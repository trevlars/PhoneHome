FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
COPY gateway/package.json gateway/
COPY control/package.json control/
RUN npm install
COPY . .
RUN npm run build -w web
ENV PORT=8787 DATA_DIR=/app/data
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "server"]
