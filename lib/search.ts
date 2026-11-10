/**
 * Web search for the model. Uses whichever provider has a key configured:
 * Brave (BRAVE_API_KEY) or Tavily (TAVILY_API_KEY). No key, no search.
 *
 * Search queries leave the encrypted path: they go to the provider in plaintext.
 */

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchProvider = { id: "brave" | "tavily"; name: string };

const MAX_RESULTS = 5;

export function searchProvider(): SearchProvider | null {
  if (process.env.BRAVE_API_KEY) return { id: "brave", name: "Brave Search" };
  if (process.env.TAVILY_API_KEY) return { id: "tavily", name: "Tavily" };
  return null;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalise(items: { title?: unknown; url?: unknown; snippet?: unknown }[]) {
  const results: SearchResult[] = [];
  for (const item of items) {
    if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) continue;
    results.push({
      title: clean(item.title, 160) || item.url,
      url: item.url,
      snippet: clean(item.snippet, 700),
    });
    if (results.length === MAX_RESULTS) break;
  }
  return results;
}

async function brave(query: string): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-subscription-token": process.env.BRAVE_API_KEY!,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Brave Search returned ${res.status}`);
  const body = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return normalise(
    (body.web?.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    })),
  );
}

async function tavily(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic" }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Tavily returned ${res.status}`);
  const body = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return normalise(
    (body.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content,
    })),
  );
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  const provider = searchProvider();
  if (!provider) throw new Error("no search provider configured");
  return provider.id === "brave" ? brave(query) : tavily(query);
}

/** What the model reads back from a search. */
export function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No web results were found for "${query}".`;
  return results
    .map(
      (result, index) =>
        `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.snippet}`,
    )
    .join("\n\n");
}

export const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current or factual information you are not certain of: news, recent events, prices, versions, people, places. Returns titles, URLs and text snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query, a few specific keywords." },
      },
      required: ["query"],
    },
  },
} as const;
