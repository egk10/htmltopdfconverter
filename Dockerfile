# Lightweight Node base image
FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000 \
    MAX_PAGES=2

# Create app directory
WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src
COPY public ./public
COPY README.md LICENSE .editorconfig . ./

# Ensure generated output dir exists
RUN mkdir -p generated

EXPOSE 3000

CMD ["node", "src/server.js"]
