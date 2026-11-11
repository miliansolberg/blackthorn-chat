import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile } from "node:fs/promises";
import path from "node:path";

/**
 * Runs the bundled Blackthorn client (`bin/blackthorn serve`) next to the
 * server routes, for hosted deployments where there is no client to point at.
 * One process per server instance, started on first use and reused after.
 */

const PORT = Number(process.env.BLACKTHORN_PORT || 8787);
const START_TIMEOUT_MS = 90_000;

type State = { child: ChildProcess; ready: Promise<string> };
const globals = globalThis as typeof globalThis & { __blackthornClient?: State };

export function bundledBinary(): string {
  return path.join(process.cwd(), "bin", "blackthorn");
}

export async function hasBundledClient(): Promise<boolean> {
  // The bundled binary is the Linux build.
  if (process.platform !== "linux" || !process.env.BLACKTHORN_TOKEN) return false;
  return access(bundledBinary(), constants.R_OK).then(
    () => true,
    () => false,
  );
}

/** A path to the binary that is certain to be executable. */
async function executablePath(): Promise<string> {
  const source = bundledBinary();
  try {
    await access(source, constants.X_OK);
    return source;
  } catch {
    // Deployment bundles can drop the executable bit; /tmp is writable.
    const copy = "/tmp/blackthorn";
    await copyFile(source, copy);
    await chmod(copy, 0o755);
    return copy;
  }
}

/**
 * The Blackthorn client program this server can run directly (for its status
 * check): BLACKTHORN_BIN if set, else the bundled Linux build.
 */
export async function clientBinary(): Promise<string | null> {
  if (process.env.BLACKTHORN_BIN) return process.env.BLACKTHORN_BIN;
  if (!(await hasBundledClient())) return null;
  return executablePath();
}

async function start(): Promise<State> {
  const binary = await executablePath();
  const child = spawn(binary, ["serve", "--port", String(PORT)], {
    // The client may want to write state; only /tmp is writable when hosted.
    env: { ...process.env, HOME: "/tmp" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let tail = "";
  const log = (chunk: Buffer) => {
    const text = chunk.toString();
    tail = (tail + text).slice(-2000);
    process.stderr.write(`[blackthorn] ${text}`);
  };
  child.stdout?.on("data", log);
  child.stderr?.on("data", log);

  let exited: string | null = null;
  child.on("error", (cause) => {
    exited = `could not start: ${cause.message}`;
  });
  child.on("exit", (code, signal) => {
    exited = `exited (${signal ?? code})`;
    if (globals.__blackthornClient?.child === child) globals.__blackthornClient = undefined;
  });

  const url = `http://127.0.0.1:${PORT}/v1`;
  const ready = (async () => {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Blackthorn client ${exited}: ${tail.trim()}`);
      try {
        const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) return url;
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    child.kill();
    throw new Error(`Blackthorn client did not become ready: ${tail.trim()}`);
  })();
  // Avoid an unhandled rejection if nobody is awaiting yet.
  ready.catch(() => {});

  return { child, ready };
}

/** Base URL of the bundled client, starting it if needed. */
export async function bundledClientUrl(): Promise<string> {
  const current = globals.__blackthornClient;
  if (current && current.child.exitCode === null && !current.child.killed) {
    return current.ready;
  }
  const state = await start();
  globals.__blackthornClient = state;
  try {
    return await state.ready;
  } catch (cause) {
    if (globals.__blackthornClient === state) globals.__blackthornClient = undefined;
    throw cause;
  }
}
