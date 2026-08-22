"use client";

import { Upload } from "lucide-react";
import { DragEvent, useEffect, useRef, useState } from "react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { Button } from "@/lib/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/lib/ui/dialog";
import { cn } from "@/lib/utils";
import {
  processAudioFile,
  processAudioUrl,
  quickAnalyzeCached,
  releaseCachedAudio,
  retainCachedAudio,
} from "@/lib/audio/audio-service";
import type { ProcessedAudio } from "@/lib/audio/types";
import { formatSeconds } from "@/lib/format";
import { SourceType } from "@/app/prototype-data";

export type ImportedSource = ProcessedAudio & {
  sourceTypes: SourceType[];
  persistedId?: string;
  persistedAudioUrl?: string;
};

type ImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (source: ImportedSource) => void;
};

const DEFAULT_SOURCE_TYPES: SourceType[] = ["Voice memo", "Jam"];

type MetadataStatus = "idle" | "analyzing" | "ready" | "failed";

function AnalysisMetadata({
  audio,
  status,
}: {
  audio: ProcessedAudio;
  status: MetadataStatus;
}) {
  const { bpm, key, scale, keyStrength } = audio.analysis;
  const keyLabel = key && scale ? `${key} ${scale}` : null;

  if (status === "analyzing") {
    return <p className="text-sm text-muted-foreground">Detecting tempo and key…</p>;
  }

  if (status === "failed") {
    return <p className="text-sm text-muted-foreground">Tempo and key unavailable for this recording.</p>;
  }

  if (status === "ready" && !bpm && !keyLabel) {
    return <p className="text-sm text-muted-foreground">No clear tempo or key detected.</p>;
  }

  if (!bpm && !keyLabel) return null;

  return (
    <p className="text-sm text-muted-foreground">
      {bpm != null && (
        <span>
          <strong className="text-foreground">{bpm}</strong> BPM
        </span>
      )}
      {bpm != null && keyLabel && <span> · </span>}
      {keyLabel && (
        <span>
          <strong className="text-foreground">{keyLabel}</strong>
          {keyStrength != null ? ` (${keyStrength}%)` : ""}
        </span>
      )}
    </p>
  );
}

function ImportProgress() {
  const value = 55;
  const label = "Reading audio…";

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${value}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

export function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const [decoded, setDecoded] = useState<ProcessedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "decoding">("idle");
  const [metadataStatus, setMetadataStatus] = useState<MetadataStatus>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewCacheKeyRef = useRef<string | null>(null);
  const pendingImportRef = useRef<string | null>(null);
  const analysisRequestRef = useRef(0);

  const releasePreview = () => {
    if (previewCacheKeyRef.current) {
      releaseCachedAudio(previewCacheKeyRef.current);
      previewCacheKeyRef.current = null;
    }
  };

  const reset = () => {
    if (pendingImportRef.current) {
      void (window as any).fragments?.cancelImport(pendingImportRef.current);
      pendingImportRef.current = null;
    }
    releasePreview();
    setDecoded(null);
    setError(null);
    setStatus("idle");
    setMetadataStatus("idle");
    setIsDragging(false);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  useEffect(() => () => releasePreview(), []);

  const applyDecoded = (next: ProcessedAudio) => {
    releasePreview();
    previewCacheKeyRef.current = next.cacheKey;
    retainCachedAudio(next.cacheKey);
    setDecoded(next);
  };

  const runQuickAnalysis = (cacheKey: string) => {
    const requestId = analysisRequestRef.current + 1;
    analysisRequestRef.current = requestId;
    setMetadataStatus("analyzing");

    void quickAnalyzeCached(cacheKey)
      .then((enriched) => {
        if (analysisRequestRef.current !== requestId || previewCacheKeyRef.current !== cacheKey) return;
        setDecoded(enriched);
        setMetadataStatus("ready");
      })
      .catch((error) => {
        console.warn("Quick analysis failed:", error);
        if (analysisRequestRef.current !== requestId || previewCacheKeyRef.current !== cacheKey) return;
        setMetadataStatus("failed");
      });
  };

  const decodeFromFile = async (file: File) => {
    setError(null);
    setDecoded(null);
    setMetadataStatus("idle");
    setStatus("decoding");
    try {
      const next = await processAudioFile(file, { analyze: false });
      applyDecoded(next);
      if (next.analysis.bpm != null || next.analysis.key != null) {
        setMetadataStatus("ready");
      } else {
        runQuickAnalysis(next.cacheKey);
      }
    } finally {
      setStatus("idle");
    }
  };

  const chooseManagedFile = async () => {
    const bridge = (window as any).fragments;
    if (!bridge) {
      inputRef.current?.click();
      return;
    }
    setError(null);
    setStatus("decoding");
    try {
      const filePath = await bridge.pickAudioFile();
      if (!filePath) return;
      const pending = await bridge.beginImport(filePath);
      pendingImportRef.current = pending.id;
      const next = await processAudioUrl(pending.audioUrl, pending.originalName, { analyze: false });
      applyDecoded(next);
      runQuickAnalysis(next.cacheKey);
    } catch (error) {
      console.error("Persistent import failed:", error);
      setError("Could not copy or read this audio file.");
      if (pendingImportRef.current) {
        await bridge.cancelImport(pendingImportRef.current);
        pendingImportRef.current = null;
      }
    } finally {
      setStatus("idle");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aiff?|flac|ogg)$/i.test(file.name)) {
      setError("Please drop an audio file.");
      return;
    }

    try {
      await decodeFromFile(file);
    } catch (error) {
      console.error("Import decode failed:", error);
      const message = error instanceof DOMException && error.name === "EncodingError"
        ? "This audio format isn't supported in your browser. Try WAV or MP3."
        : "Could not read this audio file in the browser.";
      setError(message);
      setDecoded(null);
      setStatus("idle");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  const handleImport = async () => {
    if (!decoded) return;
    let persistedId: string | undefined;
    let persistedAudioUrl: string | undefined;
    const bridge = (window as any).fragments;
    if (bridge && pendingImportRef.current) {
      const persisted = await bridge.finalizeImport(pendingImportRef.current, {
        duration: decoded.duration,
        format: decoded.format,
        sampleRate: decoded.sampleRate,
        waveform: { version: 1, count: decoded.peaks.length, peaks: decoded.peaks },
        analysis: decoded.analysis,
      });
      persistedId = persisted.id;
      persistedAudioUrl = persisted.audioUrl;
      pendingImportRef.current = null;
    }
    releasePreview();
    onImport({ ...decoded, sourceTypes: DEFAULT_SOURCE_TYPES, persistedId, persistedAudioUrl });
    onOpenChange(false);
  };

  const isDecoding = status === "decoding";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>Import recording</DialogTitle>
          <DialogDescription>Electron imports are saved; browser imports last for this session.</DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5">
          {decoded ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{decoded.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatSeconds(decoded.duration)} · {decoded.format}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  Change file
                </Button>
              </div>
              <ContinuousWaveform values={decoded.peaks} active className="h-32 w-full" />
              <AnalysisMetadata audio={decoded} status={metadataStatus} />
            </div>
          ) : status === "decoding" ? (
            <ImportProgress />
          ) : (
            <div
              className={cn(
                "rounded-lg border border-dashed p-10 transition-colors",
                isDragging ? "border-primary bg-primary/10" : "border-border bg-card/40",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget === event.target) setIsDragging(false);
              }}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.aiff,.aif,.flac,.ogg"
                className="sr-only"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
              <div className="flex flex-col items-center gap-3 text-center">
                <Upload className="size-9 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">Drop an audio file here</p>
                  <p className="mt-1 text-sm text-muted-foreground">or choose one from your device</p>
                </div>
                <Button type="button" variant="outline" onClick={() => void chooseManagedFile()}>
                  Choose file
                </Button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="lime" disabled={!decoded || isDecoding} onClick={() => void handleImport()}>
            Import source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
