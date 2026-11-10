import { useLanguage, LanguageSwitcher } from './i18n';
import { RecordingsPanel } from './Recordings';
import { brandStyle } from './branding';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
import type { DisconnectReason } from 'livekit-client';
import {
  canRecoverDisconnect,
  recoverJoinedConnection,
  type MediaConnection,
} from './meetingRecovery';
export function MeetingPage({
  code,
  identity,
  onIdentity,
}: {
  code: string;
  identity: Identity | null;
  onIdentity: () => Promise<void>;
}) {
  const { t, language } = useLanguage();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<RoomSession | null>(null);
  const [connection, setConnection] = useState<MediaConnection | null>(null);
  const [recovery, setRecovery] = useState<'idle' | 'retrying' | 'stopped'>('idle');
  const recoveryEnabled = useRef(true);
  const recoveryController = useRef<AbortController | null>(null);
  const remainingRecoveryAttempts = useRef(3);
  const current = useRef({ connection, state, joined: false });
  const cancelRecovery = useCallback(() => {
    recoveryController.current?.abort();
    recoveryController.current = null;
  }, []);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  current.current = { connection, state, joined };
  useEffect(() => () => cancelRecovery(), [code, cancelRecovery]);
  const [showAuth, setShowAuth] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeVariables, setNoticeVariables] = useState<Record<string, string | number>>({});
  const poll = useCallback(async () => {
    const current = await api<RoomSession>(`/meet/${code}/session`);
    setState(current);
    if (current.status !== 'live') {
      recoveryEnabled.current = current.status === 'scheduled';
      cancelRecovery();
      setRecovery(current.status === 'scheduled' ? 'idle' : 'stopped');
      setConnection(null);
    }
    return current;
  }, [code, cancelRecovery]);
  useEffect(() => {
    let stopped = false;
    api<Preview>(`/meet/${code}`)
      .then((p) => {
        if (!stopped) setPreview(p);
        // Restore private completed-meeting details for an existing co-host
        // cookie without rejoining media or requesting device permissions.
        if (p.status === 'ended') {
          void api<RoomSession>(`/meet/${code}/session`)
            .then((session) => {
              if (!stopped && (session.canModerate ?? session.canHost)) setState(session);
            })
            .catch(() => {});
        }
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
        const previous = current.current;
        if (
          s.status !== 'live' ||
          (previous.connection &&
            (s.sessionId !== previous.connection.sessionId ||
              s.attendee.id !== previous.state?.attendee.id))
        ) {
          recoveryEnabled.current = s.status === 'scheduled';
          cancelRecovery();
          setRecovery(s.status === 'scheduled' ? 'idle' : 'stopped');
          setConnection(null);
          if (s.status === 'live') {
            current.current.joined = false;
            setJoined(false);
          }
        }
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        if (e instanceof RequestError && [401, 403, 404, 410].includes(e.status)) {
          recoveryEnabled.current = false;
          cancelRecovery();
          setRecovery('stopped');
          current.current.joined = false;
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
  }, [joined, code, cancelRecovery]);
  useEffect(() => {
    if (
      !joined ||
      state?.status !== 'live' ||
      connection ||
      !state.mediaReady ||
      recovery !== 'idle'
    )
      return;
    let stopped = false;
    api(`/meet/${code}/connection`, 'POST', {})
      .then((c) => {
        if (!stopped && c.sessionId === state.sessionId) setConnection(c);
        else if (!stopped) {
          setRecovery('stopped');
          setJoined(false);
        }
      })
      .catch((e) => {
        if (!stopped) {
          setError(e.message);
          setRecovery('stopped');
        }
      });
    return () => {
      stopped = true;
    };
  }, [joined, state?.status, state?.sessionId, state?.mediaReady, code, connection, recovery]);
  async function join() {
    setBusy(true);
    setError('');
    try {
      await api(`/meet/${code}/join`, 'POST', { name: identity?.user.name ?? name });
      await poll();
      recoveryEnabled.current = true;
      remainingRecoveryAttempts.current = 3;
      setRecovery('idle');
      setNotice('');
      setJoined(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle(action: string) {
    if (!state?.orgId || !state.meetingId) return;
    if (action === 'end') {
      recoveryEnabled.current = false;
      cancelRecovery();
      setRecovery('stopped');
    }
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
    current.current.joined = false;
    recoveryEnabled.current = false;
    cancelRecovery();
    setRecovery('stopped');
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
  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      const snapshot = current.current;
      if (!snapshot.joined || !recoveryEnabled.current || recoveryController.current) return;
      if (!canRecoverDisconnect(reason) || !snapshot.connection || !snapshot.state) {
        recoveryEnabled.current = false;
        cancelRecovery();
        setRecovery('stopped');
        setConnection(null);
        setNotice('The media connection ended. Check with your host before reconnecting.');
        return;
      }
      const controller = new AbortController();
      recoveryController.current = controller;
      setRecovery('retrying');
      setNotice('Reconnecting to the meeting…');
      void recoverJoinedConnection({
        expected: {
          sessionId: snapshot.connection.sessionId,
          attendeeId: snapshot.state.attendee.id,
        },
        signal: controller.signal,
        remaining: remainingRecoveryAttempts,
        session: () => api<RoomSession>(`/meet/${code}/session`),
        connection: () => api<MediaConnection>(`/meet/${code}/connection`, 'POST', {}),
      })
        .then((fresh) => {
          if (!controller.signal.aborted && current.current.joined) setConnection(fresh);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          recoveryEnabled.current = false;
          setRecovery('stopped');
          setConnection(null);
          setNotice('Unable to reconnect automatically. Check your connection and try again.');
          if ([401, 403, 404, 409, 410].includes(error.status)) {
            current.current.joined = false;
            setJoined(false);
            setError(error.message);
          }
        })
        .finally(() => {
          if (recoveryController.current === controller) recoveryController.current = null;
        });
    },
    [code, cancelRecovery],
  );
  const handleConnected = useCallback(() => {
    cancelRecovery();
    setRecovery('idle');
    setNotice('');
  }, [cancelRecovery]);
  if (!preview)
    return (
      <main className="empty">
        <Wordmark />
        <LanguageSwitcher />
        <h1>{error ? t('Meeting unavailable') : t('Opening your meeting…')}</h1>
        {error && <p role="alert">{t(error)}</p>}
        <a href="/">{t('Back to Meet8')}</a>
      </main>
    );
  const p = state ?? preview;
  const blocked = p.status === 'ended' || p.status === 'cancelled';
  if (connection && state)
    return (
      <MeetingRoom
        code={code}
        onRefresh={poll}
        connection={connection}
        state={state}
        onLeave={() => void leave()}
        onEnd={() => void lifecycle('end')}
        onDisconnected={handleDisconnected}
        onConnected={handleConnected}
        reconnecting={recovery === 'retrying'}
      />
    );
  return (
    <div
      className="meeting-page"
      style={brandStyle(
        p.organization.color,
        p.organization.secondaryColor,
        p.organization.accentColor,
      )}
    >
      <header className="public-header">
        <LanguageSwitcher />
        <CompanyBrand organization={p.organization} />
        <a className="text-button" href="/">
          {t('Your workspace')}
          <ArrowUpRightIcon />
        </a>
      </header>
      <main className="join-layout">
        <section className="join-intro">
          <span className="eyebrow">{t('Hosted by {name}', { name: p.organization.name })}</span>
          <h1>{p.title}</h1>
          <p className="join-time">
            <Clock size={17} />
            {dateLabel(p.scheduledAt, p.timeZone, language)} · {p.durationMinutes}
            {t('minutes')}
          </p>
          <div className="camera-preview">
            <div className="preview-monogram">
              {(identity?.user.name || name || p.organization.name).slice(0, 1).toUpperCase()}
            </div>
            <span>
              <MicOff size={14} />
              {t('Camera and microphone start off')}
            </span>
          </div>
          <div className="join-security">
            <ShieldCheck size={16} />
            <p>
              {p.access === 'link'
                ? t('Anyone with this link can join.')
                : t('Access is limited to verified invited email addresses.')}
            </p>
          </div>
        </section>
        <section className="join-card">
          {showAuth ? (
            <>
              <button className="text-button" onClick={() => setShowAuth(false)}>
                <ArrowLeft size={15} />
                {t('Back to meeting')}
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
                    {p.status === 'live' ? t('YOUR ROOM IS READY') : t('YOU’RE IN THE RIGHT PLACE')}
                  </span>
                  <h2>
                    {p.status === 'scheduled'
                      ? t('Waiting for the host')
                      : p.status === 'ended'
                        ? t('That’s a wrap.')
                        : p.status === 'cancelled'
                          ? t('Meeting cancelled.')
                          : t('Ready to connect.')}
                  </h2>
                  <p>
                    {p.status === 'scheduled'
                      ? t('You’ll enter automatically when the host starts this meeting.')
                      : blocked
                        ? t('Thanks for making the time.')
                        : t('The conversation is ready when you are.')}
                  </p>
                  {state?.canHost && p.status === 'scheduled' && (
                    <button
                      className="primary wide"
                      disabled={busy}
                      onClick={() => void lifecycle('start')}
                    >
                      {t('Start meeting')}
                      <Video size={17} />
                    </button>
                  )}
                  {state?.canHost && p.status === 'ended' && (
                    <button
                      className="primary wide"
                      disabled={busy}
                      onClick={() => void lifecycle('restart').then(() => join())}
                    >
                      {t('Restart meeting')}
                      <Video size={17} />
                    </button>
                  )}
                  {p.status === 'live' && !state?.mediaReady && (
                    <p className="error" role="alert">
                      {t(
                        'Audio and video are not configured. Ask your administrator to connect LiveKit.',
                      )}
                    </p>
                  )}
                  {p.status === 'live' && state?.mediaReady && (
                    <button
                      className="primary wide"
                      onClick={async () => {
                        setError('');
                        cancelRecovery();
                        const expected = current.current.state?.sessionId;
                        if (!current.current.joined || !expected) return;
                        const controller = new AbortController();
                        recoveryController.current = controller;
                        try {
                          const fresh = await api<MediaConnection>(
                            `/meet/${code}/connection`,
                            'POST',
                            {},
                          );
                          if (
                            controller.signal.aborted ||
                            !current.current.joined ||
                            current.current.state?.sessionId !== expected
                          )
                            return;
                          if (fresh.sessionId !== expected) {
                            setJoined(false);
                            setError('The meeting session changed. Please check with the host.');
                            return;
                          }
                          recoveryEnabled.current = true;
                          remainingRecoveryAttempts.current = 3;
                          setConnection(fresh);
                          setRecovery('idle');
                          setNotice('');
                        } catch (e) {
                          if (!controller.signal.aborted) setError((e as Error).message);
                        } finally {
                          if (recoveryController.current === controller)
                            recoveryController.current = null;
                        }
                      }}
                    >
                      {t('Connect to room')}
                      <ArrowRight size={17} />
                    </button>
                  )}
                  <button className="text-button" onClick={() => void leave()}>
                    {t('Leave meeting')}
                  </button>
                </>
              ) : (
                <>
                  <span className="eyebrow">
                    {blocked ? t('SEE YOU NEXT TIME') : t('WORKSHOP ACCESS')}
                  </span>
                  <h2>
                    {p.status === 'ended'
                      ? t('This meeting has ended.')
                      : p.status === 'cancelled'
                        ? t('This meeting was cancelled.')
                        : t('Ready to join?')}
                  </h2>
                  {!blocked && (
                    <>
                      {p.access === 'invited' && !identity ? (
                        <>
                          <p>{t('Verify your invited email')}</p>
                          <p>{t('Sign in with the email address your host invited.')}</p>
                          <button className="primary wide" onClick={() => setShowAuth(true)}>
                            {t('Verify email to join')}
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
                              {t('Joining as')}
                              <strong>{identity.user.name}</strong>
                              <br />
                              <small>{identity.user.email}</small>
                            </p>
                          ) : (
                            <label>
                              {t('Your name')}
                              <input
                                required
                                maxLength={80}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('How should we introduce you?')}
                              />
                            </label>
                          )}
                          <button className="primary wide" disabled={busy}>
                            {busy ? t('Joining…') : t('Join meeting')}
                            <ArrowRight size={17} />
                          </button>
                        </form>
                      )}
                      {!identity && p.access === 'link' && (
                        <button className="text-button" onClick={() => setShowAuth(true)}>
                          {t('Hosting this meeting? Sign in')}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {t(error)}
                </p>
              )}
              {notice && (
                <p className="muted" role="status">
                  {t(notice, noticeVariables)}
                </p>
              )}
              <div className="join-divider" />
              <div className="join-foot">
                <LockKeyhole size={16} />
                <span>{t('A private space, with {name}.', { name: p.organization.name })}</span>
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
                {t('Copy meeting link')}
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
                      setNotice('{count} invitations sent.');
                      setNoticeVariables({ count: result.sent });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {t('Send email invitations')}
                </button>
              )}
            </>
          )}
        </section>
      </main>
      {state && (state.canModerate ?? state.canHost) && (
        <RecordingsPanel
          code={code}
          canManage={state.canModerate ?? state.canHost}
          canShare={state.canHost}
          live={state.status === 'live'}
        />
      )}
      <footer className="public-footer">
        <Wordmark />
        <span>{t('Professional workshops. Meaningful connections.')}</span>
      </footer>
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} />;
}
export function CompanyBrand({ organization }: { organization: Preview['organization'] }) {
  const { t } = useLanguage();
  return (
    <a className="company-brand" href={`/${organization.pageSlug ?? organization.slug}`}>
      <span className="company-avatar">
        {organization.logoDataUrl ? (
          <img src={organization.logoDataUrl} alt="" />
        ) : (
          organization.name.slice(0, 1)
        )}
      </span>
      <strong>{organization.name}</strong>
      <span className="powered-by">{t('on meet8')}</span>
    </a>
  );
}
