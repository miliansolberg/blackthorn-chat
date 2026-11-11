import type { NextRequest } from "next/server";
import { checkAttestation } from "@/lib/attestation";
import { isAuthed } from "@/lib/auth";

export const maxDuration = 60;

/** The Blackthorn client's attestation check, run on this server. */
export async function GET(request: NextRequest) {
  if (!isAuthed(request)) return Response.json({ error: "Not signed in." }, { status: 401 });
  return Response.json(await checkAttestation(), { headers: { "cache-control": "no-store" } });
}
