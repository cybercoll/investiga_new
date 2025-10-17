import { NextResponse } from "next/server";

// Tipos básicos
export type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata";

type SearchItem = {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
  source: Provider;
  [key: string]: unknown;
};

// Implementações de provedores gratuitos
async function searchWikipedia(query: string): Promise<SearchItem[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=5&utf8=1`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  const data: unknown = await res.json();
  const search = (data as { query?: { search?: { title: string; snippet?: string }[] } }).query?.search || [];
  const items: SearchItem[] = search.map((i: { title: string; snippet?: string }) => ({
    title: i.title,
    description: i.snippet?.replace(/<[^>]+>/g, ""),
    snippet: i.snippet?.replace(/<[^>]+>/g, ""),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(i.title)}`,
    source: "wikipedia",
  }));
  return items;
}

async function searchDuckDuckGo(query: string): Promise<SearchItem[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
    query
  )}&format=json&no_redirect=1&no_html=1`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  const data: unknown = await res.json();
  const rt = (data as { RelatedTopics?: { Text?: string; FirstURL?: string }[] }).RelatedTopics || [];
  const items: SearchItem[] = rt
    .filter((t: { Text?: string }) => !!t?.Text)
    .slice(0, 5)
    .map((t: { Text?: string; FirstURL?: string }) => ({
      title: t.Text,
      description: t.Text,
      snippet: t.Text,
      url: t.FirstURL,
      source: "duckduckgo",
    }));
  // Fallback com AbstractText se existir
  const ddg = data as { Heading?: string; AbstractText?: string; AbstractURL?: string };
  if (!items.length && ddg?.AbstractText) {
    items.push({
      title: ddg.Heading || query,
      description: ddg.AbstractText,
      snippet: ddg.AbstractText,
      url: ddg.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      source: "duckduckgo",
    });
  }
  return items;
}

async function searchGitHub(query: string): Promise<SearchItem[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    query
  )}&per_page=5`;
  const res = await fetch(url, { headers });
  const data: unknown = await res.json();
  const repos = (data as { items?: { full_name: string; description?: string; html_url: string; stargazers_count?: number }[] }).items || [];
  const items: SearchItem[] = repos.map((repo) => ({
    title: repo.full_name,
    description: repo.description || "",
    snippet: repo.description || "",
    url: repo.html_url,
    stars: repo.stargazers_count,
    source: "github",
  }));
  return items;
}

// Direct Data (API paga): integração genérica com headers configuráveis
async function searchDirectData(query: string): Promise<SearchItem[]> {
  const apiKey = process.env.DIRECT_DATA_API_KEY;
  const baseUrl = process.env.DIRECT_DATA_BASE_URL;
  const authHeader = process.env.DIRECT_DATA_AUTH_HEADER || "X-API-Key";
  const authScheme = process.env.DIRECT_DATA_AUTH_SCHEME || "";

  if (!apiKey || !baseUrl) {
    return [{ error: "Direct Data não configurado", source: "directdata" } as SearchItem];
  }

  const url = `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&limit=5`;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (authHeader.toLowerCase() === "authorization") {
    headers["Authorization"] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
  } else {
    headers[authHeader] = apiKey;
  }

  try {
    const res = await fetch(url, { headers, next: { revalidate: 30 } });
    if (!res.ok) {
      return [{ error: `Direct Data HTTP ${res.status}`, source: "directdata" } as SearchItem];
    }
    const data: unknown = await res.json();

    // Normalização genérica
    let rawItems: unknown[] = [];
    if (Array.isArray(data)) rawItems = data as unknown[];
    else if (Array.isArray((data as { items?: unknown[] }).items)) rawItems = (data as { items?: unknown[] }).items!;
    else if (Array.isArray((data as { results?: unknown[] }).results)) rawItems = (data as { results?: unknown[] }).results!;
    else if (Array.isArray((data as { data?: unknown[] }).data)) rawItems = (data as { data?: unknown[] }).data!;
    else rawItems = [data as unknown];

    const items: SearchItem[] = rawItems.slice(0, 5).map((it) => {
      const obj = it as Record<string, unknown>;
      const title = typeof obj.title === "string"
        ? obj.title
        : typeof obj.name === "string"
        ? obj.name
        : typeof obj.heading === "string"
        ? obj.heading
        : query;
      const snippet = typeof obj.snippet === "string"
        ? obj.snippet
        : typeof obj.description === "string"
        ? obj.description
        : typeof obj.summary === "string"
        ? obj.summary
        : "";
      const url = typeof obj.url === "string"
        ? obj.url
        : typeof obj.link === "string"
        ? obj.link
        : "";
      return {
        title,
        description: snippet,
        snippet,
        url,
        source: "directdata",
        raw: obj,
      } as SearchItem;
    });
    return items;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "erro";
    return [{ error: `Direct Data falhou: ${msg}`, source: "directdata" } as SearchItem];
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim();
    const providers: Provider[] = Array.isArray(body?.providers)
      ? body.providers
      : ["wikipedia", "duckduckgo", "github"];

    if (!query) {
      return NextResponse.json(
        { error: "Query ausente" },
        { status: 400 }
      );
    }

    const tasks: Promise<SearchItem[]>[] = [];
    const labels: string[] = [];

    for (const p of providers) {
      if (p === "wikipedia") {
        tasks.push(searchWikipedia(query));
        labels.push("wikipedia");
      } else if (p === "duckduckgo") {
        tasks.push(searchDuckDuckGo(query));
        labels.push("duckduckgo");
      } else if (p === "github") {
        tasks.push(searchGitHub(query));
        labels.push("github");
      } else if (p === "directdata") {
        tasks.push(searchDirectData(query));
        labels.push("directdata");
      }
    }

    const results = await Promise.all(tasks);
    const aggregated: Record<string, SearchItem[]> = {};
    results.forEach((r, idx) => {
      aggregated[labels[idx]] = r;
    });

    return NextResponse.json({ query, results: aggregated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}