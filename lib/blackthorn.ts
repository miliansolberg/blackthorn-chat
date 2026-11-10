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

export function upstreamHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Only needed when your own client sits behind an authenticating proxy.
  if (process.env.BLACKTHORN_BASE_URL && process.env.BLACKTHORN_API_KEY) {
    headers.authorization = `Bearer ${process.env.BLACKTHORN_API_KEY}`;
  }
  return headers;
}

let cachedModel: { id: string; at: number } | null = null;

/** BLACKTHORN_MODEL if set, otherwise the first model the client lists. */
export async function resolveModel(): Promise<string> {
  if (process.env.BLACKTHORN_MODEL) return process.env.BLACKTHORN_MODEL;
  if (cachedModel && Date.now() - cachedModel.at < 5 * 60_000) return cachedModel.id;

  const res = await fetch(`${await baseUrl()}/models`, {
    headers: upstreamHeaders(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`model list failed with status ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  const id = body.data?.[0]?.id;
  if (!id) throw new Error("the Blackthorn client listed no models");
  cachedModel = { id, at: Date.now() };
  return id;
}
