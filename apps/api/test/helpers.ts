import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';
export async function fixture(options: Record<string, unknown> = {}) {
  const sent: { email: string; code: string }[] = [];
  const mediaCalls: string[] = [];
  const store = new MemoryStore();
  const app = await buildApp({
    store,
    config: {
      ownerEmail: 'owner@example.com',
      baseUrl: 'http://localhost:5173',
      production: false,
      devMail: false,
      ...options,
    },
    mailer: {
      sendCode: async (email: string, code: string) => {
        sent.push({ email, code });
      },
      sendInvitation: async () => {},
    },
    media: {
      ready: true,
      cloud: true,
      token: async (room: string, id: string) => ({
        url: 'ws://localhost:7880',
        token: `${room}:${id}`,
      }),
      end: async (room: string) => {
        mediaCalls.push(room);
      },
      remove: async (room: string, id: string) => {
        mediaCalls.push(`${room}:${id}`);
      },
    },
  });
  async function call(method: string, url: string, body?: unknown, cookie?: string) {
    return app.inject({
      method: method as any,
      url,
      payload: body as any,
      headers: { ...(cookie ? { cookie } : {}), origin: 'http://localhost:5173' },
    });
  }
  async function login(email: string, name = 'Test person') {
    assert.equal((await call('POST', '/api/auth/request', { email, name })).statusCode, 200);
    const challenge = sent.at(-1)!;
    const r = await call('POST', '/api/auth/verify', { email, code: challenge.code });
    assert.equal(r.statusCode, 200, r.body);
    return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }
  return { app, call, login, sent, mediaCalls, store };
}
