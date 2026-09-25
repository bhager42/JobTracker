# CLAUDE.md

JobTracker is a self-hosted, single-user job application tracker. It ships as one Docker container (FastAPI + SQLite backend, React/Vite/Tailwind/shadcn frontend) deployed on TrueNAS SCALE 25.10.

**`PLAN.md` is the source of truth.** Read it before starting work and implement one phase at a time (Section 12). Finish each phase's acceptance criteria before starting the next.

## Conventions
- Backend: Python 3.13, `uv`, FastAPI, SQLAlchemy 2.x typed models, Pydantic v2, Alembic. Every schema change needs a migration. Lint with Ruff and type-check with mypy (strict on `backend/app/`).
- Frontend: TypeScript strict, `pnpm`, shadcn/ui (radix-nova style; add components with `pnpm dlx shadcn@latest add <name>`), TanStack Router + Query, oxlint + Prettier. Regenerate API types with `pnpm gen:api` after any API change. Never hand-edit the generated types.
- Status keys, labels, and colors are defined in exactly one place per side: `backend/app/enums.py` and `frontend/src/lib/status.ts`.
- Time: store UTC timestamps. `date_applied` is a plain date. Bucket metrics in the container `TZ`, with ISO weeks starting Monday.
- The auto-close service takes an injected clock. Tests must never depend on the real current time.
- Uvicorn runs with exactly **one worker**, because the in-process scheduler depends on it.
- Security rules in PLAN.md Section 9 are requirements: no CORS, Host/Origin checks, uploads stored under UUID names only, and the container runs as non-root 568:568 with a read-only rootfs.

## Commands
- `make install`: `uv sync` + `pnpm install`
- `make dev`: backend on :8000 (uvicorn --reload, data in `./.data`) + Vite on :5173 proxying `/api`
- `make test`: pytest + vitest
- `make e2e`: Playwright smoke, board, phone-width, and axe accessibility tests against the real app (throwaway data dir). The first time, run `pnpm exec playwright install chromium` in `frontend/`.
- `make lint` / `make format`: ruff, mypy, oxlint, tsc, prettier
- `make build` / `make run`: image build / prod-like run at http://localhost:8080 (uses docker, or podman if docker is absent)

## Environment notes
- `uv` is installed at `~/.local/bin/uv`; the Makefile adds it to PATH. Python 3.13 is managed by uv (system Python is 3.14).
- This dev machine has podman (no docker). Build with `--format docker` so the HEALTHCHECK is kept.
- New Alembic migrations: `cd backend && DATA_DIR=../.data uv run alembic revision --autogenerate -m "..."` after importing new models in `app/models.py`. Migrations run automatically at startup.
