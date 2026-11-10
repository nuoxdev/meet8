import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { turnIceServers } from '../src/turn.js';
test('TURN REST credentials expire and never return the shared secret', () => {
  const c = {
    turnUrls: 'turn:meet.example.com:3478?transport=udp,turns:meet.example.com:5349?transport=tcp',
    turnSecret: 'private-test-secret',
  };
  const [ice] = turnIceServers(c, 'person-123', 1000000);
  assert.equal(ice.username, '4600:person-123');
  assert.equal(
    ice.credential,
    createHmac('sha1', c.turnSecret).update(ice.username).digest('base64'),
  );
  assert.ok(!JSON.stringify(ice).includes(c.turnSecret));
  assert.equal(ice.urls.length, 2);
});
test('partially configured or non-TURN relay URLs are rejected', () => {
  assert.throws(() =>
    turnIceServers({ turnUrls: 'https://evil.example', turnSecret: 'x' }, 'person'),
  );
  assert.throws(() => turnIceServers({ turnUrls: 'turn:relay' }, 'person'));
});
