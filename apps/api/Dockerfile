# KDCN API — production image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t kdcn-api .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @kdcn/api...
COPY apps/api apps/api
RUN pnpm --filter @kdcn/api exec prisma generate && pnpm --filter @kdcn/api build \
 && pnpm --filter @kdcn/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/prisma /out/ \
 && cd /out && npx prisma generate

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 kdcn && mkdir -p /data/storage && chown kdcn /data/storage
WORKDIR /app
COPY --from=build --chown=kdcn /out /app
ENV NODE_ENV=production PORT=4000 STORAGE_LOCAL_DIR=/data/storage
USER kdcn
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations are applied by a separate release step: `npx prisma migrate deploy` (see docs/DEPLOYMENT.md)
CMD ["node", "dist/main.js"]
