/** User settings, kept in this browser's localStorage. */

export type Theme = "dark" | "light";

/** Sampling settings sent with each message; null means "use the model's default". */
export type Sampling = {
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  repetitionPenalty: number | null;
};

/** A remote MCP server whose tools the model may use. */
export type Connector = {
  id: string;
  name: string;
  url: string;
  /** Optional bearer token sent to the connector. */
  token: string;
  enabled: boolean;
};

export type Settings = {
  theme: Theme;
  /** Whisper language code for dictation. */
  dictationLanguage: string;
  sampling: Sampling;
  connectors: Connector[];
};

export const MAX_CONNECTORS = 5;

/** The inline script in app/layout.tsx reads this key before first paint. */
export const THEME_KEY = "blackthorn-chat:theme";
const SETTINGS_KEY = "blackthorn-chat:settings";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  dictationLanguage: "en",
  sampling: { temperature: null, topP: null, topK: null, repetitionPenalty: null },
  connectors: [],
};

function numberOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    const sampling = (raw.sampling ?? {}) as Partial<Sampling>;
    return {
      theme: localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark",
      dictationLanguage:
        typeof raw.dictationLanguage === "string" ? raw.dictationLanguage : "en",
      sampling: {
        temperature: numberOrNull(sampling.temperature, 0, 2),
        topP: numberOrNull(sampling.topP, 0.01, 1),
        topK: numberOrNull(sampling.topK, 1, 500),
        repetitionPenalty: numberOrNull(sampling.repetitionPenalty, 1, 2),
      },
      connectors: Array.isArray(raw.connectors)
        ? raw.connectors
            .filter(
              (item): item is Connector =>
                typeof item?.id === "string" &&
                typeof item.name === "string" &&
                typeof item.url === "string",
            )
            .slice(0, MAX_CONNECTORS)
            .map((item) => ({
              id: item.id,
              name: item.name,
              url: item.url,
              token: typeof item.token === "string" ? item.token : "",
              enabled: item.enabled !== false,
            }))
        : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    const { theme, ...rest } = settings;
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  } catch {
    // Storage is blocked: the settings still apply for this visit.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function newConnector(name: string, url: string, token: string): Connector {
  return { id: crypto.randomUUID(), name, url, token, enabled: true };
}
