import type { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { openConnectors } from "@/lib/mcp";

export const maxDuration = 60;

/** Connects to one connector and reports the tools it offers. */
export async function POST(request: NextRequest) {
  if (!isAuthed(request)) return Response.json({ error: "Not signed in." }, { status: 401 });

  let body: { url?: unknown; token?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (typeof body.url !== "string" || body.url.length > 2000) {
    return Response.json({ error: "Enter the connector's address." }, { status: 400 });
  }

  const session = await openConnectors([
    {
      name: typeof body.name === "string" ? body.name.slice(0, 60) : "Connector",
      url: body.url,
      token: typeof body.token === "string" ? body.token.slice(0, 4000) : "",
    },
  ]);
  try {
    const [status] = session.status;
    if (status?.error) return Response.json({ error: status.error }, { status: 502 });
    return Response.json({
      tools: session.tools.map((tool) => ({
        name: tool.toolName,
        description: tool.description.replace(/^\[[^\]]*\]\s*/, "").slice(0, 200),
      })),
    });
  } finally {
    await session.close();
  }
}
