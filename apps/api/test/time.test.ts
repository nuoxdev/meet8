import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputToISO, toDateInput } from '../../web/src/time.js';
test('organization timezone input is independent of browser timezone', () => {
  assert.equal(inputToISO('2026-11-08T14:30', 'Asia/Dubai'), '2026-11-08T10:30:00.000Z');
  assert.equal(toDateInput('2026-11-08T10:30:00.000Z', 'Asia/Dubai'), '2026-11-08T14:30');
});
test('daylight saving gaps are rejected instead of silently moving the meeting', () => {
  assert.throws(() => inputToISO('2027-03-14T02:30', 'America/New_York'), /does not exist/);
});
