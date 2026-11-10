import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "bt_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * "open"          – no APP_PASSWORD and not in production: local dev, no gate.
 * "misconfigured" – no APP_PASSWORD in production: refuse everything (fail closed).
 * "locked"        – APP_PASSWORD is set: visitors must log in.
 */
export type GateState = "open" | "misconfigured" | "locked";

export function gateState(): GateState {
  if (process.env.APP_PASSWORD) return "locked";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "open";
}

/** The cookie value: derived from the password, so changing it logs everyone out. */
export function sessionToken(password: string): string {
  return createHmac("sha256", password)
    .update("blackthorn-chat-session-v1")
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function passwordMatches(candidate: string): boolean {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  // Compare digests so length differences don't leak through timing.
  return safeEqual(sessionToken(candidate), sessionToken(password));
}

export function isAuthed(request: NextRequest): boolean {
  const state = gateState();
  if (state === "open") return true;
  if (state === "misconfigured") return false;
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return false;
  return safeEqual(cookie, sessionToken(process.env.APP_PASSWORD!));
}
