import { connection, type NextRequest } from "next/server";
import { gateState, isAuthed } from "@/lib/auth";
import { listModels, type ModelInfo } from "@/lib/blackthorn";

export const maxDuration = 120; // first call may start the bundled client

export async function GET(request: NextRequest) {
  await connection(); // always answer at request time, never from a prerender
  const state = gateState();
  const authed = isAuthed(request);

  let models: ModelInfo[] = [];
  if (authed) {
    try {
      models = await listModels();
    } catch (cause) {
      console.error("Blackthorn endpoint unavailable:", cause);
      models = []; // the UI shows the endpoint as unreachable
    }
  }

  return Response.json(
    { authed, gated: state === "locked", misconfigured: state === "misconfigured", models },
    { headers: { "cache-control": "no-store" } },
  );
}
