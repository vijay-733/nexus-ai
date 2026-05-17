FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

# Install all deps (incl. dev for tsx build)
FROM base AS deps
RUN npm ci

# Build React frontend
FROM deps AS build
COPY . .
RUN npm run build

# Production image
FROM base AS production
ENV NODE_ENV=production

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
COPY --from=build /app/server       ./server
COPY tsconfig*.json ./

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3002/health/live || exit 1

CMD ["npx", "tsx", "server/index.ts"]
