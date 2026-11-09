import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer } from '../src/mail.js';
import type { Config } from '../src/config.js';

const config = (overrides: Partial<Config> = {}): Config => ({
  ownerEmail: 'owner@example.com',
  baseUrl: 'https://meet.example.com',
  production: false,
  devMail: false,
  mailProvider: 'ses',
  awsRegion: 'us-east-1',
  mailFrom: 'noreply@e8demo.com',
  ...overrides,
});

test('SES sends sign-in codes and invitations as plain text with the configured sender', async () => {
  const sent: any[] = [];
  const mailer = createMailer(config(), {
    ses: {
      send: async (command) => {
        sent.push(command.input);
      },
    },
  });
  await mailer.sendCode('guest@example.com', '123456');
  const url = 'https://meet.example.com/meeting/abc?invite=xyz';
  await mailer.sendInvitation('invitee@example.com', 'Planning', url);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].Source, 'noreply@e8demo.com');
  assert.deepEqual(sent[0].Destination.ToAddresses, ['guest@example.com']);
  assert.equal(sent[0].Message.Subject.Data, 'Your Meet8 sign-in code');
  assert.match(sent[0].Message.Body.Text.Data, /123456.*10 minutes/);
  assert.equal(sent[0].Message.Body.Html, undefined);
  assert.deepEqual(sent[1].Destination.ToAddresses, ['invitee@example.com']);
  assert.equal(sent[1].Message.Subject.Data, 'Meeting invitation: Planning');
  assert.ok(sent[1].Message.Body.Text.Data.includes(url));
});

test('SES failures reject delivery so callers cannot report success', async () => {
  const failure = new Error('SES delivery failed');
  const mailer = createMailer(config(), {
    ses: {
      send: async () => {
        throw failure;
      },
    },
  });
  await assert.rejects(mailer.sendCode('guest@example.com', '123456'), failure);
  await assert.rejects(
    mailer.sendInvitation('guest@example.com', 'Planning', 'https://meet.example.com'),
    failure,
  );
});

test('missing sender or provider configuration rejects without attempting delivery', async () => {
  let sends = 0;
  const ses = {
    send: async () => {
      sends++;
    },
  };
  await assert.rejects(
    createMailer(config({ mailFrom: undefined }), { ses }).sendCode('guest@example.com', '123456'),
    /not configured/,
  );
  await assert.rejects(
    createMailer(config({ mailProvider: undefined, smtpHost: undefined })).sendCode(
      'guest@example.com',
      '123456',
    ),
    /not configured/,
  );
  await assert.rejects(
    createMailer(config({ mailProvider: 'ses', awsRegion: undefined }), { ses }).sendCode(
      'guest@example.com',
      '123456',
    ),
    /not configured/,
  );
  assert.equal(sends, 0);
});
