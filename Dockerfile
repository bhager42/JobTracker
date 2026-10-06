# syntax=docker/dockerfile:1

# ---- frontend build ----
# Base images are pinned by digest (PLAN.md §9.7); Dependabot proposes updates.
FROM docker.io/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# ---- backend runtime ----
FROM docker.io/library/python:3.13-slim@sha256:b92e6b9bb1ea9d826e9956fd8d30bf18bc384c130231d74fdf0ba3460c290b0b AS runtime
ARG APP_VERSION=0.1.0
ARG BUILD_SHA=dev
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    DATA_DIR=/data \
    PORT=8080 \
    APP_VERSION=${APP_VERSION} \
    BUILD_SHA=${BUILD_SHA}
# Pick up Debian security fixes published after the base image was built, so the image scan
# isn't blocked waiting for a new base image.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
# The cache mount keeps uv's download cache out of the image (smaller, and nothing stale to scan).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project && rm /usr/local/bin/uv
# The app runs from /app/.venv; the base image's own pip is never used at runtime, and its
# vendored libraries are what vulnerability scanners flag. Remove it.
RUN python -m pip uninstall --yes --no-cache-dir pip
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/app ./app
COPY --from=web /web/dist ./static
RUN mkdir -p /data && chown 568:568 /data
USER 568:568
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["/app/.venv/bin/python", "-c", "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8080\")}/api/health', timeout=4)"]
# Single worker on purpose: the auto-close scheduler must run exactly once.
CMD ["sh", "-c", "exec /app/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --no-server-header"]
