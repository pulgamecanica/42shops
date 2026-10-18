# 42 Shops production image. Built and pushed to GHCR by the release workflow,
# or locally with `make docker-build`. Configure it with env vars at runtime.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine
ARG VERSION=dev
ARG CODENAME=dev
LABEL org.opencontainers.image.source="https://github.com/pulgamecanica/42shops" \
      org.opencontainers.image.title="42 Shops" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.description="Every 42 campus shop, in one place (${CODENAME})"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
