# Meet8 standalone meeting application

Status: design approved on 2026-11-08. Core implementation is on sc/meet8-standalone; advanced Connect parity and production deployment remain pending. See docs/PARITY.md and docs/VERIFICATION.md.

## Purpose and confirmed requirements

Create Meet8 in https://github.com/nuoxdev/meet8 by copying and adapting Desk8 Connect's existing meeting implementation. This is a separate application for companies to host meetings with clients. It must not depend on a Desk8 employee account.

The platform owner creates organizations and assigns a manager to each. Organizations are not self-service. Anyone can register an account with a name and email address. Registration alone does not grant access to any organization. Users sign in and select an organization to which they belong. The organization controls branding, and every meeting link belongs to its organization.

Hosts can create a meeting immediately or schedule its date, time, and duration. A shareable link exists before the meeting starts. Hosts may start a scheduled meeting early or late; its scheduled time is informational rather than an admission deadline. Meetings offer two access modes: anyone with the link, or only explicitly invited email addresses. Meeting visitors see the owning company's branding, regardless of their own organization membership.

Retain the existing Connect meeting capabilities by adapting the source rather than replacing the call experience with an unrelated implementation.

## Proposed defaults — implementation choices, not user decisions

- Roles: platform owner, organization manager, organization member, and meeting guest. Managers maintain branding, invite/remove members, and manage their organization's meetings. Members create and host their own meetings. Guests receive no organization management access.
- One user may belong to several organizations. The selector lists only active memberships. A new registrant without memberships sees a waiting-for-invitation screen.
- Authentication: verified email sign-in through short-lived, single-use email links/codes, with an email transport adapter and a development-only delivery sink. Production registration requires a configured mail provider. Invitation acceptance verifies the target email. Sessions use secure HTTP-only cookies and server-side revocation.
- Open-link guests can enter a display name without creating an account. Invite-only guests must prove ownership of an invited email address; typing an address is insufficient. A guest never becomes an organization member through a meeting invitation.
- Guests wait until a host starts the meeting. Hosts can join early or late; ending closes that session. Reusing an ended meeting requires an explicit host restart action and a new session, preserving past attendance and invalidating previous room credentials. Cancellation revokes joining.
- Branding settings: organization display name, unique URL slug, logo upload, primary color, and default timezone. Use accessible color fallbacks. Branding appears on meeting landing pages, pre-join screens, and the in-meeting shell. Changing a display name does not break existing meeting links.
- Meeting URLs use an opaque, high-entropy meeting code under an organization route; codes are not sequential identifiers. Organization slugs alone grant no permissions.
- No automatic email sends during development or migration. Production invitation email is an explicit host action after mail setup; copying links is available without email delivery.

## Source reuse and separation

The local Desk8 repository's current main checkout is older and does not contain the complete Connect module. Other local worktrees and production refs contain it. Before copying, identify the freshest maintained Connect source and record the exact source commits in Meet8's provenance document; local production refs dated September are not proof of current production state.

Reuse candidates found in `tmp/task-agent-projects-desk8`: admin `ConnectPage.tsx` and `LiveCallRoom.tsx`; guest `App.tsx`, `GuestCallTools.tsx`, and `GuestChat.tsx`; API `communications.ts`, `communications-store.ts`, guest meeting routes, and scheduling/invitation migrations; shared call contracts and `packages/call-audio`. Read these in context before extraction. Preserve relevant fixes and tests.

Use the existing React/Vite/TypeScript frontend, Fastify API, PostgreSQL, and LiveKit foundation. Extract meeting and supporting chat/media features with the dependencies they require. Replace Desk8 employee authorization with Meet8 membership and meeting authorization. Inventory recording, screen sharing, chat, hand raising, audio processing, device selection, and other existing meeting features and carry supported features into a parity checklist. Provider-dependent features must show clear configuration states rather than pretend to work.

Do not copy employee records, screenshots, tracking, HR, payroll, telephony credentials, customer data, runtime databases, environment files, or unrelated product modules. Full historical Desk8 Git publication is not necessary for source reuse. The destination repository is currently public: use a sanitized source copy with provenance and no historical secrets. Use independent configuration, database, session secrets, storage namespace, and LiveKit room namespace.

## Application structure and data

Web app: sign-in/verification, organization selection, upcoming/past meetings, create/edit meeting, organization members/settings, platform organization administration, branded meeting landing/pre-join page, and extracted live meeting room.

Core data: users, verification challenges, sessions, organizations, memberships, organization invitations, meetings, meeting invitees, meeting sessions, guest admissions, attendance, meeting chat, branding assets, and audit events. Every organization-owned record carries organization_id. Meetings record creator, organization, access mode, schedule/timezone, duration, status, and opaque public code. Sessions hold distinct room identities so restarts do not reopen old credentials.

All organization-scoped queries and mutations require server-side membership/role checks. Public meeting routes return only approved branding and minimal meeting information. Tenant identity comes from server lookup and authorized membership, never a client-supplied organization ID alone. Only the API issues bounded LiveKit room tokens after meeting authorization; tokens are scoped to the exact session and participant. Restrict host moderation and recording controls to authorized hosts/managers. Recheck state on refresh and reconnect.

Validate and normalize email addresses consistently. Expire and rate-limit verification challenges, signup, invitation acceptance, and guest admission. Reject cross-organization identifiers, revoked memberships, forged host claims, and replayed verification links. Audit organization administration and meeting lifecycle changes.

## Delivery and verification

Implement in the separate Meet8 repository on an sc/ branch, preserving current Desk8 working changes. First complete source inventory/provenance and parity checklist; then identity and organization isolation; then scheduling/access control; then adapted meeting room and branding; then deployment configuration and end-to-end verification.

Required checks cover registration and verification, platform-only organization creation, delegated management, membership switching/revocation, cross-tenant access denial, open-link guest joining, invited-email proof and rejection of uninvited users, host-only start/end/restart, timezone scheduling, branded links, and two-browser real media/chat/screenshare behavior. A UI build alone does not establish working calls. Document unavailable provider checks explicitly.

Target hostname supplied verbally is `meet8.newox.io`; existing source examples use `nuox.io`. Keep the public base URL configurable and confirm the intended spelling before DNS/TLS or publishing links. Prepare container/runtime configuration and an environment template without secrets. Hosting, DNS credentials, production mail delivery, and final domain are deployment dependencies; do not claim a live service until verified.

## Boundaries

This release supports meetings under centrally provisioned organizations. Payments, billing plans, custom domains per customer, desktop/mobile packaging, webinars, and unrelated Desk8 business functions are outside the initial scope. Existing meeting features remain the source of truth for parity; any feature that cannot be carried across must be surfaced explicitly before completion.
