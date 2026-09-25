# JobTracker

A self-hosted job application tracker. It runs as a single container on TrueNAS SCALE.

- **Plan and roadmap:** [PLAN.md](PLAN.md)
- **Local dev:** `make install && make dev`, then open http://localhost:5173
- **Prod-like run:** `make run`, then open http://localhost:8080
- **TrueNAS install:** see [PLAN.md §13](PLAN.md#13-container--truenas-deployment) and [deploy/truenas-app.yaml](deploy/truenas-app.yaml). A full guide will be added in Phase 8.

## Security

JobTracker is built for a trusted home network and has no login by default. Don't port-forward it; for access away from home use a VPN such as the TrueNAS Tailscale app or WireGuard.

- **`ALLOWED_HOSTS`** (comma-separated) lists the names and IPs you use to open the app, e.g. `truenas.local,192.168.1.10`. Requests for any other `Host` get a 400, which blocks DNS-rebinding attacks. `localhost` and `127.0.0.1` always work. A leading `*.` matches subdomains (`*.tail1234.ts.net`).
- **Optional password:** set `AUTH_PASSWORD`, or `AUTH_PASSWORD_FILE` pointing at a file that holds it, to require a sign-in. Sessions last 30 days; changing the password signs everyone out.
- **Scripts calling the API** must send `X-Requested-With: jobtracker` on every POST, PUT, PATCH, and DELETE, with a JSON or multipart body. This is what stops other websites from making changes through your browser. For example:

  ```sh
  curl -X POST http://truenas.local:30420/api/applications \
    -H 'X-Requested-With: jobtracker' -H 'Content-Type: application/json' \
    -d '{"company": "Acme", "job_title": "Engineer"}'
  ```

  With a password set, sign in first (`POST /api/auth/login` with `{"password": "..."}`) and send the `jobtracker_session` cookie it returns.
