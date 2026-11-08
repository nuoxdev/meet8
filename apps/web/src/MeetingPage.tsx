import { brandStyle } from './branding';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  Video,
  ArrowRight,
  Clock,
  Link2,
  LockKeyhole,
  Copy,
  MicOff,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react';
import { api, RequestError, dateLabel, type Identity, type Preview } from './api';
import { Auth, Wordmark } from './Auth';
import { MeetingRoom, type RoomSession } from './MeetingRoom';
export function MeetingPage({
  code,
  identity,
  onIdentity,
}: {
  code: string;
  identity: Identity | null;
  onIdentity: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<RoomSession | null>(null);
  const [connection, setConnection] = useState<{
    url: string;
    token: string;
    sessionId: string;
  } | null>(null);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const poll = useCallback(async () => {
    const current = await api<RoomSession>(`/meet/${code}/session`);
    setState(current);
    if (current.status !== 'live') setConnection(null);
    return current;
  }, [code]);
  useEffect(() => {
    let stopped = false;
    api<Preview>(`/meet/${code}`)
      .then((p) => {
        if (!stopped) setPreview(p);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [code]);
  useEffect(() => {
    if (!joined) return;
    let stopped = false;
    const check = async () => {
      try {
        const s = await api<RoomSession>(`/meet/${code}/session`);
        if (stopped) return;
        setState(s);
        setError('');
        if (s.status !== 'live') setConnection(null);
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        if (e instanceof RequestError && [401, 403, 404, 410].includes(e.status)) {
          setConnection(null);
          setJoined(false);
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [joined, code]);
  useEffect(() => {
    if (!joined || state?.status !== 'live' || connection || !state.mediaReady) return;
    let stopped = false;
    api(`/meet/${code}/connection`, 'POST', {})
      .then((c) => {
        if (!stopped) setConnection(c);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [joined, state?.status, state?.mediaReady, code]);
  async function join() {
    setBusy(true);
    setError('');
    try {
      await api(`/meet/${code}/join`, 'POST', { name: identity?.user.name ?? name });
      await poll();
      setJoined(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle(action: string) {
    if (!state?.orgId || !state.meetingId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/orgs/${state.orgId}/meetings/${state.meetingId}/${action}`, 'POST', {});
      await poll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    setConnection(null);
    setJoined(false);
    setState(null);
    try {
      await api(`/meet/${code}/leave`, 'POST', {});
    } catch (e) {
      setError((e as Error).message);
    }
    setNotice('You left the meeting.');
  }
  if (!preview)
    return (
      <main className="empty">
        <Wordmark />
        <h1>{error ? 'Meeting unavailable' : 'Opening your meeting…'}</h1>
        {error && <p role="alert">{error}</p>}
        <a href="/">Back to Meet8</a>
      </main>
    );
  const p = state ?? preview;
  const blocked = p.status === 'ended' || p.status === 'cancelled';
  if (connection && state)
    return (
      <MeetingRoom
        code={code}
        connection={connection}
        state={state}
        onLeave={() => void leave()}
        onEnd={() => void lifecycle('end')}
        onDisconnected={() => {
          setConnection(null);
          setNotice('The media connection ended. You can reconnect below.');
        }}
      />
    );
  return (
    <div className="meeting-page" style={brandStyle(p.organization.color)}>
      <header className="public-header">
        <CompanyBrand organization={p.organization} />
        <a className="text-button" href="/">
          Your workspace
          <ArrowUpRightIcon />
        </a>
      </header>
      <main className="join-layout">
        <section className="join-intro">
          <span className="eyebrow">A CONVERSATION WITH {p.organization.name.toUpperCase()}</span>
          <h1>{p.title}</h1>
          <p className="join-time">
            <Clock size={17} />
            {dateLabel(p.scheduledAt, p.timeZone)} · {p.durationMinutes} minutes
          </p>
          <div className="camera-preview">
            <div className="preview-monogram">
              {(identity?.user.name || name || p.organization.name).slice(0, 1).toUpperCase()}
            </div>
            <span>
              <MicOff size={14} />
              Camera and microphone start off
            </span>
          </div>
          <div className="join-security">
            <ShieldCheck size={16} />
            <p>
              {p.access === 'link'
                ? 'Anyone with this link can join.'
                : 'Access is limited to verified invited email addresses.'}
            </p>
          </div>
        </section>
        <section className="join-card">
          {showAuth ? (
            <>
              <button className="text-button" onClick={() => setShowAuth(false)}>
                <ArrowLeft size={15} />
                Back to meeting
              </button>
              <Auth
                compact
                onDone={async () => {
                  await onIdentity();
                  setShowAuth(false);
                }}
              />
            </>
          ) : (
            <>
              {joined ? (
                <>
                  <span className="eyebrow">
                    {p.status === 'live' ? 'YOUR ROOM IS READY' : 'YOU’RE IN THE RIGHT PLACE'}
                  </span>
                  <h2>
                    {p.status === 'scheduled'
                      ? 'Waiting for the host'
                      : p.status === 'ended'
                        ? 'That’s a wrap.'
                        : p.status === 'cancelled'
                          ? 'Meeting cancelled.'
                          : 'Ready to connect.'}
                  </h2>
                  <p>
                    {p.status === 'scheduled'
                      ? 'You’ll enter automatically when the host starts this meeting.'
                      : blocked
                        ? 'Thanks for making the time.'
                        : 'The conversation is ready when you are.'}
                  </p>
                  {state?.canHost && p.status === 'scheduled' && (
                    <button
                      className="primary wide"
                      disabled={busy}
                      onClick={() => void lifecycle('start')}
                    >
                      Start meeting
                      <Video size={17} />
                    </button>
                  )}
                  {state?.canHost && p.status === 'ended' && (
                    <button
                      className="primary wide"
                      disabled={busy}
                      onClick={() => void lifecycle('restart').then(() => join())}
                    >
                      Restart meeting
                      <Video size={17} />
                    </button>
                  )}
                  {p.status === 'live' && !state?.mediaReady && (
                    <p className="error" role="alert">
                      Audio and video are not configured. Ask your administrator to connect LiveKit.
                    </p>
                  )}
                  {p.status === 'live' && state?.mediaReady && (
                    <button
                      className="primary wide"
                      onClick={async () => {
                        setError('');
                        try {
                          setConnection(await api(`/meet/${code}/connection`, 'POST', {}));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Connect to room
                      <ArrowRight size={17} />
                    </button>
                  )}
                  <button className="text-button" onClick={() => void leave()}>
                    Leave meeting
                  </button>
                </>
              ) : (
                <>
                  <span className="eyebrow">
                    {blocked ? 'SEE YOU NEXT TIME' : 'MAKE YOURSELF AT HOME'}
                  </span>
                  <h2>
                    {p.status === 'ended'
                      ? 'This meeting has ended.'
                      : p.status === 'cancelled'
                        ? 'This meeting was cancelled.'
                        : 'Ready to join?'}
                  </h2>
                  {!blocked && (
                    <>
                      {p.access === 'invited' && !identity ? (
                        <>
                          <p>Verify your invited email</p>
                          <p>Sign in with the email address your host invited.</p>
                          <button className="primary wide" onClick={() => setShowAuth(true)}>
                            Verify email to join
                            <ArrowRight size={17} />
                          </button>
                        </>
                      ) : (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void join();
                          }}
                        >
                          {identity ? (
                            <p>
                              Joining as <strong>{identity.user.name}</strong>
                              <br />
                              <small>{identity.user.email}</small>
                            </p>
                          ) : (
                            <label>
                              Your name
                              <input
                                required
                                maxLength={80}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="How should we introduce you?"
                              />
                            </label>
                          )}
                          <button className="primary wide" disabled={busy}>
                            {busy ? 'Joining…' : 'Join meeting'}
                            <ArrowRight size={17} />
                          </button>
                        </form>
                      )}
                      {!identity && p.access === 'link' && (
                        <button className="text-button" onClick={() => setShowAuth(true)}>
                          Hosting this meeting? Sign in
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="muted" role="status">
                  {notice}
                </p>
              )}
              <div className="join-divider" />
              <div className="join-foot">
                <LockKeyhole size={16} />
                <span>A private space, with {p.organization.name}.</span>
              </div>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    setNotice('Meeting link copied.');
                  } catch {
                    setError('Copy the browser address to share this meeting.');
                  }
                }}
              >
                <Copy size={14} />
                Copy meeting link
              </button>
              {state?.canHost && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      const result = await api(
                        `/orgs/${state.orgId}/meetings/${state.meetingId}/invitations`,
                        'POST',
                        {},
                      );
                      setNotice(`${result.sent} invitations sent.`);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Send email invitations
                </button>
              )}
            </>
          )}
        </section>
      </main>
      <footer className="public-footer">
        <Wordmark />
        <span>A little closer, from anywhere.</span>
      </footer>
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} />;
}
export function CompanyBrand({ organization }: { organization: Preview['organization'] }) {
  return (
    <a className="company-brand" href="/">
      <span className="company-avatar">
        {organization.logoDataUrl ? (
          <img src={organization.logoDataUrl} alt="" />
        ) : (
          organization.name.slice(0, 1)
        )}
      </span>
      <strong>{organization.name}</strong>
      <span className="powered-by">on meet8</span>
    </a>
  );
}
