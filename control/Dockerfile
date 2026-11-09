FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY gateway/package.json gateway/
COPY control/package.json control/
RUN npm ci
COPY control control
RUN npm run build -w @phonehome/control
ENV NODE_ENV=production PORT=8791 CONTROL_DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8791
CMD ["node", "control/dist/index.js"]
