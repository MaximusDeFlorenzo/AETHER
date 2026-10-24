# Background worker process (BullMQ)

`village-population-import` (bulk CSV upload of kecamatan/kelurahan
population data) runs its heavy work — CSV parsing, region matching, and
the actual database write — as BullMQ background jobs instead of inline in
an HTTP request, so a 100,000-row file never risks an HTTP timeout. This
document is about running the worker side of that; the feature itself is
described in `docs/DATABASE_SCHEMA.md` §6c and the controller/service under
`src/village-population-import/`.

## Two queues, two processors

| Queue | Processor | Does |
|---|---|---|
| `village-population-validation` | `ValidationProcessor` | Streams the uploaded CSV, parses/matches/classifies every row, persists results in checkpointed chunks. `UPLOADED → VALIDATING → READY` (or `FAILED`). |
| `village-population-confirm` | `ImportProcessor` | Writes `VALID` rows into `village_populations` in checkpointed chunks, re-checking for concurrent conflicts. `QUEUED → IMPORTING → COMPLETED` / `COMPLETED_WITH_ERRORS` (or `FAILED`). |

Both connect to the same Redis instance as the rest of the app
(`REDIS_URL`), via a dedicated ioredis connection registered once in
`src/queue/queue.module.ts` (BullMQ workers need
`maxRetriesPerRequest: null`, which is the wrong setting for
`CacheService`'s own connection — hence the separate connection, not a
separate Redis).

## Running it

**Local development — nothing extra to run.** `pnpm run start:dev` boots
`AppModule`, which includes `VillagePopulationImportModule` and therefore
both processors. Uploading a file in the dev environment gets picked up
by that same process. This is the simplest option and what
`docker-compose`/local dev defaults to.

**As a separate process** (closer to how you'd actually deploy this — an
API restart shouldn't drop an in-flight 100k-row import, and vice versa):

```bash
# dev, with file-watch (nest start --entryFile worker)
pnpm run worker

# prod, after `pnpm run build` (nest build already emits dist/worker.js
# alongside dist/main.js — both are compiled from src/**/*.ts by the same
# `nest build` run, no separate build step needed)
pnpm run worker:prod
```

`src/worker.ts` boots `WorkerModule` (`src/worker.module.ts`) —
**deliberately NOT `AppModule`** — via
`NestFactory.createApplicationContext`, with no HTTP listener.
`WorkerModule` wires up only what the two processors need: `DatabaseModule`,
`QueueModule`, `StorageModule`, and `VillagePopulationImportModule`. It was
originally `AppModule`, on the reasoning that reusing the API's own
dependency graph was simplest; verified live in a 100k-row end-to-end test
that this was wrong — `AppModule` also wires up every *other* scheduled
background service in the app (`IngestionScheduler`'s BMKG/weather/
landslide-trigger/PetaBencana/NASA FIRMS polling, `RiskEngineOrchestrationService`,
`NotificationsService`, etc.), none of which have anything to do with job
processing. Running the worker against full `AppModule` meant those
unrelated cron jobs ran a *second* time (once in the API process, once in
the worker process), competing for the same Postgres connection pool as
the import job itself — and a pre-existing concurrency issue in that
unrelated code (observed as a `client.query() called while already
executing a query` warning) stalled the import mid-run with no crash and
no forward progress, confirmed by watching `lastImportedRowNumber` freeze
while the worker process kept burning CPU. Switching the worker's own
root module to something minimal, scoped to exactly what this feature
needs, fixed it — without touching the unrelated scheduler/risk-engine
code that has the underlying bug (out of scope for this feature, since
fixing the worker's own boot module was sufficient).

Running both `start:dev`/`start:prod` (`AppModule`, in-process workers)
AND a separate `worker`/`worker:prod` process (`WorkerModule`) at the same
time is fine — BullMQ workers on the same queue just share the work (extra
concurrency), they don't conflict.

**To run the API without it also consuming jobs** (so the two roles are
truly independent — an API restart never interrupts an in-flight import,
and killing the worker never makes the API unresponsive), set
`ENABLE_JOB_PROCESSORS=false` on the API process's environment:

```bash
ENABLE_JOB_PROCESSORS=false pnpm run start:prod   # API only
pnpm run worker:prod                              # job processing only
```

This must be a real OS environment variable on that process (not just a
`.env` file entry) — `village-population-import.module.ts` reads
`process.env` directly when building its `providers` array, since that
happens before Nest's `ConfigModule` (and therefore dotenv) exists. Left
unset (or `true`), a process runs both roles — the default, and what
plain `start:dev` uses for local development.

## Configuration

All optional, in `env.validation.ts` with the defaults shown:

| Var | Default | Meaning |
|---|---|---|
| `VILLAGE_POPULATION_IMPORT_CHUNK_SIZE` | `2000` | Rows per checkpointed transaction, both validation and import. Larger = fewer round-trips but a bigger single transaction and a coarser resume granularity after a crash. |
| `VILLAGE_POPULATION_IMPORT_VALIDATION_CONCURRENCY` | `1` | How many validation jobs one worker process runs at once (BullMQ `Worker.concurrency`, set in `ValidationProcessor.onModuleInit` — see the comment there for why this can't be a static `@Processor()` option). |
| `VILLAGE_POPULATION_IMPORT_CONFIRM_CONCURRENCY` | `1` | Same, for the import/confirm queue. |

Also relevant, already existing: `REDIS_URL` (queue connection),
`STORAGE_*` (where the uploaded file itself lives — S3/MinIO, via
`StorageService`).

## Failure and recovery

- **Transient errors** (DB hiccup, Redis blip, storage read failure)
  propagate out of `process()` and let BullMQ's own retry/backoff
  (`attempts: 3`, exponential backoff, set in
  `village-population-import.service.ts`'s `JOB_OPTS`) handle it. A retried
  attempt resumes from `lastValidatedRowNumber` / `lastImportedRowNumber`,
  never restarts from row 1.
- **Permanent validation errors** (the file isn't structurally valid CSV)
  are caught inside `ValidationProcessor.process()` and set the batch
  straight to `FAILED` — no point retrying a file that will never parse.
- **All retries exhausted, or the job stalled with no worker resuming it**
  (a worker process died mid-job and nothing else picked up the lock):
  each processor's `@OnWorkerEvent('failed')` handler is the backstop —
  it only fires once BullMQ has truly given up
  (`job.attemptsMade >= job.opts.attempts`), and moves the batch to
  `FAILED` with a message, so a batch can never sit in `VALIDATING` or
  `IMPORTING` forever with nothing watching it.
- **Retrying a `FAILED` batch** is a user action —
  `POST /village-population-imports/:id/retry` — not automatic. It
  re-enqueues from wherever the batch's checkpoint says to resume (see
  `VillagePopulationImportService.retryBatch`), guarded by the same
  atomic `WHERE status = 'failed'` compare-and-swap `confirmBatch` uses,
  so two concurrent retry calls can't both enqueue a job.

## What this does *not* need

No separate infrastructure beyond what's already in
`infra/docker-compose.yml` — Redis is already provisioned and required by
`env.validation.ts`. No new queue technology was introduced beyond BullMQ
itself (added as a dependency in this change: `bullmq`, `@nestjs/bullmq`).
