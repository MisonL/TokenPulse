# Host-Build Dockerfile (Verification Mode)
# Uses host's node_modules and built assets to bypass registry issues.

FROM oven/bun:1.3.6
WORKDIR /app

# Runtime dependencies
RUN apt-get update && apt-get install -y curl

# Copy project files
COPY package.json bun.lock .npmrc ./
COPY frontend/package.json ./frontend/package.json

# Copy pre-installed node_modules from host
COPY node_modules ./node_modules

# Copy source code and config
COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY tsconfig.json ./

# Copy pre-built frontend assets
COPY frontend/dist ./frontend/dist

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_FILE_NAME=data/credentials.db

# Expose Port
EXPOSE 3000

# Start Command
CMD ["bun", "run", "start"]
