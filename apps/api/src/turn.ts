// Adapted from Desk8 Connect guest-turn.ts (b3ea5e5).
import { createHmac } from 'node:crypto';
export function turnIceServers(
  config: { turnUrls?: string; turnSecret?: string },
  identity: string,
  timestamp = Date.now(),
): { urls: string[]; username: string; credential: string }[] {
  if (!config.turnUrls && !config.turnSecret) return [];
  const urls = (config.turnUrls ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (!config.turnSecret || !urls.length || !urls.every((url) => /^turns?:[^\s,]+$/i.test(url)))
    throw new Error('TURN relay configuration is invalid.');
  const safe = identity.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  if (!safe) throw new Error('TURN identity is invalid.');
  const username = `${Math.floor(timestamp / 1000) + 3600}:${safe}`;
  return [
    {
      urls,
      username,
      credential: createHmac('sha1', config.turnSecret).update(username).digest('base64'),
    },
  ];
}
