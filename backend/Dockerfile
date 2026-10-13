# Family Court digital forms — backend service
# Build from the repository root:  docker build -f backend/Dockerfile -t fc-forms-api .
# Run:  docker run -p 4000:4000 --env-file backend/.env -v fc-data:/data fc-forms-api
FROM node:22-alpine
WORKDIR /srv/backend
COPY backend/ ./
ENV FC_PORT=4000 \
    FC_STORE=sqlite \
    FC_DB_PATH=/data/familycourt.db \
    FC_DATA_DIR=/data \
    FC_UPLOADS_DIR=/data/uploads \
    FC_OUTBOX_PATH=/data/outbox.jsonl \
    FC_EVENT_LOG_PATH=/data/events.jsonl
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
USER node
CMD ["node", "server.js"]
