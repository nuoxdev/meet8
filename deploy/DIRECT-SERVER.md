# Deploy directly without GitHub Actions

GitHub Actions is optional. Build a pinned, reviewed source release directly on the server, using its Docker engine. GitHub billing does not affect SSH, copying source, or running containers.

Server checked 9 November 2026: existing Desk8 host `10.255.254.100`, user `administrator`, x86_64, Docker Compose v2.38.1. Desk8 preview already occupies localhost:4100. Use `MEET8_BIND_PORT=4198`, which was free at inspection. Recheck before activation.

## Release layout

- `~/apps/meet8/releases/<full-commit>/`: source from `git archive`, never workstation .env files or runtime data.
- Docker image: `meet8:<full-commit>`.
- `~/apps/meet8/shared/.env`: server-only, permission 0600, containing actual production settings.
- Compose project: `meet8`, with its own PostgreSQL container and persistent volume.

## Build

From the local Meet8 repository, transfer the exact committed archive over the existing SSH connection. On the server, run `docker build -t meet8:<full-commit> .` in that release directory. The Dockerfile runs typecheck and the frontend/API builds; run the API suite in an intermediate build image as well. No Actions runner is involved.

## Required settings before activation

Confirm `MEET8_BASE_URL` and `MEET8_OWNER_EMAIL`. Set real SMTP transport and `MAIL_FROM`, dedicated media settings, a strong URL-safe `POSTGRES_PASSWORD`, `MEET8_IMAGE=meet8:<full-commit>`, and `MEET8_BIND_PORT=4198` in the shared .env. Set `NODE_ENV=production`; development-code delivery must remain off.

The current production media implementation requires LiveKit Cloud for immediate participant token revocation. Existing Desk8 uses self-hosted LiveKit; those credentials must not be silently copied or relabeled as cloud. A dedicated secure self-hosted signaling/revocation implementation is separate work if all media must also run on this server.

## Activate

Link the shared environment file to `.env` in the chosen release directory. Run `docker compose --env-file .env config --quiet` before starting. Then run `docker compose --project-name meet8 up -d --no-build`. Check service health, PostgreSQL persistence, and localhost:4198 root/deep-link responses. Do not publish DNS/tunnel routes until real owner sign-in and media readiness are verified.

Add only the confirmed hostname to the existing tunnel/reverse proxy, directed to `http://localhost:4198`, backing up and validating its configuration before reload. Verify HTTPS, branding, email ownership checks, both join modes and an external-network two-browser meeting. Keep release and environment details server-side; do not print credentials.

## Rollback

Use the previous compatible image and release directory with the same shared environment and Compose project. Back up the database before any schema change. Do not remove volumes, alter Desk8 services, or replace its configuration to roll back Meet8.
