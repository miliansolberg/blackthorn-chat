/** Chat history, kept in this browser's localStorage only. */

export type SearchRecord = {
  query: string;
  status: "searching" | "done" | "failed";
  results: { title: string; url: string }[];
};
export type Message = {
  role: "user" | "assistant";
  content: string;
  /** Web searches the assistant ran while writing this reply. */
  searches?: SearchRecord[];
};
export type ChatRecord = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

const CHATS_KEY = "blackthorn-chat:chats:v1";
const MODEL_KEY = "blackthorn-chat:model";

function isMessage(value: unknown): value is Message {
  const message = value as Message;
  return (
    (message?.role === "user" || message?.role === "assistant") &&
    typeof message.content === "string"
  );
}

export function loadChats(): ChatRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (chat): chat is ChatRecord =>
          typeof chat?.id === "string" &&
          typeof chat.title === "string" &&
          typeof chat.updatedAt === "number" &&
          Array.isArray(chat.messages) &&
          chat.messages.every(isMessage),
      )
      .map((chat) => {
        // A reply cut off by closing the page leaves an empty placeholder.
        const messages = [...chat.messages];
        while (messages.length && !messages[messages.length - 1].content) messages.pop();
        return { ...chat, messages };
      })
      .filter((chat) => chat.messages.length > 0);
  } catch {
    return [];
  }
}

export function saveChats(chats: ChatRecord[]): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    // Storage is full or blocked: the chats still work for this visit.
  }
}

export function loadModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export function saveModel(id: string): void {
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    // ignore
  }
}

export function createChat(firstMessage: string): ChatRecord {
  const text = firstMessage.replace(/\s+/g, " ").trim();
  return {
    id: crypto.randomUUID(),
    title: text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text,
    messages: [],
    updatedAt: Date.now(),
  };
}

export function touched(chat: ChatRecord, messages: Message[]): ChatRecord {
  return { ...chat, messages, updatedAt: Date.now() };
}

const SEARCH_KEY = "blackthorn-chat:search";

/** Web search is on unless the user switched it off. */
export function loadSearchEnabled(): boolean {
  try {
    return localStorage.getItem(SEARCH_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SEARCH_KEY, enabled ? "on" : "off");
  } catch {
    // ignore
  }
}
