import { useEffect, useState, type CSSProperties } from 'react';
import {
  CalendarDays,
  Plus,
  Video,
  ArrowUpRight,
  Search,
  Copy,
  Check,
  Settings,
  Users,
  Building2,
  LogOut,
  ChevronDown,
  ArrowRight,
  Clock,
  Link2,
  LockKeyhole,
  X,
} from 'lucide-react';
import { api, meetingLink, dateLabel, type Identity, type Organization, type Meeting } from './api';
import { Auth, Wordmark } from './Auth';
import { MeetingPage } from './MeetingPage';
import { MeetingForm } from './MeetingForm';
import { CompanySettings } from './CompanySettings';
export function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fatal, setFatal] = useState('');
  async function refresh() {
    try {
      setIdentity(await api<Identity>('/me'));
      setFatal('');
    } catch (e) {
      if ((e as any).status !== 401) setFatal((e as Error).message);
      setIdentity(null);
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const code = window.location.pathname.match(/^\/o\/[^/]+\/meet\/([^/]+)\/?$/)?.[1];
  if (code) return <MeetingPage code={code} identity={identity} onIdentity={refresh} />;
  if (!loaded) return <div className="loading-page">Opening Meet8…</div>;
  if (fatal)
    return (
      <div className="empty">
        <h1>Meet8 is unavailable</h1>
        <p role="alert">{fatal}</p>
        <button onClick={() => void refresh()}>Try again</button>
      </div>
    );
  if (!identity) return <Auth onDone={refresh} />;
  return (
    <Dashboard
      identity={identity}
      refresh={refresh}
      onLogout={async () => {
        await api('/auth/logout', 'POST', {});
        setIdentity(null);
      }}
    />
  );
}
function Dashboard({
  identity,
  refresh,
  onLogout,
}: {
  identity: Identity;
  refresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [orgId, setOrgId] = useState(() => sessionStorage.getItem('meet8-org') ?? '');
  const org = identity.organizations.find((o) => o.id === orgId) ?? identity.organizations[0];
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [view, setView] = useState<'meetings' | 'settings'>('meetings');
  const [tab, setTab] = useState('upcoming');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Meeting | 'new' | null>(null);
  const [newOrg, setNewOrg] = useState(false);
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState('');
  async function load() {
    if (!org) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api<Meeting[]>(`/orgs/${org.id}/meetings`);
      setMeetings(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    setMeetings([]);
    setLoading(true);
    setView('meetings');
    setForm(null);
    setError('');
    if (!org) {
      setLoading(false);
      return;
    }
    sessionStorage.setItem('meet8-org', org.id);
    api<Meeting[]>(`/orgs/${org.id}/meetings`)
      .then((m) => {
        if (!cancelled) setMeetings(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org?.id]);
  async function action(m: Meeting, act: string) {
    setBusy(m.id);
    setError('');
    try {
      await api(`/orgs/${org!.id}/meetings/${m.id}/${act}`, 'POST', {});
      if (act === 'start' || act === 'restart') window.location.assign(meetingLink(org!, m));
      else await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function instant() {
    if (!org) return;
    setBusy('instant');
    setError('');
    try {
      const m = await api<Meeting>(`/orgs/${org.id}/meetings`, 'POST', {
        title: `${identity.user.name.split(' ')[0]}’s meeting`,
        description: '',
        scheduledAt: new Date().toISOString(),
        durationMinutes: 60,
        timeZone: org.timeZone,
        access: 'link',
        invitees: [],
      });
      await action(m, 'start');
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }
  async function copy(m: Meeting) {
    try {
      await navigator.clipboard.writeText(meetingLink(org!, m));
      setCopied(m.id);
      window.setTimeout(() => setCopied(''), 2200);
    } catch {
      setError('Could not copy the link. Open the meeting and copy its browser address.');
    }
  }
  const shown = meetings.filter(
    (m) =>
      (tab === 'upcoming'
        ? ['scheduled', 'live'].includes(m.status)
        : ['ended', 'cancelled'].includes(m.status)) &&
      m.title.toLowerCase().includes(query.toLowerCase()),
  );
  const manager = org?.role !== 'member';
  return (
    <div className="app-shell" style={{ '--brand': org?.color ?? '#1c5947' } as CSSProperties}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Wordmark />
        <div className="workspace">
          <label htmlFor="org-select">YOUR WORKSPACE</label>
          <div className="org-select">
            <span className="company-avatar">
              {org?.logoDataUrl ? (
                <img src={org.logoDataUrl} alt="" />
              ) : (
                (org?.name.slice(0, 1) ?? '8')
              )}
            </span>
            <select
              id="org-select"
              aria-label="Select organization"
              value={org?.id ?? ''}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {!org && <option value="">No organization</option>}
              {identity.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <nav aria-label="Workspace">
          <button
            className={view === 'meetings' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('meetings')}
          >
            <CalendarDays size={19} />
            Meetings
            <span>
              {meetings.filter((m) => m.status === 'live' || m.status === 'scheduled').length}
            </span>
          </button>
          {org && manager && (
            <button
              className={view === 'settings' ? 'nav-item active' : 'nav-item'}
              onClick={() => setView('settings')}
            >
              <Settings size={19} />
              Organization
            </button>
          )}
          {identity.platformAdmin && (
            <button className="nav-item" onClick={() => setNewOrg(true)}>
              <Building2 size={19} />
              New organization
            </button>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-orbit">✳</span>
          <h3>A space that’s yours.</h3>
          <p>Every conversation, in your company’s colors.</p>
        </div>
        <div className="profile">
          <span className="avatar">{identity.user.name.slice(0, 1)}</span>
          <div>
            <strong>{identity.user.name}</strong>
            <small>{identity.user.email}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void onLogout().catch((e) => setError(e.message))}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <span>
            {org?.name ?? 'Your account'}
            <span className="breadcrumb">
              {' '}
              / {view === 'settings' ? 'Organization' : 'Meetings'}
            </span>
          </span>
          <span className="topbar-label">
            <span className="status-dot" /> YOUR SPACE TO CONNECT
          </span>
        </header>
        <main id="main">
          {error && (
            <div className="error banner" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!org ? (
            <section className="empty welcome-empty">
              <span className="eyebrow">YOU’RE IN</span>
              <h1>
                Your conversations
                <br />
                start with a company.
              </h1>
              <p>
                {identity.platformAdmin
                  ? 'Create your first organization and choose someone to manage it.'
                  : 'Your account is ready. Ask your organization manager to invite this email address.'}
              </p>
              {identity.platformAdmin && (
                <button className="primary" onClick={() => setNewOrg(true)}>
                  Create an organization
                  <Plus size={17} />
                </button>
              )}
            </section>
          ) : view === 'settings' ? (
            <CompanySettings org={org} refresh={refresh} />
          ) : (
            <>
              <section className="dashboard-hero">
                <div>
                  <span className="eyebrow">A GOOD DAY TO CONNECT</span>
                  <h1>
                    Your next
                    <br />
                    <em>conversation.</em>
                  </h1>
                  <p>
                    Bring the right people into the same room.
                    <br />
                    We’ll take care of the distance.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      disabled={Boolean(busy)}
                      onClick={() => void instant()}
                    >
                      <Video size={18} />
                      Start instant meeting
                      <ArrowUpRight size={17} />
                    </button>
                    <button className="secondary" onClick={() => setForm('new')}>
                      <Plus size={18} />
                      Schedule a meeting
                    </button>
                  </div>
                </div>
                <div className="hero-graphic" aria-hidden="true">
                  <div className="graphic-caption">
                    MAKE SPACE FOR
                    <br />
                    WHAT COMES NEXT.
                  </div>
                  <div className="graphic-circle one" />
                  <div className="graphic-circle two" />
                  <div className="graphic-cross">✳</div>
                  <span className="graphic-foot">LESS DISTANCE. MORE POSSIBILITY.</span>
                </div>
              </section>
              <section className="meetings-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">YOUR CALENDAR, SIMPLIFIED</span>
                    <h2>Meetings</h2>
                  </div>
                  <button className="text-button" onClick={() => setForm('new')}>
                    New meeting
                    <Plus size={17} />
                  </button>
                </div>
                <div className="list-tools">
                  <div className="tabs" role="group" aria-label="Meeting list">
                    <button
                      aria-pressed={tab === 'upcoming'}
                      className={tab === 'upcoming' ? 'selected' : ''}
                      onClick={() => setTab('upcoming')}
                    >
                      Upcoming
                      <span>
                        {meetings.filter((m) => ['scheduled', 'live'].includes(m.status)).length}
                      </span>
                    </button>
                    <button
                      aria-pressed={tab === 'past'}
                      className={tab === 'past' ? 'selected' : ''}
                      onClick={() => setTab('past')}
                    >
                      Past meetings
                    </button>
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search meetings"
                      placeholder="Find a conversation"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                {loading ? (
                  <p className="empty">Loading meetings…</p>
                ) : !shown.length ? (
                  <div className="empty meeting-empty">
                    <span className="empty-icon">
                      <CalendarDays size={28} />
                    </span>
                    <h3>
                      {query
                        ? 'No matching meetings.'
                        : tab === 'past'
                          ? 'Room for memories.'
                          : 'Your calendar is wide open.'}
                    </h3>
                    <p>
                      {tab === 'past'
                        ? 'Finished and cancelled meetings will appear here.'
                        : 'Schedule your first conversation or start one right now.'}
                    </p>
                    {tab === 'upcoming' && !query && (
                      <button className="text-button" onClick={() => setForm('new')}>
                        Create your first meeting
                        <ArrowRight size={17} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="meeting-list">
                    {shown.map((m) => (
                      <article className="meeting-row" key={m.id}>
                        <div className="date-tile">
                          <span>
                            {new Intl.DateTimeFormat('en', {
                              month: 'short',
                              timeZone: m.timeZone,
                            }).format(new Date(m.scheduledAt))}
                          </span>
                          <strong>
                            {new Intl.DateTimeFormat('en', {
                              day: '2-digit',
                              timeZone: m.timeZone,
                            }).format(new Date(m.scheduledAt))}
                          </strong>
                        </div>
                        <div className="meeting-details">
                          <div className="meeting-title">
                            <a aria-label={`Open ${m.title}`} href={meetingLink(org, m)}>
                              {m.title}
                            </a>
                            {m.status === 'live' && <span className="live-badge">LIVE</span>}
                          </div>
                          <p>
                            <Clock size={13} />
                            {dateLabel(m.scheduledAt, m.timeZone)}
                            <span>·</span>
                            {m.durationMinutes} min
                          </p>
                          <span className="access-label">
                            {m.access === 'link' ? <Link2 size={12} /> : <LockKeyhole size={12} />}{' '}
                            {m.access === 'link'
                              ? 'Anyone with the link'
                              : 'Invited email addresses only'}
                            {['ended', 'cancelled'].includes(m.status) && ` · ${m.status}`}
                          </span>
                        </div>
                        <div className="meeting-actions">
                          <button
                            className="icon-button"
                            aria-label={`Copy link for ${m.title}`}
                            onClick={() => void copy(m)}
                            title="Copy meeting link"
                          >
                            {copied === m.id ? <Check size={18} /> : <Copy size={18} />}
                          </button>
                          {m.canHost && m.status === 'scheduled' && (
                            <>
                              <button className="text-button" onClick={() => setForm(m)}>
                                Edit
                              </button>
                              <button
                                className="secondary small"
                                disabled={busy === m.id}
                                onClick={() => void action(m, 'start')}
                              >
                                Start
                                <ArrowUpRight size={15} />
                              </button>
                            </>
                          )}
                          {m.status === 'live' && (
                            <a className="primary small" href={meetingLink(org, m)}>
                              Join
                              <ArrowUpRight size={15} />
                            </a>
                          )}
                          {m.canHost && m.status === 'ended' && (
                            <button
                              className="secondary small"
                              disabled={busy === m.id}
                              onClick={() => void action(m, 'restart')}
                            >
                              Restart
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <footer className="list-footer">
                  <ShieldIcon />
                  Your meetings belong to {org.name}. Your links carry your brand.
                </footer>
              </section>
            </>
          )}
        </main>
      </div>
      {form && org && (
        <MeetingForm
          org={org}
          meeting={form === 'new' ? undefined : form}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null);
            await load();
          }}
        />
      )}
      {newOrg && (
        <NewOrganization
          onClose={() => setNewOrg(false)}
          onSaved={async (id) => {
            await refresh();
            setOrgId(id);
            setNewOrg(false);
          }}
        />
      )}
      <div className="sr-only" role="status">
        {copied ? 'Meeting link copied.' : ''}
      </div>
    </div>
  );
}
function ShieldIcon() {
  return <LockKeyhole size={13} />;
}
function NewOrganization({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-org-title">
        <div className="modal-heading">
          <span className="eyebrow">PLATFORM ADMINISTRATION</span>
          <button autoFocus className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <h2 id="new-org-title">A new place to meet.</h2>
        <p>Create a company workspace and assign its manager.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            try {
              const org = await api('/orgs', 'POST', {
                name: d.get('name'),
                slug: d.get('slug'),
                managerEmail: d.get('managerEmail'),
              });
              await onSaved(org.id);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Company name
            <input name="name" required maxLength={100} placeholder="Element8" />
          </label>
          <label>
            Organization address
            <input
              name="slug"
              required
              pattern="[a-z0-9][a-z0-9-]*"
              maxLength={48}
              placeholder="element8"
            />
            <small>Lowercase letters, numbers, and hyphens.</small>
          </label>
          <label>
            Manager email
            <input name="managerEmail" required type="email" placeholder="manager@company.com" />
            <small>They gain access when they verify this email.</small>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            Create organization
            <ArrowRight size={17} />
          </button>
        </form>
      </section>
    </div>
  );
}
