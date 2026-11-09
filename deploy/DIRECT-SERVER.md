# Deploy directly without GitHub Actions

GitHub Actions is optional. Build a pinned, reviewed source release directly on the server, using its Docker engine. GitHub billing does not affect SSH, copying source, or running containers.

Server checked 9 November 2026: existing Desk8 host `10.255.254.100`, user `administrator`, x86_64, Docker Compose v2.38.1. Desk8 preview already occupies localhost:4100. Use `MEET8_BIND_PORT=4198`, which was free at inspection. Recheck before activation.

## Release layout

- `~/apps/meet8/releases/<full-commit>/`: source from `git archive`, never workstation .env files or runtime data.
- Docker image: `meet8:<full-commit>`.
- `~/apps/meet8/shared/.env`: server-only, permission 0600, containing actual production settings.
- Compose project: `meet8`, with its own PostgreSQL container and persistent volume.

## Build

From the local Meet8 repository, transfer the exact committed archive over the existing SSH connection. On the server, run `docker build -t meet8:<full-commit> .` in that release directory. The Dockerfile runs typecheck, the API test suite, and the frontend/API builds. Provider integration tests require separately configured test services. No Actions runner is involved.

## Required settings before activation

Confirm `MEET8_BASE_URL` and `MEET8_OWNER_EMAIL`. Set real SMTP transport and `MAIL_FROM`, dedicated media settings, a strong URL-safe `POSTGRES_PASSWORD`, `MEET8_IMAGE=meet8:<full-commit>`, and `MEET8_BIND_PORT=4198` in the shared .env. Set `NODE_ENV=production`; development-code delivery must remain off.

Self-hosted production media now uses a dedicated private-signaling service behind the Meet8 authorization gateway. See SELF-HOSTED.md; do not publish its upstream port or reuse Desk8’s media key. Cloud mode remains available as an alternative.

## Activate

Link the shared environment file to `.env` in the chosen release directory. Run `docker compose --env-file .env config --quiet` before starting. Then run `docker compose --project-name meet8 up -d --no-build`. Check service health, PostgreSQL persistence, and localhost:4198 root/deep-link responses. Do not publish DNS/tunnel routes until real owner sign-in and media readiness are verified.

Add only the confirmed hostname to the existing tunnel/reverse proxy, directed to `http://localhost:4198`, backing up and validating its configuration before reload. Verify HTTPS, branding, email ownership checks, both join modes and an external-network two-browser meeting. Keep release and environment details server-side; do not print credentials.

## Rollback

Use the previous compatible image and release directory with the same shared environment and Compose project. Back up the database before any schema change. Do not remove volumes, alter Desk8 services, or replace its configuration to roll back Meet8.

## Prepared release — 9 November 2026

Release `d8e3e023fe07c5d3fcede530265540a02be8d519` has been archived to the server, built there as `meet8:d8e3e023fe07c5d3fcede530265540a02be8d519` (amd64), and smoke-tested on localhost:4198. The server build passed typecheck, 14 API tests (2 provider integration checks skipped), and web/API compilation. The temporary runtime returned health OK, root HTTP 200, and meeting deep-link HTTP 200, and was removed after verification.

The permission-0600 server-only environment template is prepared with a newly generated database password. The actual hostname, owner email, SMTP and media settings remain unset. No persistent Meet8 service or database has been started, and no DNS/tunnel route has been published. Existing Desk8 services were not restarted or reconfigured.

## Active pilot — 9 November 2026

Application release `4792b0ee01a4413565c7025e7b3fc0c7783448be` is running on localhost:4198 with a dedicated database, private-signaling SFU and source-scoped RTC firewall guard. The confirmed hostname is public through its own tunnel. The selected owner/sender and mail credentials are stored only in the private server environment. SES SMTP authentication passed; no test mail was sent. Earlier preparation notes above describe historical stages, not current activation state.

Current service names: meet8-app-1, meet8-database-1, meet8-media-1, meet8-media-firewall-1, meet8-tunnel. See TUNNEL.md and SELF-HOSTED.md for the separated networking boundaries. See docs/VERIFICATION.md for exact tested and untested scope.
