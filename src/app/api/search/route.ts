import { NextResponse } from "next/server";

// Tipos básicos
export type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata" | "cep" | "cpf" | "email_hibp" | "phone" | "clt_pis";

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

// CEP (ViaCEP)
function normalizeCep(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}
async function searchCEP(query: string): Promise<SearchItem[]> {
  const cep = normalizeCep(query);
  if (!/^\d{8}$/.test(cep)) return [];
  const url = `https://viacep.com.br/ws/${cep}/json/`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  const data = await res.json();
  if ((data as any)?.erro) {
    return [{
      title: "CEP não encontrado",
      description: `CEP ${cep} não localizado na base ViaCEP`,
      snippet: `CEP ${cep} não localizado na base ViaCEP`,
      url,
      source: "cep",
    }];
  }
  const uf = (data as any)?.uf;
  const loc = (data as any)?.localidade;
  const log = (data as any)?.logradouro;
  const bai = (data as any)?.bairro;
  const ibge = (data as any)?.ibge;
  const ddd = (data as any)?.ddd;
  const desc = [log, bai, loc && uf ? `${loc}-${uf}` : loc || uf].filter(Boolean).join(", ");
  return [{
    title: "Endereço encontrado",
    description: desc,
    snippet: desc,
    url,
    source: "cep",
    ibge,
    ddd,
    cep,
  }];
}

// CPF (validação)
function normalizeCpf(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}
function isCpfValid(cpf: string): boolean {
  const s = normalizeCpf(cpf);
  if (!/^\d{11}$/.test(s)) return false;
  if (/^([0-9])\1{10}$/.test(s)) return false; // todos iguais
  const nums = s.split("").map((d) => parseInt(d, 10));
  let sum1 = 0;
  for (let i = 0; i < 9; i++) sum1 += nums[i] * (10 - i);
  let d1 = 11 - (sum1 % 11);
  if (d1 >= 10) d1 = 0;
  let sum2 = 0;
  for (let i = 0; i < 10; i++) sum2 += nums[i] * (11 - i);
  let d2 = 11 - (sum2 % 11);
  if (d2 >= 10) d2 = 0;
  return d1 === nums[9] && d2 === nums[10];
}
function formatCpf(cpf: string): string {
  const s = normalizeCpf(cpf);
  if (!/^\d{11}$/.test(s)) return cpf;
  return `${s.slice(0,3)}.${s.slice(3,6)}.${s.slice(6,9)}-${s.slice(9)}`;
}
async function validateCPF(query: string): Promise<SearchItem[]> {
  const s = normalizeCpf(query);
  if (!/^\d{11}$/.test(s)) return [];
  const valid = isCpfValid(s);
  const title = valid ? "CPF válido" : "CPF inválido";
  const fmt = formatCpf(s);
  const snippet = valid ? `CPF ${fmt} válido conforme dígitos verificadores.` : `CPF ${fmt} inválido (dígitos verificadores não conferem).`;
  return [{ title, description: snippet, snippet, url: "https://www.gov.br/pt-br/servicos/validacao-de-documentos", source: "cpf", cpf: fmt, digits: s }];
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

// Email (HIBP)
async function searchHIBP(query: string): Promise<SearchItem[]> {
  const email = String(query).trim().toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return [];
  const apiKey = process.env.HIBP_API_KEY;
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`;
  if (!apiKey) {
    return [{ title: "HIBP não configurado", description: "Defina HIBP_API_KEY no ambiente", snippet: "HIBP_API_KEY ausente", url: "https://haveibeenpwned.com/API/v3", source: "email_hibp" }];
  }
  try {
    const res = await fetch(url, {
      headers: {
        "hibp-api-key": apiKey,
        "User-Agent": "InvestigaOSINT",
        Accept: "application/json",
      },
      next: { revalidate: 300 },
    });
    if (res.status === 404) {
      return [{ title: "Nenhum vazamento encontrado", description: `Email ${email} não consta em breaches (HIBP)`, snippet: `Sem vazamentos para ${email}`, url: "https://haveibeenpwned.com/", source: "email_hibp" }];
    }
    if (!res.ok) {
      return [{ title: `HIBP falhou (${res.status})`, description: "Erro ao consultar HIBP", snippet: `Falha HTTP ${res.status}`, url: url, source: "email_hibp" }];
    }
    const data: unknown = await res.json();
    const arr = Array.isArray(data) ? (data as any[]) : [];
    const items: SearchItem[] = arr.slice(0, 5).map((b: any) => ({
      title: b.Name || b.Title || "Breache",
      description: `Data: ${b.BreachDate || b.AddedDate || ""} — ${b.Domain || ""}`,
      snippet: b.Description ? String(b.Description).replace(/<[^>]+>/g, "").slice(0, 140) : undefined,
      url: b.Domain ? `https://${b.Domain}` : "https://haveibeenpwned.com/",
      source: "email_hibp",
      breach: b.Name,
    }));
    return items.length ? items : [{ title: "Possível vazamento", description: `HIBP retornou dados para ${email}`, snippet: "Consulte HIBP para detalhes", url: "https://haveibeenpwned.com/", source: "email_hibp" }];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return [{ title: "HIBP erro", description: msg, snippet: msg, url, source: "email_hibp" }];
  }
}

// Telefone (formatação BR)
function normalizePhoneBR(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}
async function formatPhoneBR(query: string): Promise<SearchItem[]> {
  const s = normalizePhoneBR(query);
  if (s.length < 10 || s.length > 11) return [];
  const ddd = s.slice(0, 2);
  const local = s.slice(2);
  const isCell = local.length === 9 && local.startsWith("9");
  const fmt = isCell ? `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}` : `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
  const e164 = `+55${s}`;
  return [{ title: "Telefone formatado", description: fmt, snippet: isCell ? "Celular" : "Fixo", url: `tel:${e164}`, source: "phone", ddd, e164 }];
}

// CLT (PIS/NIT validação)
function normalizePis(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}
function isPisValid(pis: string): boolean {
  const s = normalizePis(pis);
  if (!/^\d{11}$/.test(s)) return false;
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i], 10) * weights[i];
  let dv = 11 - (sum % 11);
  if (dv === 10 || dv === 11) dv = 0;
  return dv === parseInt(s[10], 10);
}
function formatPis(pis: string): string {
  const s = normalizePis(pis);
  if (!/^\d{11}$/.test(s)) return pis;
  return `${s.slice(0, 3)}.${s.slice(3, 8)}.${s.slice(8, 10)}-${s.slice(10)}`;
}
async function validatePIS(query: string): Promise<SearchItem[]> {
  const s = normalizePis(query);
  if (!/^\d{11}$/.test(s)) return [];
  const valid = isPisValid(s);
  const fmt = formatPis(s);
  const title = valid ? "PIS/NIT válido" : "PIS/NIT inválido";
  const desc = valid ? `CLT ${fmt} válido.` : `CLT ${fmt} inválido.`;
  return [{ title, description: desc, snippet: desc, url: "https://www.gov.br/pt-br/servicos", source: "clt_pis", pis: fmt }];
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
      } else if (p === "cep") {
        tasks.push(searchCEP(query));
        labels.push("cep");
      } else if (p === "cpf") {
        tasks.push(validateCPF(query));
        labels.push("cpf");
      } else if (p === "email_hibp") {
        tasks.push(searchHIBP(query));
        labels.push("email_hibp");
      } else if (p === "phone") {
        tasks.push(formatPhoneBR(query));
        labels.push("phone");
      } else if (p === "clt_pis") {
        tasks.push(validatePIS(query));
        labels.push("clt_pis");
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