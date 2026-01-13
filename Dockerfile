# Multi-stage Dockerfile

# Stage 1: Build Frontend
FROM oven/bun:latest as frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install
COPY frontend .
RUN bun run build

# Stage 2: Build Backend
FROM oven/bun:latest as backend-builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY . .
# Remove src/frontend source to keep image clean (optional, but good practice)
RUN rm -rf frontend

# Stage 3: Final Image
FROM oven/bun:latest
WORKDIR /app

# Copy backend deps and source
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src ./src
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/drizzle.config.ts ./
COPY --from=backend-builder /app/tsconfig.json ./

# Copy built frontend assets
COPY --from=backend-builder /app/drizzle ./drizzle

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_FILE_NAME=credentials.db

# Expose Port
EXPOSE 3000

# Start Command
CMD ["bun", "run", "start"]
