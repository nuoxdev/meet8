import { useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { ArrowRight, UserPlus, Trash2 } from 'lucide-react';
import { api, type Organization } from './api';
import { brandStyle } from './branding';
type Member = { id: string; email: string; role: string };
export function CompanySettings({
  org,
  refresh,
}: {
  org: Organization;
  refresh: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logo, setLogo] = useState(org.logoDataUrl);
  const [busy, setBusy] = useState(false);
  const [primary, setPrimary] = useState(org.color);
  const [secondary, setSecondary] = useState(org.secondaryColor ?? '#253b57');
  const [accent, setAccent] = useState(org.accentColor ?? '#ddedbb');
  async function load() {
    try {
      setMembers(await api(`/orgs/${org.id}/members`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setLogo(org.logoDataUrl);
    void load();
  }, [org.id]);
  return (
    <section className="settings-page">
      <span className="eyebrow">{t('MAKE IT YOURS')}</span>
      <h1>
        {t('Your company.')}
        <br />
        <em>{t('Your space.')}</em>
      </h1>
      <p className="intro">
        {t('Create a consistent, professional experience for your customers.')}
      </p>
      {error && (
        <p className="error banner" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {t(notice)}
        </p>
      )}
      <div className="settings-grid">
        <section className="settings-card">
          <h2>{t('Organization branding')}</h2>
          <p>{t('Customize your dashboard, workshop links, and meeting rooms.')}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              setNotice('');
              const f = new FormData(e.currentTarget);
              try {
                await api(`/orgs/${org.id}`, 'PATCH', {
                  name: f.get('name'),
                  pageSlug: f.get('pageSlug'),
                  color: primary,
                  secondaryColor: secondary,
                  accentColor: accent,
                  timeZone: f.get('timeZone'),
                  logoDataUrl: logo,
                });
                await refresh();
                setNotice('Organization branding saved.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Company name')}
              <input name="name" required maxLength={100} defaultValue={org.name} />
            </label>
            <label>
              {t('Organization page address')}
              <input
                name="pageSlug"
                required
                maxLength={48}
                pattern="[a-z0-9][a-z0-9-]{0,47}"
                defaultValue={org.pageSlug ?? org.slug}
              />
              <small>
                {t('Your public welcome page: {url}', {
                  url: `${window.location.origin}/${org.pageSlug ?? org.slug}`,
                })}
              </small>
            </label>
            <fieldset className="brand-palette">
              <legend>{t('Brand colors')}</legend>
              <p>
                {t(
                  'Primary for main actions, secondary for supporting elements, and accent for highlights. Text contrast adjusts automatically.',
                )}
              </p>
              <div className="palette-inputs">
                {(
                  [
                    ['Primary color', primary, setPrimary],
                    ['Secondary color', secondary, setSecondary],
                    ['Accent color', accent, setAccent],
                  ] as const
                ).map(([label, value, update]) => (
                  <label key={t(label)}>
                    {t(label)}
                    <input
                      aria-label={t(label)}
                      type="color"
                      value={value}
                      onChange={(e) => update(e.target.value)}
                    />
                    <small>{value.toUpperCase()}</small>
                  </label>
                ))}
              </div>
              <div
                className="brand-preview"
                style={brandStyle(primary, secondary, accent)}
                aria-label={t('Brand palette preview')}
              >
                <span className="palette-preview-label">{t('CUSTOMER EXPERIENCE PREVIEW')}</span>
                <strong>{t('Your next customer workshop')}</strong>
                <p>{t('A branded welcome, from invitation to conversation.')}</p>
                <div className="preview-actions">
                  <span className="preview-primary">{t('Join workshop')}</span>
                  <span className="preview-secondary">{t('Workshop details')}</span>
                  <span className="preview-accent">{t('Your brand')}</span>
                </div>
              </div>
            </fieldset>
            <div className="form-grid">
              <label>
                {t('Default time zone')}
                <input name="timeZone" required defaultValue={org.timeZone} />
              </label>
            </div>
            <label>
              {t('Company logo')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500000) {
                    setError('Choose a logo smaller than 500 KB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setLogo(String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
              <small>{t('PNG, JPEG, or WebP. Up to 500 KB.')}</small>
            </label>
            {logo && (
              <div className="logo-preview">
                <img src={logo} alt={t('Company logo preview')} />
                <button className="text-button" type="button" onClick={() => setLogo('')}>
                  {t('Remove logo')}
                </button>
              </div>
            )}
            <button disabled={busy} className="primary">
              {t('Save branding')}
              <ArrowRight size={16} />
            </button>
          </form>
        </section>
        <section className="settings-card">
          <h2>{t('Workshop hosts and managers')}</h2>
          <p>{t('Add their email, then ask them to sign in to Meet8.')}</p>
          <form
            className="member-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              setBusy(true);
              const form = e.currentTarget;
              const f = new FormData(form);
              try {
                await api(`/orgs/${org.id}/members`, 'POST', {
                  email: f.get('email'),
                  role: f.get('role'),
                });
                await load();
                form.reset();
                setNotice('Member access assigned. They can now sign in with that email.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Member email')}
              <input type="email" required name="email" placeholder={t('teammate@company.com')} />
            </label>
            <label>
              {t('Access level')}
              <select name="role">
                <option value="member">{t('Member · host meetings')}</option>
                <option value="manager">{t('Manager · manage company')}</option>
              </select>
            </label>
            <button disabled={busy} className="secondary">
              <UserPlus size={16} />
              {t('Add member')}
            </button>
          </form>
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="avatar">{m.email[0].toUpperCase()}</span>
                <div>
                  <strong>{m.email}</strong>
                  <small>{t(m.role)}</small>
                </div>
                <button
                  className="icon-button"
                  aria-label={t('Remove {email}', { email: m.email })}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        t('Remove {email} from {name}?', { email: m.email, name: org.name }),
                      )
                    )
                      return;
                    setError('');
                    try {
                      await api(`/orgs/${org.id}/members/${m.id}`, 'DELETE');
                      await load();
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
