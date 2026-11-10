import { brandStyle } from './branding';
// LiveKitRoom composition adapted from Desk8 Connect apps/guest/src/App.tsx.
import { useEffect, useState, type CSSProperties } from 'react';
import { LiveKitRoom, RoomAudioRenderer, VideoConference } from '@livekit/components-react';
import { DisconnectReason, VideoPresets } from 'livekit-client';
import { Hand, MessageSquare, Send, Users, X } from 'lucide-react';
import { GuestCallTools, guestAudioCaptureDefaults } from './connect/GuestCallTools';
import { api, type Preview } from './api';
import { CompanyBrand } from './MeetingPage';
export type RoomSession = Preview & {
  sessionId: string | null;
  attendee: { id: string; name: string; email?: string; raised: boolean };
  participants: { id: string; name: string; raised: boolean }[];
  canHost: boolean;
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
}: {
  code: string;
  connection: { url: string; token: string; iceServers?: RTCIceServer[]; relayOnly?: boolean };
  state: RoomSession;
  onLeave: () => void;
  onEnd: () => void;
  onDisconnected: () => void;
}) {
  const [panel, setPanel] = useState<'chat' | 'people' | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<Message[]>(`/meet/${code}/chat`)
        .then((m) => {
          if (!stopped) setMessages(m);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [code]);
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
          <span className="live-badge">LIVE</span>
        </span>
        <button className="secondary small" onClick={onLeave}>
          Leave meeting
        </button>
        {state.canHost && (
          <button
            className="secondary small end-meeting"
            onClick={() => {
              if (window.confirm('End this meeting for everyone?')) onEnd();
            }}
          >
            End for everyone
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
                screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
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
          <aside className="room-panel">
            <div className="panel-heading">
              <h2>{panel === 'chat' ? 'In this conversation' : 'The people here'}</h2>
              <button
                className="icon-button"
                onClick={() => setPanel(null)}
                aria-label="Close panel"
              >
                <X size={17} />
              </button>
            </div>
            {panel === 'chat' ? (
              <>
                <div className="messages" aria-live="polite">
                  {!messages.length && (
                    <p className="muted">Say hello. Meeting messages stay in this conversation.</p>
                  )}
                  {messages.map((m) => (
                    <article key={m.id}>
                      <header>
                        <strong>{m.name}</strong>
                        <time>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </header>
                      <p>{m.body}</p>
                    </article>
                  ))}
                </div>
                <form
                  className="chat-compose"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSending(true);
                    setError('');
                    try {
                      await api(`/meet/${code}/chat`, 'POST', { body });
                      setBody('');
                      setMessages(await api(`/meet/${code}/chat`));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setSending(false);
                    }
                  }}
                >
                  <input
                    aria-label="Meeting message"
                    required
                    maxLength={4000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write a message…"
                  />
                  <button className="icon-button" disabled={sending} aria-label="Send message">
                    <Send size={18} />
                  </button>
                </form>
              </>
            ) : (
              <ul className="room-people">
                {state.participants.map((p) => (
                  <li key={p.id}>
                    <span className="avatar">{p.name[0]}</span>
                    <span>
                      {p.name}
                      {p.raised && ' ✋'}
                      {p.id === state.attendee.id && ' (you)'}
                    </span>
                    {state.canHost && p.id !== state.attendee.id && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await api(`/meet/${code}/remove`, 'POST', { attendeeId: p.id });
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
      <footer className="live-footer">
        <button
          className={state.attendee.raised ? 'secondary raised' : 'secondary'}
          aria-label={state.attendee.raised ? 'Lower hand' : 'Raise hand'}
          title={state.attendee.raised ? 'Lower hand' : 'Raise hand'}
          aria-pressed={state.attendee.raised}
          onClick={async () => {
            try {
              await api(`/meet/${code}/raise-hand`, 'POST', { raised: !state.attendee.raised });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Hand size={16} />
          <span className="sr-only">{state.attendee.raised ? 'Lower hand' : 'Raise hand'}</span>
        </button>
        <button
          className="text-button"
          aria-label={`${state.participants.length} people`}
          title="Participants"
          aria-expanded={panel === 'people'}
          onClick={() => setPanel(panel === 'people' ? null : 'people')}
        >
          <Users size={17} />
          <span aria-hidden="true">{state.participants.length}</span>
        </button>
        <button
          className="text-button"
          aria-label="Chat"
          title="Chat"
          aria-expanded={panel === 'chat'}
          onClick={() => setPanel(panel === 'chat' ? null : 'chat')}
        >
          <MessageSquare size={17} />
          <span className="sr-only">Chat</span>
        </button>
        <span className="muted">{state.organization.name} · Meet8</span>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </footer>
    </div>
  );
}
