/**
 * Talks to a Blackthorn client (`blackthorn serve`), which exposes an
 * OpenAI-compatible API and seals every request before it leaves that machine.
 */

export function baseUrl(): string {
  return (process.env.BLACKTHORN_BASE_URL || "http://127.0.0.1:8000/v1").replace(
    /\/+$/,
    "",
  );
}

export function upstreamHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Only needed when the client sits behind an authenticating proxy.
  if (process.env.BLACKTHORN_API_KEY) {
    headers.authorization = `Bearer ${process.env.BLACKTHORN_API_KEY}`;
  }
  return headers;
}

let cachedModel: { id: string; at: number } | null = null;

/** BLACKTHORN_MODEL if set, otherwise the first model the client lists. */
export async function resolveModel(): Promise<string> {
  if (process.env.BLACKTHORN_MODEL) return process.env.BLACKTHORN_MODEL;
  if (cachedModel && Date.now() - cachedModel.at < 5 * 60_000) return cachedModel.id;

  const res = await fetch(`${baseUrl()}/models`, {
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
