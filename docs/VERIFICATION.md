# Verification — 8 November 2026

Implemented and checked locally; not deployed to a public hostname.

- 16 API/repository/time/static-server tests passed, including actual PostgreSQL persistence/rollback and LiveKit absent-participant idempotency. No skips in the integration run.
- 4 browser tests passed: owner → manager → scheduled/branded links and invited-only gate; transient polling failure recovery; delayed cross-organization save refresh; modal keyboard focus; and two-browser real-media flow (the first browser case contains multiple checks).
- The media test observed positive inbound microphone packet counts and decoded camera frame counts in both browsers using synthetic browser devices through local LiveKit 1.13.11. Chat, hand raising, explicit leave/rejoin, and end-for-everyone also passed.
- TypeScript typecheck and production web/API build passed.
- Docker image built and passed packaged-server smoke checks independently of Vite: root 200, meeting deep link 200, unknown API 404. Static serving has a regression test for `/`, meeting deep links, and unknown API/assets.
- Production dependency audit reported zero vulnerabilities.
- Desktop and 390 px mobile screenshots were visually inspected; meeting-room screenshot shows synthetic camera output, not real people.

## Review outcomes

A separate code reviewer identified anonymous-guest removal on unregistered-member deletion, historical-session media revocation, and stale organization refreshes. Regression checks reproduced these failures before fixes and pass afterward. Already-absent provider participants are handled idempotently; real provider failures still stop the mutation. Keyboard focus trapping and Escape were added to application dialogs.

## Unverified or pending

- Real SMTP delivery and any external invitation emails. No real customer messages were sent.
- LiveKit Cloud production project, internet/TURN connectivity across customer networks, and real camera/microphone quality.
- Public DNS/TLS, final hostname and actual platform-owner email.
- Recording/transcripts/AI/translation/file-chat parity; see PARITY.md.
- Production scale: document storage and global transaction locking are an explicitly limited pilot implementation. Relational repositories/retention and scoped locks are required before broad multi-company rollout.

Commands and setup are in README.md. Browser screenshots are QA artifacts using fictitious test accounts/companies.
