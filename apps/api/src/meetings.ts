import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordingSessionState } from './recordings.js';
import type { AppOptions } from './app.js';
import type { State, Meeting, User, Attendee, MeetingSettings } from './store.js';
import {
  ApiError,
  requireUser,
  optionalUser,
  requireOrg,
  isOwner,
  id,
  now,
  token,
  hash,
  audit,
} from './auth.js';
export function meetingSettings(m: Meeting): MeetingSettings {
  return {
    microphoneAccess: 'everyone',
    cameraAccess: 'everyone',
    screenShareAccess: 'everyone',
    chatEnabled: true,
    locked: false,
    ...m.settings,
  };
}
export function isMeetingHost(s: State, m: Meeting, u: User | undefined, ownerEmail: string) {
  if (!u) return false;
  try {
    requireOrg(s, u, m.orgId, ownerEmail);
    return (
      m.createdBy === u.id ||
      isOwner(u, ownerEmail) ||
      s.memberships.some(
        (x) => x.orgId === m.orgId && x.email === u.email && x.active && x.role === 'manager',
      )
    );
  } catch {
    return false;
  }
}
export function isMeetingCohost(m: Meeting, a: Attendee) {
  return (
    a.meetingId === m.id &&
    a.sessionId === m.sessionId &&
    !a.removed &&
    !a.leftAt &&
    Boolean(m.cohostAttendeeIds?.includes(a.id))
  );
}
export function participantPermissions(s: State, m: Meeting, a: Attendee, ownerEmail: string) {
  const elevated =
    isMeetingHost(
      s,
      m,
      s.users.find((u) => u.id === a.userId),
      ownerEmail,
    ) || isMeetingCohost(m, a);
  const settings = meetingSettings(m);
  return {
    microphone: elevated || settings.microphoneAccess === 'everyone',
    camera: elevated || settings.cameraAccess === 'everyone',
    screenShare: elevated || settings.screenShareAccess === 'everyone',
    data: false,
  };
}
const settingsBody = z
  .object({
    microphoneAccess: z.enum(['everyone', 'hosts']).optional(),
    cameraAccess: z.enum(['everyone', 'hosts']).optional(),
    screenShareAccess: z.enum(['everyone', 'hosts']).optional(),
    chatEnabled: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();
const date = z.string().datetime({ offset: true });
const zone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Invalid timezone.');
const body = z.object({
  settings: settingsBody
    .transform((v) => ({
      microphoneAccess: 'everyone' as const,
      cameraAccess: 'everyone' as const,
      screenShareAccess: 'everyone' as const,
      chatEnabled: true,
      locked: false,
      ...v,
    }))
    .optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(''),
  scheduledAt: date,
  durationMinutes: z.number().int().min(5).max(480),
  timeZone: zone,
  access: z.enum(['link', 'invited']),
  invitees: z.array(z.string().trim().toLowerCase().email().max(254)).max(100).default([]),
});
function publicMeeting(s: State, m: Meeting) {
  const org = s.organizations.find((o) => o.id === m.orgId)!;
  return {
    code: m.code,
    title: m.title,
    scheduledAt: m.scheduledAt,
    durationMinutes: m.durationMinutes,
    timeZone: m.timeZone,
    access: m.access,
    status: m.status,
    organization: {
      name: org.name,
      slug: org.slug,
      pageSlug: org.pageSlug,
      color: org.color,
      secondaryColor: org.secondaryColor,
      accentColor: org.accentColor,
      logoDataUrl: org.logoDataUrl,
    },
  };
}
export async function registerMeetings(
  app: FastifyInstance,
  { store, config, media, mailer }: AppOptions,
) {
  const find = (s: State, code: string) => {
    const m = s.meetings.find((m) => m.code === code);
    if (!m) throw new ApiError(404, 'This meeting link is not available.');
    return m;
  };
  const host = (s: State, m: Meeting, u: User) => {
    requireOrg(s, u, m.orgId, config.ownerEmail);
    if (
      m.createdBy !== u.id &&
      !isOwner(u, config.ownerEmail) &&
      !s.memberships.some(
        (x) => x.orgId === m.orgId && x.email === u.email && x.active && x.role === 'manager',
      )
    )
      throw new ApiError(403, 'Only the host or an organization manager can control this meeting.');
  };
  const canHost = (s: State, m: Meeting, u?: User) => {
    if (!u) return false;
    try {
      host(s, m, u);
      return true;
    } catch {
      return false;
    }
  };
  const moderator = (s: State, m: Meeting, req: FastifyRequest) => {
    const u = optionalUser(s, req);
    if (canHost(s, m, u)) return { u, a: undefined as Attendee | undefined };
    const a = attendee(s, m, req);
    if (!isMeetingCohost(m, a))
      throw new ApiError(403, 'Only hosts and cohosts can moderate this meeting.');
    return { u, a };
  };
  const participants = (s: State, m: Meeting) =>
    s.attendees.filter(
      (a) => a.meetingId === m.id && a.sessionId === m.sessionId && !a.removed && !a.leftAt,
    );
  const syncPermissions = async (s: State, m: Meeting) => {
    if (m.status !== 'live') return;
    if (!media.ready || !media.updatePermissions)
      throw new ApiError(503, 'Media permission changes are unavailable. Settings were not saved.');
    try {
      for (const a of participants(s, m))
        await media.updatePermissions(
          `meet8-${m.sessionId}`,
          a.id,
          participantPermissions(s, m, a, config.ownerEmail),
        );
    } catch {
      // A provider may have accepted some grants before failing. Disconnect all
      // affected sessions rather than leave a partially elevated connected peer.
      await Promise.allSettled(
        participants(s, m).map((a) => media.remove(`meet8-${m.sessionId}`, a.id)),
      );
      throw new ApiError(
        503,
        'Media permission changes could not be confirmed. Settings were not saved; reconnect and retry before continuing.',
      );
    }
  };
  const admission = (s: State, m: Meeting, request: FastifyRequest) => {
    const user = optionalUser(s, request);
    if (m.access === 'invited' && !canHost(s, m, user)) {
      if (!user) throw new ApiError(401, 'Verify your invited email address to join.');
      if (!m.invitees.includes(user.email))
        throw new ApiError(403, 'This email address is not invited to the meeting.');
    }
    return user;
  };
  const attendee = (
    s: State,
    m: Meeting,
    request: FastifyRequest,
    requireLive = false,
  ): Attendee => {
    const user = admission(s, m, request);
    const a = s.attendees.find(
      (a) =>
        a.meetingId === m.id &&
        (user
          ? a.userId === user.id
          : !a.userId && a.guestHash === hash(request.cookies.meet8_guest ?? '')) &&
        a.sessionId === m.sessionId,
    );
    if (!a || a.removed || a.leftAt)
      throw new ApiError(403, 'Join the meeting again to continue, or contact the host.');
    if (a.memberAtJoin && user) requireOrg(s, user, m.orgId, config.ownerEmail);
    if (requireLive && m.status !== 'live') throw new ApiError(409, 'The meeting is not live.');
    return a;
  };
  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/meetings', async (req) =>
    store.transaction((s) => {
      const user = requireUser(s, req);
      requireOrg(s, user, req.params.orgId, config.ownerEmail);
      return s.meetings
        .filter((m) => m.orgId === req.params.orgId)
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
        .map((m) => ({ ...m, canHost: canHost(s, m, user) }));
    }),
  );
  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/meetings', async (req, reply) => {
    const b = body.parse(req.body);
    const m = await store.transaction((s) => {
      const user = requireUser(s, req);
      requireOrg(s, user, req.params.orgId, config.ownerEmail);
      const meeting: Meeting = {
        ...b,
        invitees: [...new Set(b.invitees)],
        id: id(),
        orgId: req.params.orgId,
        createdBy: user.id,
        code: token(),
        status: 'scheduled',
        sessionId: null,
        createdAt: now(),
      };
      s.meetings.push(meeting);
      audit(s, user.id, 'meeting.created', meeting.id, meeting.orgId);
      return meeting;
    });
    return reply.code(201).send(m);
  });
  app.patch<{ Params: { orgId: string; meetingId: string } }>(
    '/api/orgs/:orgId/meetings/:meetingId',
    async (req) => {
      const b = body.parse(req.body);
      return store.transaction((s) => {
        const m = s.meetings.find(
          (m) => m.id === req.params.meetingId && m.orgId === req.params.orgId,
        );
        if (!m) throw new ApiError(404, 'Meeting not found.');
        const user = requireUser(s, req);
        host(s, m, user);
        if (m.status !== 'scheduled')
          throw new ApiError(409, 'Only a scheduled meeting can be edited.');
        Object.assign(m, b, { invitees: [...new Set(b.invitees)] });
        audit(s, user.id, 'meeting.updated', m.id, m.orgId);
        return m;
      });
    },
  );
  for (const action of ['start', 'end', 'restart', 'cancel'] as const) {
    app.post<{ Params: { orgId: string; meetingId: string } }>(
      `/api/orgs/:orgId/meetings/:meetingId/${action}`,
      async (req) =>
        store.transaction(async (s) => {
          const user = requireUser(s, req);
          requireOrg(s, user, req.params.orgId, config.ownerEmail);
          const m = s.meetings.find(
            (m) => m.id === req.params.meetingId && m.orgId === req.params.orgId,
          );
          if (!m) throw new ApiError(404, 'Meeting not found.');
          host(s, m, user);
          if (action === 'start') {
            if (m.status === 'live') return m;
            if (m.status !== 'scheduled')
              throw new ApiError(409, 'Restart an ended meeting explicitly.');
            m.sessionId = id();
            m.status = 'live';
            for (const a of s.attendees.filter(
              (a) => a.meetingId === m.id && a.sessionId === null && !a.removed,
            ))
              a.sessionId = m.sessionId;
          }
          if (action === 'restart') {
            if (m.status !== 'ended')
              throw new ApiError(409, 'Only an ended meeting can be restarted.');
            m.sessionId = id();
            m.status = 'live';
          }
          if (action === 'end') {
            if (m.status !== 'live') throw new ApiError(409, 'This meeting is not live.');
            await media.end(`meet8-${m.sessionId}`);
            m.status = 'ended';
          }
          if (action === 'cancel') {
            if (m.status === 'live')
              throw new ApiError(409, 'End the live meeting before cancelling it.');
            m.status = 'cancelled';
          }
          audit(s, user.id, `meeting.${action}`, m.id, m.orgId);
          return m;
        }),
    );
  }
  app.post<{ Params: { orgId: string; meetingId: string } }>(
    '/api/orgs/:orgId/meetings/:meetingId/invitations',
    async (req) => {
      const info = await store.transaction((s) => {
        const u = requireUser(s, req);
        const m = s.meetings.find(
          (m) => m.orgId === req.params.orgId && m.id === req.params.meetingId,
        );
        if (!m) throw new ApiError(404, 'Meeting not found.');
        host(s, m, u);
        if (!m.invitees.length)
          throw new ApiError(400, 'Add email addresses to the meeting first.');
        return { meeting: m, organization: s.organizations.find((o) => o.id === m.orgId)! };
      });
      let sent = 0;
      for (const email of info.meeting.invitees) {
        try {
          await mailer.sendInvitation(
            email,
            info.meeting.title,
            `${config.baseUrl}/o/${info.organization.slug}/meet/${info.meeting.code}`,
          );
          sent++;
        } catch {
          throw new ApiError(
            503,
            `Email delivery stopped after ${sent} invitations. Check mail configuration before retrying.`,
          );
        }
      }
      return { sent };
    },
  );
  app.get<{ Params: { code: string } }>('/api/meet/:code', async (req) =>
    store.transaction((s) => publicMeeting(s, find(s, req.params.code))),
  );
  app.post<{ Params: { code: string } }>('/api/meet/:code/join', async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    let guestToken = req.cookies.meet8_guest ?? token();
    const response = await store.transaction((s) => {
      const m = find(s, req.params.code);
      if (m.status === 'cancelled') throw new ApiError(410, 'This meeting has been cancelled.');
      if (m.status === 'ended') throw new ApiError(409, 'This meeting has ended.');
      const user = admission(s, m, req);
      let a = s.attendees.find(
        (a) =>
          a.meetingId === m.id &&
          a.sessionId === m.sessionId &&
          (user ? a.userId === user.id : !a.userId && a.guestHash === hash(guestToken)),
      );
      if (meetingSettings(m).locked && !a && !canHost(s, m, user))
        throw new ApiError(403, 'The host has locked this meeting.');
      if (a?.removed) throw new ApiError(403, 'You have been removed from this meeting.');
      if (!a) {
        a = {
          id: id(),
          orgId: m.orgId,
          meetingId: m.id,
          sessionId: m.sessionId,
          ...(user ? { userId: user.id, email: user.email } : { guestHash: hash(guestToken) }),
          name: user?.name ?? b.name,
          memberAtJoin: Boolean(
            user &&
            (isOwner(user, config.ownerEmail) ||
              s.memberships.some((x) => x.orgId === m.orgId && x.email === user.email && x.active)),
          ),
          raised: false,
          removed: false,
          joinedAt: now(),
        };
        s.attendees.push(a);
      } else {
        a.leftAt = undefined;
        a.name = user?.name ?? b.name;
      }
      return {
        state: m.status === 'live' ? 'live' : 'waiting',
        attendee: { id: a.id, name: a.name },
        meeting: publicMeeting(s, m),
      };
    });
    reply.setCookie('meet8_guest', guestToken, {
      path: '/',
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      maxAge: 86400,
    });
    return response;
  });
  app.get<{ Params: { code: string } }>('/api/meet/:code/session', async (req) =>
    store.transaction((s) => {
      const m = find(s, req.params.code);
      const a = attendee(s, m, req);
      const user = optionalUser(s, req);
      return {
        ...publicMeeting(s, m),
        sessionId: m.sessionId,
        attendee: {
          id: a.id,
          name: a.name,
          email: a.email,
          raised: a.raised,
          isHost: canHost(s, m, user),
          isCohost: isMeetingCohost(m, a),
        },
        ...recordingSessionState(s, m),
        recordingAvailable: Boolean((config as { recordingEnabled?: boolean }).recordingEnabled),
        settings: meetingSettings(m),
        permissions: participantPermissions(s, m, a, config.ownerEmail),
        canModerate: canHost(s, m, user) || isMeetingCohost(m, a),
        canAssignCohost: canHost(s, m, user),
        canHost: canHost(s, m, user),
        meetingId: canHost(s, m, user) ? m.id : undefined,
        orgId: canHost(s, m, user) ? m.orgId : undefined,
        participants: s.attendees
          .filter(
            (p) => p.meetingId === m.id && p.sessionId === m.sessionId && !p.removed && !p.leftAt,
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            raised: p.raised,
            isHost: canHost(
              s,
              m,
              s.users.find((u) => u.id === p.userId),
            ),
            isCohost: isMeetingCohost(m, p),
            verified: Boolean(p.userId),
          })),
        mediaReady: media.ready,
      };
    }),
  );
  app.post<{ Params: { code: string } }>('/api/meet/:code/connection', async (req) =>
    store.transaction(async (s) => {
      const m = find(s, req.params.code);
      if (m.status !== 'live') throw new ApiError(409, 'Wait for the host to start the meeting.');
      const a = attendee(s, m, req, true);
      if (!media.ready)
        throw new ApiError(
          503,
          'Meeting audio and video are not configured. Contact your administrator.',
        );
      try {
        return {
          ...(await media.token(
            `meet8-${m.sessionId}`,
            a.id,
            a.name,
            participantPermissions(s, m, a, config.ownerEmail),
          )),
          sessionId: m.sessionId,
        };
      } catch {
        throw new ApiError(503, 'The meeting media service is unavailable. Please try again.');
      }
    }),
  );
  app.post<{ Params: { code: string } }>('/api/meet/:code/leave', async (req) =>
    store.transaction(async (s) => {
      const m = find(s, req.params.code);
      const a = attendee(s, m, req);
      if (m.status === 'live') await media.remove(`meet8-${m.sessionId}`, a.id);
      a.leftAt = now();
      a.raised = false;
      return { ok: true };
    }),
  );
  app.post<{ Params: { code: string } }>('/api/meet/:code/raise-hand', async (req) => {
    const b = z.object({ raised: z.boolean() }).parse(req.body);
    return store.transaction((s) => {
      const m = find(s, req.params.code);
      const a = attendee(s, m, req, true);
      a.raised = b.raised;
      return { raised: a.raised };
    });
  });
  app.get<{ Params: { code: string } }>('/api/meet/:code/chat', async (req) =>
    store.transaction((s) => {
      const m = find(s, req.params.code);
      attendee(s, m, req, true);
      return s.messages
        .filter((x) => x.meetingId === m.id && x.sessionId === m.sessionId)
        .slice(-200);
    }),
  );
  app.post<{ Params: { code: string } }>('/api/meet/:code/chat', async (req, reply) => {
    const b = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const message = await store.transaction((s) => {
      const m = find(s, req.params.code);
      const a = attendee(s, m, req, true);
      if (
        !meetingSettings(m).chatEnabled &&
        !canHost(s, m, optionalUser(s, req)) &&
        !isMeetingCohost(m, a)
      )
        throw new ApiError(403, 'Chat is disabled by the host.');
      const message = {
        id: id(),
        orgId: m.orgId,
        meetingId: m.id,
        sessionId: m.sessionId!,
        attendeeId: a.id,
        name: a.name,
        body: b.body,
        createdAt: now(),
      };
      s.messages.push(message);
      return message;
    });
    return reply.code(201).send(message);
  });
  app.post<{ Params: { code: string } }>('/api/meet/:code/remove', async (req) => {
    const b = z.object({ attendeeId: z.string().uuid() }).parse(req.body);
    return store.transaction(async (s) => {
      const m = find(s, req.params.code);
      const { u } = moderator(s, m, req);
      const target = s.attendees.find(
        (a) => a.id === b.attendeeId && a.meetingId === m.id && a.sessionId === m.sessionId,
      );
      if (!target) throw new ApiError(404, 'Participant not found.');
      if (u && target.userId === u.id) throw new ApiError(400, 'Use Leave to exit your meeting.');
      if (
        !canHost(s, m, u) &&
        (canHost(
          s,
          m,
          s.users.find((x) => x.id === target.userId),
        ) ||
          isMeetingCohost(m, target))
      )
        throw new ApiError(403, 'Only the original host may remove elevated participants.');
      if (target.userId === m.createdBy)
        throw new ApiError(403, 'The original host cannot be removed.');
      if (m.status === 'live') {
        try {
          await media.remove(`meet8-${m.sessionId}`, target.id);
        } catch {
          throw new ApiError(503, 'Participant removal could not be confirmed.');
        }
      }
      target.removed = true;
      audit(s, u?.id ?? 'guest-cohost', 'participant.removed', target.id, m.orgId);
      return { ok: true };
    });
  });
  app.patch<{ Params: { code: string } }>('/api/meet/:code/settings', async (req) => {
    const b = settingsBody.parse(req.body);
    return store.transaction(async (s) => {
      const m = find(s, req.params.code);
      moderator(s, m, req);
      const old = meetingSettings(m);
      m.settings = { ...old, ...b };
      if (
        ['microphoneAccess', 'cameraAccess', 'screenShareAccess'].some(
          (k) => old[k as keyof MeetingSettings] !== m.settings![k as keyof MeetingSettings],
        )
      )
        await syncPermissions(s, m);
      return { settings: meetingSettings(m) };
    });
  });
  app.post<{ Params: { code: string } }>('/api/meet/:code/moderate', async (req) => {
    const b = z
      .object({
        action: z.enum(['lower-hand', 'mute', 'mute-all', 'cohost', 'remove-cohost']),
        attendeeId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    return store.transaction(async (s) => {
      const m = find(s, req.params.code);
      const { u } = moderator(s, m, req);
      const target = participants(s, m).find((a) => a.id === b.attendeeId);
      if (b.action !== 'mute-all' && !target) throw new ApiError(404, 'Participant not found.');
      if (b.action === 'cohost' || b.action === 'remove-cohost') {
        if (!canHost(s, m, u))
          throw new ApiError(
            403,
            'Only the original host or organization manager can assign cohosts.',
          );
        m.cohostAttendeeIds = (m.cohostAttendeeIds ?? []).filter((id) => id !== target!.id);
        if (b.action === 'cohost') m.cohostAttendeeIds.push(target!.id);
        const p = participantPermissions(s, m, target!, config.ownerEmail);
        if (
          m.status === 'live' &&
          (p.microphone === false ||
            p.camera === false ||
            p.screenShare === false ||
            Object.values(meetingSettings(m)).includes('hosts'))
        )
          await syncPermissions(s, m);
      } else if (b.action === 'lower-hand') target!.raised = false;
      else {
        if (!media.ready || !media.mute)
          throw new ApiError(503, 'Microphone moderation is unavailable.');
        try {
          for (const a of b.action === 'mute-all'
            ? participants(s, m).filter(
                (a) =>
                  !isMeetingHost(
                    s,
                    m,
                    s.users.find((u) => u.id === a.userId),
                    config.ownerEmail,
                  ) && !isMeetingCohost(m, a),
              )
            : [target!])
            await media.mute(`meet8-${m.sessionId}`, a.id);
        } catch {
          throw new ApiError(503, 'Microphone mute could not be confirmed.');
        }
      }
      audit(s, u?.id ?? 'guest-cohost', `participant.${b.action}`, target?.id ?? m.id, m.orgId);
      return { ok: true };
    });
  });
  app.delete<{ Params: { code: string; messageId: string } }>(
    '/api/meet/:code/chat/:messageId',
    async (req) =>
      store.transaction((s) => {
        const m = find(s, req.params.code);
        moderator(s, m, req);
        const index = s.messages.findIndex(
          (x) =>
            x.id === req.params.messageId && x.meetingId === m.id && x.sessionId === m.sessionId,
        );
        if (index < 0) throw new ApiError(404, 'Message not found.');
        s.messages.splice(index, 1);
        return { ok: true };
      }),
  );
}
