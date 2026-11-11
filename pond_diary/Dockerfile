FROM node:24-alpine
WORKDIR /app
COPY server.mjs ./
COPY public/ ./public/
ENV HOST=0.0.0.0 PORT=8099 DATA_DIR=/data SUPERVISOR_ONLY=1
CMD ["node", "server.mjs"]
