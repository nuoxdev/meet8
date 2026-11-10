# Two-person meeting disconnect investigation — 10 November 2026

## Evidence from the reported meeting

The meeting ran approximately 14:52–15:14 Dubai time (10:52–11:14 UTC). Both attendee records remained in the same meeting session. No moderator removal, meeting end or restart was recorded during the test. App, media and firewall containers had zero restarts; the application image predated the call.

The dedicated Cloudflare connector repeatedly logged `write udp ... sendmsg: network is unreachable` during the call. At 10:57:07, 11:05:07 and 11:09:17 UTC, those failures explicitly affected the reported meeting's session requests. At 10:58:38 and 11:05:16 UTC, its signaling WebSocket ended. The SFU subsequently recorded replacement connections with `DUPLICATE_IDENTITY`, consistent with the same attendees reconnecting while old sessions remained. That message alone does not demonstrate duplicate browser tabs or shared accounts.

The recorded failure boundary is the tunnel's QUIC/UDP path. TCP reachability to Cloudflare port7844 succeeded. The underlying router/UDP-path cause was not established; unrelated NIC, routing, Wi-Fi, WireGuard and Desk8 services were not changed.

## Independently reproduced client defect

The room constructor options reread the stored noise-cancellation preference on every render. The LiveKit React integration recreates its Room whenever serialized options change. Toggling that preference therefore replaced the Room on the next polling render; cleanup generated a client-initiated disconnect, which Meet8 treated as leaving. The inline error callback also retriggered the SDK connect effect on every render.

A two-browser regression test reproduced interrupted audio after changing noise cancellation and waiting beyond two polling cycles. Freezing constructor options for the joined room and stabilizing callbacks passed that same test. Noise changes continue to apply to current tracks through the existing call tools.

## Scoped mitigation and recovery

- Tested an HTTP2 connector alongside the original connector, then made HTTP2 primary after fresh zero-participant gates. Four tunnel connections registered. The app/SFU were not restarted for that change. Original connector/config retained stopped/private for rollback; pilot removed.
- SDK transient reconnection keeps the room mounted. Terminal network recovery requests fresh media credentials only after verifying the same current attendee and live session. Attempts are bounded and cancelled on leaving or revocation.
- Explicit Leave, removal, duplicate identity, meeting end/restart or changed admission must not be bypassed by retry. Reconnection status remains in the room and offers an explicit Leave action even while the SDK is disconnected.

## Validation

Final test counts, exact deployed image and post-rollout observations are appended after verification. Initial checks: existing noise/audio two-browser regression green; ten recovery-helper guards green; seven browser tests of the media-component boundary green. A real gateway test waits beyond the initial60-second token lifetime and deliberately interrupts signaling to validate recovery without another join.

Cloudflare references: [tunnel troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/) and [common tunnel errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/).

### Additional measured checks

- After HTTP2 became primary, 60/60 external HTTPS health requests returned `{ok:true}` with no failures. Maximum observed request time was5.275 seconds. Connector readiness reported four active connections, zero restarts and no network-unreachable/proxy errors in the sampled new-connector log.
- The ten recovery guards plus existing API suite passed49 tests with PostgreSQL and LiveKit integration settings enabled, zero skips. Local production compilation passed.
- Static review identified that a recovered room must republish prior user-selected microphone/camera states. The client now retains those intentions through disconnect cleanup, records connected mute changes, and clears them when the host revokes permissions. It never enables devices for a first join or because permissions were merely granted.

### Final source verification

- Configured API/integration suite:49 passed, zero skips. Browser suite:19 passed.
- Opt-in real gateway media test passed in1.7 minutes: waited beyond65 seconds, forced a native signaling WebSocket closure, injected a terminal network disconnect into the real SDK, and verified fresh audio-packet/video-frame counters increased after republishing. Camera/microphone intent was restored; recovery made no additional join/leave request. Leave during a held token response cancelled recovery and issued one leave.
- A separate manual-connection regression caught and fixed late token reuse after leaving. It passes with the full browser suite.
- Typecheck and production compilation passed. Source build and deployment image/readiness are checked separately at rollout. Refreshing existing browser tabs is required to load the new client.

### Rollout

Deployed app/source image `5528f3be0508285795010e05c763e802c4632c7b` is healthy. Two fresh zero-participant checks preceded the app-only replacement. The SFU, database, recording worker and firewall were not restarted. The HTTP2 connector remained ready with four active connections and no network-unreachable/proxy-error entries in the new connector's observed log.

The reported meeting page returned200 and rendered without browser errors; health returned `{ok:true}` and unsigned signaling was denied401. No diagnostic attendees or messages were inserted into the customer's meeting. Existing tabs must be refreshed to receive the corrected client; a fresh customer two-person retest remains the final user-side confirmation.
