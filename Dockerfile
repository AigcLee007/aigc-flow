# Build Stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build production artifacts
RUN npm run build
RUN npm run build --workspace @aigc-flow/workflow-core
RUN npm run build --workspace @aigc-flow/db
RUN npm run build --workspace @aigc-flow/redis
RUN npm run build --workspace @aigc-flow/storage
RUN npm run build --workspace @aigc-flow/ai-gateway-core
RUN npm run build --workspace @aigc-flow/api
RUN npm run build --workspace @aigc-flow/worker

# Production Stage
FROM node:18-alpine

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/ai-gateway-core/package.json ./packages/ai-gateway-core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/redis/package.json ./packages/redis/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/workflow-core/package.json ./packages/workflow-core/package.json

# Install dependencies needed by the root v2 start scripts
RUN npm ci

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy built v2 backend artifacts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages/ai-gateway-core/dist ./packages/ai-gateway-core/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations
COPY --from=builder /app/packages/redis/dist ./packages/redis/dist
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder /app/packages/workflow-core/dist ./packages/workflow-core/dist

# Copy docs for runtime operators
COPY docs ./docs

# Expose the v2 API port
EXPOSE 3366

# Start the v2 production entrypoints
CMD ["npm", "run", "start:v2"]
