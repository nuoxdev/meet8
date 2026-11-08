import { useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, type LocalAudioTrack, type Room } from 'livekit-client';
import { RNNoiseTrackProcessor, supportsRNNoise, type NoiseMode } from './processor.js';
export { RNNoiseTrackProcessor, supportsRNNoise } from './processor.js';

export const noiseCancellationDescription: Record<NoiseMode, string> = {
  off: 'Noise filtering is off',
  starting: 'Starting enhanced noise cancellation…',
  rnnoise: 'Enhanced · RNNoise running on this device',
  browser: 'Standard · browser noise suppression',
};

/** Baseline is safe before publication; enhancement attaches to microphone tracks only. */
export function callAudioCaptureDefaults(enabled: boolean) {
  return {
    echoCancellation: true,
    noiseSuppression: enabled,
    autoGainControl: true,
    channelCount: 1,
  };
}

export function useCallNoiseCancellation(room: Room, enabled: boolean) {
  const [mode, setMode] = useState<NoiseMode>(enabled ? 'starting' : 'off');
  const currentEnabled = useRef(enabled);
  currentEnabled.current = enabled;
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let active: { track: LocalAudioTrack; processor: RNNoiseTrackProcessor } | undefined;
    let queue = Promise.resolve();
    const report = (next: NoiseMode) => {
      if (!disposed) setMode(next);
    };
    const detach = async () => {
      const previous = active;
      active = undefined;
      if (!previous) return;
      if (previous.track.getProcessor() === previous.processor)
        await previous.track.stopProcessor();
      else await previous.processor.destroy();
    };
    const refresh = () => {
      queue = queue
        .catch(() => {})
        .then(async () => {
          if (disposed) return;
          const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)
            ?.track as LocalAudioTrack | undefined;
          const on = currentEnabled.current;
          if (
            active &&
            (active.track !== track || !on || active.track.getProcessor() !== active.processor)
          )
            await detach();
          if (disposed) return;
          if (!track) {
            report(on ? 'starting' : 'off');
            return;
          }
          if (active?.track === track) return;
          if (!on || !supportsRNNoise()) {
            await track.applyConstraints(callAudioCaptureDefaults(on));
            report(on ? 'browser' : 'off');
            return;
          }
          // Do not replace a processor installed by another audio feature.
          if (track.getProcessor()) {
            report('browser');
            return;
          }
          report('starting');
          const processor = new RNNoiseTrackProcessor(report);
          active = { track, processor };
          try {
            await track.setProcessor(processor);
          } catch {
            if (track.getProcessor() === processor) await track.stopProcessor().catch(() => {});
            await processor.destroy();
            active = undefined;
            await track
              .applyConstraints(callAudioCaptureDefaults(currentEnabled.current))
              .catch(() => {});
            report(currentEnabled.current ? 'browser' : 'off');
          }
          if (disposed) await detach();
        })
        .catch(() => {
          report(currentEnabled.current ? 'browser' : 'off');
        });
    };
    refreshRef.current = refresh;
    room.on(RoomEvent.LocalTrackPublished, refresh);
    room.on(RoomEvent.LocalTrackUnpublished, refresh);
    room.on(RoomEvent.Reconnected, refresh);
    refresh();
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      room.off(RoomEvent.LocalTrackPublished, refresh);
      room.off(RoomEvent.LocalTrackUnpublished, refresh);
      room.off(RoomEvent.Reconnected, refresh);
      void queue.then(detach).catch(() => {});
    };
  }, [room]);
  useEffect(() => {
    refreshRef.current();
  }, [enabled]);
  return mode;
}
