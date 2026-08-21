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

const MAX_RESULTS = 4;
const MAX_PAGE_TEXT_LENGTH = 100_000;
// Hard cap on the per-result page text we return to the model. Web-search
// results are injected as a tool result; free-tier models (e.g. nemotron-3)
// have very small context windows and return an EMPTY completion when the
// prompt is oversized. Capping content keeps the tool result within budget
// so the model actually answers instead of yielding "no text token".
const MAX_RESULT_CONTENT_LENGTH = 4_000;

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

// --- NEW: Serper Scrape API for fetching full page content ---
async function scrapeSerperPage(url: string, apiKey: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://scrape.serper.dev", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        includeMarkdown: false, // we just want the plain text
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`Serper Scrape API returned ${response.status} for ${url}`);
      return undefined;
    }

    const data = await response.json();
    // API returns { text, markdown, metadata, jsonld }
    const text = data.text || data.markdown;
    return text ? text.slice(0, MAX_PAGE_TEXT_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

// --- NEW: Batch scrape top 3 results using Serper Scrape API ---
async function scrapeTopResultsWithSerper(results: SearchResult[], apiKey: string): Promise<SearchResult[]> {
  const topResults = results.slice(0, 3); // top 3 only
  const scraped = await Promise.all(
    topResults.map(async (result) => {
      if (!result.url) return { ...result, content: undefined };
      const content = await scrapeSerperPage(result.url, apiKey);
      return { ...result, content };
    })
  );
  // Return merged: scraped top 3 + untouched rest
  return [...scraped, ...results.slice(3)];
}

// --- Serper Search ---
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
// DuckDuckGo is the primary (zero-cost, no API key) search source; Serper is
// kept as a fallback for when DDG is rate-limited or returns nothing.
export async function searchDuckDuckGo(query: string, serperApiKey?: string): Promise<SearchResult[]> {
  const ddgResults = await searchDuckDuckGoHtml(query);
  if (ddgResults.length > 0) {
    return ddgResults;
  }
  return searchSerper(query, serperApiKey);
}

/**
 * Finds the best search results and retrieves their readable page text.
 * Uses Serper Scrape API for top 3 results, falls back to raw HTML fetch for the rest.
 */
export async function searchWithPageContent(query: string, serperApiKey?: string): Promise<SearchResult[]> {
  const apiKey = serperApiKey || process.env.SERPER_API_KEY;
  const results = await searchDuckDuckGo(query, serperApiKey);

  const capContent = (r: SearchResult): SearchResult => ({
    ...r,
    content: r.content && r.content.length > MAX_RESULT_CONTENT_LENGTH
      ? r.content.slice(0, MAX_RESULT_CONTENT_LENGTH)
      : r.content,
  });

  if (apiKey && results.some(r => r.url)) {
    // Use Serper Scrape for top 3 results with URLs
    const withSerperScraped = await scrapeTopResultsWithSerper(results, apiKey);
    // For remaining results with URLs (beyond top 3), fall back to raw fetch
    const remaining = withSerperScraped.slice(3);
    const remainingWithContent = await Promise.all(
      remaining.map((result) =>
        result.url ? fetchPageContent(result.url) : Promise.resolve(undefined)
      )
    );
    return [
      ...withSerperScraped.slice(0, 3).map(capContent),
      ...remaining.map((result, index) => ({
        ...result,
        content: remainingWithContent[index] ?? result.content,
      })).map(capContent),
    ];
  }

  // No Serper API key or no URLs - fall back to raw HTML fetch for all
  const content = await Promise.all(
    results.map((result) =>
      result.url ? fetchPageContent(result.url) : Promise.resolve(undefined)
    )
  );

  return results.map((result, index) => ({ ...result, content: content[index] })).map(capContent);
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
