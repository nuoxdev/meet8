# Self-hosted meeting recordings

This adds LiveKit Room Composite Egress, not browser recording. Recording stays disabled until explicitly configured. No cloud account is required. Budget at least 4 CPU cores and 4 GB RAM per Egress worker and monitor disk capacity. Egress and LiveKit must use the same Redis address/password. Never publish Redis or Egress ports.

1. Choose and pin a tested `livekit/egress` image version/digest in `MEET8_EGRESS_IMAGE`. Review compatibility with the existing pinned LiveKit server before rollout; do not use `latest`.
2. Create a server-only directory (`MEET8_RECORDING_PATH`) writable by the Egress container user and readable by the app's node user (UID 1000). Do not put recordings under the web root. Mount it at `/recordings` in both containers. The app mount is read-only.
3. Add this to the existing private LiveKit YAML (preserve all RTC/keys configuration):

```yaml
redis:
  address: redis:6379
  password: YOUR_RANDOM_REDIS_PASSWORD
```

4. Create a private Egress YAML at `MEET8_EGRESS_CONFIG` (mode 0600):

```yaml
api_key: SAME_LIVEKIT_API_KEY
api_secret: SAME_LIVEKIT_API_SECRET
ws_url: ws://media:7880
insecure: true
redis:
  address: redis:6379
  password: SAME_RANDOM_REDIS_PASSWORD
logging:
  level: info
```

Set `MEET8_REDIS_PASSWORD` to that same password. Internal Docker signaling uses `ws://media:7880` and is never published. Composite capture runs Chromium; the upstream default disables its sandbox. To enable sandboxing, use the official Chrome seccomp profile and `enable_chrome_sandbox: true` as described in upstream documentation. Do not add broad host privileges.

5. Review generated configuration securely, then deploy during a maintenance window with no active meetings:

```sh
docker compose -f compose.yaml -f compose.media.yaml -f compose.recording.yaml config --quiet
docker compose -f compose.yaml -f compose.media.yaml -f compose.recording.yaml up -d --build
```

Do not run these instructions during an active call. LiveKit needs a restart for Redis configuration. This document does not claim deployment or real recording verification.

6. Test with two real devices: join/start a meeting, start recording, confirm the visible recording indicator for both participants, speak and share screen, stop, wait for ready, play/download and inspect actual audio/video. Confirm the MP4 exists in the private volume and survives app restart. Confirm an ordinary attendee cannot control/view private recordings. Promote a guest co-host, verify controls, revoke/remove/leave and verify controls fail. End the meeting and use meeting details to create a share link; check unauthenticated range playback, replacement, revocation and expiration. Failed/missing files must never report ready. Check Egress logs and disk space.

Files are private by default. Hosts/managers can issue a random seven-day bearer link only after completion; only its SHA-256 hash is stored. Replacing/revoking the link prevents future requests. An already downloaded copy cannot be revoked. Back up state and the recording directory together. Agree retention separately; there is no automatic deletion policy in this release.

Official references: https://docs.livekit.io/transport/self-hosting/egress/ and https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/.

If a start RPC times out, Meet8 deliberately retains the starting reservation and blocks duplicate starts. A background poll reconciles matching Egress output by UUID. If Egress confirms no job ever existed, an operator must inspect the state and service logs before clearing that pending reservation; do not blindly retry or edit metadata during an active capture. Provider calls are bounded to 15 seconds.

## Activated 10 November 2026

Redis 8.10.3 and Egress 1.15.0 are digest-pinned. Recording bridge: 192.168.249.0/28 (checked non-overlapping). Worker source: 192.168.249.3 on br-meet8-rec; source/interface-scoped RTC allowance only. No Redis/Egress host ports. Server-only Egress config UID1001/mode0600; output directory UID1001/group1000/mode2750; app mount read-only. Worker: 6 CPU/6 GiB RAM/1 GiB shared memory.

Actual two-browser capture, private playback and explicit share revocation passed through an isolated temporary app. Test files/app were removed. Desk8 runtime and recording data were not copied. This verifies integration, not event capacity or a retention/backup policy.
