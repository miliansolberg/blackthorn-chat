/**
 * Connectors: remote MCP servers whose tools the model may call. The app's
 * server connects to each one, offers its tools to the model, and runs the
 * calls the model makes.
 *
 * Whatever is sent to a connector leaves Blackthorn's encryption: the tool
 * arguments go to that server in plaintext.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type ConnectorConfig = { name: string; url: string; token: string };
export type ConnectorTool = {
  /** Name offered to the model: unique across connectors. */
  name: string;
  /** The tool's own name on the connector. */
  toolName: string;
  connector: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<string>;
};

export const MAX_CONNECTORS = 5;
const MAX_TOOLS = 48;
const MAX_RESULT_CHARS = 24_000;
const CONNECT_TIMEOUT_MS = 12_000;
const CALL_TIMEOUT_MS = 60_000;

const isProduction = process.env.NODE_ENV === "production";

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("::ffff:")
    );
  }
  return true;
}

/**
 * Connector addresses come from the user, and this server fetches them, so a
 * hosted deployment only accepts public HTTPS addresses. Local development
 * also allows http and localhost, for a connector on the same machine.
 */
export async function safeConnectorUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The connector address is not a valid URL.");
  }
  if (url.username || url.password) {
    throw new Error("Put the token in the token field, not in the address.");
  }
  if (!isProduction) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("The connector address must start with https://.");
    }
    return url;
  }
  if (url.protocol !== "https:") {
    throw new Error("The connector address must start with https://.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (addresses.length === 0) throw new Error("The connector address could not be found.");
  if (addresses.some(isPrivateAddress)) {
    throw new Error("Connectors on private or local networks are not allowed here.");
  }
  return url;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

async function connect(config: ConnectorConfig): Promise<Client> {
  const url = await safeConnectorUrl(config.url);
  const requestInit: RequestInit = config.token
    ? { headers: { authorization: `Bearer ${config.token}` } }
    : {};
  const info = { name: "blackthorn-chat", version: "1.0.0" };

  // Current servers speak Streamable HTTP; older ones speak SSE.
  const modern = new Client(info);
  try {
    await withTimeout(
      modern.connect(new StreamableHTTPClientTransport(url, { requestInit })),
      CONNECT_TIMEOUT_MS,
      "Connecting",
    );
    return modern;
  } catch (first) {
    await modern.close().catch(() => {});
    const legacy = new Client(info);
    try {
      await withTimeout(
        legacy.connect(new SSEClientTransport(url, { requestInit })),
        CONNECT_TIMEOUT_MS,
        "Connecting",
      );
      return legacy;
    } catch {
      await legacy.close().catch(() => {});
      throw first;
    }
  }
}

/** A short reason a connector failed, safe to show to the user. */
export function describeFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/401|403|unauthori[sz]ed|forbidden/i.test(message)) {
    return "The connector refused access. It may need a token, or it uses sign-in (OAuth), which is not supported.";
  }
  if (/timed out/i.test(message)) return "The connector did not answer in time.";
  if (/private or local|must start with|not a valid URL|could not be found|token field/.test(message)) {
    return message;
  }
  return "Could not connect. Check that the address is the connector's MCP endpoint.";
}

function resultText(result: unknown): string {
  const { content, isError, structuredContent } = (result ?? {}) as {
    content?: { type?: string; text?: string }[];
    isError?: boolean;
    structuredContent?: unknown;
  };
  const parts = (content ?? []).map((item) =>
    item.type === "text" && typeof item.text === "string" ? item.text : `[${item.type ?? "item"} omitted]`,
  );
  let text = parts.join("\n").trim();
  if (!text && structuredContent !== undefined) text = JSON.stringify(structuredContent);
  if (!text) text = "(the tool returned nothing)";
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[result cut off]`;
  return isError ? `The tool reported an error:\n${text}` : text;
}

export type ConnectorSession = {
  tools: ConnectorTool[];
  /** One entry per connector: how many tools it offered, or why it failed. */
  status: { name: string; tools: number; error?: string }[];
  close: () => Promise<void>;
};

export async function openConnectors(configs: ConnectorConfig[]): Promise<ConnectorSession> {
  const clients: Client[] = [];
  const tools: ConnectorTool[] = [];
  const status: ConnectorSession["status"] = [];

  await Promise.all(
    configs.slice(0, MAX_CONNECTORS).map(async (config, index) => {
      try {
        const client = await connect(config);
        clients.push(client);
        const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "Listing tools");
        let count = 0;
        for (const tool of listed.tools) {
          const name = `c${index + 1}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
          tools.push({
            name,
            toolName: tool.name,
            connector: config.name,
            description: `[${config.name} connector] ${tool.description ?? tool.name}`.slice(0, 1024),
            parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
            call: async (args) =>
              resultText(
                await client.callTool({ name: tool.name, arguments: args }, undefined, {
                  timeout: CALL_TIMEOUT_MS,
                }),
              ),
          });
          count += 1;
        }
        status.push({ name: config.name, tools: count });
      } catch (cause) {
        console.error(`Connector "${config.name}" failed:`, cause);
        status.push({ name: config.name, tools: 0, error: describeFailure(cause) });
      }
    }),
  );

  return {
    tools: tools.slice(0, MAX_TOOLS),
    status,
    close: async () => {
      await Promise.all(clients.map((client) => client.close().catch(() => {})));
    },
  };
}

/** Tool definitions in the form the model API expects. */
export function toolDefinitions(tools: ConnectorTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}
