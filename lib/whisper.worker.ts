/// <reference lib="webworker" />
/**
 * Speech-to-text in a web worker, with the open Whisper model running in the
 * browser. Audio is transcribed on the device and never uploaded. The model
 * files are downloaded once from Hugging Face and then cached by the browser.
 */
import { pipeline } from "@huggingface/transformers";

/** English gets the small, fast model; other languages need the larger one to be usable. */
const modelFor = (language: string) =>
  language === "en" ? "onnx-community/whisper-base" : "onnx-community/whisper-small";

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

export type WorkerRequest =
  | { type: "load"; language: string }
  | { type: "transcribe"; id: number; audio: Float32Array; language: string };
export type WorkerResponse =
  | { type: "progress"; percent: number }
  | { type: "ready" }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number | null; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse) => scope.postMessage(message);

const transcribers = new Map<string, Promise<Transcriber>>();

function load(language: string): Promise<Transcriber> {
  const MODEL = modelFor(language);
  const existing = transcribers.get(MODEL);
  if (existing) return existing;
  const transcriber = (async () => {
    // Report download progress across all model files.
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (event: {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (event.status !== "progress" || !event.file || !event.total) return;
      files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
      let loaded = 0;
      let total = 0;
      for (const file of files.values()) {
        loaded += file.loaded;
        total += file.total;
      }
      post({ type: "progress", percent: Math.min(99, Math.round((loaded / total) * 100)) });
    };

    const create = (options: Record<string, unknown>) =>
      pipeline("automatic-speech-recognition", MODEL, {
        ...options,
        progress_callback,
      } as never) as unknown as Promise<Transcriber>;

    let model: Transcriber;
    try {
      if (!("gpu" in navigator)) throw new Error("no WebGPU");
      model = await create({
        device: "webgpu",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
      });
    } catch {
      model = await create({ device: "wasm", dtype: "q8" });
    }
    post({ type: "ready" });
    return model;
  })();
  transcribers.set(MODEL, transcriber);
  transcriber.catch(() => {
    transcribers.delete(MODEL); // allow a retry after a failed download
  });
  return transcriber;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const id = request.type === "transcribe" ? request.id : null;
  try {
    const model = await load(request.language);
    if (request.type !== "transcribe") return;
    const output = await model(request.audio, {
      task: "transcribe",
      // The library cannot detect the language itself; it would assume English.
      language: request.language,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = Array.isArray(output) ? output.map((part) => part.text).join(" ") : output.text;
    post({ type: "result", id: request.id, text: text.trim() });
  } catch (cause) {
    console.error("Speech recognition failed:", cause);
    post({
      type: "error",
      id,
      message: "The speech model could not be loaded or run in this browser.",
    });
  }
};
