# JobTracker

A self-hosted, single-user job application tracker. It runs as one small container on TrueNAS SCALE (or anywhere Docker runs), keeps everything in one folder, and works fully offline on your home network.

- Track applications with status history, notes, salary, contacts, and the job description.
- Keep a library of resumes and cover letters, and attach them to any application.
- Applications with no reply for 30 days (configurable) close automatically, and any close can be undone.
- A dashboard, a kanban board, a ⌘K command palette, and a metrics page (weekly, monthly, and yearly).
- Backup and restore from the app, plus CSV import from a spreadsheet.

See [PLAN.md](PLAN.md) for the full design.

## Install on TrueNAS SCALE 25.10

### 1. Publish the image

CI builds the image and pushes it to the GitHub Container Registry (see [Releasing](#releasing)). Once it has run, the image is `ghcr.io/<your-github-user>/jobtracker`.

New GHCR packages are often private. Either make the package public (GitHub → your profile → Packages → `jobtracker` → Package settings → Change visibility), or add a `ghcr.io` credential (a token with `read:packages`) to TrueNAS's container registry settings so it can pull a private image.

### 2. Choose where the data lives

**Option A: your own dataset (recommended).** It's easy to snapshot, roll back, and keep if you delete the app.

1. **Datasets → Add Dataset.** Create, for example, `tank/apps/jobtracker` using the **Apps** preset.
2. **Edit Permissions** on the dataset. Give the `apps` user and group (UID/GID **568**) read and write access. The container runs as 568:568 and never as root.

The dataset must be local ZFS, not an NFS or SMB share, because SQLite's write-ahead log is unsafe on network filesystems.

**Option B: a named volume (no dataset to create).** TrueNAS keeps it inside its hidden apps dataset (`<pool>/ix-apps`), like the ixVolume storage in its app forms. There's nothing to set up: a new volume takes its owner (568:568) from the image. In the YAML, use the commented `jobtracker` volume line instead of the `/mnt/...` path, and uncomment the `volumes:` block at the end of the file too. The trade-offs:

- Snapshots have to cover the whole `ix-apps` dataset, and rolling it back rolls back every app, not just this one.
- Deleting the app in TrueNAS can delete the volume along with it, so download a backup first (see [Backups](#backups)).

### 3. Install the app

**Apps → Discover Apps → ⋮ → Install via YAML.** Name it `jobtracker` and paste [deploy/truenas-app.yaml](deploy/truenas-app.yaml). Then change:

- `image` to your GHCR path. `:latest` is always the newest release; use a version tag such as `:0.1.6` to stay on one version.
- under `volumes`, the dataset path (Option A), or switch to the named volume (Option B)
- `TZ` to your time zone. It decides what "today" and "this week" mean.
- `ALLOWED_HOSTS` to every name and IP you'll use to open the app, e.g. `truenas.local,192.168.1.10`. See [Security](#security).

Then open `http://<truenas-ip>:30420`.

### 4. Optional: require a password

The app has no login by default, which suits a trusted home network. To require one:

1. Put the password in a file in the dataset, e.g. `/mnt/tank/apps/jobtracker/password.txt`, owned by 568 with mode `600`.
2. Add `AUTH_PASSWORD_FILE: /data/password.txt` to the app's `environment`. `AUTH_PASSWORD` works too, but the value is then visible in the app's configuration.

With a named volume (Option B) there's no host folder to put the file in, so use `AUTH_PASSWORD`.

Sessions last 30 days. Changing the password signs everyone out.

## Backups

Everything lives in `/data`: the database (`jobtracker.db`, plus `-wal` and `-shm` while running) and `uploads/`. That's your dataset (Option A) or the named volume (Option B).

- **ZFS snapshots (recommended):** **Data Protection → Periodic Snapshot Tasks → Add** on the dataset, e.g. daily, kept for 30 days. With a named volume, the task has to cover `<pool>/ix-apps` recursively. Snapshots are safe while the app runs. SQLite's write-ahead log makes a snapshot a consistent point in time.
- **In-app backup:** **Settings → Data → Download backup** gives a ZIP of all applications, history, documents, and settings. It includes a CSV you can open in a spreadsheet.

### Restoring

- **From a snapshot:** stop the app (**Apps → jobtracker → Stop**), roll the dataset back (**Datasets → the dataset → Snapshots → Rollback**), then start the app. With a named volume, this rolls back `ix-apps` and so every app; restoring a backup ZIP only touches JobTracker.
- **From a backup ZIP:** install JobTracker fresh, then use **Settings → Data → Restore from backup**. On an empty instance this brings everything back exactly, including ids and settings. On one with data, it adds the backup alongside what's there.

## Updating

1. Take a snapshot first (or rely on the periodic task).
2. With `:latest`, use the app's **Update** action. With a version tag, change it to the new version and save.

Database migrations run automatically when the new version starts. If something goes wrong, go back to the previous tag and roll the dataset back to the snapshot you took.

## Security

JobTracker is built for a trusted home network. Don't port-forward it. For access away from home, use a VPN such as the TrueNAS Tailscale app or WireGuard.

- **`ALLOWED_HOSTS`** (comma-separated) lists the names and IPs you use to open the app, e.g. `truenas.local,192.168.1.10`. Requests for any other `Host` get a 400, which blocks DNS-rebinding attacks. `localhost` and `127.0.0.1` always work. A leading `*.` matches subdomains (`*.tail1234.ts.net`).
- **Optional password:** set `AUTH_PASSWORD`, or `AUTH_PASSWORD_FILE` pointing at a file that holds it, to require a sign-in. See [step 4](#4-optional-require-a-password).
- **Scripts calling the API** must send `X-Requested-With: jobtracker` on every POST, PUT, PATCH, and DELETE, with a JSON or multipart body. This is what stops other websites from making changes through your browser. For example:

  ```sh
  curl -X POST http://truenas.local:30420/api/applications \
    -H 'X-Requested-With: jobtracker' -H 'Content-Type: application/json' \
    -d '{"company": "Acme", "job_title": "Engineer"}'
  ```

  With a password set, sign in first (`POST /api/auth/login` with `{"password": "..."}`) and send the `jobtracker_session` cookie it returns.
- The container runs as 568:568 with a read-only root filesystem, no Linux capabilities, and `no-new-privileges`. Only `/data` is writable.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `/data` | Database and uploads |
| `TZ` | container default | Your time zone, for "today" and weekly/monthly buckets |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Names and IPs the app answers to |
| `AUTO_CLOSE_DAYS_DEFAULT` | `30` | The auto-close window on first run; after that, change it in Settings |
| `MAX_UPLOAD_MB` | `10` | Largest document upload |
| `MAX_IMPORT_MB` | `1024` | Largest backup ZIP to restore |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_FILE` | unset | Turns on sign-in |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, or `ERROR` |

## Troubleshooting

- **"Unknown Host. Add it to ALLOWED_HOSTS"**: you opened the app by a name or IP that isn't listed. Add it to `ALLOWED_HOSTS` and redeploy.
- **The app won't start, with a permission error on `/data`**: the dataset isn't writable by 568:568. Fix its permissions (step 2).
- **The app won't start after setting a password**: the password file is missing, empty, or unreadable by 568. The log names the problem.
- **Logs:** **Apps → jobtracker → Logs**. The health check is `GET /api/health`.

## Development

Requires [uv](https://docs.astral.sh/uv/), Node 24, and pnpm.

- `make install`, then `make dev`: the backend on :8000 and Vite on http://localhost:5173
- `make test`: backend and frontend unit tests
- `make e2e`: Playwright tests against the real app (smoke path, board, phone width, and accessibility). The first time, run `pnpm exec playwright install chromium` in `frontend/`.
- `make lint` / `make format`
- `make build` / `make run`: the container image, and a production-like run at http://localhost:8080

## Releasing

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) lints, tests, and audits dependencies. It then builds the `linux/amd64` image, scans it with Trivy, and runs the end-to-end suite against it started from `compose.yaml`. Only release tags publish an image; pushes to `main` build and test it without publishing.

To publish a release:

1. Set the new version in `backend/pyproject.toml`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.

CI checks that the tag matches `pyproject.toml`, then publishes `:0.2.0`, `:0.2`, and `:latest`.
