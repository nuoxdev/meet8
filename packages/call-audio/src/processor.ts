import type { AudioProcessorOptions, TrackProcessor, Track } from 'livekit-client';
import type { NoiseSuppressionProcessor } from '@shiguredo/noise-suppression';

export type NoiseMode = 'off' | 'starting' | 'rnnoise' | 'browser';

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Audio processing startup timed out')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function supportsRNNoise() {
  return (
    typeof window !== 'undefined' &&
    'MediaStreamTrackProcessor' in window &&
    'MediaStreamTrackGenerator' in window &&
    'AudioContext' in window
  );
}

function inputProcessingConstraints(
  input: MediaStreamTrack,
  enhanced: boolean,
): MediaTrackConstraints {
  const capabilities = input.getCapabilities();
  // Generated/virtual tracks may not offer microphone DSP controls at all.
  return {
    ...input.getConstraints(),
    ...(capabilities.echoCancellation?.includes(true) ? { echoCancellation: true } : {}),
    ...((capabilities.noiseSuppression?.length ?? 0) > 1 ? { noiseSuppression: !enhanced } : {}),
    ...((capabilities.autoGainControl?.length ?? 0) > 1 ? { autoGainControl: !enhanced } : {}),
  };
}

/** Owns only derived tracks and its own AudioContext; never stops the microphone. */
export class RNNoiseTrackProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = 'desk8-rnnoise';
  processedTrack?: MediaStreamTrack;
  fallbackReason?: string;
  private context?: AudioContext;
  private filter?: NoiseSuppressionProcessor;
  private derived: MediaStreamTrack[] = [];
  private generation = 0;

  constructor(private report: (mode: NoiseMode) => void = () => {}) {}

  async init(options: AudioProcessorOptions) {
    await this.restart(options);
  }

  async restart(options: Pick<AudioProcessorOptions, 'track'>) {
    await this.destroy();
    this.fallbackReason = undefined;
    const generation = this.generation;
    const input = options.track;
    try {
      const { NoiseSuppressionProcessor } = await bounded(
        import('@shiguredo/noise-suppression'),
        8000,
      );
      if (generation !== this.generation) throw new Error('Processor stopped');
      if (!NoiseSuppressionProcessor.isSupported()) throw new Error('Unsupported browser');
      await input.applyConstraints(inputProcessingConstraints(input, true));
      if (generation !== this.generation) throw new Error('Processor stopped');
      const context = new AudioContext({ sampleRate: 48000 });
      this.context = context;
      await bounded(context.resume(), 2000);
      if (generation !== this.generation) throw new Error('Processor stopped');
      const source = context.createMediaStreamSource(new MediaStream([input]));
      const mono = context.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      const destination = context.createMediaStreamDestination();
      destination.channelCount = 1;
      source.connect(mono).connect(destination);
      const raw = destination.stream.getAudioTracks()[0];
      this.derived.push(raw);
      const filter = new NoiseSuppressionProcessor();
      this.filter = filter;
      const filtered = await bounded(
        filter.startProcessing(raw).then((track) => {
          if (generation !== this.generation) {
            filter.stopProcessing();
            track.stop();
            throw new Error('Processor stopped');
          }
          return track;
        }),
        4000,
      );
      if (generation !== this.generation) {
        filter.stopProcessing();
        filtered.stop();
        throw new Error('Processor stopped');
      }
      this.processedTrack = filtered;
      this.report('rnnoise');
    } catch (error) {
      if (generation !== this.generation) throw error;
      this.fallbackReason = error instanceof Error ? error.message : 'Audio processing unavailable';
      await this.destroy();
      const fallbackGeneration = this.generation;
      // Keep calls usable if model loading, AudioContext, or browser support fails.
      await input.applyConstraints(inputProcessingConstraints(input, false)).catch(() => undefined);
      if (fallbackGeneration !== this.generation || input.readyState === 'ended') throw error;
      // No output override: LiveKit keeps its original track, including its mute state.
      // A clone here would have an independent `enabled` flag and could bypass mute.
      this.processedTrack = undefined;
      this.report('browser');
    }
  }

  async destroy() {
    this.generation++;
    this.filter?.stopProcessing();
    this.filter = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.derived.forEach((track) => track.stop());
    this.derived = [];
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}
