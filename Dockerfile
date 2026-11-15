FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io git ca-certificates openssh-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
COPY docker-entrypoint.sh /usr/local/bin/webbase-entrypoint
RUN chmod 755 /usr/local/bin/webbase-entrypoint
ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/webbase-entrypoint"]
CMD ["node", "server.js"]
