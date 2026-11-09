FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY gateway/package.json gateway/
COPY control/package.json control/
RUN npm ci
COPY gateway gateway
RUN npm run build -w @phonehome/push-gateway

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8789
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY gateway/package.json gateway/
COPY control/package.json control/
RUN npm ci --omit=dev -w @phonehome/push-gateway
COPY --from=build /app/gateway/dist gateway/dist
EXPOSE 8789
CMD ["node", "gateway/dist/index.js"]
