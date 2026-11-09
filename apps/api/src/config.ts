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
  livekitGateway?: boolean;
  livekitInternalUrl?: string;
  turnUrls?: string;
  turnSecret?: string;
  mailProvider?: 'smtp' | 'ses';
  awsRegion?: string;
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
    livekitGateway: e.LIVEKIT_MODE === 'self-hosted-gateway',
    livekitInternalUrl: e.LIVEKIT_INTERNAL_URL,
    turnUrls: e.MEET8_TURN_URLS,
    turnSecret: e.MEET8_TURN_SECRET,
    mailProvider: e.MAIL_PROVIDER === 'ses' ? 'ses' : 'smtp',
    awsRegion: e.AWS_REGION,
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
    (base.protocol !== 'https:' ||
      !config.databaseUrl ||
      !config.mailFrom ||
      (config.mailProvider === 'ses' ? !config.awsRegion : !config.smtpHost))
  )
    throw new Error(
      'Production requires HTTPS MEET8_BASE_URL, DATABASE_URL, MAIL_FROM and configured SMTP or SES transport.',
    );
  if (production && config.livekitUrl && !config.livekitCloud && !config.livekitGateway)
    throw new Error(
      'Production media requires cloud mode or the private self-hosted authorization gateway.',
    );
  if (config.livekitGateway) {
    if (!config.livekitInternalUrl || !config.livekitKey || !config.livekitSecret)
      throw new Error('Gateway mode requires internal LiveKit URL, API key and secret.');
    const internal = new URL(config.livekitInternalUrl);
    if (
      !['http:', 'https:', 'ws:', 'wss:'].includes(internal.protocol) ||
      internal.username ||
      internal.password ||
      internal.search ||
      internal.hash ||
      internal.pathname !== '/'
    )
      throw new Error('Use an origin-only internal LiveKit URL.');
    if (
      production &&
      !(
        internal.hostname === 'media' ||
        internal.hostname === 'localhost' ||
        /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(internal.hostname)
      )
    )
      throw new Error('Production gateway requires private LiveKit signaling.');
    if (production && (!config.turnUrls || !config.turnSecret))
      throw new Error('Production gateway requires a configured TURN relay.');
  }
  return config;
}
