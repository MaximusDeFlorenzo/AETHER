# Deployment — VPS (backend) + Vercel (frontend)

| Where | What |
|---|---|
| VPS (1 vCPU / 2 GB / 20 GB) | `infra/docker-compose.prod.yml`: Caddy (HTTPS) → api, ai-engine, Postgres/PostGIS, Redis, MinIO |
| Vercel | `apps/web` (Next.js) |

Only Caddy is exposed (80/443). Two DNS records are needed:

| Record | Points to | Serves |
|---|---|---|
| `api.<domain>` (A) | VPS IP | REST `/api/v1`, `/docs`, `/health`, socket.io |
| `media.<domain>` (A) | VPS IP | signed report-image URLs (MinIO) |

HTTPS is mandatory: the Vercel site is HTTPS, so browsers block calls to a
plain `http://` API (mixed content). Caddy gets Let's Encrypt certificates
automatically once DNS resolves.

## 1. VPS — one-time setup (Ubuntu/Debian, as root)

```bash
# Swap — the most important step on 2 GB RAM
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf

# Docker
curl -fsSL https://get.docker.com | sh

# Firewall: SSH + HTTP(S) only
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Docker publishes ports past ufw, which is why the prod compose file
publishes nothing except Caddy.

## 2. VPS — deploy

```bash
git clone git@github.com:MaximusDeFlorenzo/AETHER.git && cd AETHER
cp infra/.env.production.example infra/.env.production
nano infra/.env.production          # domains, secrets (openssl rand -hex 32), API keys

docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d --build

# First deploy only — schema + admin user
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec api pnpm run migration:run
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec api pnpm run seed
```

Use hex secrets for `POSTGRES_PASSWORD` — it is embedded in `DATABASE_URL`,
so characters like `@ / : #` would break the URL.

Building the images on the VPS works with the swap in place but is slow
(several minutes for the api's `pnpm install` + `nest build`). If it gets
killed for memory, build on another machine with
`docker buildx build --platform linux/amd64` and push to a registry instead.

Check it:

```bash
curl https://api.<domain>/health
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production ps
docker stats --no-stream
```

### Updating

```bash
git pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d --build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec api pnpm run migration:run
docker image prune -f              # old images eat the 20 GB disk
```

## 3. Vercel — frontend

1. Import the GitHub repo in Vercel.
2. **Root Directory:** `apps/web` (framework auto-detected as Next.js; pnpm
   is picked up from the root lockfile, and the `@aether/contracts`
   workspace package resolves because Vercel includes files outside the
   root directory by default).
3. **Environment variables** (Production). `NEXT_PUBLIC_*` values are baked
   in at build time, so redeploy after changing any of them:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://api.<domain>/api/v1` |
   | `NEXT_PUBLIC_WS_URL` | `wss://api.<domain>` |
   | `NEXT_PUBLIC_SITE_URL` | `https://<project>.vercel.app` (or custom domain) |
   | `NEXT_PUBLIC_CARTO_BASEMAP_KEY` | your CARTO key |

4. Put the final Vercel origin in `CORS_ORIGIN` in `infra/.env.production`
   (exact, no trailing slash; comma-separate a custom domain too) and
   restart the api. Preview deployments get different URLs and will be
   blocked by CORS unless added.

Auth uses bearer tokens (not cookies), so the separate Vercel/VPS domains
need no cookie or SameSite setup.

## Backups

The database lives only on the VPS volume. At minimum, a nightly dump
copied off the box:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec -T postgres \
  pg_dump -U aether -Fc aether > aether-$(date +%F).dump
```

## Resource notes

Memory caps per container (sum ~2.4 GB, relies on swap at peak): postgres
600 MB, ai-engine 700 MB, api 640 MB, minio 256 MB, redis 160 MB, caddy
96 MB. If a container keeps restarting, `docker inspect <name> | grep OOMKilled`
tells you whether it hit its cap. `HOTSPOT_RETENTION_DAYS` defaults to 60
here to keep FIRMS growth in check on 20 GB.
