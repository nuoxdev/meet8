import { useLanguage, LanguageSwitcher } from './i18n';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Video, ShieldCheck } from 'lucide-react';
import { api } from './api';
export function Wordmark() {
  const { t } = useLanguage();
  return (
    <a className="wordmark" href="/" aria-label={t('Meet8 home')}>
      <span className="logo-mark">
        <Video size={22} />
      </span>
      meet<span className="wordmark-eight">8</span>
    </a>
  );
}
export function Auth({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!sent) {
        const result = await api('/auth/request', 'POST', { name, email });
        setDevCode(result.developmentCode ?? '');
        setSent(true);
      } else {
        await api('/auth/verify', 'POST', { email, code });
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={compact ? 'auth-inline' : 'auth-page'}>
      {!compact && (
        <>
          <header className="public-header">
            <Wordmark />
            <span>{t('Good conversations start here.')}</span>
          </header>
          <div className="auth-art">
            <span className="eyebrow">{t('BUILT FOR CUSTOMER CONNECTIONS')}</span>
            <h1>
              {t('Bring customers')}
              <br />
              {t('together for')}
              <br />
              <em>{t('what’s next.')}</em>
            </h1>
            <div className="orbit-art" aria-hidden="true">
              <div />
              <div />
              <div />
              <span>8</span>
            </div>
            <p>
              {t('Your expertise. Your brand.')}
              <br />
              {t('Professional workshops and meetings, in one link.')}
            </p>
          </div>
        </>
      )}
      <section className="auth-card">
        <LanguageSwitcher />
        <span className="eyebrow">{t('WELCOME TO MEET8')}</span>
        <h2>{sent ? t('Check your inbox.') : t('Welcome to Meet8.')}</h2>
        <p>
          {sent
            ? t('We sent a six-digit code to {email}.', { email })
            : t('Sign in or create your account with your email.')}
        </p>
        <form onSubmit={submit}>
          {!sent ? (
            <>
              <label>
                {t('Your name')}
                <input
                  required
                  maxLength={100}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Alex Morgan')}
                />
              </label>
              <label>
                {t('Email address')}
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('you@company.com')}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {t('Verification code')}
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('000000')}
                  autoFocus
                />
              </label>
              {devCode && (
                <aside className="dev-note">
                  {t('Development email delivery · code')}{' '}
                  <strong data-testid="development-code">{devCode}</strong>
                </aside>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? t('Please wait…') : sent ? t('Verify and continue') : t('Send sign-in code')}
            <ArrowRight size={17} />
          </button>
          {sent && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setSent(false);
                setError('');
              }}
            >
              {t('Use a different email or request a new code')}
            </button>
          )}
        </form>
        <div className="auth-footnote">
          <ShieldCheck size={17} />
          <span>{t('Organization access is managed by your company.')}</span>
        </div>
      </section>
    </div>
  );
}
