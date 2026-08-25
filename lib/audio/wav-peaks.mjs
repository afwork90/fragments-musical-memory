import { readFile } from "node:fs/promises";

export const DEFAULT_PEAK_COUNT = 512;

export function parseWavHeader(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = { start: body, length: size };
    }

    offset = body + size + (size % 2);
  }

  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  return { ...fmt, dataStart: data.start, dataLength: data.length };
}

function sampleMagnitude(buffer, { channels, dataStart }, frame) {
  const bytesPerFrame = 2 * channels;
  const sampleOffset = dataStart + frame * bytesPerFrame;

  if (channels === 1) {
    return Math.abs(buffer.readInt16LE(sampleOffset)) / 32768;
  }

  const left = buffer.readInt16LE(sampleOffset) / 32768;
  const right = buffer.readInt16LE(sampleOffset + 2) / 32768;
  return Math.abs((left + right) / 2);
}

/** Matches lib/audio/audio-service.ts peaksFromBuffer (max block amplitude, scaled 0–100). */
export function peaksFromPcm16(buffer, header, count = DEFAULT_PEAK_COUNT) {
  const { channels, dataLength } = header;
  const bytesPerFrame = 2 * channels;
  const frameCount = Math.floor(dataLength / bytesPerFrame);
  const blockSize = Math.max(1, Math.floor(frameCount / count));
  const peaks = [];

  for (let index = 0; index < count; index++) {
    const start = index * blockSize;
    const end = Math.min(frameCount, start + blockSize);
    let max = 0;

    for (let frame = start; frame < end; frame++) {
      max = Math.max(max, sampleMagnitude(buffer, header, frame));
    }

    peaks.push(Math.max(4, Math.round(max * 100)));
  }

  return peaks;
}

export async function peaksFromWavFile(filePath, count = DEFAULT_PEAK_COUNT) {
  const buffer = await readFile(filePath);
  const header = parseWavHeader(buffer);

  if (header.bitsPerSample !== 16) {
    throw new Error(`unsupported bit depth ${header.bitsPerSample} in ${filePath}`);
  }

  return {
    peaks: peaksFromPcm16(buffer, header, count),
    duration: header.dataLength / (header.channels * 2) / header.sampleRate,
    sampleRate: header.sampleRate,
  };
}
