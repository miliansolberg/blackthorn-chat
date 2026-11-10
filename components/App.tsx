"use client";

import { useCallback, useEffect, useState } from "react";
import { Chat } from "./Chat";
import { Login } from "./Login";

type Session = {
  authed: boolean;
  gated: boolean;
  misconfigured: boolean;
  models: { id: string; name: string }[];
  search: string | null;
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setSession(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    refresh();
  }, [refresh]);

  if (failed) {
    return (
      <Centered>
        <p className="text-muted">Could not reach the server.</p>
        <button onClick={refresh} className="mt-3 text-accent underline">
          Try again
        </button>
      </Centered>
    );
  }
  if (!session) return <Centered />;
  if (session.misconfigured) {
    return (
      <Centered>
        <p className="max-w-sm text-center text-muted">
          This deployment has no <code className="font-mono">APP_PASSWORD</code> set,
          so chat is disabled. Add it in the hosting environment settings and
          redeploy.
        </p>
      </Centered>
    );
  }
  if (!session.authed) return <Login onSuccess={refresh} />;
  return <Chat models={session.models} search={session.search} gated={session.gated} onSessionChange={refresh} />;
}

function Centered({ children }: { children?: React.ReactNode }) {
  return (
    <main className="flex h-full flex-col items-center justify-center p-6">
      {children}
    </main>
  );
}
