FROM node:20-bookworm-slim

# Set timezone
ENV TZ=Europe/Paris

# Install dependencies required for Playwright Firefox
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && npx playwright install --with-deps firefox \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy project files
COPY . .

# Expose the dashboard port
EXPOSE 8080

# Run the server
CMD ["node", "server.js"]
