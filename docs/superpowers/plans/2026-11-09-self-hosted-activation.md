# Self-hosted Meet8 Activation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the gateway and deployment. SES adapter and read-only network investigation are independent bounded tasks under dispatching-parallel-agents.

**Goal:** Activate the approved Meet8 core on the user's server, with self-hosted media and the user's selected email sender.
**Architecture:** A dedicated LiveKit service has no public signaling port. Meet8 proxies only its RTC signaling/validation routes, authenticating the signed media identity against the current meeting, session, membership and admission state on every new connection. Existing TURN relay carries media to the dedicated office media ports; sender uses existing Amazon SES.
**Tech Stack:** Fastify websocket, ws, LiveKit TokenVerifier, AWS SES SDK, Docker Compose, existing Cloudflare Tunnel.
**Spec:** 2026-11-08-meet8-design.md plus user selection of self-hosted media on 9 November; prior cloud-only restriction is replaced by equivalent gateway enforcement.

## Global Constraints
- Dedicated LiveKit API key, room namespace and private signaling; never expose upstream signaling or reuse Desk8's LiveKit key.
- Revoked/left attendees, old sessions, ended rooms and revoked memberships must fail gateway admission even with unexpired JWTs.
- Serialize upstream connection establishment with authorization changes to prevent removal/startup races.
- Mail credentials remain server-side. No real messages sent during implementation or verification without explicit user instruction.
- Changes to existing relay/firewall/tunnel must be minimal, additive, backed up and validated.

## Review Focus
- Direct upstream access bypassing the gateway.
- Connect-versus-revoke races and queued websocket messages.
- Expired/forged/wrong-room JWTs, ended/restarted meeting reconnects.
- Sensitive query tokens in logs or credentials in artifacts.
- Public TURN reachability and preserving existing Desk8 traffic.

### Task 1: Signed signaling admission
**Files:** apps/api/src/signaling.ts, apps/api/test/signaling.test.ts, apps/api/src/config.ts, app.ts.
**Interfaces:** registerSignaling(app,{store,config}); verifySignalClaims(config,token); authorizeSignalState(state,claims,config).
- [ ] Add failing tests for active/removed/left/cross-session/expired tokens and membership/invite revocation.
- [ ] Implement signature verification and state checks; websocket bridge only /media/rtc, HTTP /media/rtc/validate.
- [ ] Hold storage transaction while upstream websocket opens; recheck state inside it. Bound buffers/timeouts; close paired sockets on failure/shutdown.
- [ ] Verify real websocket binary forwarding plus denied token attempts before upstream joins.

### Task 2: Independent media and relay
**Files:** apps/api/src/media.ts, turn.ts, config.ts, apps/web/src/MeetingRoom.tsx, api.ts, apps/web/vite.config.ts, compose.media.yaml.
**Interfaces:** gateway mode returns same-origin ws(s) /media and ICE servers with time-limited TURN credentials; RoomServiceClient uses internal upstream URL.
- [ ] Test short-lived TURN credentials and internal/public URL separation.
- [ ] Configure dedicated service without signaling publication and separate RTC ports/key.
- [ ] Verify two-browser media through the gateway; verify saved JWT cannot reconnect after host removal/end/restart.

### Task 3: SES transport
**Files:** apps/api/src/mail.ts, apps/api/test/mail.test.ts, config.ts.
**Interfaces:** mailProvider ses uses existing Mailer; config supports AWS region/default credentials and sender.
- [ ] Test failure first then success for provider payloads and failure propagation.
- [ ] Verify existing identity and sending quota with read-only AWS APIs; copy only needed configuration server-side.

### Task 4: Deploy and verify
**Files:** deploy runbook and server-only release/environment/media config.
- [ ] Run test/typecheck/build and gateway browser checks; request scoped review.
- [ ] Build pinned release on server, update environment without exposing secrets, preserve dedicated database.
- [ ] Add verified minimal relay/firewall and tunnel route; check health, settings, HTTPS, gateway denial and actual media path.
- [ ] Report exact verification boundaries, including real email/real-device testing and remaining advanced-feature parity.
