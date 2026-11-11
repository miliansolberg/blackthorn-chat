"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "./whisper.worker";

/**
 * Dictation that stays on the device: the microphone is recorded in the
 * browser and transcribed by a Whisper model running in a web worker
 * (lib/whisper.worker.ts). No audio is uploaded anywhere, and it works in any
 * modern browser, unlike the browsers' own cloud speech services.
 */

export type DictationState = "idle" | "recording" | "transcribing";

/** Languages offered for dictation (Whisper language codes). */
export const DICTATION_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "no", name: "Norwegian" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
] as const;

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 180;

function describe(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it for this site to dictate.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found.";
  }
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  return "Dictation could not start.";
}

/** Decodes a recording to the 16 kHz mono samples Whisper expects. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index++) {
        samples[index] += data[index] / buffer.numberOfChannels;
      }
    }
    return samples;
  } finally {
    context.close();
  }
}

export function useDictation(language: string, onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Download progress of the speech model, 0-99, or null when not downloading. */
  const [downloading, setDownloading] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const requestRef = useRef(0);
  const onTextRef = useRef(onText);
  const languageRef = useRef(language);

  const supported =
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    onTextRef.current = onText;
    languageRef.current = language;
  });
  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      workerRef.current?.terminate();
    },
    [],
  );

  function worker(): Worker {
    if (workerRef.current) return workerRef.current;
    const created = new Worker(new URL("./whisper.worker.ts", import.meta.url), {
      type: "module",
    });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") setDownloading(message.percent);
      else if (message.type === "ready") setDownloading(null);
      else if (message.type === "result") {
        if (message.id !== requestRef.current) return;
        setState("idle");
        if (message.text) onTextRef.current(message.text);
        else setError("No speech was heard.");
      } else {
        setDownloading(null);
        if (message.id === null || message.id === requestRef.current) {
          setState((current) => (current === "transcribing" ? "idle" : current));
          setError(message.message);
        }
      }
    };
    workerRef.current = created;
    return created;
  }

  async function start() {
    if (state !== "idle") return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setError(describe(cause));
      return;
    }

    // Start fetching the model while the user is talking.
    worker().postMessage({ type: "load", language: languageRef.current } satisfies WorkerRequest);

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    const limit = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_SECONDS * 1000);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      try {
        const audio = await toSamples(new Blob(chunks, { type: recorder.mimeType }));
        if (audio.length < SAMPLE_RATE / 4) {
          setState("idle");
          setError("That was too short to transcribe.");
          return;
        }
        const id = ++requestRef.current;
        const request: WorkerRequest = {
          type: "transcribe",
          id,
          audio,
          language: languageRef.current,
        };
        worker().postMessage(request, [
          audio.buffer,
        ]);
      } catch {
        setState("idle");
        setError("The recording could not be read.");
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
  }

  /** Ends the recording and transcribes it. */
  function stop() {
    if (recorderRef.current?.state === "recording") {
      setState("transcribing");
      recorderRef.current.stop();
    }
  }

  /** Ends the recording and discards it. */
  function cancel() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    }
    requestRef.current += 1; // ignore a transcription still in flight
    setState("idle");
  }

  return { supported, state, error, downloading, start, stop, cancel };
}
