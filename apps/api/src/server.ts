import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerWeb } from './web.js';
import { loadConfig } from './config.js';
import { MemoryStore, PostgresStore } from './store.js';
import { buildApp } from './app.js';
import { createMailer } from './mail.js';
import { createMedia } from './media.js';
const config = loadConfig();
if (!config.databaseUrl && process.env.MEET8_EPHEMERAL !== 'true')
  throw new Error(
    'Set DATABASE_URL for persistent storage, or MEET8_EPHEMERAL=true for a disposable development/test session.',
  );
const store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new MemoryStore();
if (store instanceof PostgresStore) await store.initialize();
const app = await buildApp({
  store,
  config,
  mailer: createMailer(config),
  media: createMedia(config),
});
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
await registerWeb(app, webRoot);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => store.close())
      .then(() => process.exit(0));
  });
await app.listen({ port: config.port ?? 4100, host: process.env.HOST ?? '127.0.0.1' });
console.info(
  `Meet8 API ready on port ${config.port}. Storage: ${config.databaseUrl ? 'PostgreSQL' : 'EPHEMERAL — discarded on restart'}. Email: ${config.devMail ? 'development codes shown in UI' : 'SMTP'}.`,
);
