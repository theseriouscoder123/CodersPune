# Baton web (Next.js). The /api/* rewrite target is fixed at build time, so API_ORIGIN is a build argument.
FROM node:22-slim AS build
WORKDIR /web
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim
WORKDIR /web
ARG API_ORIGIN=http://api:8000
ENV NODE_ENV=production API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1
COPY --from=build /web/package.json /web/next.config.ts ./
COPY --from=build /web/node_modules ./node_modules
COPY --from=build /web/.next ./.next
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
