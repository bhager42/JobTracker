.PHONY: install dev dev-api dev-web test e2e lint format build run

export PATH := $(HOME)/.local/bin:$(PATH)
DEV_DATA := $(CURDIR)/.data
# Use docker if present, otherwise podman.
DOCKER ?= $(shell command -v docker >/dev/null 2>&1 && echo docker || echo podman)

install:
	cd backend && uv sync
	cd frontend && pnpm install

# Backend on :8000 with reload, Vite on :5173 proxying /api to it.
dev:
	$(MAKE) -j2 dev-api dev-web

dev-api:
	cd backend && DATA_DIR=$(DEV_DATA) uv run uvicorn app.main:app --reload --port 8000

dev-web:
	cd frontend && pnpm dev

test:
	cd backend && uv run pytest -q
	cd frontend && pnpm test

# Playwright against the real app on a throwaway data dir (builds the frontend first).
# Set E2E_BASE_URL to test a running instance, e.g. `make run` in another terminal.
e2e:
	cd frontend && pnpm e2e

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy
	cd frontend && pnpm lint

format:
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && pnpm format

build:
	$(DOCKER) build --format docker -t jobtracker:dev .

run:
	$(DOCKER) compose up --build
