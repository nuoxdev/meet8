# Customer workshop controls and bilingual organization portals

## Intended behavior

Each company has a branded public portal at /<pageSlug>, separate from its private host dashboard. Public visitors see branding and may enter a shared workshop link; no company meeting list or membership data is public. Organization managers choose a unique page address, preserving old meeting links.

The platform supports English and Arabic with persistent language selection, true translated UI and RTL layout. User-provided company names, names, titles and chat messages remain unchanged.

Hosts may appoint any joined attendee as a meeting-specific co-host, including guests. This does not grant company membership. Co-hosts may lower hands, mute participants, remove ordinary participants, control media/chat policy, moderate chat and start/stop recordings. Only the original host/manager assigns co-hosts; ending the entire event remains an explicit primary-host action. Leaving/removal revokes a guest co-host's live authority.

Camera, microphone and screen-share policies are independent, everyone or hosts/co-hosts only. Changes apply to the live SFU permissions and future join tokens; gateway revalidation rejects stale overprivileged grants. Remote mute never remotely activates devices. Chat can be disabled and inappropriate messages deleted. A room lock prevents new ordinary attendees without disconnecting those already present.

Real server-side recordings use a separate Egress worker and private filesystem volume. Recording controls and files are private to hosts/current co-hosts. Everyone sees a recording indicator. Completed recordings appear in meeting details. Only the host/co-host creates an explicit revocable, expiring sharing link; no automatic distribution. Sharing links grant access only to that recording.

## Execution and verification

1. Reproduce/characterize non-JSON API responses, add client parsing regression tests and recovery behavior; preserve actionable proxy error status without rendering HTML.
2. Add public organization branding endpoint, unique/reserved address validation and portal route; tests prove member data and meetings are not exposed.
3. Add moderation tests before backend endpoints; test guest co-host authority, tenant/session isolation, grant revocation, media restrictions and chat moderation. Test SFU permissions with real LiveKit.
4. Add explicit translations/provider/RTL stylesheet and persistent language switcher; retain English default compatibility. Test both languages and mobile widths.
5. Add private recording service/routes, state reconciliation, token sharing and bounded filesystem streaming. Test role boundaries, failed/in-progress jobs, revoked links and range requests. Prepare separate Redis/Egress configuration without touching Desk8.
6. Integrate live settings/participants/chat/recording UI and saved recording details. Test complete host/co-host/guest flows plus actual two-browser media.
7. Review, typecheck, test, build pinned server release, private DB backup, zero-connected-media deployment gate. Verify production image/health/portal/bilingual rendering and media/recording proof separately. Do not interrupt active calls or claim capacity from a two-browser test.

Useful follow-ups: moderated Q&A, attendee registration/consent, attendance CSV, presentation spotlight/pinning, scheduled reminders and captions. Do not add speculative engagement features before the requested controls work.
