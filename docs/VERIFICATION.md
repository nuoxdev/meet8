# Verification — 10 November 2026

The core application is live as a **pilot** at https://meet8.nuox.io. Running application image/source commit: `3c9233cc0c0980dc44ec08cf17c5c19d7face5a3`. This does not certify 100-person workshop capacity or full Desk8 Connect parity.

## Latest customer workshop release

- 31 API/repository/gateway/mail/branding/time/static-server tests passed locally with real PostgreSQL and LiveKit integrations enabled, zero skips. The server image build passed typecheck, 29 tests (2 provider integration checks skipped), production build, and dependency pruning with zero reported runtime vulnerabilities.
- All five browser tests passed, including persisted supplementary palettes, public preview colors, tenant isolation, responsive join/live layouts at 320/390/768/1280 pixels and two-browser synthetic microphone/camera reception, chat, hand raising, leave/rejoin and ending.
- Reviewer found one screen-share accessible-name mismatch; corrected the observer to synchronize the active label and reran the complete browser suite.
- Created a permission-0600 database dump on the server and checked its archive listing. No restore drill was performed. The app-only update left the database, media, firewall, tunnel and Desk8 containers running; immediately preceding media checks showed zero connected participants.
- The first activation automatically rolled back because its 30-second deadline was too short for Docker's health interval. Retried with a 90-second deadline; the exact new image is healthy. No data migration was required.
- Public HTTPS health is OK, unsigned RTC returns401, and the supplied real workshop page renders without browser errors or horizontal overflow at all four tested widths. No attendee was added to the real workshop for verification.
- SES accepted the requested real test email on 9 November after its configuration-set policy was fixed; acceptance is separate from recipient inbox confirmation. User reported normal operation on10 November.
- See PRODUCTION-READINESS.md for release scope and remaining broad-rollout requirements. Historical pilot checks below describe the previous release.

## Completed checks

- 29 local API/repository/gateway/mail/time/static-server tests passed with actual PostgreSQL and LiveKit integrations enabled, no skips.
- Signaling tests cover JWT validation, current participant/session state, host removal, explicit leave, ended/restarted rooms, expired/forged tokens, revoked membership/invites, and binary WebSocket forwarding. Both legacy and current LiveKit RTC protocol paths are supported; real browser testing caught the current `/rtc/v1` path requirement.
- Proxy tests verify exact immediate-peer trust and ignored forwarding headers by default. A shared-IP test registers/verifies100 distinct fake attendees. Repeat unverified code requests preserve the first code and are throttled for30 seconds; verification retains five attempts. This is an admission test, not a100-participant media benchmark.
- The local browser suite covers owner/manager organization setup, scheduled/branded links, invited-only gate, transient failure recovery, cross-organization mutation races, modal keyboard behavior, and two-browser media/chat/hand/leave/end behavior.
- A separate two-browser test ran against an isolated temporary app on the actual office server, using its dedicated SFU and existing public TURN/WireGuard relay. Both browsers received microphone packets and decoded camera frames; chat, hands, leave/rejoin and end passed. Browsers enforced relay-only policy. Chrome reported selected peer-reflexive candidates at the relay VPN IP with TURN URL/relay-protocol metadata; the dedicated source-scoped firewall chain also recorded media packets/bytes from the TURN relay. Do not mislabel that result as candidateType=relay.
- TypeScript and production web/API builds passed. The server Docker build runs typecheck/tests/build; provider integration cases require configured test services and skip during that build.
- A fresh scoped reviewer found no remaining Important/Critical issues in the gateway/deployment boundary or trusted-proxy/mail changes. Global document transaction serialization remains an acknowledged availability/scaling limitation.
- Production SES SMTP authentication and TLS were verified in the running app environment. No real email was sent by these checks. The credentials are restricted; the SES identity lookup API is not permitted. SMTP is used instead of requiring broader AWS permissions.
- Public HTTPS sign-in rendered in Chromium without submitting its form. Root and health returned200; unsigned RTC signaling returned401. App/database are healthy. Metrics are loopback-only and upstream LiveKit signaling is not published.
- Temporary validation app/SSH forwarding were removed. No test users or meetings were inserted into production state. Actual platform-owner membership is established only after email verification.

## Remaining boundaries

- User reports normal operation; structured customer-network/device UAT and inbox-placement monitoring remain outstanding.
- No100-person media load test was run. Production workshop sizing must include all publishers, visible subscriptions, reconnects, TURN-only clients and recording workload.
- Recording/transcripts/AI/translation/file-chat parity remains pending; see PARITY.md.
- The first-version PostgreSQL document repository serializes operations and needs indexed/scoped repositories and retention before broad commercial scale.
- GitHub-hosted CI was blocked by account billing; deployment and checks ran directly, without Actions.
