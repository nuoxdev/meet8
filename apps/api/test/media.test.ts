import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMedia } from '../src/media.js';
test(
  'media removal/end are idempotent when a meeting has no media participants',
  { skip: !process.env.MEET8_TEST_LIVEKIT_URL },
  async () => {
    const media = createMedia({
      ownerEmail: 'owner@example.com',
      baseUrl: 'http://localhost:5173',
      production: false,
      devMail: true,
      livekitUrl: process.env.MEET8_TEST_LIVEKIT_URL,
      livekitKey: 'devkey',
      livekitSecret: 'secret',
    });
    await assert.doesNotReject(() => media.remove('meet8-nonexistent-room', 'nonexistent-person'));
    await assert.doesNotReject(() => media.end('meet8-nonexistent-room'));
  },
);
