import { brandStyle } from './branding';
import { useEffect, useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, VideoConference } from '@livekit/components-react';
import { DisconnectReason, VideoPresets } from 'livekit-client';
import {
  Hand,
  MessageSquare,
  Send,
  Users,
  X,
  ShieldCheck,
  MicOff,
  Trash2,
  Video,
} from 'lucide-react';
import { GuestCallTools, guestAudioCaptureDefaults } from './connect/GuestCallTools';
import { api, type Preview } from './api';
import { CompanyBrand } from './MeetingPage';
import { LanguageSwitcher, useLanguage } from './i18n';
import {
  MeetingPolicyFields,
  defaultMeetingSettings,
  type MeetingSettings,
} from './MeetingControls';
import { RecordingsPanel } from './Recordings';
import './workshop.css';
export type RoomSession = Preview & {
  sessionId: string | null;
  attendee: { id: string; name: string; email?: string; raised: boolean };
  participants: {
    id: string;
    name: string;
    raised: boolean;
    isHost?: boolean;
    isCohost?: boolean;
    verified?: boolean;
  }[];
  canHost: boolean;
  canModerate?: boolean;
  canAssignCohost?: boolean;
  settings?: MeetingSettings;
  permissions?: { microphone: boolean; camera: boolean; screenShare: boolean; data: boolean };
  recordingActive?: boolean;
  recordingAvailable?: boolean;
  orgId?: string;
  meetingId?: string;
  mediaReady: boolean;
};
type Message = { id: string; name: string; body: string; createdAt: string };
export function MeetingRoom({
  code,
  connection,
  state,
  onLeave,
  onEnd,
  onDisconnected,
  onRefresh,
}: {
  code: string;
  connection: { url: string; token: string; iceServers?: RTCIceServer[]; relayOnly?: boolean };
  state: RoomSession;
  onLeave: () => void;
  onEnd: () => void;
  onDisconnected: () => void;
  onRefresh: () => Promise<unknown>;
}) {
  const { t, language } = useLanguage();
  const [panel, setPanel] = useState<'chat' | 'people' | 'controls' | 'recordings' | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [chatError, setChatError] = useState('');
  const [busy, setBusy] = useState(false);
  const moderate = state.canModerate ?? state.canHost;
  const assign = state.canAssignCohost ?? state.canHost;
  const settings = state.settings ?? defaultMeetingSettings;
  const [draftSettings, setDraftSettings] = useState(settings);
  useEffect(() => {
    if (!busy) setDraftSettings(settings);
  }, [
    settings.microphoneAccess,
    settings.cameraAccess,
    settings.screenShareAccess,
    settings.chatEnabled,
    settings.locked,
    busy,
  ]);
  useEffect(() => {
    if (!moderate && (panel === 'controls' || panel === 'recordings')) setPanel(null);
  }, [moderate, panel]);
  async function loadChat() {
    const m = await api<Message[]>(`/meet/${code}/chat`);
    setMessages(m);
    setChatError('');
  }
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<Message[]>(`/meet/${code}/chat`)
        .then((m) => {
          if (!stopped) {
            setMessages(m);
            setChatError('');
          }
        })
        .catch((e) => {
          if (!stopped) setChatError(e.message);
        });
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [code]);
  async function run(path: string, data?: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(`/meet/${code}${path}`, method, data);
      await onRefresh();
      if (path.includes('/chat/')) await loadChat();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const action = (action: string, attendeeId?: string) =>
    void run('/moderate', { action, attendeeId });
  const toggle = (name: typeof panel) => setPanel(panel === name ? null : name);
  return (
    <div
      className="live-shell guest-live-room"
      style={brandStyle(
        state.organization.color,
        state.organization.secondaryColor,
        state.organization.accentColor,
      )}
    >
      <header className="live-header">
        <CompanyBrand organization={state.organization} />
        <span className="live-title">
          {state.title}
          <span className="live-badge">{t('LIVE')}</span>
        </span>
        <LanguageSwitcher />
        {state.recordingActive && (
          <span className="recording-indicator" role="status">
            <Video size={14} />
            {t('Recording in progress')}
          </span>
        )}
        {state.canHost && (
          <button
            className="secondary small end-meeting"
            onClick={() => {
              if (window.confirm(t('End this meeting for everyone?'))) onEnd();
            }}
          >
            {t('End for everyone')}
          </button>
        )}
      </header>
      <div className="live-body">
        <section className="room-shell" data-lk-theme="default">
          <LiveKitRoom
            token={connection.token}
            serverUrl={connection.url}
            connect
            connectOptions={{
              rtcConfig: {
                iceServers: connection.iceServers,
                iceTransportPolicy: connection.relayOnly ? 'relay' : 'all',
              },
            }}
            audio={false}
            video={false}
            options={{
              adaptiveStream: true,
              dynacast: true,
              audioCaptureDefaults: guestAudioCaptureDefaults(),
              videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
              publishDefaults: {
                simulcast: true,
                screenShareEncoding: { maxBitrate: 3000000, maxFramerate: 15 },
              },
            }}
            onDisconnected={(reason) => {
              if (reason === DisconnectReason.CLIENT_INITIATED) onLeave();
              else onDisconnected();
            }}
            onError={(e) => setError(e.message)}
          >
            <VideoConference className="lk-video-conference remote-first-conference" />
            <GuestCallTools />
            <RoomAudioRenderer />
          </LiveKitRoom>
        </section>
        {panel && (
          <aside
            className="room-panel"
            aria-label={t(
              panel === 'chat'
                ? 'Meeting chat'
                : panel === 'people'
                  ? 'Participants'
                  : panel === 'controls'
                    ? 'Host controls'
                    : 'Recordings',
            )}
          >
            <div className="panel-heading">
              <h2>
                {t(
                  panel === 'chat'
                    ? 'Meeting chat'
                    : panel === 'people'
                      ? 'Participants'
                      : panel === 'controls'
                        ? 'Host controls'
                        : 'Recordings',
                )}
              </h2>
              <button
                className="icon-button"
                onClick={() => setPanel(null)}
                aria-label={t('Close panel')}
              >
                <X size={18} />
              </button>
            </div>
            {panel === 'chat' && (
              <>
                <div className="messages" aria-live="polite">
                  {!messages.length && (
                    <p className="muted">
                      {t('Say hello. Meeting messages stay in this conversation.')}
                    </p>
                  )}
                  {messages.map((m) => (
                    <article key={m.id}>
                      <header>
                        <strong>{m.name}</strong>
                        <time>
                          {new Date(m.createdAt).toLocaleTimeString(language, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                        {moderate && (
                          <button
                            className="icon-button"
                            disabled={busy}
                            title={t('Delete message')}
                            aria-label={t('Delete message from {name}', { name: m.name })}
                            onClick={() => {
                              if (window.confirm(t('Delete this message for everyone?')))
                                void run(`/chat/${m.id}`, undefined, 'DELETE');
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </header>
                      <p>{m.body}</p>
                    </article>
                  ))}
                </div>
                {!settings.chatEnabled && (
                  <p className="chat-paused">{t('Attendee chat is paused by the host.')}</p>
                )}
                {chatError && (
                  <p className="error" role="alert">
                    {t(chatError)}
                  </p>
                )}
                <form
                  className="chat-compose"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError('');
                    try {
                      await api(`/meet/${code}/chat`, 'POST', { body });
                      setBody('');
                      await loadChat();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <input
                    aria-label={t('Meeting message')}
                    required
                    maxLength={4000}
                    value={body}
                    disabled={!settings.chatEnabled && !moderate}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t('Write a message…')}
                  />
                  <button
                    className="icon-button"
                    disabled={busy || (!settings.chatEnabled && !moderate)}
                    aria-label={t('Send message')}
                  >
                    <Send size={18} />
                  </button>
                </form>
              </>
            )}
            {panel === 'people' && (
              <>
                <ul className="room-people">
                  {state.participants.map((p) => (
                    <li key={p.id}>
                      <div className="participant-summary">
                        <span className="avatar">{p.name[0]}</span>
                        <span>
                          {p.name}
                          {p.raised && ' ✋'}
                          {p.id === state.attendee.id && t(' (you)')}
                          <small>
                            {p.isHost ? t('Host') : p.isCohost ? t('Co-host') : t('Attendee')}
                          </small>
                        </span>
                      </div>
                      {moderate && (
                        <div className="participant-actions">
                          {p.raised && (
                            <button
                              className="secondary small"
                              disabled={busy}
                              onClick={() => action('lower-hand', p.id)}
                              aria-label={t('Lower hand for {name}', { name: p.name })}
                            >
                              {t('Lower hand')}
                            </button>
                          )}
                          {p.id !== state.attendee.id && (
                            <>
                              <button
                                className="secondary small"
                                disabled={busy}
                                onClick={() => action('mute', p.id)}
                                aria-label={t('Mute {name}', { name: p.name })}
                              >
                                <MicOff size={14} />
                                {t('Mute')}
                              </button>
                              {assign && !p.isHost && (
                                <button
                                  className="secondary small"
                                  disabled={busy}
                                  onClick={() =>
                                    action(p.isCohost ? 'remove-cohost' : 'cohost', p.id)
                                  }
                                >
                                  {t(p.isCohost ? 'Remove co-host' : 'Make co-host')}
                                </button>
                              )}
                              {!p.isHost && (!p.isCohost || assign) && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        t('Remove {name} from the meeting?', { name: p.name }),
                                      )
                                    )
                                      void run('/remove', { attendeeId: p.id });
                                  }}
                                  aria-label={t('Remove {name}', { name: p.name })}
                                >
                                  {t('Remove')}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {moderate && (
                  <button
                    className="secondary mute-all"
                    disabled={busy}
                    onClick={() => action('mute-all')}
                  >
                    <MicOff size={16} />
                    {t('Mute attendees')}
                  </button>
                )}
              </>
            )}
            {panel === 'controls' && moderate && (
              <div className="host-controls">
                <MeetingPolicyFields
                  value={draftSettings}
                  disabled={busy}
                  onChange={(next) => {
                    setDraftSettings(next);
                    void run('/settings', next, 'PATCH');
                  }}
                />
                <p className="muted">
                  {t('Changes apply immediately to everyone in this meeting.')}
                </p>
              </div>
            )}
            {panel === 'recordings' && moderate && (
              <RecordingsPanel
                code={code}
                canManage
                canShare={state.canHost}
                live={state.status === 'live'}
              />
            )}
          </aside>
        )}
      </div>
      <footer className="live-footer">
        <button
          className={state.attendee.raised ? 'secondary raised' : 'secondary'}
          aria-label={t(state.attendee.raised ? 'Lower hand' : 'Raise hand')}
          title={t(state.attendee.raised ? 'Lower hand' : 'Raise hand')}
          aria-pressed={state.attendee.raised}
          disabled={busy}
          onClick={() => void run('/raise-hand', { raised: !state.attendee.raised })}
        >
          <Hand size={18} />
        </button>
        <button
          className="text-button"
          aria-label={t('{count} people', { count: state.participants.length })}
          title={t('Participants')}
          aria-expanded={panel === 'people'}
          onClick={() => toggle('people')}
        >
          <Users size={18} />
          <span aria-hidden="true">{state.participants.length}</span>
        </button>
        <button
          className="text-button"
          aria-label={t('Chat')}
          title={t('Chat')}
          aria-expanded={panel === 'chat'}
          onClick={() => toggle('chat')}
        >
          <MessageSquare size={18} />
        </button>
        {moderate && (
          <>
            <button
              className="text-button"
              aria-label={t('Host controls')}
              title={t('Host controls')}
              aria-expanded={panel === 'controls'}
              onClick={() => toggle('controls')}
            >
              <ShieldCheck size={18} />
            </button>
            <button
              className="text-button"
              aria-label={t('Recordings')}
              title={t('Recordings')}
              aria-expanded={panel === 'recordings'}
              onClick={() => toggle('recordings')}
            >
              <Video size={18} />
            </button>
          </>
        )}
        <span className="muted">{state.organization.name} · Meet8</span>
        {!moderate &&
          state.permissions &&
          (!state.permissions.microphone || !state.permissions.camera) && (
            <span className="media-policy-note">
              {t('Your host controls camera and microphone access.')}
            </span>
          )}
        {(error || chatError) && (
          <p className="error room-error" role="alert">
            {t(error || chatError)}
            <button
              className="icon-button"
              aria-label={t('Dismiss error')}
              onClick={() => {
                setError('');
                setChatError('');
              }}
            >
              <X size={16} />
            </button>
          </p>
        )}
      </footer>
    </div>
  );
}
