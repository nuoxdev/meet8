# Verification — 9 November 2026

The core application is live as a **pilot** at https://meet8.nuox.io. Running application image/source commit: `4792b0ee01a4413565c7025e7b3fc0c7783448be`. This does not certify 100-person workshop capacity or full Desk8 Connect parity.

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

- First real sign-in email delivery and customer-network/device UAT remain to be confirmed.
- No100-person media load test was run. Production workshop sizing must include all publishers, visible subscriptions, reconnects, TURN-only clients and recording workload.
- Recording/transcripts/AI/translation/file-chat parity remains pending; see PARITY.md.
- The first-version PostgreSQL document repository serializes operations and needs indexed/scoped repositories and retention before broad commercial scale.
- GitHub-hosted CI was blocked by account billing; deployment and checks ran directly, without Actions.
