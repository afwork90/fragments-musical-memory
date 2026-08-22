"use client";

import { useEffect, useRef } from "react";
import { SonogramData } from "@/lib/audio/essentia-client";

type SonogramProps = {
  data: SonogramData;
  className?: string;
};

export function Sonogram({ data, className = "" }: SonogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.frames.length === 0 || data.bands === 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const width = data.frames.length;
    const height = data.bands;
    canvas.width = width;
    canvas.height = height;

    const image = context.createImageData(width, height);
    let max = 0;

    for (const frame of data.frames) {
      for (const value of frame) max = Math.max(max, value);
    }

    const floor = max > 0 ? max * 0.02 : 0;

    for (let x = 0; x < width; x++) {
      const frame = data.frames[x];
      for (let y = 0; y < height; y++) {
        const value = frame[height - 1 - y] ?? 0;
        const normalized = max > floor ? (value - floor) / (max - floor) : 0;
        const intensity = Math.max(0, Math.min(1, normalized));
        const offset = (y * width + x) * 4;

        image.data[offset] = Math.round(40 + intensity * 130);
        image.data[offset + 1] = Math.round(20 + intensity * 90);
        image.data[offset + 2] = Math.round(70 + intensity * 185);
        image.data[offset + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-full w-full rounded-md bg-[#0a090d] ${className}`}
      aria-label="Mel spectrogram"
    />
  );
}
