# Built with context = monorepo root (see infra/docker-compose.yml), not
# apps/web alone: apps/web depends on the workspace package
# `@aether/contracts` (packages/contracts), which a build scoped to apps/web
# can't see. apps/api has no intra-workspace dependency, so its Dockerfile
# stays scoped to apps/api.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc* ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @aether/web... || pnpm install --filter @aether/web...
COPY apps/web ./apps/web
COPY packages/contracts ./packages/contracts
# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time, not
# read at container runtime — must be declared as build ARGs and re-exported
# as ENV before `next build` runs, or a docker-compose override of these would
# silently have no effect on the built image. Same requirement ORION documented.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000
ARG NEXT_PUBLIC_CARTO_BASEMAP_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_CARTO_BASEMAP_KEY=$NEXT_PUBLIC_CARTO_BASEMAP_KEY
RUN pnpm --filter @aether/web run build

FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/package.json ./apps/web/package.json

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "run", "start"]
