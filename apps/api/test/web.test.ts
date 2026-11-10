import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerWeb } from '../src/web.js';
test('packaged server serves application root and meeting links while keeping unknown API/assets as 404', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meet8-web-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Meet8</title>');
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await fs.rm(root, { recursive: true });
  });
  await registerWeb(app, root);
  for (const url of ['/', '/o/element8/meet/random-code']) {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    assert.match(response.body, /Meet8/);
  }
  assert.equal((await app.inject({ url: '/api/not-real' })).statusCode, 404);
  assert.equal((await app.inject({ url: '/assets/missing.js' })).statusCode, 404);
});
