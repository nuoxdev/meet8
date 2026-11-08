import nodemailer from 'nodemailer';
import type { Config } from './config.js';
export interface Mailer {
  sendCode(email: string, code: string): Promise<void>;
  sendInvitation(email: string, title: string, url: string): Promise<void>;
}
export function createMailer(c: Config): Mailer {
  const transport = c.smtpHost
    ? nodemailer.createTransport({
        host: c.smtpHost,
        port: c.smtpPort,
        secure: c.smtpPort === 465,
        auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPassword } : undefined,
      })
    : null;
  async function send(to: string, subject: string, text: string) {
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
