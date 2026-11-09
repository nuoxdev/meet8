# Private-signaling self-hosted media

Run with both `compose.yaml` and `compose.media.yaml`. The media service has a dedicated key and API secret; publish only RTC TCP7981 and UDP51100–51200 on the office VPN IP. Never publish port7880 or install a public route directly to that service.

Browser signaling uses `wss://<Meet8-host>/media/rtc` or `/media/rtc/v1`. Meet8 verifies the JWT, current session, active attendance, membership and invite authorization before connecting upstream. It holds the repository transaction while upstream opens, serializing that operation with removal/end. The HTTP validation paths have the same checks. Unknown media paths do not proxy. Existing connected participants are removed through RoomServiceClient; a saved token cannot establish a new connection once access is revoked.

The dedicated firewall service inserts only a source/interface/destination-scoped jump into DOCKER-USER, ahead of the existing WireGuard drop. Its chain admits only Meet8 RTC ports and returns all other packets to the existing rules. A reconciliation loop repairs ordering after WireGuard recreation. It does not flush chains or restart existing services. For rollback, stop the guard and remove its exact jump and dedicated chain; do not remove Desk8 rules.

Use the existing office TURN relay with time-limited HMAC credentials kept server-side. Actual media must be verified using selected relay ICE candidates and received audio/video, not signaling success alone. The public TURN host and path to the new RTC ports are separate operational dependencies.

SES mail uses MAIL_PROVIDER=ses, MAIL_FROM and AWS_REGION with the standard AWS credential provider chain. Credential verification is read-only; sending test/invitation messages requires explicit authorization. The sender address alone does not supply working SES/SMTP credentials.
