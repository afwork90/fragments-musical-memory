// soundtouchjs ships no type declarations. Declare only the surface we call.
//
// Only the offline path is described here — `SoundTouch` driven by a `SimpleFilter`
// over a source we supply. The library also offers `PitchShifter` and
// `getWebAudioNode`, which build a `ScriptProcessorNode` for realtime playback;
// that is deliberately left undeclared, since realtime tempo matching goes through
// an `<audio>` element's `playbackRate` instead.

declare module "soundtouchjs" {
  /** Frames written into `target` as interleaved stereo, and how many were real. */
  export type SoundTouchSource = {
    extract(target: Float32Array, numFrames: number, position: number): number;
  };

  export class SoundTouch {
    /** Speed multiplier with pitch held: 1.05 plays 5% faster at the same pitch. */
    tempo: number;
    /** Pitch in semitones, positive up, with duration held. */
    pitchSemitones: number;
    clear(): void;
  }

  export class SimpleFilter {
    constructor(source: SoundTouchSource, pipe: SoundTouch);
    /** Fills `target` with interleaved stereo; returns the frames actually written. */
    extract(target: Float32Array, numFrames: number): number;
    clear(): void;
  }
}
