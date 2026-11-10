import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, RequestError } from '../../web/src/api.js';
test('API client reports proxy HTML as a recoverable service error instead of JSON syntax details', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    new Response('<!DOCTYPE html><title>Bad gateway</title>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
  await assert.rejects(
    api('/meet/example/chat'),
    (error: unknown) =>
      error instanceof RequestError &&
      error.status === 502 &&
      !error.message.includes('DOCTYPE') &&
      !error.message.includes('Unexpected token') &&
      /temporarily unavailable/i.test(error.message),
  );
  globalThis.fetch = async () =>
    new Response('{badjson', { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    api('/me'),
    (error: unknown) => error instanceof RequestError && error.status === 502,
  );
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Chat is disabled.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  await assert.rejects(api('/meet/example/chat'), /Chat is disabled/);
});
