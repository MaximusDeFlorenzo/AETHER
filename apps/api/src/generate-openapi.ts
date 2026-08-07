import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildSwaggerDocument } from './swagger.config';

// Standalone codegen entrypoint for `packages/contracts` (see its
// package.json `generate` script) — boots the full app (needs a reachable
// Postgres/Redis, same as `main.ts`, since TypeOrmModule connects on
// bootstrap) just long enough to build the Swagger document, writes it to a
// static file, then exits. Replaces the previous approach of pointing
// openapi-typescript at a running server's `/docs-json`, which doesn't
// survive in CI without extra process-lifecycle plumbing.
const OUTPUT_PATH = resolve(__dirname, '../openapi.json');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildSwaggerDocument(app);
  writeFileSync(OUTPUT_PATH, JSON.stringify(document, null, 2));
  await app.close();
  console.log(`Wrote OpenAPI document to ${OUTPUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to generate OpenAPI document:', error);
    process.exit(1);
  });
