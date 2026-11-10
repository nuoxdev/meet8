import { Pool } from 'pg';
import type { Recording } from './recordings.js';
export type User = { id: string; email: string; name: string; createdAt: string };
export type Organization = {
  pageSlug?: string;
  id: string;
  name: string;
  slug: string;
  color: string;
  secondaryColor?: string;
  accentColor?: string;
  logoDataUrl: string;
  timeZone: string;
  createdAt: string;
};
export type Membership = {
  id: string;
  orgId: string;
  email: string;
  role: 'manager' | 'member';
  active: boolean;
};
export type Challenge = {
  email: string;
  name: string;
  hash: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
};
export type Session = { hash: string; userId: string; expiresAt: number };
export type MeetingSettings = {
  microphoneAccess: 'everyone' | 'hosts';
  cameraAccess: 'everyone' | 'hosts';
  screenShareAccess: 'everyone' | 'hosts';
  chatEnabled: boolean;
  locked: boolean;
};
export type Meeting = {
  settings?: MeetingSettings;
  cohostAttendeeIds?: string[];
  id: string;
  orgId: string;
  code: string;
  title: string;
  description: string;
  createdBy: string;
  scheduledAt: string;
  durationMinutes: number;
  timeZone: string;
  access: 'link' | 'invited';
  invitees: string[];
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  sessionId: string | null;
  createdAt: string;
};
export type Attendee = {
  id: string;
  orgId: string;
  meetingId: string;
  sessionId: string | null;
  userId?: string;
  guestHash?: string;
  name: string;
  email?: string;
  memberAtJoin: boolean;
  raised: boolean;
  removed: boolean;
  joinedAt: string;
  leftAt?: string;
};
export type Message = {
  id: string;
  orgId: string;
  meetingId: string;
  sessionId: string;
  attendeeId: string;
  name: string;
  body: string;
  createdAt: string;
};
export type Audit = {
  id: string;
  orgId?: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
};
export type State = {
  recordings?: Recording[];
  users: User[];
  organizations: Organization[];
  memberships: Membership[];
  challenges: Challenge[];
  sessions: Session[];
  meetings: Meeting[];
  attendees: Attendee[];
  messages: Message[];
  audit: Audit[];
};
export function emptyState(): State {
  return {
    users: [],
    organizations: [],
    memberships: [],
    challenges: [],
    sessions: [],
    meetings: [],
    attendees: [],
    messages: [],
    audit: [],
  };
}
export interface Store {
  transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  private state = emptyState();
  private tail: Promise<unknown> = Promise.resolve();
  async transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      const copy = structuredClone(this.state);
      const result = await fn(copy);
      this.state = copy;
      return structuredClone(result);
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  async close() {}
}
/** Serialized document storage provides cross-process atomic meeting transitions.
 * This first-release repository can be replaced without changing application services. */
export class PostgresStore implements Store {
  readonly pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10 });
  }
  async initialize() {
    await this.pool.query(
      `create table if not exists meet8_state (id integer primary key check(id=1), data jsonb not null, updated_at timestamptz not null default now())`,
    );
    await this.pool.query('insert into meet8_state(id,data) values(1,$1) on conflict do nothing', [
      emptyState(),
    ]);
  }
  async transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query('select data from meet8_state where id=1 for update');
      const state = result.rows[0].data as State;
      const value = await fn(state);
      await client.query('update meet8_state set data=$1,updated_at=now() where id=1', [state]);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
