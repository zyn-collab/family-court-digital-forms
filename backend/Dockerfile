# Family Court digital forms — the whole system in one container: the backend serves the
# site (app/) and the API on one address.
# Build from the repository root:  docker build -f backend/Dockerfile -t fc-forms .
# Run:  docker run -p 8080:4000 -v fc-data:/data fc-forms
FROM node:22-alpine
WORKDIR /srv
COPY backend/ ./backend/
COPY app/ ./app/
RUN rm -f backend/.env && mkdir -p /data && chown node:node /data
WORKDIR /srv/backend
ENV FC_PORT=4000 \
    FC_STORE=sqlite \
    FC_DB_PATH=/data/familycourt.db \
    FC_DATA_DIR=/data \
    FC_UPLOADS_DIR=/data/uploads \
    FC_OUTBOX_PATH=/data/outbox.jsonl \
    FC_EVENT_LOG_PATH=/data/events.jsonl \
    FC_BACKUP_DIR=/data/backups
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
USER node
CMD ["node", "server.js"]
