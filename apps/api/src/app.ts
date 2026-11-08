import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import type { Store } from './store.js';
import type { Config } from './config.js';
import type { Mailer } from './mail.js';
import type { Media } from './media.js';
import { registerMeetings } from './meetings.js';
import {
  ApiError,
  requireUser,
  requireOrg,
  isOwner,
  id,
  now,
  token,
  hash,
  code,
  audit,
} from './auth.js';
const email = z.string().trim().toLowerCase().email().max(254);
const displayName = z.string().trim().min(1).max(100);
export type AppOptions = { store: Store; config: Config; mailer: Mailer; media: Media };
export async function buildApp(options: AppOptions) {
  const { store, config, mailer, media } = options;
  const app = Fastify({ logger: false, bodyLimit: 800_000, trustProxy: false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid input.' });
    const status =
      error instanceof ApiError ? error.statusCode : ((error as any).statusCode ?? 500);
    return reply
      .code(status)
      .send({
        error:
          status >= 500
            ? 'The service could not complete this request. Please try again.'
            : error instanceof Error
              ? error.message
              : 'Invalid request.',
      });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('Cache-Control', 'no-store');
    if (config.production) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if ((origin && origin !== new URL(config.baseUrl).origin) || (!origin && config.production))
        throw new ApiError(403, 'Request origin is not allowed.');
    }
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/api/readiness', async () => ({
    media: media.ready,
    email: config.devMail ? 'development' : Boolean(config.smtpHost),
    development: config.devMail,
  }));
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
  app.post(
    '/api/auth/request',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request) => {
      const body = z.object({ email, name: displayName }).parse(request.body);
      const raw = code();
      await store.transaction((s) => {
        s.challenges = s.challenges.filter(
          (c) => c.expiresAt > Date.now() && c.email !== body.email,
        );
        s.challenges.push({
          email: body.email,
          name: body.name,
          hash: hash(`${body.email}:${raw}`),
          expiresAt: Date.now() + 600_000,
          attempts: 0,
          createdAt: Date.now(),
        });
      });
      if (!config.devMail) {
        try {
          await mailer.sendCode(body.email, raw);
        } catch {
          await store.transaction((s) => {
            s.challenges = s.challenges.filter(
              (c) => c.email !== body.email || c.hash !== hash(`${body.email}:${raw}`),
            );
          });
          throw new ApiError(503, 'Email delivery is unavailable. Contact the administrator.');
        }
      }
      return { ok: true, ...(config.devMail ? { developmentCode: raw } : {}) };
    },
  );
  app.post(
    '/api/auth/verify',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = z.object({ email, code: z.string().min(1).max(20) }).parse(request.body);
      const raw = token();
      const user = await store.transaction((s) => {
        const challenge = s.challenges.find(
          (c) => c.email === body.email && c.expiresAt > Date.now(),
        );
        if (!challenge || challenge.attempts >= 5) return null;
        challenge.attempts++;
        if (challenge.hash !== hash(`${body.email}:${body.code}`)) return null;
        s.challenges = s.challenges.filter((c) => c !== challenge);
        let user = s.users.find((u) => u.email === body.email);
        if (!user) {
          user = { id: id(), email: body.email, name: challenge.name, createdAt: now() };
          s.users.push(user);
        }
        s.sessions = s.sessions.filter((session) => session.expiresAt > Date.now());
        s.sessions.push({
          hash: hash(raw),
          userId: user.id,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
        return user;
      });
      if (!user) throw new ApiError(401, 'The code is invalid or has expired. Request a new code.');
      reply.setCookie('meet8_session', raw, cookieOptions);
      return { user };
    },
  );
  app.post('/api/auth/logout', async (request, reply) => {
    await store.transaction((s) => {
      s.sessions = s.sessions.filter(
        (session) => session.hash !== hash(request.cookies.meet8_session ?? ''),
      );
    });
    reply.clearCookie('meet8_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/me', async (request) =>
    store.transaction((s) => {
      const user = requireUser(s, request);
      const platformAdmin = isOwner(user, config.ownerEmail);
      return {
        user,
        platformAdmin,
        organizations: s.organizations
          .filter(
            (o) =>
              platformAdmin ||
              s.memberships.some((m) => m.orgId === o.id && m.email === user.email && m.active),
          )
          .map((o) => ({
            ...o,
            role: platformAdmin
              ? 'owner'
              : s.memberships.find((m) => m.orgId === o.id && m.email === user.email && m.active)!
                  .role,
          })),
      };
    }),
  );
  app.post('/api/orgs', async (request, reply) => {
    const b = z
      .object({
        name: displayName,
        slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/),
        managerEmail: email,
      })
      .parse(request.body);
    const org = await store.transaction((s) => {
      const user = requireUser(s, request);
      if (!isOwner(user, config.ownerEmail))
        throw new ApiError(403, 'Only the platform owner can create organizations.');
      if (s.organizations.some((o) => o.slug === b.slug))
        throw new ApiError(409, 'This organization address is already taken.');
      const org = {
        id: id(),
        name: b.name,
        slug: b.slug,
        color: '#1c5947',
        logoDataUrl: '',
        timeZone: 'Asia/Dubai',
        createdAt: now(),
      };
      s.organizations.push(org);
      s.memberships.push({
        id: id(),
        orgId: org.id,
        email: b.managerEmail,
        role: 'manager',
        active: true,
      });
      audit(s, user.id, 'organization.created', org.id, org.id);
      return org;
    });
    return reply.code(201).send(org);
  });
  app.patch<{ Params: { orgId: string } }>('/api/orgs/:orgId', async (request) => {
    const b = z
      .object({
        name: displayName.optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        timeZone: z
          .string()
          .refine((v) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }, 'Invalid timezone.')
          .optional(),
        logoDataUrl: z
          .string()
          .max(700_000)
          .refine(
            (v) => v === '' || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
            'Use a PNG, JPEG, or WebP image.',
          )
          .optional(),
      })
      .strict()
      .parse(request.body);
    return store.transaction((s) => {
      const user = requireUser(s, request);
      const org = requireOrg(s, user, request.params.orgId, config.ownerEmail, true);
      Object.assign(org, b);
      audit(s, user.id, 'organization.updated', org.id, org.id);
      return org;
    });
  });
  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/members', async (request) =>
    store.transaction((s) => {
      const user = requireUser(s, request);
      requireOrg(s, user, request.params.orgId, config.ownerEmail, true);
      return s.memberships.filter((m) => m.orgId === request.params.orgId && m.active);
    }),
  );
  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/members', async (request, reply) => {
    const b = z.object({ email, role: z.enum(['manager', 'member']) }).parse(request.body);
    const member = await store.transaction((s) => {
      const user = requireUser(s, request);
      requireOrg(s, user, request.params.orgId, config.ownerEmail, true);
      const existing = s.memberships.find(
        (m) => m.orgId === request.params.orgId && m.email === b.email,
      );
      if (existing && existing.active)
        throw new ApiError(409, 'This person already belongs to the organization.');
      if (existing) {
        existing.active = true;
        existing.role = b.role;
        return existing;
      }
      const member = { id: id(), orgId: request.params.orgId, ...b, active: true };
      s.memberships.push(member);
      audit(s, user.id, 'member.added', member.id, member.orgId);
      return member;
    });
    return reply.code(201).send(member);
  });
  app.delete<{ Params: { orgId: string; memberId: string } }>(
    '/api/orgs/:orgId/members/:memberId',
    async (request) =>
      store.transaction(async (s) => {
        const user = requireUser(s, request);
        requireOrg(s, user, request.params.orgId, config.ownerEmail, true);
        const member = s.memberships.find(
          (m) => m.orgId === request.params.orgId && m.id === request.params.memberId && m.active,
        );
        if (!member) throw new ApiError(404, 'Member not found.');
        if (
          member.role === 'manager' &&
          s.memberships.filter((m) => m.orgId === member.orgId && m.role === 'manager' && m.active)
            .length === 1
        )
          throw new ApiError(409, 'Assign another manager before removing the last manager.');
        const target = s.users.find((u) => u.email === member.email);
        for (const attendee of s.attendees.filter(
          (a) => a.orgId === member.orgId && a.userId === target?.id && !a.removed,
        )) {
          const meeting = s.meetings.find((m) => m.id === attendee.meetingId);
          if (meeting?.status === 'live' && meeting.sessionId)
            await media.remove(`meet8-${meeting.sessionId}`, attendee.id);
          attendee.removed = true;
        }
        member.active = false;
        audit(s, user.id, 'member.removed', member.id, member.orgId);
        return { ok: true };
      }),
  );
  await registerMeetings(app, options);
  return app;
}
