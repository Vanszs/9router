# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm install

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Tailscale static binaries for Alpine Linux (bundled so tunnel works in Docker).
# Fetches the latest stable tailscale and tailscaled. Override with --build-arg.
FROM alpine:3.19 AS tailscale
ARG TAILSCALE_VERSION=1.80.3
ARG TARGETARCH
RUN apk add --no-cache curl ca-certificates && \
  mkdir -p /out && \
  TARCH=${TARGETARCH:-amd64} && \
  case "$TARCH" in \
    amd64) TS_ARCH=amd64 ;; \
    arm64) TS_ARCH=arm64 ;; \
    arm) TS_ARCH=arm ;; \
    *) echo "Unsupported arch: $TARCH"; exit 1 ;; \
  esac && \
  curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}.tgz" -o /tmp/tailscale.tgz && \
  tar -xzf /tmp/tailscale.tgz -C /tmp && \
  cp /tmp/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}/tailscale /out/tailscale && \
  cp /tmp/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}/tailscaled /out/tailscaled && \
  chmod +x /out/tailscale /out/tailscaled

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data
# API_KEY_SECRET is required by src/shared/utils/apiKey.js (generateCrc uses it
# as the HMAC secret for API keys). Provide a sensible default so GHCR installs
# work out-of-the-box; override at runtime with
#   -e API_KEY_SECRET="$(openssl rand -hex 32)"
# for production deployments to invalidate keys minted by the default.
ENV API_KEY_SECRET=vansrouter-dev-default-change-me-in-production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
# Bundle Tailscale binaries into /usr/local/bin so they survive the /app/data volume mount.
COPY --from=tailscale /out/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /out/tailscaled /usr/local/bin/tailscaled

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# Tailscale Funnel requires CAP_NET_ADMIN for TUN mode; keep su-exec for dropping privileges.
# When using host socket mode (TAILSCALE_USE_HOST_SOCKET=true), no extra capability is needed.
RUN apk --no-cache upgrade && apk --no-cache add su-exec ip6tables iptables && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
