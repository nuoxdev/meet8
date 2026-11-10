import { useEffect, useState } from 'react';
import { ArrowRight, Building2 } from 'lucide-react';
import { api, type Identity, type Preview } from './api';
import { Auth, Wordmark } from './Auth';
import { brandStyle } from './branding';
import { LanguageSwitcher, useLanguage } from './i18n';
import './organization.css';
type Company = Preview['organization'] & { pageSlug?: string };
export function OrganizationPage({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const [company, setCompany] = useState<Company | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  async function loadIdentity() {
    try {
      setIdentity(await api<Identity>('/me'));
    } catch {
      setIdentity(null);
    }
  }
  useEffect(() => {
    let stopped = false;
    void api<Company>(`/organizations/${encodeURIComponent(slug)}`)
      .then((c) => {
        if (!stopped) setCompany(c);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    void loadIdentity();
    return () => {
      stopped = true;
    };
  }, [slug]);
  if (!company)
    return (
      <main className="empty">
        <LanguageSwitcher />
        <Wordmark />
        <h1>{t(error ? 'Organization page not found.' : 'Opening your organization…')}</h1>
        {error && <p role="alert">{t(error)}</p>}
        <a href="/">{t('Back to Meet8')}</a>
      </main>
    );
  const membership = identity?.organizations.find((o) => o.slug === company.slug);
  const canHost = Boolean(membership);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true);
    setError('');
    try {
      let code = input.trim();
      if (/^https?:\/\//i.test(code) || code.startsWith('/')) {
        const url = new URL(code, location.origin);
        if (url.origin !== location.origin)
          throw new Error('Use a Meet8 meeting link from this organization.');
        code = url.pathname.match(/^\/o\/[^/]+\/meet\/([^/]+)\/?$/)?.[1] ?? '';
      }
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(code))
        throw new Error('Enter a valid meeting link or code.');
      const preview = await api<Preview>(`/meet/${encodeURIComponent(code)}`);
      if (preview.organization.slug !== company.slug)
        throw new Error('This meeting belongs to another organization.');
      location.assign(`/o/${company.slug}/meet/${encodeURIComponent(code)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div
      className="organization-page meeting-page"
      style={brandStyle(company.color, company.secondaryColor, company.accentColor)}
    >
      <header className="organization-header">
        <a className="company-brand" href={`/${company.pageSlug ?? company.slug}`}>
          <span className="company-avatar">
            {company.logoDataUrl ? <img src={company.logoDataUrl} alt="" /> : company.name[0]}
          </span>
          <strong>{company.name}</strong>
        </a>
        <LanguageSwitcher />
      </header>
      <main className="organization-main">
        <section>
          <span className="eyebrow">{t('CUSTOMER WORKSHOPS & MEETINGS')}</span>
          <h1>{t('Welcome to {name}', { name: company.name })}</h1>
          <p>{t('Join your workshop or meeting through a secure link from your host.')}</p>
          <div className="organization-assurance">
            <Building2 size={20} />
            <span>{t('A professional experience, hosted by {name}.', { name: company.name })}</span>
          </div>
        </section>
        <section className="organization-join">
          <h2>{t('Join a workshop')}</h2>
          <form onSubmit={join}>
            <label>
              {t('Meeting link or code')}
              <input
                required
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('Paste your invitation link')}
                autoComplete="off"
              />
            </label>
            <button className="primary wide" disabled={busy}>
              {t('Continue to meeting')}
              <ArrowRight size={16} />
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {t(error)}
            </p>
          )}
          <div className="join-divider" />
          {canHost ? (
            <button
              className="secondary wide"
              onClick={() => {
                sessionStorage.setItem('meet8-org', membership!.id);
                location.assign('/');
              }}
            >
              {t('Open host dashboard')}
              <ArrowRight size={16} />
            </button>
          ) : (
            <>
              <button className="text-button" onClick={() => setSignIn(!signIn)}>
                {t('Host or manage workshops? Sign in')}
              </button>
              {identity && (
                <p className="muted">
                  {t('Your organization manager must assign hosting access to your email.')}
                </p>
              )}
            </>
          )}
          {signIn && !canHost && <Auth compact onDone={loadIdentity} />}
        </section>
      </main>
      <footer className="organization-footer">
        <Wordmark />
        <span>{t('Professional workshops. Your brand.')}</span>
      </footer>
    </div>
  );
}
