# Hearth hub server image.
# Build context: the server/ directory. See ../docker-compose.yml.

FROM node:22.12.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.12.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY examples ./examples
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# Config lives on a named volume; drop a hearth.yaml there to leave mock mode.
VOLUME ["/config"]
EXPOSE 8321
ENTRYPOINT ["docker-entrypoint.sh"]
