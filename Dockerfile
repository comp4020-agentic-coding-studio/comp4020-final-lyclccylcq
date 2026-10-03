# syntax = docker/dockerfile:1

# The gym is plain Node: its own http server and the built-in SQLite
# (node:sqlite), with TypeScript run as-is by Node's type stripping. No runtime
# dependencies, so nothing to install and nothing to build. It serves HTTP on
# 0.0.0.0:$PORT (fly.toml sets PORT), publishes README.md at /readme/, and keeps
# its database on the /data volume.
FROM docker.io/library/node:24.21.0-slim
WORKDIR /app
COPY package.json README.md ./
COPY src/ src/
COPY public/ public/
COPY docs/ docs/
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
