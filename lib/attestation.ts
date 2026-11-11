/**
 * Runs the Blackthorn client's own check (`blackthorn status`) and reports what
 * it found: whether the host accepts the token, which model is served, and
 * whether the network's parties vouch for the GPU's attested session.
 *
 * The check is done by the client program on this server. The client prints a
 * summary only; it does not output the underlying NVIDIA attestation quote.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clientBinary } from "./client-process";

const run = promisify(execFile);

export type Attestation =
  | { available: false; reason: string }
  | {
      available: true;
      /** True when every party vouches for the GPU's attested session. */
      verified: boolean;
      checkedAt: string;
      clientVersion: string | null;
      host: string | null;
      model: string | null;
      access: string | null;
      /** e.g. "3 of 3 vouch for the GPU's attested session (fresh receipt)" */
      parties: string | null;
      vouching: number | null;
      totalParties: number | null;
      engineKey: string | null;
      /** The client's output, with the API token's identifier removed. */
      report: string;
    };

const CACHE_MS = 60_000;
let cached: { at: number; value: Attestation } | null = null;

function field(report: string, label: string): string | null {
  const match = report.match(new RegExp(`^${label}\\s+(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

export async function checkAttestation(): Promise<Attestation> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const binary = await clientBinary().catch(() => null);
  if (!binary) {
    return {
      available: false,
      reason:
        "This deployment forwards to a Blackthorn client it does not run itself, so it cannot run the check. Run `blackthorn status` on the machine that runs the client.",
    };
  }

  const options = { env: { ...process.env, HOME: "/tmp" }, timeout: 45_000 };
  const output = async (args: string[]) => {
    try {
      const { stdout, stderr } = await run(binary, args, options);
      return `${stdout}${stderr}`;
    } catch (cause) {
      // A failed check exits non-zero but still prints its findings.
      const failed = cause as { stdout?: string; stderr?: string };
      const text = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
      if (!text.trim()) throw cause;
      return text;
    }
  };

  let report: string;
  let version: string | null = null;
  try {
    report = await output(["status"]);
    version = (await output(["--version"]).catch(() => "")).trim() || null;
  } catch (cause) {
    console.error("Attestation check could not run:", cause);
    return { available: false, reason: "The Blackthorn client could not be run on this server." };
  }

  // Never show the API token's identifier.
  report = report
    .replace(/pk-[A-Za-z0-9_-]+/g, "pk-…")
    .replace(/^Token\s.*$/m, (line) => line.replace(/pk-…,?\s*/, ""))
    .trim();

  const parties = field(report, "Parties");
  const counts = parties?.match(/(\d+)\s+of\s+(\d+)/);
  const vouching = counts ? Number(counts[1]) : null;
  const totalParties = counts ? Number(counts[2]) : null;
  const engine = field(report, "Engine");

  const value: Attestation = {
    available: true,
    verified: vouching !== null && totalParties !== null && vouching === totalParties && /vouch/.test(parties ?? ""),
    checkedAt: new Date().toISOString(),
    clientVersion: version,
    host: field(report, "Host"),
    model: field(report, "Model"),
    access: field(report, "Access"),
    parties,
    vouching,
    totalParties,
    engineKey: engine?.match(/[0-9a-f]{32,}/i)?.[0] ?? null,
    report,
  };
  cached = { at: Date.now(), value };
  return value;
}
