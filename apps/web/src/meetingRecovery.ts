import { DisconnectReason } from 'livekit-client';

export function canRecoverDisconnect(reason?: DisconnectReason) {
  // The SDK exhausts network retries without supplying a reason. Authorization
  // is checked again below before either unknown or explicit network failures.
  return (
    reason === undefined ||
    [
      DisconnectReason.UNKNOWN_REASON,
      DisconnectReason.SIGNAL_CLOSE,
      DisconnectReason.STATE_MISMATCH,
      DisconnectReason.CONNECTION_TIMEOUT,
      DisconnectReason.MEDIA_FAILURE,
      DisconnectReason.SERVER_SHUTDOWN,
    ].includes(reason)
  );
}
export type MediaConnection = {
  url: string;
  token: string;
  sessionId: string;
  iceServers?: RTCIceServer[];
  relayOnly?: boolean;
};
type RecoverySession = {
  status: string;
  sessionId: string | null;
  attendee: { id: string };
  mediaReady: boolean;
};
export async function recoverJoinedConnection(options: {
  expected: { sessionId: string; attendeeId: string };
  signal: AbortSignal;
  remaining: { current: number };
  session: () => Promise<RecoverySession>;
  connection: () => Promise<MediaConnection>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<MediaConnection> {
  const check = () => options.signal.throwIfAborted();
  const wait =
    options.wait ??
    ((ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }));
  while (options.remaining.current > 0) {
    check();
    const attempt = 3 - options.remaining.current--;
    await wait([1000, 2500, 5000][attempt] ?? 5000, options.signal);
    check();
    try {
      const current = await options.session();
      check();
      if (
        current.status !== 'live' ||
        !current.mediaReady ||
        current.sessionId !== options.expected.sessionId ||
        current.attendee.id !== options.expected.attendeeId
      ) {
        throw Object.assign(new Error('The meeting session changed. Please check with the host.'), {
          status: 409,
        });
      }
      const connection = await options.connection();
      check();
      if (connection.sessionId !== options.expected.sessionId)
        throw Object.assign(new Error('The meeting session changed. Please check with the host.'), {
          status: 409,
        });
      return connection;
    } catch (error) {
      check();
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500) throw error;
      if (!options.remaining.current) throw error;
    }
  }
  throw new Error('Unable to reconnect automatically. Check your connection and try again.');
}
