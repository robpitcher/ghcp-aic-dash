
# syntax=docker/dockerfile:1

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
# The build reuses an existing npm configuration instead of restating it. It
# mounts an `.npmrc` as a build secret, so an internal feed — and any
# credentials it carries — reaches `npm ci` without entering an image layer,
# the image history, or the build cache. The secret is optional, so a plain
# `docker build .` installs from the public registry with no setup. To install
# from an internal feed, pass your own configuration:
#   docker build --secret id=npmrc,src=$HOME/.npmrc .
# Compose does this for you: set NPM_CONFIG_USERCONFIG in `.env` to that path
# (it defaults to the repository's committed `.npmrc`).
# NPM_REGISTRY stays available for environments with no `.npmrc` to pass, and
# overrides the mounted configuration when set:
#   docker build --build-arg NPM_REGISTRY=<mirror-url> .
# Either way npm rewrites the lockfile's registry URLs to that host, so the
# committed lockfile stays valid and builds stay reproducible.
ARG NPM_REGISTRY
# The version-check ping talks to the registry on every npm invocation.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Install from the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
  if [ -n "$NPM_REGISTRY" ]; then export NPM_CONFIG_REGISTRY="$NPM_REGISTRY"; fi \
  && npm ci

# ── Demo ──────────────────────────────────────────────────────────────────────
# Credential-free local demo. Demo mode never activates in a production build,
# so this stage runs the development server with synthetic data. It is for
# local evaluation only and must not be deployed.
FROM node:24-alpine AS demo
WORKDIR /app
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV DEMO_ENV=true
ENV PORT=3000
# The dev server writes its build cache into /app/.next at runtime.
RUN chown node:node /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]

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
