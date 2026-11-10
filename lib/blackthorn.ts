import { bundledClientUrl, hasBundledClient } from "./client-process";

/**
 * Finds the Blackthorn client, which exposes an OpenAI-compatible API and seals
 * every request before it leaves the machine it runs on. In order:
 *
 * 1. BLACKTHORN_BASE_URL – a client you run yourself.
 * 2. The bundled client (bin/blackthorn + BLACKTHORN_TOKEN) – hosted deployments.
 * 3. http://127.0.0.1:8000/v1 – `blackthorn serve` on your own machine.
 */
export async function baseUrl(): Promise<string> {
  if (process.env.BLACKTHORN_BASE_URL) {
    return process.env.BLACKTHORN_BASE_URL.replace(/\/+$/, "");
  }
  if (await hasBundledClient()) return bundledClientUrl();
  return "http://127.0.0.1:8000/v1";
}

/** Whether this server runs the Blackthorn client itself or forwards to one. */
export async function clientMode(): Promise<"bundled" | "external"> {
  return !process.env.BLACKTHORN_BASE_URL && (await hasBundledClient()) ? "bundled" : "external";
}

export function upstreamHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Only needed when your own client sits behind an authenticating proxy.
  if (process.env.BLACKTHORN_BASE_URL && process.env.BLACKTHORN_API_KEY) {
    headers.authorization = `Bearer ${process.env.BLACKTHORN_API_KEY}`;
  }
  return headers;
}

export type ModelInfo = {
  id: string;
  name: string;
  /** Size of the context window in tokens, when the client reports it. */
  contextWindow: number | null;
};

/** "qwen3.8-27b-bllm" -> "Qwen 3.8 27B" */
export function displayName(id: string): string {
  const parts = id.replace(/-bllm$/i, "").split(/[-_]/).filter(Boolean);
  return parts
    .map((part, index) => {
      if (index === 0) {
        const match = part.match(/^([a-z]+)([\d.]+)?$/i);
        if (match) {
          const family = match[1][0].toUpperCase() + match[1].slice(1);
          return match[2] ? `${family} ${match[2]}` : family;
        }
      }
      return /\d/.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    })
    .join(" ");
}

let cachedModels: { list: ModelInfo[]; at: number } | null = null;

/** The models the client offers (BLACKTHORN_MODEL pins a single one). */
export async function listModels(): Promise<ModelInfo[]> {
  const pinned = process.env.BLACKTHORN_MODEL;
  if (pinned) return [{ id: pinned, name: displayName(pinned), contextWindow: null }];
  if (cachedModels && Date.now() - cachedModels.at < 5 * 60_000) return cachedModels.list;

  const res = await fetch(`${await baseUrl()}/models`, {
    headers: upstreamHeaders(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`model list failed with status ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string; context_window?: number }[] };
  const list = (body.data ?? [])
    .filter((model): model is { id: string; context_window?: number } =>
      typeof model.id === "string" && model.id.length > 0,
    )
    .map((model) => ({
      id: model.id,
      name: displayName(model.id),
      contextWindow:
        typeof model.context_window === "number" && model.context_window > 0
          ? model.context_window
          : null,
    }));
  if (list.length === 0) throw new Error("the Blackthorn client listed no models");
  cachedModels = { list, at: Date.now() };
  return list;
}

/** The requested model if the client offers it, otherwise the first one. */
export async function resolveModel(requested?: string): Promise<ModelInfo> {
  const models = await listModels();
  return models.find((model) => model.id === requested) ?? models[0];
}
