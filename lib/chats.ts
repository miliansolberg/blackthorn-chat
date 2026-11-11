/** Chat history, kept in this browser's localStorage only. */

import type { Attachment } from "./attachments";

export type SearchRecord = {
  query: string;
  status: "searching" | "done" | "failed";
  results: { title: string; url: string }[];
};
/** One step the app took while producing a reply; `at` is ms since it began. */
export type ActivityStep = { at: number; text: string };
export type Message = {
  role: "user" | "assistant";
  content: string;
  /** Web searches the assistant ran while writing this reply. */
  searches?: SearchRecord[];
  /** What the app did while writing this reply, for the activity view. */
  activity?: ActivityStep[];
  /** The model's reasoning, when a model sends it separately. */
  reasoning?: string;
  /** How long the reply took, in seconds. */
  seconds?: number;
  /** Files attached to a user message, already converted to text. */
  attachments?: Attachment[];
};
export type ChatRecord = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  /** Tokens of the context window used after the latest reply. */
  usage?: { used: number; window: number | null };
};

const LEGACY_CHATS_KEY = "blackthorn-chat:chats:v1";
const MODEL_KEY = "blackthorn-chat:model";
const DB_NAME = "blackthorn-chat";
const STORE = "chats";

function isMessage(value: unknown): value is Message {
  const message = value as Message;
  return (
    (message?.role === "user" || message?.role === "assistant") &&
    typeof message.content === "string"
  );
}

/** Drops anything that is not a usable chat, and half-written replies. */
function clean(records: unknown[]): ChatRecord[] {
  return records
    .filter(
      (chat): chat is ChatRecord =>
        typeof (chat as ChatRecord)?.id === "string" &&
        typeof (chat as ChatRecord).title === "string" &&
        typeof (chat as ChatRecord).updatedAt === "number" &&
        Array.isArray((chat as ChatRecord).messages) &&
        (chat as ChatRecord).messages.every(isMessage),
    )
    .map((chat) => {
      // A reply cut off by closing the page leaves an empty placeholder.
      const messages = [...chat.messages];
      while (messages.length && !messages[messages.length - 1].content) messages.pop();
      return { ...chat, messages };
    })
    .filter((chat) => chat.messages.length > 0);
}

/**
 * Chats live in IndexedDB, one record per chat. localStorage, used at first,
 * holds only about 5 MB, far too little for an imported history.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let database: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  database ??= openDatabase();
  database.catch(() => {
    database = null;
  });
  return database;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Chats saved by the first versions of the app, in localStorage. */
function legacyChats(): ChatRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_CHATS_KEY) ?? "[]");
    return Array.isArray(parsed) ? clean(parsed) : [];
  } catch {
    return [];
  }
}

let loading: Promise<ChatRecord[]> | null = null;

/** Reads the saved chats. Concurrent calls share one read (and one migration). */
export function loadChats(): Promise<ChatRecord[]> {
  loading ??= readChats();
  return loading;
}

async function readChats(): Promise<ChatRecord[]> {
  try {
    const connection = await db();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = connection.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const chats = clean(records);

    // One-time move of chats from localStorage.
    const legacy = legacyChats().filter((old) => !chats.some((chat) => chat.id === old.id));
    const moved = legacy.length === 0 || (await writeChats(legacy, []));
    chats.push(...legacy);
    if (moved) {
      try {
        localStorage.removeItem(LEGACY_CHATS_KEY);
      } catch {
        // ignore
      }
    }
    return chats;
  } catch {
    // IndexedDB is unavailable (some private windows): fall back to what
    // localStorage has; new chats then last for this visit only.
    return legacyChats();
  }
}

/** Saves the given chats and removes the given ids, in one transaction. */
export async function writeChats(changed: ChatRecord[], removedIds: string[]): Promise<boolean> {
  if (changed.length === 0 && removedIds.length === 0) return true;
  try {
    const connection = await db();
    const transaction = connection.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const chat of changed) store.put(chat);
    for (const id of removedIds) store.delete(id);
    await done(transaction);
    return true;
  } catch {
    // Storage is full or blocked: the chats still work for this visit.
    return false;
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
  const text = firstMessage.replace(/\s+/g, " ").trim() || "New chat";
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
