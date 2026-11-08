import { useEffect, useState } from 'react';
import { ArrowRight, UserPlus, Trash2 } from 'lucide-react';
import { api, type Organization } from './api';
type Member = { id: string; email: string; role: string };
export function CompanySettings({
  org,
  refresh,
}: {
  org: Organization;
  refresh: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logo, setLogo] = useState(org.logoDataUrl);
  const [busy, setBusy] = useState(false);
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
      <span className="eyebrow">MAKE IT YOURS</span>
      <h1>
        Your company.
        <br />
        <em>Your space.</em>
      </h1>
      <p className="intro">A familiar welcome for every person who joins you.</p>
      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="settings-grid">
        <section className="settings-card">
          <h2>Organization branding</h2>
          <p>Applied to your meeting links and rooms.</p>
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
                  color: f.get('color'),
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
              Company name
              <input name="name" required maxLength={100} defaultValue={org.name} />
            </label>
            <div className="form-grid">
              <label>
                Brand color
                <input type="color" name="color" defaultValue={org.color} />
              </label>
              <label>
                Default time zone
                <input name="timeZone" required defaultValue={org.timeZone} />
              </label>
            </div>
            <label>
              Company logo
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
              <small>PNG, JPEG, or WebP. Up to 500 KB.</small>
            </label>
            {logo && (
              <div className="logo-preview">
                <img src={logo} alt="Company logo preview" />
                <button className="text-button" type="button" onClick={() => setLogo('')}>
                  Remove logo
                </button>
              </div>
            )}
            <button disabled={busy} className="primary">
              Save branding
              <ArrowRight size={16} />
            </button>
          </form>
        </section>
        <section className="settings-card">
          <h2>The people in your space</h2>
          <p>Add their email, then ask them to sign in to Meet8.</p>
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
              Member email
              <input type="email" required name="email" placeholder="teammate@company.com" />
            </label>
            <label>
              Access level
              <select name="role">
                <option value="member">Member · host meetings</option>
                <option value="manager">Manager · manage company</option>
              </select>
            </label>
            <button disabled={busy} className="secondary">
              <UserPlus size={16} />
              Add member
            </button>
          </form>
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="avatar">{m.email[0].toUpperCase()}</span>
                <div>
                  <strong>{m.email}</strong>
                  <small>{m.role}</small>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Remove ${m.email}`}
                  onClick={async () => {
                    if (!window.confirm(`Remove ${m.email} from ${org.name}?`)) return;
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
