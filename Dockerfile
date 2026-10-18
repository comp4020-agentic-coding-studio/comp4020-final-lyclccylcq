# syntax = docker/dockerfile:1

# Wayline is plain Node: its own http server and the built-in SQLite
# (node:sqlite), with TypeScript run as-is by Node's type stripping. One
# runtime dependency (the OpenAI SDK), installed from the lockfile; nothing to
# build. It serves HTTP on 0.0.0.0:$PORT (fly.toml sets PORT), publishes
# README.md at /readme/, and keeps its database on the /data volume. No .env or
# key is ever copied in: on Fly, keys arrive as secrets at runtime.
FROM docker.io/library/node:24.21.0-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate && pnpm install --prod --frozen-lockfile && corepack disable
COPY README.md ./
COPY src/ src/
COPY public/ public/
COPY docs/ docs/
ENV NODE_ENV=production DATA_DIR=/data
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
