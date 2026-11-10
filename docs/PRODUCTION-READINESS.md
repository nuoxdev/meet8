# Customer workshop release — 10 November 2026

Meet8 is intended for companies hosting workshops and meetings with their customers. The platform owner provisions organizations and assigns managers; registration alone grants no organization access.

## This release

- Organization managers can save primary, secondary, and accent colors, with an immediate preview. The palette covers the host dashboard, public join pages, and live meeting controls/surfaces. Existing organizations retain their primary color and receive safe supplementary defaults until they save their palette.
- Brand buttons use computed black/white text; supporting surfaces use restrained tints. Error and connection-quality indicators keep their semantic colors.
- Corporate customer-workshop copy replaces internal-team language on sign-in and the dashboard sidebar.
- Meeting controls retain accessible names and pressed states. Microphone/camera use icons; screen sharing and leaving retain visible labels. Leave uses the secondary color instead of red. Hosts retain the explicit end-for-everyone confirmation.
- Mobile controls wrap without clipping. Chat/participants are closed initially and open as an overlay on smaller screens. Browser checks cover 320, 390, 768, and 1280 pixel widths and real two-browser audio/video reception.
- Optional palette fields are additive to the existing document schema; no destructive migration or tenant data rewrite is required. Reverting to the previous app image preserves the extra fields.

## Release gates

Run typecheck, the API suite with PostgreSQL/LiveKit integrations, the full browser suite, and the production build. Build an immutable source image directly on the server. Check zero connected LiveKit participants immediately before replacing only the Meet8 app container. Keep the database, SFU, tunnel, and Desk8 services running. Back up the database before activation and retain the previous image/environment for rollback. Verify the new image, health, public meeting route and assets after deployment.

## Still required before broad 50–100 camera workshop rollout

- A representative media load test with 100 publishers, actual subscription layout, TURN-only users, reconnects, and target customer network regions. The two-browser check does not establish workshop capacity.
- Recurring database backups with off-host retention and a timed restore drill. A pre-release backup alone is not a backup service.
- Application, database, signaling, SFU/TURN network and email-delivery alerts with an agreed operator and response process.
- Organization-scoped indexed persistence and retention in place of the global serialized JSON document before broad commercial scale.
- Customer device/network acceptance tests, privacy/retention terms, and support procedures.
- Recording/transcription/translation/AI remain separate capabilities; see PARITY.md.

SES accepted the specifically requested real test email on 9 November after the configuration-set permission was corrected. SMTP acceptance proves provider handoff; inbox placement requires recipient confirmation.
