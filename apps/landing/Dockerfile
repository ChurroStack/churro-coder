# Build context must be the repo root so apps/desktop/assets is available
# for the prebuild asset-processing step. From the repo root run:
#   docker build -f apps/landing/Dockerfile -t churro-landing .

# ---------- deps ----------
FROM oven/bun:1 AS deps
WORKDIR /app/apps/landing
COPY apps/landing/package.json apps/landing/bun.lock ./
RUN bun install --frozen-lockfile

# ---------- builder ----------
FROM oven/bun:1 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pil \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/apps/landing/node_modules ./apps/landing/node_modules
COPY apps/landing ./apps/landing
COPY apps/desktop/assets ./apps/desktop/assets
COPY apps/desktop/build ./apps/desktop/build
WORKDIR /app/apps/landing
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---------- runner ----------
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/static ./apps/landing/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/public ./apps/landing/public

USER nextjs
EXPOSE 3000

CMD ["bun", "apps/landing/server.js"]
