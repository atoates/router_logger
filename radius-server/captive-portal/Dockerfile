# Captive Portal Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application
COPY . .

# Fix file permissions for node user (files are copied as root, need to be readable by node user)
RUN chown -R node:node /app && \
    chmod -R 755 /app/src/public && \
    chmod 644 /app/src/public/images/*.png /app/src/public/images/*.gif 2>/dev/null || true

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run as non-root
USER node

CMD ["node", "src/server.js"]

