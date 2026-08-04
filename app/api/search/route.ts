import { NextResponse } from "next/server";

export const maxDuration = 20;

export type SearchResult = {
  title: string;
  snippet: string;
  url?: string;
  /** Readable text retrieved from the result page for the model only. */
  content?: string;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MAX_RESULTS = 11;
const MAX_PAGE_TEXT_LENGTH = 100_000;

// --- HTML stripping (unchanged) ---
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function pageHtmlToText(html: string): string {
  return stripHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
  );
}

async function fetchPageContent(url: string): Promise<string | undefined> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;

    const response = await fetch(url, {
      headers: {
        ...DEFAULT_FETCH_HEADERS,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return undefined;
    }

    const text = pageHtmlToText(await response.text());
    return text ? text.slice(0, MAX_PAGE_TEXT_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

// --- NEW: Serper.dev search function ---
async function searchSerper(query: string, customApiKey?: string): Promise<SearchResult[]> {
  const apiKey = customApiKey || process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.error("SERPER_API_KEY is not set in environment variables");
    return [];
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: MAX_RESULTS,
      }),
    });

    if (!response.ok) {
      console.error(`Serper API returned ${response.status}: ${await response.text()}`);
      return [];
    }

    const data = await response.json();
    const organicResults = data.organic || data.organic_results || [];
    return organicResults.slice(0, MAX_RESULTS).map((result: any) => ({
      title: result.title || "Untitled",
      snippet: result.snippet || result.description || "",
      url: result.link || result.url || undefined,
    }));
  } catch (error) {
    console.error("Serper API fetch failed:", error);
    return [];
  }
}

async function searchDuckDuckGoHtml(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query }).toString()}`,
      {
        headers: {
          ...DEFAULT_FETCH_HEADERS,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }
    );

    if (!response.ok) {
      console.error(`DuckDuckGo HTML search returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const results: SearchResult[] = [];
    const snippetMatches = Array.from(html.matchAll(snippetRegex));
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) && results.length < MAX_RESULTS) {
      const url = decodeHtml(match[1]);
      const title = stripHtml(match[2]);
      const snippet = snippetMatches[results.length]?.[1]
        ? stripHtml(snippetMatches[results.length][1])
        : "";
      results.push({ title: title || "Untitled", snippet, url });
    }

    return results;
  } catch (error) {
    console.error("DuckDuckGo HTML search failed:", error);
    return [];
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

// --- Replace search function ---
export async function searchDuckDuckGo(query: string, serperApiKey?: string): Promise<SearchResult[]> {
  const serperResults = await searchSerper(query, serperApiKey);
  if (serperResults.length > 0) {
    return serperResults;
  }
  return searchDuckDuckGoHtml(query);
}

/**
 * Finds the five best search results and retrieves their readable page text.
 */
export async function searchWithPageContent(query: string, serperApiKey?: string): Promise<SearchResult[]> {
  const results = await searchDuckDuckGo(query, serperApiKey);
  const content = await Promise.all(
    results.map((result) =>
      result.url ? fetchPageContent(result.url) : Promise.resolve(undefined)
    )
  );

  return results.map((result, index) => ({ ...result, content: content[index] }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) {
    return NextResponse.json({ results: [] });
  }
  const results = await searchDuckDuckGo(q);
  return NextResponse.json({ results });
}
