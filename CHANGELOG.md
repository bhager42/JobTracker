# Changelog

All notable changes to JobTracker are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are the day each version was tagged.

No release so far needs a manual upgrade step. Database migrations run automatically when a new version starts.

## [Unreleased]

### Changed
- The install docs use `1.0.0` as the example version tag.

## [1.0.0] - 2026-11-10

The first stable release. Every phase of [PLAN.md](PLAN.md) is complete, and the TrueNAS install, update, and snapshot-restore paths have been checked on a real system. There are no new features since 0.1.8.

### Changed
- Backend dependencies: FastAPI 0.162.2, Starlette 1.10.0, SQLAlchemy 2.1.8, pydantic 2.14.3, pydantic-settings 2.16.2, and python-multipart 0.0.33.
- Frontend dependencies: TanStack Query 5.107.1, lucide-react 1.71.0, react-hook-form 7.91.0, and other patch updates. Build tools: Vite 8.3.7, Tailwind CSS 4.3.5, and Vitest 5.1.0.
- The GitHub Actions used by CI are updated.

### Fixed
- Images built locally with `make build` or `make run` report the version from `backend/pyproject.toml`. They used to report 0.1.0. Published images were not affected.

## [0.1.8] - 2026-10-30

The first image that includes the 0.1.7 changes.

### Added
- The sidebar footer links to the source code on GitHub.

### Changed
- JobTracker is licensed under the [GNU Affero General Public License v3.0](LICENSE).

## [0.1.7] - 2026-10-23

No image was published for this version. Its changes first shipped in 0.1.8.

### Changed
- Backend dependencies: FastAPI 0.161.1, SQLAlchemy 2.1.6, alembic 1.20.1, and pydantic-settings 2.16.1.
- Frontend dependencies: React 19.3.1, Radix UI 1.8.1, TanStack Query, Router and Table, lucide-react 1.61.0, zod 4.6.7, and other patch updates.
- CI publishes an image only for release tags. Pushes to `main` still build and test it.
- The TrueNAS app template tracks `:latest`.

### Fixed
- The upload drop areas, on the Documents page and under the Resume and Cover letter pickers, have accessible names that include their visible text, so voice-control users can activate them by saying what they see.

### Security
- opentelemetry-api, a FastAPI dependency, is updated to 1.45.1, which fixes CVE-2026-114603.
- Vite is updated to 8.3.5, which fixes several advisories in the development server. The published image was not affected.

## [0.1.6] - 2026-10-08

### Added
- In the New application dialog, the Resume and Cover letter fields each have a visible drop area underneath. Drop a file on it to upload and select it, or click it (or focus it and press Enter) to choose a file.
- While a file is dragged over a field, the field and its drop area highlight and say "Drop to upload".

### Fixed
- A file dropped elsewhere in the dialog is ignored. Before, the browser opened the file, which left the page and lost what had been typed.

## [0.1.5] - 2026-10-06

### Fixed
- In the New application dialog, a just-uploaded resume or cover letter stays selected and is attached to the new application. Before, the field could be left blank when there were no other documents of that kind.

### Added
- An end-to-end test covers dropping a resume onto the dialog, including a long filename that has to stay inside its field.

## [0.1.4] - 2026-10-05

The first image that includes the 0.1.3 changes.

### Changed
- Backend dependencies: FastAPI 0.142.2, SQLAlchemy 2.1.3, uvicorn 0.54.0, and refreshed sub-dependencies. Query code was adjusted for SQLAlchemy 2.1's typing changes, with no change in behavior.
- Frontend dependencies: recharts 3.10.1, radix-ui 1.7.0, lucide-react 1.52.0, TanStack Query 5.104.1, react-hook-form 7.89.0, Vite 8.3.2, and other minor and patch updates.

### Security
- The runtime image uses the newest `python:3.13-slim` base and applies Debian security updates at build time. This fixes high-severity issues in OpenSSL (CVE-2026-75804, CVE-2026-84782) and pcre2 (CVE-2026-103111).
- `shadcn` moved to build-only dependencies. It was never in the image, but it was counted in the runtime audit and pulled in an unpatched advisory in `braces` (GHSA-vfj7-8cjw-p6xm).

## [0.1.3] - 2026-10-05

No image was published for this version, because CI's security checks failed. Its changes first shipped in 0.1.4.

### Added
- A file can be dragged onto the Resume or Cover letter field to upload and select it.

### Changed
- On the application detail page, Salary min, Salary max, and Salary expectation show the currency symbol and thousands separators (for example `$ 120,000`). The symbol follows the application's Currency field. Values are still stored as whole numbers.

### Fixed
- A long filename in the Resume or Cover letter picker is cut off with an ellipsis. Before, it ran past the field into other parts of the New application dialog.

## [0.1.2] - 2026-09-25

### Added
- Each application has an optional salary expectation: the amount you asked for, in the application's currency.
  - Edit it on the application detail page.
  - Show it in the applications table with the Expectation column, which is hidden by default.
  - It is included in export and restore. Older backups without the field still import.
  - CSV import maps columns named "Expected salary", "Desired salary", or "Ask" to it.
- Migration `0005` adds the column.

## [0.1.1] - 2026-09-25

### Fixed
- The dashboard, metrics, and stats refresh after an application is added, edited, moved to another status, or deleted. Before, only the application lists refreshed, and adding an application from an empty dashboard left it stuck on "Nothing to show yet".

### Changed
- The README and the TrueNAS template offer a named Docker volume (`jobtracker`) as an alternative to a dedicated dataset, and explain the trade-offs.
- The template warns that its top-level `volumes` block is required with a named volume. Without it, TrueNAS reports "refers to undefined volume".

## [0.1.0] - 2026-09-25

The first release: a self-hosted job application tracker for one user, shipped as a single container for TrueNAS SCALE or anywhere Docker runs.

### Added
- Applications with status history, notes, salary, contacts, and the job description.
- A document library for resumes and cover letters, with previews, that can be attached to any application.
- Auto-close: applications with no reply for 30 days (configurable) close automatically, and any close can be undone.
- A dashboard, a kanban board, and a ⌘K command palette.
- A metrics page with weekly, monthly, and yearly charts.
- Backup and restore from inside the app, and CSV import from a spreadsheet.
- Optional password sign-in, with security hardening: Host and Origin checks, no CORS, and a non-root container with a read-only root filesystem.
- A TrueNAS SCALE 25.10 install guide and app template.

[Unreleased]: https://github.com/bhager42/JobTracker/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/bhager42/JobTracker/compare/v0.1.8...v1.0.0
[0.1.8]: https://github.com/bhager42/JobTracker/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/bhager42/JobTracker/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/bhager42/JobTracker/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/bhager42/JobTracker/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/bhager42/JobTracker/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/bhager42/JobTracker/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/bhager42/JobTracker/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/bhager42/JobTracker/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bhager42/JobTracker/releases/tag/v0.1.0
