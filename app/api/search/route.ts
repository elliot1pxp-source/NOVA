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
  Referer: "https://duckduckgo.com/",
};

const MAX_RESULTS = 5;
// This is deliberately large enough to give the model the article's actual
// context, while preventing one unusually large page from crowding out every
// other source or exceeding the model request limit.
const MAX_PAGE_TEXT_LENGTH = 100_000;

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
      // These sections are not article context and frequently account for the
      // majority of a page's markup.
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
    // A failed, blocked, or non-HTML source should not prevent the answer.
    return undefined;
  }
}

function resolveDuckDuckGoUrl(rawHref: string): string {
  try {
    const href = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return href;
  } catch {
    return rawHref;
  }
}

/**
 * DuckDuckGo's Instant Answer API — good for quick facts / definitions,
 * but returns nothing for most "news"-style or general queries.
 */
async function fetchInstantAnswer(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
    query
  )}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];

  const data = await res.json();
  const results: SearchResult[] = [];

  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      snippet: data.AbstractText,
      url: data.AbstractURL || undefined,
    });
  }

  if (data.Answer) {
    results.push({ title: "Answer", snippet: String(data.Answer) });
  }

  if (data.Definition) {
    results.push({
      title: "Definition",
      snippet: data.Definition,
      url: data.DefinitionURL || undefined,
    });
  }

  const flattenTopics = (topics: any[]) => {
    for (const t of topics ?? []) {
      if (t.Text) {
        results.push({
          title: t.Text.split(" - ")[0]?.slice(0, 60) ?? "Related",
                     snippet: t.Text,
                     url: t.FirstURL,
        });
      } else if (Array.isArray(t.Topics)) {
        flattenTopics(t.Topics);
      }
    }
  };
  flattenTopics(data.RelatedTopics);

  return results;
}

/**
 * DuckDuckGo's HTML search (no API key / signup) — this is the endpoint
 * that actually returns real organic results (news, articles, etc.),
 * unlike the Instant Answer API above which only covers infobox facts.
 * Note: scraping an HTML page is inherently a bit fragile (DDG can change
 * markup or rate-limit), but it requires no key and works for real queries.
 */
function parseDuckDuckGoHtmlSearch(html: string): SearchResult[] {
  const resultRegex = new RegExp(
    `<h2[^>]*class=["'][^"']*\bresult__title\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<div[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/div>|<a[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>)`,
    "gi"
  );

  const results: SearchResult[] = [];
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null) {
    const href = match[1];
    const title = stripHtml(match[2]);
    const snippet = stripHtml(match[3] || match[4] || "");
    const url = resolveDuckDuckGoUrl(href);
    if (title) {
      results.push({ title, snippet, url });
    }
  }

  if (results.length > 0) {
    return results;
  }

  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<(?:a|div)[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/gi;

  const titles: Array<{ title: string; url: string }> = [];
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const title = stripHtml(match[2]);
    const url = resolveDuckDuckGoUrl(href);
    if (title) {
      titles.push({ title, url });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]));
  }

  return titles.map((titleItem, index) => ({
    ...titleItem,
    snippet: snippets[index] ?? "",
  }));
}
async function fetchWebResults(query: string): Promise<SearchResult[]> {
  const urls = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    `https://duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: DEFAULT_FETCH_HEADERS,
      });
      if (!res.ok) {
        continue;
      }

      const html = await res.text();
      const results = parseDuckDuckGoHtmlSearch(html);
      if (results.length > 0) {
        return results;
      }
    } catch {
      continue;
    }
  }

  return [];
}
export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const [instant, web] = await Promise.allSettled([
    fetchInstantAnswer(query),
                                                  fetchWebResults(query),
  ]);

  const instantResults = instant.status === "fulfilled" ? instant.value : [];
  const webResults = web.status === "fulfilled" ? web.value : [];

  // Organic web results are the sources we can retrieve and analyse. Keep
  // Instant Answer items as a fallback, rather than letting them displace the
  // top pages for a query.
  const combined = [...webResults, ...instantResults];
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const r of combined) {
    const key = (r.url || r.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return deduped.slice(0, MAX_RESULTS);
}

/**
 * Finds the five best search results and retrieves their readable page text.
 * The chat route uses this rather than asking the model to reason from just a
 * title and a search-engine snippet.
 */
export async function searchWithPageContent(query: string): Promise<SearchResult[]> {
  const results = await searchDuckDuckGo(query);
  const content = await Promise.all(results.map((result) =>
    result.url ? fetchPageContent(result.url) : Promise.resolve(undefined)
  ));

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
