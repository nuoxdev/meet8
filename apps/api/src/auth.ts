import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { State, User, Organization } from './store.js';
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const code = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const now = () => new Date().toISOString();
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireUser(state: State, request: FastifyRequest): User {
  const session = state.sessions.find(
    (s) => s.hash === hash(request.cookies.meet8_session ?? '') && s.expiresAt > Date.now(),
  );
  const user = session && state.users.find((u) => u.id === session.userId);
  if (!user) throw new ApiError(401, 'Please sign in to continue.');
  return user;
}
export function optionalUser(state: State, request: FastifyRequest): User | undefined {
  try {
    return requireUser(state, request);
  } catch {
    return undefined;
  }
}
export const isOwner = (user: User, ownerEmail: string) => user.email === ownerEmail;
export function requireOrg(
  state: State,
  user: User,
  orgId: string,
  ownerEmail: string,
  manager = false,
): Organization {
  const org = state.organizations.find((o) => o.id === orgId);
  if (!org) throw new ApiError(404, 'Organization not found.');
  const member = state.memberships.find(
    (m) => m.orgId === orgId && m.email === user.email && m.active,
  );
  if (!isOwner(user, ownerEmail) && (!member || (manager && member.role !== 'manager')))
    throw new ApiError(403, 'You do not have permission in this organization.');
  return org;
}
export function audit(state: State, actor: string, action: string, target: string, orgId?: string) {
  state.audit.push({ id: id(), actor, action, target, orgId, createdAt: now() });
}
