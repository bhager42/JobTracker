# JobTracker — Software Development Plan

A self-hosted, single-user job application tracker packaged as one Docker container and deployed as a Custom App on **TrueNAS SCALE 25.10 ("Goldeye")**.

This document is the source of truth for implementation. Build it **phase by phase** (Section 12). Each phase ends with its acceptance criteria met and tests passing before starting the next.

---

## 1. Goals & Non-Goals

### Goals
- Track job applications: company, role, link, date applied, status, notes, and more.
- Upload and attach the resume and cover letter used for each application, and reuse documents across applications.
- Automatically move stale applications to **Not Selected (No Response)** after a configurable window (default **30 days**).
- Metrics dashboard with **weekly / monthly / yearly** views of application volume and status breakdown.
- A modern (2026) look: fast, responsive, with light and dark themes and keyboard shortcuts.
- Runs fully offline on the LAN with no external services. All data lives in one TrueNAS dataset that is easy to snapshot.

### Non-Goals (v1)
- Multiple users or accounts.
- Email or calendar integrations, job-board scraping, AI features.
- Public internet exposure. Remote access should go through a VPN such as Tailscale or WireGuard.

---

## 2. Tech Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Backend | **Python 3.13 + FastAPI**, SQLAlchemy 2.x (typed ORM), Pydantic v2, Alembic | Mature, typed, fast to build. Validation is built in. |
| Database | **SQLite** in WAL mode, file on a mounted volume | See Section 3. |
| Scheduler | In-process asyncio background task started in the FastAPI `lifespan` | No extra dependency. One worker means no duplicate runs. |
| Frontend | **React 19 + TypeScript + Vite**, **Tailwind CSS v4**, **shadcn/ui** (Radix primitives), **lucide-react** icons | The current standard for a clean, modern UI. |
| Data fetching | TanStack Query | Caching and optimistic updates |
| Routing | TanStack Router (code-based routes in `src/router.tsx`) | Type-safe routes |
| Tables | TanStack Table | Sorting, filtering, column visibility |
| Kanban | dnd-kit | Drag cards between status columns |
| Charts | Recharts (via shadcn/ui `chart` components) | Matches the design system and themes |
| Forms | react-hook-form + zod | Client-side validation that mirrors the API schemas |
| Dates | date-fns | Week, month, and year bucketing in the UI |
| Tooling | `uv` (Python), `pnpm` (JS), Ruff + mypy, oxlint + Prettier, pytest, Vitest, Playwright | |
| Container | Multi-stage Dockerfile: Node builds the SPA, then a slim Python runtime serves both the API and the static files | One image, one port |

Use the **latest stable** versions of each at implementation time and pin them in lockfiles (`uv.lock`, `pnpm-lock.yaml`).

---

## 3. Database Choice

**Use SQLite.** It fits this workload best:

- One user, low write volume. SQLite handles this easily.
- No second container, no credentials, nothing to maintain.
- The whole database is one file (`/data/jobtracker.db`) in a ZFS dataset. TrueNAS snapshots and replication give you backups for free.
- WAL mode plus `PRAGMA foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- **Caveat:** the dataset must be local ZFS (a host path), **not** an NFS or SMB mount. WAL is unsafe on network filesystems.

Alternatives considered:
- **PostgreSQL**: overkill. It needs a second container, credentials, and upgrade work. Only worth it if this ever becomes multi-user.
- **DuckDB**: great for analytics but not suited to transactional CRUD. SQLite `GROUP BY` queries are more than fast enough for the metrics here.

Keep the ORM layer free of SQLite-specific code, other than the date-bucketing helpers, which live in one module. Then a later move to Postgres is just a config change plus rewriting that module.

---

## 4. Status Model

### Statuses

| Key | Label | Group | Terminal? | Notes |
|---|---|---|---|---|
| `saved` | Saved / Wishlist | Pre-application | No | Optional. A job you plan to apply to. Excluded from "applied" metrics. |
| `applied` | Applied | Active | No | Default for new entries |
| `screening` | Recruiter Screen | Active | No | First contact or phone screen |
| `interviewing` | Interviewing | Active | No | Uses the `interview_rounds` counter |
| `offer` | Offer Received | Active | No | |
| `accepted` | Accepted | Closed – Positive | Yes | |
| `declined` | Offer Declined | Closed – Neutral | Yes | You turned down an offer |
| `withdrawn` | Withdrawn | Closed – Neutral | Yes | You pulled out of the process |
| `rejected_no_interview` | Rejected (No Interview) | Closed – Negative | Yes | Explicit rejection before any interview |
| `rejected_after_interview` | Rejected (After Interview) | Closed – Negative | Yes | Shows the round reached, e.g. "after round 2" |
| `not_selected` | Not Selected (No Response) | Closed – Negative | Yes | **Set by the automation** (ghosted). Can also be set manually. |
| `closed` | Position Closed | Closed – Neutral | Yes | Posting was pulled or filled internally |

**Design note:** there is no separate "Rejected (1st Interview)", "Rejected (2nd Interview)" and so on. Use `rejected_after_interview` plus the `interview_rounds` integer. This keeps the status list short and still gives per-round detail in metrics, e.g. "Rejected after round 1: 4, round 2: 2".

Keeping `not_selected` (automatic, no response) separate from `rejected_no_interview` (explicit rejection) lets the dashboard show a **ghost rate**.

Statuses live in a Python `StrEnum` shared with the frontend through the generated OpenAPI types. Labels and colors are defined once in the frontend (`src/lib/status.ts`). Transitions are **not** restricted: any status can move to any other, because real life is messy. Every change is recorded in history.

---

## 5. Data Model

```
applications
  id                  INTEGER PK
  company             TEXT NOT NULL
  job_title           TEXT NOT NULL
  job_url             TEXT NULL            -- validated http(s) only
  location            TEXT NULL
  work_mode           TEXT NULL            -- remote | hybrid | onsite
  employment_type     TEXT NULL            -- full_time | part_time | contract | internship
  salary_min          INTEGER NULL
  salary_max          INTEGER NULL
  salary_currency     TEXT NULL DEFAULT 'USD'
  source              TEXT NULL            -- LinkedIn, Indeed, Referral, Company site, Recruiter, Other
  contact_name        TEXT NULL
  contact_email       TEXT NULL
  date_applied        DATE NULL            -- required unless status = saved; defaults to today
  status              TEXT NOT NULL DEFAULT 'applied'
  status_changed_at   DATETIME NOT NULL    -- UTC; drives auto-close
  interview_rounds    INTEGER NOT NULL DEFAULT 0
  auto_close_exempt   BOOLEAN NOT NULL DEFAULT 0   -- "pin": never auto-close
  notes               TEXT NULL            -- markdown
  job_description     TEXT NULL            -- paste of the JD (postings disappear)
  archived            BOOLEAN NOT NULL DEFAULT 0
  created_at, updated_at DATETIME NOT NULL (UTC)
  INDEX(status), INDEX(date_applied), INDEX(company)

status_history
  id                  INTEGER PK
  application_id      FK -> applications ON DELETE CASCADE
  from_status         TEXT NULL
  to_status           TEXT NOT NULL
  changed_at          DATETIME NOT NULL (UTC)
  source              TEXT NOT NULL        -- 'user' | 'automation' | 'import'
  note                TEXT NULL

documents                                  -- a reusable document library
  id                  INTEGER PK
  kind                TEXT NOT NULL        -- resume | cover_letter | other
  display_name        TEXT NOT NULL        -- e.g. "Resume – Backend v3"
  original_filename   TEXT NOT NULL
  stored_filename     TEXT NOT NULL UNIQUE -- uuid4 + safe extension; never user-controlled
  mime_type           TEXT NOT NULL
  size_bytes          INTEGER NOT NULL
  sha256              TEXT NOT NULL        -- dedupe: identical uploads reuse the stored file
  uploaded_at         DATETIME NOT NULL

application_documents                      -- many-to-many
  application_id      FK ON DELETE CASCADE
  document_id         FK ON DELETE RESTRICT
  PK(application_id, document_id)

settings                                   -- key/value, typed through a Pydantic Settings model
  key TEXT PK, value TEXT (JSON)
```

Why a document library: you often send the same resume to many jobs. Upload it once, attach it many times. You can still upload a new file straight from the application form, which creates a library entry and links it in one step.

Deleting a document that is still linked is blocked with a clear message listing the linked applications. Deleting an application removes its links but keeps the documents.

---

## 6. Auto-Close Automation

**Rule:** an application is auto-closed when all of these are true:
- `status` is in the configured eligible set (default: `applied` only; `screening` can be added in settings)
- `auto_close_exempt = false` and `archived = false`
- `status_changed_at` is more than **N days** ago (default `30`, allowed range 1–365)

**Action:** set `status = not_selected`, update `status_changed_at`, and insert a `status_history` row with `source='automation'` and a note like `"Auto-closed after 30 days with no update"`.

**Implementation:**
- `app/services/auto_close.py` exposes `run_auto_close(session, now) -> list[int]`. It is a pure, idempotent function that takes an injectable clock, so tests can control time.
- A background task in the FastAPI `lifespan` runs it **once at startup**, then **every hour**. Hourly with an idempotent query is simpler and more robust than a cron expression, and catches up after NAS downtime.
- Run uvicorn with **one worker** (documented in the Dockerfile) so there is only one scheduler.
- Settings UI: window in days, eligible statuses, an enable/disable toggle, and a **"Run now"** button (`POST /api/automation/auto-close/run`) that reports how many applications were closed.
- UI hints:
  - Each eligible card or row shows "Auto-closes in X days". Show it as a warning when 7 days or fewer remain.
  - Applications closed by automation get a small robot icon, and there's a one-click **Undo** that restores the previous status and resets the clock.
- Env var `AUTO_CLOSE_DAYS_DEFAULT=30` seeds the setting on first run. After that the value in the database is authoritative.

---

## 7. Features & Pages

### 7.1 Layout
- A collapsible left sidebar with Dashboard, Applications, Documents, Metrics, and Settings. A top bar with global search and a theme toggle.
- A **command palette** (`⌘K` / `Ctrl+K`) to jump to any application, create a new one, or switch pages.
- Keyboard shortcuts: `N` for a new application, `/` to focus search, `G then A` for Applications, `G then M` for Metrics.

### 7.2 Dashboard (home)
- KPI tiles: Applied this week, Applied this month, Active pipeline (applied, screening, interviewing, or offer), Interview rate, Response rate.
- "Needs attention": applications that auto-close within 7 days, and offers awaiting a decision.
- A recent activity feed built from `status_history`.

### 7.3 Applications
- **Two views, toggle persisted:**
  - **Table**: sortable and filterable columns, column visibility, pagination or virtualization, row click opens the detail drawer.
  - **Kanban**: one column per active status plus a collapsed "Closed" group. Dragging a card changes its status. Dropping on `rejected_after_interview` asks for the round count.
- Filters: status (multi-select), date-applied range, source, work mode, text search (company, title, notes), and show/hide archived.
- **Quick add** dialog with the minimum fields: company, title, URL, date applied (defaults to today), and resume/cover letter (pick from the library or upload).
- **Detail view** (side drawer or `/applications/:id`): every field is editable inline, a status timeline from history, attached documents with preview and download, markdown notes, and the pasted job description.
- Bulk actions: change status, archive, delete (with confirmation).

### 7.4 Documents
- Library grid or list with name, kind, size, upload date, and "used in N applications".
- Upload by drag and drop. Rename, delete (blocked if linked), download, and preview (PDFs render inline in a sandboxed iframe; other types download).

### 7.5 Metrics
- **Granularity toggle:** Weekly | Monthly | Yearly.
- **Date range:** presets (last 12 weeks, last 12 months, YTD, all time) plus a custom range.
- **Filters:** status (multi-select), source, and work mode, applied to every chart.
- Charts:
  1. **Applications over time**: bar chart of count per week, month, or year bucketed by `date_applied`. Optionally stacked by current status group.
  2. **Status breakdown**: donut or horizontal bar of the current status distribution for applications in range.
  3. **Pipeline funnel**: Applied, then Screening, Interviewing, Offer, and Accepted. Counts use "ever reached this stage", taken from `status_history`, not just the current status.
  4. **Outcomes**: rejected (no interview), rejected (after interview, split by round), ghosted, withdrawn, declined.
  5. **By source**: applications and interview rate per source, which shows which channels work.
- KPI row: total applied, response rate (anything past `applied` other than `not_selected`), interview rate, offer rate, median days to first response.
- Weeks are **ISO weeks starting Monday**. All bucketing uses the container `TZ`.
- Every chart has a "view as table" toggle for accessibility and exact numbers.

### 7.6 Settings
- Auto-close: enabled, days, eligible statuses, run now.
- Appearance: theme (system, light, dark).
- Data: **Export** (a ZIP with `applications.json`, `applications.csv`, and all document files), **Import** (JSON from an export, or a CSV with a column-mapping step), and a database stats summary.
- About: version, build SHA, and data path.

---

## 8. API Design

REST + JSON under `/api`. FastAPI generates OpenAPI at `/api/openapi.json`. The frontend generates TS types with `openapi-typescript` (script: `pnpm gen:api`), so front and back never drift.

```
GET    /api/health                           -> {status, version, db: ok}
GET    /api/applications                     ?status=&q=&source=&work_mode=&from=&to=&archived=&sort=&page=&page_size=
POST   /api/applications
GET    /api/applications/{id}                (includes documents + history)
PATCH  /api/applications/{id}                (partial; status change writes history)
DELETE /api/applications/{id}
POST   /api/applications/{id}/status         {status, note?, interview_rounds?}
POST   /api/applications/{id}/undo-auto-close
POST   /api/applications/bulk                {ids[], action, payload}
PUT    /api/applications/{id}/documents      {document_ids[]}   (replace links)

GET    /api/documents
POST   /api/documents                        multipart: file, kind, display_name
GET    /api/documents/{id}/file              ?disposition=inline|attachment
PATCH  /api/documents/{id}
DELETE /api/documents/{id}                   (409 if linked)

GET    /api/metrics/summary                  ?from=&to=&status=&source=&work_mode=
GET    /api/metrics/timeseries               ?granularity=week|month|year&from=&to=&...
GET    /api/metrics/funnel                   ?from=&to=&...
GET    /api/metrics/by-source                ?from=&to=&...

GET    /api/settings
PATCH  /api/settings
POST   /api/automation/auto-close/run

GET    /api/export                           -> application/zip
POST   /api/import                           multipart
```

Errors use RFC 9457 Problem Details (`application/problem+json`).

---

## 9. Security (no auth by default)

Auth is **off by default**, which suits a trusted home LAN. Being unauthenticated on the LAN still has real risks, so address them:

1. **CSRF and DNS rebinding.** Any website you visit could try to send requests to `http://truenas.local:30420`. Mitigations:
   - **Host allowlist** (`TrustedHostMiddleware`) from `ALLOWED_HOSTS` (e.g. `truenas.local,192.168.1.10,localhost`). This blocks DNS rebinding.
   - **Origin/Referer check** on every non-GET request. Reject if present and not in the allowlist.
   - The API accepts only `application/json` or `multipart/form-data` with a custom header (`X-Requested-With: jobtracker`). The header forces a CORS preflight, which fails because **no CORS is enabled**.
2. **Optional auth switch.** If `AUTH_PASSWORD` (or `AUTH_PASSWORD_FILE`) is set, turn on a single-password login with an argon2 hash, an HttpOnly + SameSite=Strict session cookie, and a login rate limit. This is off when unset, and it costs little to build now in case the app is later reached over a VPN or shared.
3. **File uploads:**
   - Allowlist: PDF, DOCX, DOC, ODT, TXT, MD, RTF. Check **magic bytes** (`python-magic` / `filetype`), not just the extension.
   - Size limit `MAX_UPLOAD_MB` (default 10), enforced while streaming.
   - Stored under a random UUID filename in `/data/uploads/`. Never build paths from user input.
   - Serve with `X-Content-Type-Options: nosniff`, the stored MIME type, and `Content-Disposition` using a sanitized RFC 5987 filename. Inline PDF preview is served with `Content-Security-Policy: sandbox`.
4. **HTTP headers:** a strict CSP (`default-src 'self'`; no inline scripts, which Vite's build supports), `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` (except the sandboxed PDF route, which uses `frame-ancestors 'self'`), and `Permissions-Policy` locking down unused features.
5. **Input handling:** Pydantic validation on everything. URLs must be `http`/`https`, which prevents `javascript:` links. Markdown notes render through a sanitizer (`react-markdown` without raw HTML). The ORM parameterizes all queries.
6. **Container hardening:** runs as a non-root UID/GID (default **568:568**, the TrueNAS `apps` user), read-only root filesystem, `tmpfs` for `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, and only `/data` writable. No shell tools are needed at runtime.
7. **Supply chain:** lockfiles committed, pinned base image digests, `pip-audit` + `pnpm audit` + a **Trivy** image scan in CI.
8. **Network guidance (in the README):** don't port-forward the app. For access away from home, use the TrueNAS **Tailscale** app or WireGuard.
9. **Backups:** a periodic ZFS snapshot task on the dataset, plus the in-app export.

---

## 10. Configuration (environment variables)

| Var | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `/data` | SQLite DB + uploads |
| `PORT` | `8080` | Container listen port |
| `TZ` | `America/Chicago` (set yours) | Date bucketing, "today" |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host/Origin allowlist (comma-separated) |
| `AUTO_CLOSE_DAYS_DEFAULT` | `30` | Seed value on first run |
| `MAX_UPLOAD_MB` | `10` | Upload limit |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_FILE` | unset | Enables optional login |
| `LOG_LEVEL` | `INFO` | Structured JSON logs to stdout |

Settings are loaded with `pydantic-settings`. The app fails fast on invalid config.

---

## 11. Repository Layout

```
jobtracker/
├── CLAUDE.md
├── PLAN.md
├── README.md                      # user-facing: install on TrueNAS, backup, upgrade
├── Dockerfile
├── compose.yaml                   # local dev/prod-like run
├── deploy/truenas-app.yaml        # paste into TrueNAS "Install via YAML"
├── .github/workflows/ci.yml       # lint, test, build, scan, push to GHCR
├── backend/
│   ├── pyproject.toml / uv.lock
│   ├── alembic.ini, migrations/
│   ├── app/
│   │   ├── main.py                # app factory, lifespan (migrations + scheduler), static mount
│   │   ├── config.py
│   │   ├── db.py                  # engine, SQLite pragmas, session dependency
│   │   ├── models.py              # SQLAlchemy models
│   │   ├── schemas.py             # Pydantic request/response models
│   │   ├── enums.py               # Status, WorkMode, DocumentKind, ...
│   │   ├── security.py            # host/origin checks, headers middleware, optional auth
│   │   ├── routers/               # applications.py, documents.py, metrics.py, settings.py, io.py, health.py
│   │   └── services/              # auto_close.py, metrics.py, storage.py, export_import.py
│   └── tests/                     # pytest; unit + API tests with temp DATA_DIR
└── frontend/
    ├── package.json / pnpm-lock.yaml
    ├── vite.config.ts
    ├── src/
    │   ├── api/                   # generated types + typed fetch client
    │   ├── components/ui/         # shadcn components
    │   ├── components/            # StatusBadge, KanbanBoard, AppTable, DocumentPicker, charts/...
    │   ├── pages/                 # Dashboard, Applications, ApplicationDetail, Documents, Metrics, Settings
    │   ├── lib/                   # status.ts (labels/colors), dates.ts, utils.ts
    │   └── main.tsx
    └── tests/                     # Vitest unit + Playwright e2e
```

---

## 12. Implementation Phases

Each phase lists **deliverables** and **acceptance criteria (AC)**. Don't start the next phase until the AC pass.

### Phase 0: Scaffold
- `git init`, `.gitignore`, `.editorconfig`, and this repo layout.
- Backend: a FastAPI app with `/api/health`, config, the SQLite engine with pragmas, and an Alembic baseline.
- Frontend: Vite + React + TS + Tailwind v4 + shadcn/ui initialized, an app shell with sidebar, routing, theme toggle, and empty pages.
- Dockerfile (multi-stage) and `compose.yaml`. FastAPI serves `frontend/dist` with an SPA fallback to `index.html` for non-`/api` routes.
- Makefile or `justfile`: `dev`, `test`, `lint`, `build`, `run`.
- **AC:** `docker compose up --build` serves the shell at `http://localhost:8080`, `/api/health` returns ok, the container runs as a non-root user with a read-only rootfs, and lint and test commands pass.

### Phase 1: Applications CRUD + status history
- Models, migration, schemas, and routers for applications and status history.
- Frontend: table view, quick-add dialog, detail drawer or page, status change with history timeline, filters, and search.
- **AC:** create, edit, delete, and filter applications. Every status change writes history. The API has pytest coverage for CRUD, validation, and history.

### Phase 2: Documents
- Storage service with UUID filenames, magic-byte validation, size limit, and sha256 dedupe. The document library page. Attach and detach on the application form, with upload-and-attach inline.
- **AC:** upload a PDF and a DOCX, attach them to two applications, preview the PDF inline, and download with the original filename. Rejected cases (wrong type, oversize, spoofed extension, deleting a linked document) are covered by tests.

### Phase 3: Auto-close automation
- The `auto_close` service, the lifespan scheduler, the settings model and API, the settings UI section, "Run now", "auto-closes in X days" indicators, and undo.
- **AC:** tests with a frozen clock prove the rules: eligible statuses only, exemptions respected, idempotent, history row written with `source=automation`, undo restores the previous status. Changing the window in the UI takes effect on the next run.

### Phase 4: Kanban + dashboard + command palette
- Kanban with dnd-kit and optimistic updates. Dashboard KPIs, needs-attention list, and activity feed. `⌘K` palette and keyboard shortcuts.
- **AC:** dragging a card changes status and writes history. Dashboard numbers match the API. The palette finds applications by company or title.

### Phase 5: Metrics
- Backend metric services, with SQLite `strftime` bucketing isolated in `services/metrics.py`. Endpoints for the summary, timeseries (filling empty buckets with zeros), funnel from history, and by-source.
- Frontend metrics page: granularity toggle, date presets and custom range, filters, the charts, and table fallback.
- **AC:** seeded fixture data gives known counts for week, month, and year (including ISO week and year-boundary edge cases). Charts render in light and dark themes. Filters apply to every chart.

### Phase 6: Security hardening + optional auth
- Host and Origin middleware, the custom-header requirement, security headers and CSP, optional password auth, and the login rate limit.
- **AC:** tests prove cross-origin POSTs are rejected, a bad `Host` gets a 400, CSP headers are present, and with `AUTH_PASSWORD` set, unauthenticated API calls get a 401 and login works.

### Phase 7: Import/Export + polish
- ZIP export and import (JSON), CSV import with column mapping, and empty states. Loading skeletons, toasts, and responsive layouts down to phone width. An accessibility pass: keyboard navigation, focus rings, and AA contrast.
- **AC:** exporting then importing into a fresh instance gives identical data and files. A Playwright smoke test covers add, attach resume, change status, and view metrics.

### Phase 8: Packaging & TrueNAS deployment
- GitHub Actions: lint, test, build the `linux/amd64` image, run the Trivy scan, and push to `ghcr.io/<user>/jobtracker:<version>` and `:latest`.
- `deploy/truenas-app.yaml` (below) and a README with step-by-step TrueNAS install, upgrade, and backup instructions.
- **AC:** the image installs through TrueNAS "Install via YAML", data survives an app update and restart, and a snapshot restore brings back the database and uploads.

---

## 13. Container & TrueNAS Deployment

### Dockerfile outline
```dockerfile
# --- frontend build ---
FROM node:24-alpine AS web
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# --- backend runtime ---
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ .
COPY --from=web /web/dist ./static
RUN mkdir -p /data && chown 568:568 /data
USER 568:568
EXPOSE 8080
HEALTHCHECK CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",8080)}/api/health')"
# Single worker on purpose: the auto-close scheduler must run exactly once.
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--proxy-headers"]
```
Alembic migrations run automatically in the `lifespan` before the scheduler starts.

### TrueNAS SCALE 25.10 steps
1. **Create a dataset:** `Datasets → Add Dataset` → e.g. `tank/apps/jobtracker` with the **Apps** preset. Make sure user/group **568 (apps)** has read and write access.
2. **Install:** `Apps → Discover Apps → ⋮ → Install via YAML`, name it `jobtracker`, and paste:

```yaml
services:
  jobtracker:
    image: ghcr.io/<your-github-user>/jobtracker:latest
    container_name: jobtracker
    restart: unless-stopped
    user: "568:568"
    ports:
      - "30420:8080"
    environment:
      TZ: America/Chicago
      ALLOWED_HOSTS: "truenas.local,192.168.1.10,localhost"
      AUTO_CLOSE_DAYS_DEFAULT: "30"
    volumes:
      - /mnt/tank/apps/jobtracker:/data
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
```
3. Open `http://<truenas-ip>:30420`.
4. **Backups:** `Data Protection → Periodic Snapshot Tasks` on `tank/apps/jobtracker` (e.g. daily, keep 30 days).
5. **Updates:** push a new image tag, then use the app's **Update** action in TrueNAS (or pull `:latest` and redeploy).

> If you'd rather not use GHCR, build locally and push to a private registry on your LAN. You can also `docker save | ssh truenas docker load` and reference the local tag, but TrueNAS may prune unreferenced images. A registry is more reliable.

---

## 14. Design Direction ("2026 modern")

- **Theme:** neutral zinc/slate base, one accent color (e.g. violet or indigo), and system-driven light/dark mode with a manual override. Semantic status colors: blue for active, amber for interviewing, green for offer or accepted, red for rejected, gray for neutral closes.
- **Typography:** Inter or Geist Sans. Geist Mono for numbers in KPI tiles, with tabular numerals.
- **Surfaces:** cards with a subtle 1px border, large radius (12–16px), soft shadows. No heavy gradients.
- **Motion:** 150–200ms transitions, skeleton loaders, optimistic updates, toast confirmations with Undo. Respect `prefers-reduced-motion`.
- **Density:** comfortable by default, with a compact toggle for the table.
- **Empty states:** a friendly illustration or icon plus a primary action ("Add your first application").
- **Responsive:** the sidebar becomes a bottom nav or sheet on mobile, and Kanban scrolls horizontally with snap.

---

## 15. Testing Strategy

- **Backend (pytest):** each test gets a temp `DATA_DIR` and a fresh migrated DB. `time-machine` or an injected clock for automation and metrics. Target ≥ 85% coverage on `services/`.
- **Frontend (Vitest + Testing Library):** status helpers, date bucketing, form validation, key components.
- **E2E (Playwright):** runs against `docker compose up` in CI. One happy path, plus an upload-rejection case.
- **Static checks:** Ruff, mypy (strict on `app/`), oxlint, `tsc --noEmit`, Prettier.

---

## 16. Future Ideas (post-v1)

- Follow-up reminders ("ping recruiter in 5 days") and an iCal feed.
- A per-application interview log (date, type, interviewer, notes).
- Browser extension or bookmarklet to one-click add from LinkedIn or Indeed pages.
- A company entity with its own notes and all related applications.
- Resume version comparison: which resume version got the best response rate.
