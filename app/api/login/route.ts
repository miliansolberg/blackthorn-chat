import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  gateState,
  passwordMatches,
  sessionToken,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (gateState() === "misconfigured") {
    return Response.json(
      { error: "APP_PASSWORD is not set on the server." },
      { status: 503 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // fall through to the 401 below
  }

  if (!passwordMatches(password)) {
    // Slow down guessing a little.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(process.env.APP_PASSWORD!), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
