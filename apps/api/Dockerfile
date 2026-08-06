# Built with context = monorepo root (see infra/docker-compose.yml), same
# reasoning as apps/web/Dockerfile: a build scoped to apps/api alone has no
# pnpm-workspace.yaml/root lockfile, so `pnpm install` falls back to a
# non-workspace-aware standalone install that doesn't link devDependency
# binaries (e.g. @nestjs/cli) correctly — `nest build` then fails with
# MODULE_NOT_FOUND. A workspace-filtered install from the real root fixes it.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @aether/api... || pnpm install --filter @aether/api...
COPY apps/api ./apps/api
RUN pnpm --filter @aether/api run build

FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/package.json
# ts-node/tsconfig-paths/typescript are real (non-dev) dependencies here —
# `pnpm run migration:run`/`seed` (docs/README.md quick start) run against
# TS source via ts-node in this same runtime container, not compiled dist,
# so they need to work post-`--prod` install too.
RUN pnpm install --frozen-lockfile --prod --filter @aether/api... || pnpm install --prod --filter @aether/api...
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
