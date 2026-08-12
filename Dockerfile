
# syntax=docker/dockerfile:1

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
# Environments can point the build at an approved registry:
#   docker build --build-arg NPM_REGISTRY=<mirror-url> .
# npm rewrites the lockfile's registry.npmjs.org URLs to this host, so the
# committed lockfile stays valid and builds stay reproducible.
ARG NPM_REGISTRY
# The version-check ping talks to the registry on every npm invocation.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Install from the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Produces a self-contained server in .next/standalone (output: 'standalone').
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output + static assets + public files.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# The privileged GITHUB_BILLING_TOKEN and all other secrets are injected at
# runtime — never baked into the image.
CMD ["node", "server.js"]
