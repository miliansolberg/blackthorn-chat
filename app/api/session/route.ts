import { connection, type NextRequest } from "next/server";
import { gateState, isAuthed } from "@/lib/auth";
import { resolveModel } from "@/lib/blackthorn";

export async function GET(request: NextRequest) {
  await connection(); // always answer at request time, never from a prerender
  const state = gateState();
  const authed = isAuthed(request);

  let model: string | null = null;
  if (authed) {
    try {
      model = await resolveModel();
    } catch {
      model = null; // the UI shows the endpoint as unreachable
    }
  }

  return Response.json(
    { authed, gated: state === "locked", misconfigured: state === "misconfigured", model },
    { headers: { "cache-control": "no-store" } },
  );
}
