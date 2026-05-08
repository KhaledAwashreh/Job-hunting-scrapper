# Multi-stage Dockerfile for Job Hunter
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files first (leverage Docker cache)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Final stage
FROM node:18-alpine

WORKDIR /app

# Copy only production dependencies and source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY --from=builder /app/.env.example ./.env

# Create necessary directories
RUN mkdir -p /app/data/resumes /app/public

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Run the application
CMD ["node", "src/server.js"]
