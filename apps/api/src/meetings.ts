import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppOptions } from './app.js';
import type { State, Meeting, User, Attendee } from './store.js';
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
        attendee: { id: a.id, name: a.name, email: a.email, raised: a.raised },
        canHost: canHost(s, m, user),
        meetingId: canHost(s, m, user) ? m.id : undefined,
        orgId: canHost(s, m, user) ? m.orgId : undefined,
        participants: s.attendees
          .filter(
            (p) => p.meetingId === m.id && p.sessionId === m.sessionId && !p.removed && !p.leftAt,
          )
          .map((p) => ({ id: p.id, name: p.name, raised: p.raised })),
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
          ...(await media.token(`meet8-${m.sessionId}`, a.id, a.name)),
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
      const u = requireUser(s, req);
      host(s, m, u);
      const target = s.attendees.find(
        (a) => a.id === b.attendeeId && a.meetingId === m.id && a.sessionId === m.sessionId,
      );
      if (!target) throw new ApiError(404, 'Participant not found.');
      if (target.userId === u.id) throw new ApiError(400, 'Use Leave to exit your meeting.');
      if (m.status === 'live') await media.remove(`meet8-${m.sessionId}`, target.id);
      target.removed = true;
      audit(s, u.id, 'participant.removed', target.id, m.orgId);
      return { ok: true };
    });
  });
}
