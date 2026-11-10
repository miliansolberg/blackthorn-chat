// Downloads the pinned Linux Blackthorn client into bin/ so hosted deployments
// can run it next to the server routes. Runs on Vercel builds, or anywhere with
// BLACKTHORN_FETCH=1. Skipped otherwise (local dev uses your own `blackthorn serve`).
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = "0.6.0";
const FILE = `blackthorn_x86_64_linux_${VERSION}`;
const URL = `https://bin.arcium.com/download/blackthorn/${FILE}`;
const SHA256 = "4463693391eb40ccebfd1512df49b26eb9bccb3095d0fa7ea011fb4edbef7b74";

const target = path.join(process.cwd(), "bin", "blackthorn");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

if (!process.env.VERCEL && process.env.BLACKTHORN_FETCH !== "1") {
  console.log("fetch-blackthorn: skipped (not a hosted build)");
  process.exit(0);
}

const existing = await readFile(target).catch(() => null);
if (existing && sha256(existing) === SHA256) {
  console.log(`fetch-blackthorn: bin/blackthorn ${VERSION} already present`);
  process.exit(0);
}

console.log(`fetch-blackthorn: downloading ${URL}`);
const response = await fetch(URL);
if (!response.ok) throw new Error(`download failed with status ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());

const digest = sha256(data);
if (digest !== SHA256) {
  throw new Error(`checksum mismatch for ${FILE}: expected ${SHA256}, got ${digest}`);
}

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, data);
await chmod(target, 0o755);
console.log(`fetch-blackthorn: wrote bin/blackthorn (${data.length} bytes)`);
