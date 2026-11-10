import fs from 'node:fs';
import path from 'node:path';
import staticFiles from '@fastify/static';
import type { FastifyInstance } from 'fastify';
export async function registerWeb(app: FastifyInstance, root: string) {
  if (!fs.existsSync(root)) return;
  await app.register(staticFiles, { root, index: 'index.html' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/assets/') || req.method !== 'GET')
      return reply.code(404).send({ error: 'Not found.' });
    return reply.type('text/html').send(fs.readFileSync(path.join(root, 'index.html')));
  });
}
