// What both hosts need to hand a library audio file to an `<audio>` element.
//
// Pure and import-free, because the two transports in front of the library are
// otherwise unrelated: the Vite dev server answers over HTTP with Node's
// `ServerResponse`, and Electron answers a custom scheme with a web `Response`.
// Only the parsing and the content type are the same, so only those live here —
// and they have to be the same, because a fragment that seeks in the browser and
// not in the desktop app is the bug this module exists to prevent.

const AUDIO_MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

/**
 * The type to answer with, by extension. Deliberately not sniffed: the library
 * copied the file in and recorded its format, and a wrong guess is worse than a
 * generic answer because Chromium refuses to decode on it.
 */
export function audioMimeType(filePath: string): string {
  const extension = /\.([^./\\]+)$/.exec(filePath)?.[1]?.toLowerCase();
  return (extension && AUDIO_MIME[extension]) || "application/octet-stream";
}

export type ByteRange = { start: number; end: number };

/**
 * Parses a single-range `Range: bytes=start-end` header.
 *
 * **Seeking depends entirely on this.** Chromium asks for a range and reads a
 * plain `200` carrying the whole body as "not seekable": `audio.seekable` comes
 * back `[0, 0]`, every assignment to `currentTime` snaps to zero, and a fragment
 * plays from the top of its recording instead of from its own start. Short files
 * hide it, because a fully buffered resource can be seeked inside the buffer.
 *
 * `null` means "answer with the whole file"; `"unsatisfiable"` means the range
 * asked for bytes the file does not have, which is a `416`.
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // A suffix range: the last N bytes. Chromium uses this to read trailing
    // metadata, so refusing it costs a decode on some formats.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0) return null;
  // Checked before the ordering, because an empty file makes every `end` come out
  // below its `start` and that is a property of the file, not of the request.
  if (size === 0 || start >= size) return "unsatisfiable";
  // A malformed range is ignored rather than refused, which is what the spec asks
  // for: the answer is the whole representation.
  if (start > end) return null;
  return { start, end: Math.min(end, size - 1) };
}
