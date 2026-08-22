export type { EssentiaAnalysis, SonogramData, ProcessedAudio } from "./types";

export {
  bindSourceAudio,
  getCachedAudio,
  hasCachedAudio,
  processAudioBuffer,
  processAudioFile,
  processAudioUrl,
  releaseCachedAudio,
  retainCachedAudio,
  subscribeAudioCache,
} from "./audio-service";

/** @deprecated Use processAudioFile / getCachedAudio instead */
export { analyzeAudioBuffer } from "./essentia-client";

export type DecodedAudio = import("./types").ProcessedAudio;

export {
  processAudioFile as decodeAudioFile,
  processAudioUrl as decodeAudioUrl,
  releaseCachedAudio as revokeDecodedAudio,
} from "./audio-service";
