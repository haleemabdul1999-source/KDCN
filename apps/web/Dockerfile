# KDCN web — production image (Next.js standalone). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t kdcn-web .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @kdcn/web...
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kdcn/web build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 kdcn
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=kdcn /repo/apps/web/.next/standalone ./
COPY --from=build --chown=kdcn /repo/apps/web/.next/static ./apps/web/.next/static
USER kdcn
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# API_INTERNAL_URL must point at the API service (runtime configuration).
CMD ["node", "apps/web/server.js"]
