import {
  callAudioCaptureDefaults,
  useCallNoiseCancellation,
  noiseCancellationDescription,
} from '@meet8/call-audio';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoomContext } from '@livekit/components-react';
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors';
import { RoomEvent, Track } from 'livekit-client';
import type { LocalVideoTrack } from 'livekit-client';

const NOISE_CANCELLATION_KEY = 'meet8.call.noise-cancellation';
const BACKGROUND_BLUR_KEY = 'meet8.call.background-blur';

function readCallPreference(key: string, fallback: boolean) {
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === 'true';
}

function writeCallPreference(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* Calls still work when storage is unavailable. */
  }
}

export function guestAudioCaptureDefaults() {
  return callAudioCaptureDefaults(readCallPreference(NOISE_CANCELLATION_KEY, true));
}

function ScreenShareFullscreen() {
  const [tile, setTile] = useState<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const roomElement = document.querySelector<HTMLElement>('.guest-live-room [data-lk-theme]');
    if (!roomElement) return;
    const refresh = () =>
      setTile(
        roomElement.querySelector<HTMLElement>(
          '.lk-participant-tile[data-lk-source="screen_share"]',
        ),
      );
    const observer = new MutationObserver(refresh);
    observer.observe(roomElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-lk-source'],
    });
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    refresh();
    return () => {
      observer.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  if (!tile || !document.fullscreenEnabled) return null;
  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await tile.requestFullscreen();
    } catch {
      /* Fullscreen requires a direct user gesture and browser support. */
    }
  };
  return createPortal(
    <button
      type="button"
      className="guest-screen-fullscreen"
      aria-label={fullscreen ? 'Exit shared screen fullscreen' : 'View shared screen fullscreen'}
      title={fullscreen ? 'Exit fullscreen' : 'View shared screen fullscreen'}
      onClick={() => void toggle()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {fullscreen ? (
          <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
        ) : (
          <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
        )}
      </svg>
    </button>,
    tile,
  );
}

export function GuestCallTools() {
  const room = useRoomContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlBar, setControlBar] = useState<HTMLElement | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState(
    () => room.getActiveDevice('audioinput') ?? 'default',
  );
  const [cameraId, setCameraId] = useState(() => room.getActiveDevice('videoinput') ?? 'default');
  const [outputId, setOutputId] = useState(() => room.getActiveDevice('audiooutput') ?? 'default');
  const [noiseCancellation, setNoiseCancellation] = useState(() =>
    readCallPreference(NOISE_CANCELLATION_KEY, true),
  );
  const [backgroundBlur, setBackgroundBlur] = useState(() =>
    readCallPreference(BACKGROUND_BLUR_KEY, false),
  );
  const noiseMode = useCallNoiseCancellation(room, noiseCancellation);
  const backgroundBlurRef = useRef(backgroundBlur);
  const backgroundProcessorRef = useRef<{
    track: LocalVideoTrack;
    processor: ReturnType<typeof BackgroundProcessor>;
  } | null>(null);
  const backgroundBlurSupported = supportsBackgroundProcessors();
  const outputSelectionSupported = 'setSinkId' in HTMLMediaElement.prototype;

  useEffect(() => {
    const roomElement = document.querySelector<HTMLElement>('.guest-live-room [data-lk-theme]');
    if (!roomElement) return;
    const refresh = () => {
      const bar = roomElement.querySelector<HTMLElement>('.lk-control-bar');
      setControlBar(bar);
      // LiveKit uses icon-only controls at small widths. Keep their names explicit
      // for assistive technology and tooltips at every breakpoint.
      for (const [source, label] of [
        ['microphone', 'Microphone'],
        ['camera', 'Camera'],
        ['screen_share', 'Share screen'],
      ]) {
        const button = bar?.querySelector<HTMLButtonElement>(`button[data-lk-source="${source}"]`);
        if (button) {
          const action =
            source === 'screen_share' && button.dataset.lkEnabled === 'true'
              ? 'Stop sharing'
              : label;
          button.setAttribute('aria-label', action);
          button.title = action;
        }
      }
      const leave = bar?.querySelector<HTMLButtonElement>('.lk-disconnect-button');
      if (leave) {
        leave.setAttribute('aria-label', 'Leave');
        leave.title = 'Leave meeting';
      }
    };
    const observer = new MutationObserver(refresh);
    observer.observe(roomElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-lk-enabled'],
    });
    refresh();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const devices = await navigator.mediaDevices
        ?.enumerateDevices()
        .catch(() => [] as MediaDeviceInfo[]);
      if (stopped) return;
      const available = devices ?? [];
      setMicrophones(available.filter((device) => device.kind === 'audioinput'));
      setCameras(available.filter((device) => device.kind === 'videoinput'));
      setOutputs(available.filter((device) => device.kind === 'audiooutput'));
      setMicrophoneId(room.getActiveDevice('audioinput') ?? 'default');
      setCameraId(room.getActiveDevice('videoinput') ?? 'default');
      setOutputId(room.getActiveDevice('audiooutput') ?? 'default');
    };
    void load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => {
      stopped = true;
      navigator.mediaDevices?.removeEventListener('devicechange', load);
    };
  }, [room]);

  useEffect(() => {
    backgroundBlurRef.current = backgroundBlur;
  }, [backgroundBlur]);

  useEffect(() => {
    const applyToCamera = () => {
      if (!backgroundBlurRef.current || !backgroundBlurSupported) return;
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
        LocalVideoTrack | undefined;
      if (!track || backgroundProcessorRef.current?.track === track) return;
      const processor = BackgroundProcessor({ mode: 'background-blur', blurRadius: 12 });
      setBusy(true);
      void track
        .setProcessor(processor)
        .then(() => {
          backgroundProcessorRef.current = { track, processor };
        })
        .catch(() => {
          backgroundBlurRef.current = false;
          setBackgroundBlur(false);
          writeCallPreference(BACKGROUND_BLUR_KEY, false);
          setError('Background blur could not start in this browser.');
        })
        .finally(() => setBusy(false));
    };
    applyToCamera();
    room.on(RoomEvent.LocalTrackPublished, applyToCamera);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, applyToCamera);
    };
  }, [backgroundBlurSupported, room]);

  useEffect(
    () => () => {
      const active = backgroundProcessorRef.current;
      if (active) void active.track.stopProcessor().catch(() => undefined);
    },
    [],
  );

  const toggleNoiseCancellation = () => {
    if (busy) return;
    const next = !noiseCancellation;
    setNoiseCancellation(next);
    writeCallPreference(NOISE_CANCELLATION_KEY, next);
  };

  const toggleBackgroundBlur = async () => {
    if (busy || !backgroundBlurSupported) return;
    const next = !backgroundBlur;
    setBusy(true);
    setError('');
    try {
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
        LocalVideoTrack | undefined;
      const active = backgroundProcessorRef.current;
      if (track) {
        if (active?.track === track)
          await active.processor.switchTo(
            next ? { mode: 'background-blur', blurRadius: 12 } : { mode: 'disabled' },
          );
        else if (next) {
          const processor = BackgroundProcessor({ mode: 'background-blur', blurRadius: 12 });
          await track.setProcessor(processor);
          backgroundProcessorRef.current = { track, processor };
        }
      }
      backgroundBlurRef.current = next;
      setBackgroundBlur(next);
      writeCallPreference(BACKGROUND_BLUR_KEY, next);
    } catch {
      setError(
        'Background blur could not be updated. Your camera is still available without the effect.',
      );
    } finally {
      setBusy(false);
    }
  };

  const selectInput = async (kind: 'audioinput' | 'videoinput', deviceId: string) => {
    setError('');
    try {
      await room.switchActiveDevice(kind, deviceId);
      if (kind === 'audioinput') setMicrophoneId(deviceId);
      else setCameraId(deviceId);
    } catch {
      setError(
        `This browser could not switch the ${kind === 'audioinput' ? 'microphone' : 'camera'}.`,
      );
    }
  };

  const selectOutput = async (deviceId: string) => {
    setError('');
    try {
      await room.switchActiveDevice('audiooutput', deviceId);
      setOutputId(deviceId);
    } catch {
      setError('This browser could not switch the meeting audio output.');
    }
  };

  return (
    <div className="guest-call-tools">
      {controlBar &&
        createPortal(
          <button
            type="button"
            className={`lk-button guest-settings-toggle ${settingsOpen ? 'on' : ''}`}
            aria-label="Call settings"
            aria-expanded={settingsOpen}
            title="Call settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.38.36.72.6 1 .28.28.62.42 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6.6z" />
            </svg>
          </button>,
          controlBar,
        )}
      {settingsOpen && (
        <section className="guest-call-settings" role="dialog" aria-label="Call settings">
          <header>
            <div>
              <small>CALL SETTINGS</small>
              <b>Audio & video</b>
            </div>
            <button
              type="button"
              aria-label="Close call settings"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="guest-call-settings-body">
            <button
              type="button"
              className="guest-call-effect"
              aria-pressed={noiseCancellation}
              disabled={busy}
              onClick={() => void toggleNoiseCancellation()}
            >
              <span>
                <b>Background noise cancellation</b>
                <small>{noiseCancellationDescription[noiseMode]}</small>
              </span>
              <i aria-hidden="true" className={noiseCancellation ? 'on' : ''} />
            </button>
            <button
              type="button"
              className="guest-call-effect"
              aria-pressed={backgroundBlur}
              disabled={busy || !backgroundBlurSupported}
              title={
                backgroundBlurSupported
                  ? 'Blur the area behind you'
                  : 'Background blur is not supported by this browser'
              }
              onClick={() => void toggleBackgroundBlur()}
            >
              <span>
                <b>Background blur</b>
                <small>
                  {backgroundBlurSupported
                    ? 'Keep you clear and soften your surroundings'
                    : 'Not supported by this browser'}
                </small>
              </span>
              <i aria-hidden="true" className={backgroundBlur ? 'on' : ''} />
            </button>
            <label>
              <span>Microphone</span>
              <select
                value={microphoneId}
                disabled={microphones.length === 0}
                onChange={(event) => void selectInput('audioinput', event.target.value)}
              >
                {microphones.length ? (
                  microphones.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))
                ) : (
                  <option value="default">System microphone</option>
                )}
              </select>
            </label>
            <label>
              <span>Camera</span>
              <select
                value={cameraId}
                disabled={cameras.length === 0}
                onChange={(event) => void selectInput('videoinput', event.target.value)}
              >
                {cameras.length ? (
                  cameras.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))
                ) : (
                  <option value="default">System camera</option>
                )}
              </select>
            </label>
            <label
              title={
                outputSelectionSupported
                  ? 'Play meeting audio through this device'
                  : 'Your browser uses the system audio-output setting'
              }
            >
              <span>Listen on</span>
              <select
                value={outputId}
                disabled={!outputSelectionSupported || outputs.length === 0}
                onChange={(event) => void selectOutput(event.target.value)}
              >
                {outputs.length ? (
                  outputs.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Audio output ${index + 1}`}
                    </option>
                  ))
                ) : (
                  <option value="default">System output</option>
                )}
              </select>
            </label>
          </div>
        </section>
      )}
      {error && (
        <div className="guest-call-error" role="alert">
          {error}
        </div>
      )}
      <ScreenShareFullscreen />
    </div>
  );
}
