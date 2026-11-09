ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

# PhoneHome Mothership — Node 20 on HA base image.
RUN apk add --no-cache nodejs npm

WORKDIR /opt/phonehome
# Build context is repo root when publishing; for local HA, expect prebuilt tarball.
COPY server/package.json server/package-lock.json* ./server/
COPY server/dist ./server/dist
COPY web/public ./web/public
COPY haos/phonehome/run.sh /
RUN chmod a+x /run.sh \
  && cd /opt/phonehome/server && npm ci --omit=dev || npm install --omit=dev

ENV PHONEHOME_DATA_DIR=/data/phonehome
ENV PORT=8787
EXPOSE 8787

CMD ["/run.sh"]
