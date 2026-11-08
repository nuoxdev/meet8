export type Config = {
  ownerEmail: string;
  baseUrl: string;
  production: boolean;
  devMail: boolean;
  port?: number;
  livekitUrl?: string;
  livekitKey?: string;
  livekitSecret?: string;
  livekitCloud?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  mailFrom?: string;
  databaseUrl?: string;
};
export function loadConfig(): Config {
  const e = process.env;
  const production = e.NODE_ENV === 'production';
  const config: Config = {
    ownerEmail: (e.MEET8_OWNER_EMAIL ?? '').trim().toLowerCase(),
    baseUrl: e.MEET8_BASE_URL ?? 'http://localhost:5173',
    production,
    devMail: !production && e.MEET8_DEV_MAIL === 'true',
    port: Number(e.PORT ?? 4100),
    databaseUrl: e.DATABASE_URL,
    livekitUrl: e.LIVEKIT_URL,
    livekitKey: e.LIVEKIT_API_KEY,
    livekitSecret: e.LIVEKIT_API_SECRET,
    livekitCloud: e.LIVEKIT_MODE === 'cloud',
    smtpHost: e.SMTP_HOST,
    smtpPort: Number(e.SMTP_PORT ?? 587),
    smtpUser: e.SMTP_USER,
    smtpPassword: e.SMTP_PASSWORD,
    mailFrom: e.MAIL_FROM,
  };
  if (!config.ownerEmail || !config.ownerEmail.includes('@'))
    throw new Error('Set MEET8_OWNER_EMAIL to the platform owner’s email.');
  const base = new URL(config.baseUrl);
  if (
    production &&
    (base.protocol !== 'https:' || !config.databaseUrl || !config.smtpHost || !config.mailFrom)
  )
    throw new Error(
      'Production requires HTTPS MEET8_BASE_URL, DATABASE_URL, SMTP_HOST and MAIL_FROM.',
    );
  if (production && config.livekitUrl && !config.livekitCloud)
    throw new Error(
      'Production meeting access revocation requires LIVEKIT_MODE=cloud. Self-hosted media is development-only until equivalent token revocation is implemented.',
    );
  return config;
}
