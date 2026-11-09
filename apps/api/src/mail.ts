import nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { Config } from './config.js';
export interface Mailer {
  sendCode(email: string, code: string): Promise<void>;
  sendInvitation(email: string, title: string, url: string): Promise<void>;
}
export type MailClients = {
  ses?: { send(command: SendEmailCommand): Promise<unknown> };
};
export function createMailer(c: Config, clients: MailClients = {}): Mailer {
  const provider = c.mailProvider ?? 'smtp';
  const ses =
    provider === 'ses' && c.awsRegion
      ? (clients.ses ?? new SESClient({ region: c.awsRegion }))
      : null;
  const transport =
    provider === 'smtp' && c.smtpHost
      ? nodemailer.createTransport({
          host: c.smtpHost,
          port: c.smtpPort,
          secure: c.smtpPort === 465,
          auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPassword } : undefined,
        })
      : null;
  async function send(to: string, subject: string, text: string) {
    if (!c.mailFrom) throw new Error('Email delivery is not configured.');
    if (ses) {
      await ses.send(
        new SendEmailCommand({
          Source: c.mailFrom,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' } },
          },
        }),
      );
      return;
    }
    if (!transport) throw new Error('Email delivery is not configured.');
    await transport.sendMail({ from: c.mailFrom, to, subject, text });
  }
  return {
    sendCode: (email, code) =>
      send(
        email,
        'Your Meet8 sign-in code',
        `Your Meet8 code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      ),
    sendInvitation: (email, title, url) =>
      send(
        email,
        `Meeting invitation: ${title}`,
        `You are invited to ${title}.\n\nOpen the meeting: ${url}\n\nFor invited-only meetings, verify this email address to join.`,
      ),
  };
}
