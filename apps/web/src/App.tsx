import { RecordingsPanel } from './Recordings';
import { MeetingSettingsEditor } from './MeetingControls';
import { SharedRecording } from './Recordings';
import { OrganizationPage } from './OrganizationPage';
import { useLanguage, LanguageSwitcher } from './i18n';
import { useDialog } from './useDialog';
import { brandStyle } from './branding';
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
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
const MeetingPage = lazy(() => import('./MeetingPage').then((m) => ({ default: m.MeetingPage })));
import { MeetingForm } from './MeetingForm';
import { CompanySettings } from './CompanySettings';
export function App() {
  const { t, language } = useLanguage();
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
  const recordingToken = window.location.pathname.match(/^\/recordings\/([^/]+)\/?$/)?.[1];
  if (recordingToken) return <SharedRecording token={recordingToken} />;
  const organizationSlug = window.location.pathname.match(/^\/([a-z0-9][a-z0-9-]{0,47})\/?$/)?.[1];
  if (organizationSlug && !['recordings'].includes(organizationSlug))
    return <OrganizationPage slug={organizationSlug} />;
  const code = window.location.pathname.match(/^\/o\/[^/]+\/meet\/([^/]+)\/?$/)?.[1];
  if (code)
    return (
      <Suspense fallback={<div className="loading-page">{t('Opening your meeting…')}</div>}>
        <MeetingPage code={code} identity={identity} onIdentity={refresh} />
      </Suspense>
    );
  if (!loaded) return <div className="loading-page">{t('Opening Meet8…')}</div>;
  if (fatal)
    return (
      <div className="empty">
        <h1>{t('Meet8 is unavailable')}</h1>
        <p role="alert">{t(fatal)}</p>
        <button onClick={() => void refresh()}>{t('Try again')}</button>
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
  const { t, language } = useLanguage();
  const [orgId, setOrgId] = useState(() => sessionStorage.getItem('meet8-org') ?? '');
  const org = identity.organizations.find((o) => o.id === orgId) ?? identity.organizations[0];
  const activeOrgId = useRef(org?.id);
  activeOrgId.current = org?.id;
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
    if (activeOrgId.current !== org?.id) return;
    if (!org) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api<Meeting[]>(`/orgs/${org.id}/meetings`);
      if (activeOrgId.current === org.id) setMeetings(result);
    } catch (e) {
      if (activeOrgId.current === org.id) setError((e as Error).message);
    } finally {
      if (activeOrgId.current === org.id) setLoading(false);
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
        title: t('{name}’s meeting', { name: identity.user.name.split(' ')[0] }),
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
      setError(t('Could not copy the link. Open the meeting and copy its browser address.'));
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
    <div
      className="app-shell"
      style={brandStyle(org?.color ?? '#1c5947', org?.secondaryColor, org?.accentColor)}
    >
      <a className="skip-link" href="#main">
        {t('Skip to content')}
      </a>
      <aside className="sidebar">
        <Wordmark />
        <div className="workspace">
          <label htmlFor="org-select">{t('YOUR WORKSPACE')}</label>
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
              aria-label={t('Select organization')}
              value={org?.id ?? ''}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {!org && <option value="">{t('No organization')}</option>}
              {identity.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <nav aria-label={t('Workspace')}>
          <button
            className={view === 'meetings' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('meetings')}
          >
            <CalendarDays size={19} />
            {t('Meetings')}
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
              {t('Organization')}
            </button>
          )}
          {identity.platformAdmin && (
            <button className="nav-item" onClick={() => setNewOrg(true)}>
              <Building2 size={19} />
              {t('New organization')}
            </button>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-orbit">✳</span>
          <h3>{t('Professional workshops. Your brand.')}</h3>
          <p>
            {t(
              'Host customer workshops and meetings in a branded experience built around your business.',
            )}
          </p>
        </div>
        <div className="profile">
          <span className="avatar">{identity.user.name.slice(0, 1)}</span>
          <div>
            <strong>{identity.user.name}</strong>
            <small>{identity.user.email}</small>
          </div>
          <button
            className="icon-button"
            aria-label={t('Sign out')}
            title={t('Sign out')}
            onClick={() => void onLogout().catch((e) => setError(e.message))}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <LanguageSwitcher />
          <span>
            {org?.name ?? t('Your account')}
            <span className="breadcrumb">
              {' '}
              / {view === 'settings' ? t('Organization') : t('Meetings')}
            </span>
          </span>
          <span className="topbar-label">
            <span className="status-dot" />
            {t('CUSTOMER WORKSHOPS & MEETINGS')}
          </span>
        </header>
        <main id="main">
          {error && (
            <div className="error banner" role="alert">
              {t(error)}
              <button
                className="icon-button"
                aria-label={t('Dismiss error')}
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!org ? (
            <section className="empty welcome-empty">
              <span className="eyebrow">{t('YOU’RE IN')}</span>
              <h1>
                {t('Your conversations')}
                <br />
                {t('start with a company.')}
              </h1>
              <p>
                {identity.platformAdmin
                  ? t('Create your first organization and choose someone to manage it.')
                  : t(
                      'Your account is ready. Ask your organization manager to invite this email address.',
                    )}
              </p>
              {identity.platformAdmin && (
                <button className="primary" onClick={() => setNewOrg(true)}>
                  {t('Create an organization')}
                  <Plus size={17} />
                </button>
              )}
            </section>
          ) : view === 'settings' ? (
            <CompanySettings key={org.id} org={org} refresh={refresh} />
          ) : (
            <>
              <section className="dashboard-hero">
                <div>
                  <span className="eyebrow">{t('A GOOD DAY TO CONNECT')}</span>
                  <h1>
                    {t('Your next')}
                    <br />
                    <em>{t('conversation.')}</em>
                  </h1>
                  <p>
                    {t('Bring the right people into the same room.')}
                    <br />
                    {t('We’ll take care of the distance.')}
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      disabled={Boolean(busy)}
                      onClick={() => void instant()}
                    >
                      <Video size={18} />
                      {t('Start instant meeting')}
                      <ArrowUpRight size={17} />
                    </button>
                    <button className="secondary" onClick={() => setForm('new')}>
                      <Plus size={18} />
                      {t('Schedule a meeting')}
                    </button>
                  </div>
                </div>
                <div className="hero-graphic" aria-hidden="true">
                  <div className="graphic-caption">
                    {t('MAKE SPACE FOR')}
                    <br />
                    {t('WHAT COMES NEXT.')}
                  </div>
                  <div className="graphic-circle one" />
                  <div className="graphic-circle two" />
                  <div className="graphic-cross">✳</div>
                  <span className="graphic-foot">{t('LESS DISTANCE. MORE POSSIBILITY.')}</span>
                </div>
              </section>
              <section className="meetings-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">{t('YOUR CALENDAR, SIMPLIFIED')}</span>
                    <h2>{t('Meetings')}</h2>
                  </div>
                  <button className="text-button" onClick={() => setForm('new')}>
                    {t('New meeting')}
                    <Plus size={17} />
                  </button>
                </div>
                <div className="list-tools">
                  <div className="tabs" role="group" aria-label={t('Meeting list')}>
                    <button
                      aria-pressed={tab === 'upcoming'}
                      className={tab === 'upcoming' ? 'selected' : ''}
                      onClick={() => setTab('upcoming')}
                    >
                      {t('Upcoming')}
                      <span>
                        {meetings.filter((m) => ['scheduled', 'live'].includes(m.status)).length}
                      </span>
                    </button>
                    <button
                      aria-pressed={tab === 'past'}
                      className={tab === 'past' ? 'selected' : ''}
                      onClick={() => setTab('past')}
                    >
                      {t('Past meetings')}
                    </button>
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label={t('Search meetings')}
                      placeholder={t('Find a conversation')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                {loading ? (
                  <p className="empty">{t('Loading meetings…')}</p>
                ) : !shown.length ? (
                  <div className="empty meeting-empty">
                    <span className="empty-icon">
                      <CalendarDays size={28} />
                    </span>
                    <h3>
                      {query
                        ? t('No matching meetings.')
                        : tab === 'past'
                          ? t('Room for memories.')
                          : t('Your calendar is wide open.')}
                    </h3>
                    <p>
                      {tab === 'past'
                        ? t('Finished and cancelled meetings will appear here.')
                        : t('Schedule your first conversation or start one right now.')}
                    </p>
                    {tab === 'upcoming' && !query && (
                      <button className="text-button" onClick={() => setForm('new')}>
                        {t('Create your first meeting')}
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
                            {new Intl.DateTimeFormat(language, {
                              month: 'short',
                              timeZone: m.timeZone,
                            }).format(new Date(m.scheduledAt))}
                          </span>
                          <strong>
                            {new Intl.DateTimeFormat(language, {
                              day: '2-digit',
                              timeZone: m.timeZone,
                            }).format(new Date(m.scheduledAt))}
                          </strong>
                        </div>
                        <div className="meeting-details">
                          <div className="meeting-title">
                            <a
                              aria-label={t('Open {name}', { name: m.title })}
                              href={meetingLink(org, m)}
                            >
                              {m.title}
                            </a>
                            {m.status === 'live' && <span className="live-badge">{t('LIVE')}</span>}
                          </div>
                          <p>
                            <Clock size={13} />
                            {dateLabel(m.scheduledAt, m.timeZone, language)}
                            <span>·</span>
                            {m.durationMinutes}
                            {t('min')}
                          </p>
                          <span className="access-label">
                            {m.access === 'link' ? <Link2 size={12} /> : <LockKeyhole size={12} />}{' '}
                            {m.access === 'link'
                              ? t('Anyone with the link')
                              : t('Invited email addresses only')}
                            {['ended', 'cancelled'].includes(m.status) && ` · ${t(m.status)}`}
                          </span>
                        </div>
                        <div className="meeting-actions">
                          <button
                            className="icon-button"
                            aria-label={t('Copy link for {name}', { name: m.title })}
                            onClick={() => void copy(m)}
                            title={t('Copy meeting link')}
                          >
                            {copied === m.id ? <Check size={18} /> : <Copy size={18} />}
                          </button>
                          {m.canHost && m.status === 'scheduled' && (
                            <>
                              <button className="text-button" onClick={() => setForm(m)}>
                                {t('Edit')}
                              </button>
                              <button
                                className="secondary small"
                                disabled={busy === m.id}
                                onClick={() => void action(m, 'start')}
                              >
                                {t('Start')}
                                <ArrowUpRight size={15} />
                              </button>
                            </>
                          )}
                          {m.status === 'live' && (
                            <a className="primary small" href={meetingLink(org, m)}>
                              {t('Join')}
                              <ArrowUpRight size={15} />
                            </a>
                          )}
                          {m.canHost && m.status === 'ended' && (
                            <button
                              className="secondary small"
                              disabled={busy === m.id}
                              onClick={() => void action(m, 'restart')}
                            >
                              {t('Restart')}
                            </button>
                          )}
                        </div>
                        {m.canHost && (
                          <details className="meeting-recordings">
                            <summary>{t('Meeting details')}</summary>
                            <MeetingSettingsEditor
                              code={m.code}
                              initial={m.settings}
                              ended={m.status === 'ended' || m.status === 'cancelled'}
                            />
                            <RecordingsPanel
                              code={m.code}
                              canManage
                              canShare
                              live={m.status === 'live'}
                            />
                          </details>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                <footer className="list-footer">
                  <ShieldIcon />
                  {t('Your meetings belong to {name}. Your links carry your brand.', {
                    name: org.name,
                  })}
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
        {copied ? t('Meeting link copied.') : ''}
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
  const { t, language } = useLanguage();
  const dialogRef = useDialog(onClose);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-org-title"
      >
        <div className="modal-heading">
          <span className="eyebrow">{t('PLATFORM ADMINISTRATION')}</span>
          <button autoFocus className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <X />
          </button>
        </div>
        <h2 id="new-org-title">{t('A new place to meet.')}</h2>
        <p>{t('Create a company workspace and assign its manager.')}</p>
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
            {t('Company name')}
            <input name="name" required maxLength={100} placeholder={t('Element8')} />
          </label>
          <label>
            {t('Organization address')}
            <input
              name="slug"
              required
              pattern="[a-z0-9][a-z0-9-]*"
              maxLength={48}
              placeholder={t('element8')}
            />
            <small>{t('Lowercase letters, numbers, and hyphens.')}</small>
          </label>
          <label>
            {t('Manager email')}
            <input
              name="managerEmail"
              required
              type="email"
              placeholder={t('manager@company.com')}
            />
            <small>{t('They gain access when they verify this email.')}</small>
          </label>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {t('Create organization')}
            <ArrowRight size={17} />
          </button>
        </form>
      </section>
    </div>
  );
}
