/**
 * Imports chat history from a Claude or ChatGPT data export. Both services
 * export a ZIP that contains conversations.json; either the ZIP or the JSON
 * file can be chosen. Everything is read in the browser; nothing is uploaded.
 */
import type { Attachment } from "./attachments";
import type { ChatRecord, Message } from "./chats";

export type ImportResult = { source: "Claude" | "ChatGPT"; chats: ChatRecord[] };

const MAX_BYTES = 1_500_000_000;

function title(text: unknown, fallback: Message[]): string {
  const base =
    (typeof text === "string" && text.trim()) ||
    fallback.find((message) => message.role === "user")?.content ||
    "Imported chat";
  const flat = base.replace(/\s+/g, " ").trim();
  return flat.length > 48 ? `${flat.slice(0, 47).trimEnd()}…` : flat;
}

function time(value: unknown): number {
  if (typeof value === "number" && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

/** Joins consecutive messages from the same side, so turns alternate. */
function alternate(messages: Message[]): Message[] {
  const merged: Message[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = [previous.content, message.content].filter(Boolean).join("\n\n");
      if (message.attachments) {
        previous.attachments = [...(previous.attachments ?? []), ...message.attachments];
      }
    } else {
      merged.push({ ...message });
    }
  }
  return merged;
}

type ClaudeConversation = {
  uuid?: string;
  name?: string;
  updated_at?: string;
  created_at?: string;
  chat_messages?: {
    sender?: string;
    text?: string;
    content?: { type?: string; text?: string }[];
    attachments?: { file_name?: string; extracted_content?: string }[];
  }[];
};

function fromClaude(conversations: ClaudeConversation[]): ChatRecord[] {
  const chats: ChatRecord[] = [];
  for (const conversation of conversations) {
    const messages: Message[] = [];
    for (const item of conversation.chat_messages ?? []) {
      const role = item.sender === "human" ? "user" : item.sender === "assistant" ? "assistant" : null;
      if (!role) continue;
      const blocks = (item.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n\n");
      const content = (blocks || item.text || "").trim();
      const attachments: Attachment[] = (item.attachments ?? [])
        .filter((file) => typeof file.extracted_content === "string" && file.extracted_content)
        .map((file) => ({
          name: file.file_name || "attachment",
          kind: "document" as const,
          text: (file.extracted_content as string).slice(0, 120_000),
        }));
      if (!content && attachments.length === 0) continue;
      messages.push({
        role,
        content,
        ...(role === "user" && attachments.length > 0 ? { attachments } : {}),
      });
    }
    const merged = alternate(messages);
    if (merged.length === 0) continue;
    chats.push({
      id: `claude:${conversation.uuid ?? crypto.randomUUID()}`,
      title: title(conversation.name, merged),
      messages: merged,
      updatedAt: time(conversation.updated_at ?? conversation.created_at),
    });
  }
  return chats;
}

type ChatGptNode = {
  parent?: string | null;
  message?: {
    author?: { role?: string };
    recipient?: string;
    content?: { content_type?: string; parts?: unknown[] };
    metadata?: { is_visually_hidden_from_conversation?: boolean };
  } | null;
};
type ChatGptConversation = {
  id?: string;
  conversation_id?: string;
  title?: string;
  update_time?: number;
  create_time?: number;
  current_node?: string;
  mapping?: Record<string, ChatGptNode>;
};

function fromChatGpt(conversations: ChatGptConversation[]): ChatRecord[] {
  const chats: ChatRecord[] = [];
  for (const conversation of conversations) {
    const mapping = conversation.mapping ?? {};
    // The visible thread is the path from the current node back to the root.
    const path: ChatGptNode[] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined = conversation.current_node;
    while (cursor && mapping[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      path.push(mapping[cursor]);
      cursor = mapping[cursor].parent;
    }
    path.reverse();

    const messages: Message[] = [];
    for (const node of path) {
      const message = node.message;
      const role = message?.author?.role;
      if (!message || (role !== "user" && role !== "assistant")) continue;
      if (message.metadata?.is_visually_hidden_from_conversation) continue;
      if (message.recipient && message.recipient !== "all") continue; // a tool call
      const type = message.content?.content_type;
      if (type !== "text" && type !== "multimodal_text") continue;
      const content = (message.content?.parts ?? [])
        .filter((part): part is string => typeof part === "string")
        .join("\n")
        .trim();
      if (content) messages.push({ role, content });
    }
    const merged = alternate(messages);
    if (merged.length === 0) continue;
    chats.push({
      id: `chatgpt:${conversation.conversation_id ?? conversation.id ?? crypto.randomUUID()}`,
      title: title(conversation.title, merged),
      messages: merged,
      updatedAt: time(conversation.update_time ?? conversation.create_time),
    });
  }
  return chats;
}

/** The conversations files inside an export ZIP, as text. */
async function conversationsFromZip(bytes: Uint8Array): Promise<string[]> {
  const { unzip } = await import("fflate");
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(
      bytes,
      { filter: (entry) => /(^|\/)conversations[^/]*\.json$/i.test(entry.name) },
      (error, data) => (error ? reject(error) : resolve(data)),
    ),
  );
  const decoder = new TextDecoder();
  return Object.keys(files)
    .sort()
    .map((name) => decoder.decode(files[name]));
}

export async function parseExport(file: File): Promise<ImportResult> {
  if (file.size > MAX_BYTES) {
    throw new Error("This export is too large to read in the browser (over 1.5 GB).");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  let texts: string[];
  if (isZip) {
    texts = await conversationsFromZip(bytes).catch(() => {
      throw new Error("This ZIP file could not be read.");
    });
    if (texts.length === 0) {
      throw new Error("No conversations.json was found in this ZIP file.");
    }
  } else {
    texts = [new TextDecoder().decode(bytes)];
  }

  const conversations: unknown[] = [];
  for (const text of texts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("This file is not valid JSON. Choose the export ZIP or its conversations.json.");
    }
    if (Array.isArray(parsed)) conversations.push(...parsed);
  }
  const sample = conversations.find((item) => item && typeof item === "object") as
    | Record<string, unknown>
    | undefined;
  if (!sample) throw new Error("No conversations were found in this file.");

  if ("chat_messages" in sample) {
    return { source: "Claude", chats: fromClaude(conversations as ClaudeConversation[]) };
  }
  if ("mapping" in sample) {
    return { source: "ChatGPT", chats: fromChatGpt(conversations as ChatGptConversation[]) };
  }
  throw new Error("This does not look like a Claude or ChatGPT export.");
}
