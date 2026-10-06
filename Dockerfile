# ==============================================================================
# Multi-Stage Dockerfile — edtech-cloud-deploy
# ==============================================================================
# Stage 1: Build stage (compile TypeScript to dist/)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci

# Copy source code and build
COPY src/ ./src/
RUN npm run build

# Prune devDependencies to keep production image minimal
RUN npm prune --omit=dev

# ==============================================================================
# Stage 2: Production runtime stage
# ==============================================================================
FROM node:22-alpine AS production

LABEL maintainer="EdTech Cloud Engineering Team"
LABEL description="Containerized Node.js queue consumer & API with elastic auto-scaling"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV METRICS_PORT=9464

# Copy runtime files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Non-root user for principle of least privilege
USER node

# Expose API port and metrics port
EXPOSE 3000 9464

# Container healthcheck targeting the API /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/health || exit 1

# Default command starts index.js which delegates to APP_ROLE (api or worker)
CMD ["node", "dist/index.js"]
