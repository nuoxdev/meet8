# Meet8

Standalone company-branded meetings, extracted from Desk8 Connect. Each company is provisioned by the platform owner and receives an assigned manager. Anyone can register; organization membership must be assigned by an owner/manager. Meeting guests do not gain company access.

## Run locally

Requires Node 22+, npm, and Docker for persistent PostgreSQL and local LiveKit.

```sh
cp .env.example .env
# Set MEET8_OWNER_EMAIL to your email.
docker compose -f compose.dev.yaml up -d
npm ci
npm run dev
```

Open http://localhost:5173. Development email codes appear in the sign-in form while `MEET8_DEV_MAIL=true`; no external messages are sent in this mode. Sign in with the configured owner email, create an organization, and assign its manager email. The manager signs in with that email to receive access. An ordinary registrant sees no companies until membership is assigned.

The development media server and database bind only to localhost. The sample media/database credentials are deliberately disposable and must not be used for public deployment. Set `MEET8_EPHEMERAL=true` and omit `DATABASE_URL` only for disposable tests; otherwise a persistent database is required.

## What works

- Owner-managed organizations and delegated managers; membership switching and revocation.
- Logo, company name, primary color with accessible button text, and default timezone.
- Public verified-email accounts, expiring one-time codes, revocable HTTP-only sessions.
- Scheduled or instant meetings with stable company-branded links, early/late starts and explicit restarts.
- Anyone-with-link guests or verified invited-email-only access.
- Copied Desk8 camera/audio/device controls, background blur, noise cancellation, screen sharing, focus/grid room layout and shared-screen fullscreen.
- Meeting-session chat, participant list, hand raising, host removal and end-for-everyone.

See [source provenance](docs/SOURCE.md) and [feature parity](docs/PARITY.md). Recording, transcripts, AI summaries, live translation, file attachments, and advanced moderation are **not yet migrated**. This is the core standalone version, not a complete migration of all Connect features.

## Checks

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

To include actual PostgreSQL and local media integration checks:

```sh
MEET8_TEST_DATABASE_URL=postgresql://meet8:meet8-local-only@127.0.0.1:5448/meet8 \
MEET8_TEST_LIVEKIT_URL=ws://127.0.0.1:7880 npm test
LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npm run test:e2e
```

The media browser test uses two isolated browser sessions with synthetic cameras/microphones and asserts inbound audio packets and decoded video frames on both sides, plus chat, hands, and ending. This verifies the media path without claiming real microphone/camera quality or internet-network reliability.

## Production setup

1. Confirm the hostname (`meet8.nuox.io` versus `meet8.newox.io` is pending).
2. Configure the real owner email, HTTPS base URL, persistent PostgreSQL, SMTP and `MAIL_FROM`.
3. Use a dedicated LiveKit Cloud project and `LIVEKIT_MODE=cloud`. LiveKit self-hosted removal does not immediately revoke issued tokens; the production startup guard disallows that mode until equivalent revocation is implemented. See [LiveKit token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/).
4. Set a long URL-safe `POSTGRES_PASSWORD`, then `docker compose up --build -d`. The application listens on localhost:4100 for an HTTPS reverse proxy. The database is not publicly published.
5. Configure DNS/TLS and proxy HTTPS traffic to localhost:4100. Preserve WebSocket support for any provider paths used by future features. Media connects directly to LiveKit via its secure endpoint and TURN fallback.
6. Test real SMTP delivery, owner verification, two external-network participants, access revocation, logo uploads and restart behavior before inviting customers.

The app refuses production startup without HTTPS, PostgreSQL and configured SMTP. `MEET8_DEV_MAIL=true` is ignored in production. Session cookies become Secure in production. No real SMTP credentials, customer records, media secrets, or Desk8 Git history are included.

## Data and operations

The first version persists a transactional JSONB state document in `meet8_state`. PostgreSQL row locking makes transitions atomic across app instances. This intentionally serializes all operations and rewrites state; provider calls during a transaction can delay other organizations. Use for a small pilot, not unbounded multi-company scale. Before scale, move behind the `Store` interface to indexed relational repositories, pagination, scoped locks, and retention for attendance/chat/audit records.

Back up with `pg_dump` using your configured connection and test restoration in a separate database. Back up before changing the schema or owner configuration. Logos currently live in database state with a 500 KB UI limit; migrate them to dedicated object storage as usage grows. The platform-owner email is a deployment setting: restrict configuration access and use a durable company-controlled mailbox.

Invitation emails are sent only through the explicit “Send email invitations” action on a joined host’s meeting page. Membership assignment grants access by verified email; it does not silently send messages. A failed or partially completed invitation send reports how many messages were sent; do not retry blindly if duplication matters.

Local test services can be stopped with `docker compose -f compose.dev.yaml stop`; avoid `down -v` unless you intentionally want to erase the development database.
