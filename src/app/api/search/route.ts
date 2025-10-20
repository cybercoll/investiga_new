import { NextResponse } from "next/server";
import crypto from "crypto";

// Tipos básicos
export type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata" | "cep" | "cpf" | "email_hibp" | "phone" | "phone_portabilidade" | "clt_pis" | "email_rep" | "gravatar" | "ddd_brasilapi" | "ddd_apibrasil" | "clearbit_logo" | "email_hunter" | "cnpj" | "datajud";

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
  const url = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=5&utf8=1`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  const data: unknown = await res.json();
  const search = (data as { query?: { search?: { title: string; snippet?: string }[] } }).query?.search || [];
  const items: SearchItem[] = search.map((i: { title: string; snippet?: string }) => ({
    title: i.title,
    description: i.snippet?.replace(/<[^>]+>/g, ""),
    snippet: i.snippet?.replace(/<[^>]+>/g, ""),
    url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(i.title)}`,
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
      url: t.FirstURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
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
  const fmt = formatCpf(s);

  try {
    const ddItems = await searchDirectData(s);
    const enriched = ddItems.find((it: any) => !!(it?.raw?.Cpf || it?.cpf)) || ddItems[0];

    if (!enriched || (enriched as any).not_found === true) {
      const status = valid ? "Válido" : "Inválido";
      const desc = process.env.DIRECT_DATA_API_KEY
        ? `CPF ${fmt} — ${status} • sem dados DirectData`
        : `CPF ${fmt} — ${status} • validação local (DirectData não configurado)`;
      return [{
        title: `CPF ${fmt}`,
        description: desc,
        snippet: desc,
        url: "https://www.gov.br/pt-br/servicos",
        source: "cpf",
        cpf: fmt,
        digits: s,
        valid,
      } as SearchItem];
    }

    const desc = (enriched as any).description || (enriched as any).snippet || "";
    const item: SearchItem = {
      title: (enriched as any).title || `CPF ${fmt}`,
      description: desc,
      snippet: desc,
      url: (enriched as any).url || "https://apiv3.directd.com.br/api/RegistrationDataBrazil",
      source: "cpf",
      cpf: fmt,
      digits: s,
      raw: (enriched as any).raw || (enriched as any),
      valid,
    } as SearchItem;
    if ((enriched as any).cep) (item as any).cep = (enriched as any).cep;
    if ((enriched as any).ddd) (item as any).ddd = (enriched as any).ddd;
    if ((enriched as any).phone) (item as any).phone = (enriched as any).phone;

    return [item];
  } catch (e: unknown) {
    const errMsg = "Falha ao consultar DirectData v3 para CPF.";
    return [{
      title: `CPF ${fmt}`,
      description: errMsg,
      snippet: errMsg,
      url: "https://apiv3.directd.com.br/api/RegistrationDataBrazil",
      source: "cpf",
      cpf: fmt,
      digits: s,
      error: String((e as any)?.message || e),
      valid,
    } as SearchItem];
  }
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
  const res = await fetch(url, { headers, next: { revalidate: 60 } });
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

async function searchDatajud(query: string): Promise<SearchItem[]> {
  const name = String(query || "").trim();
  if (!name) return [];
  const base = process.env.DATAJUD_BASE_URL || "";
  const token = process.env.DATAJUD_TOKEN || process.env.DATAJUD_API_KEY || "";
  if (!base) {
    const desc = token ? "Base Datajud ausente" : "Datajud não configurado";
    return [{
      title: `Consulta CNJ por nome`,
      description: desc,
      snippet: desc,
      url: "https://www.cnj.jus.br/pesquisas-judiciais/",
      source: "datajud",
      query: name,
      not_configured: true,
    } as SearchItem];
  }
  const baseTrim = base.trim().replace(/\/+$/, "");
  // Detect CNJ aliases: if base includes alias or ends with _search, use POST
  const isAlias = /api_publica_/i.test(baseTrim);
  const endsWithSearch = /\/_search$/i.test(baseTrim);
  const usePost = isAlias || endsWithSearch;
  const url = usePost
    ? (endsWithSearch ? baseTrim : `${baseTrim}/_search`)
    : `${baseTrim}/search?nome=${encodeURIComponent(name)}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = (process.env.DATAJUD_AUTH_HEADER || "Authorization").toLowerCase();
  const authScheme = (process.env.DATAJUD_AUTH_SCHEME || "Bearer").trim();
  if (token) {
    if (authHeader === "authorization") headers["Authorization"] = authScheme ? `${authScheme} ${token}` : token;
    else headers[process.env.DATAJUD_AUTH_HEADER || "X-API-Key"] = token;
  }
  try {
    let options: RequestInit & { next?: { revalidate?: number } } = { headers, next: { revalidate: 300 } };
    if (usePost) {
      options = {
        ...options,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" } as any,
        body: JSON.stringify({
          size: 5,
          query: { query_string: { query: name } },
          _source: ["numero", "numeroProcesso", "partes", "parties", "classeProcessual", "assuntos", "movimentos", "url"],
        }),
      };
    }
    let res = await fetch(url, options);
    let data: any;
    if (!res.ok && usePost) {
      // Fallback: tentar GET com query param 'q'
      const getUrl = url.includes("?") ? url : `${url}?q=${encodeURIComponent(name)}`;
      const resGet = await fetch(getUrl, { headers, next: { revalidate: 300 } });
      if (!resGet.ok) throw new Error(`HTTP ${res.status}`);
      data = await resGet.json();
    } else {
      data = await res.json();
    }
    let arr: any[] = [];
    if (Array.isArray(data)) arr = data;
    else if (Array.isArray(data?.items)) arr = data.items;
    else if (data?.hits?.hits && Array.isArray(data.hits.hits)) {
      arr = data.hits.hits.map((h: any) => h?._source || (h as any).source || h);
    } else if (data?._source || data?.source) {
      arr = [data._source || data.source];
    } else {
      arr = [data];
    }
    const items: SearchItem[] = arr.slice(0, 5).map((row: any) => {
      const partesArr = Array.isArray(row?.partes)
        ? row.partes
        : Array.isArray(row?.parties)
        ? row.parties
        : [];
      const partes = partesArr
        .map((x: any) => (typeof x === "string" ? x : (x?.nome || x?.name)))
        .map((s: any) => String(s || "").trim())
        .filter(Boolean);
      const uniq = Array.from(new Set(partes));
      const title = row?.numero || row?.numeroProcesso || row?.id ? `Processo ${row?.numero || row?.numeroProcesso || row?.id}` : `Resultado Datajud`;
      const desc = uniq.length ? `Partes: ${uniq.join(", ")}` : "Sem partes disponíveis";
      const searchPage = "https://www.cnj.jus.br/pesquisas-judiciais/";
      const urlItem = (row?.url && /^https?:\/\//i.test(String(row?.url))) ? row.url : (!usePost ? url : searchPage);
      return {
        title,
        description: desc,
        snippet: desc,
        url: urlItem,
        source: "datajud",
        raw: row,
        partes: uniq,
      } as SearchItem;
    });
    return items;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const desc = `Falha ao consultar Datajud: ${msg}`;
    return [{ title: "Datajud erro", description: desc, snippet: desc, url, source: "datajud", error: msg } as SearchItem];
  }
}

// Direct Data (API paga): integração por tipo com heurísticas e headers configuráveis
async function searchDirectData(query: string): Promise<SearchItem[]> {
  const apiKey = process.env.DIRECT_DATA_API_KEY;
  const baseUrl = process.env.DIRECT_DATA_BASE_URL;
  const authHeader = process.env.DIRECT_DATA_AUTH_HEADER || "X-API-Key";
  const authScheme = (process.env.DIRECT_DATA_AUTH_SCHEME || "").trim();
  const authQueryParamEnv = (process.env.DIRECT_DATA_AUTH_QUERY_PARAM || "").trim().toUpperCase();
  const baseUrlIsV3 = !!(baseUrl && /apiv3\.directd\.com\.br/i.test(baseUrl));
  const isAPIV3 = baseUrlIsV3 || authQueryParamEnv === "TOKEN";
  const authQueryParam = isAPIV3 ? "TOKEN" : "";
  const effectiveBaseUrl = isAPIV3 ? "https://apiv3.directd.com.br" : (baseUrl || "");
  const q = String(query).trim();
  const digits = q.replace(/[^0-9]/g, "");
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const isEmail = emailRe.test(q);
  const isCpf = isCpfValid(digits);
  const isPhone = /^\d{10,11}$/.test(digits) && !isCpf;
  const isPis = (typeof isPisValid === "function") ? isPisValid(digits) : false;
  const isCnh = /^\d{11}$/.test(digits) && !isCpf && !isPis;
  const isRg = /^\d{7,10}$/.test(digits) && !isCpf && !isPis;
  const isName = !isEmail && !isPhone && !/^\d+$/.test(digits);

  // Endpoints configuráveis
  const emailEndpoint = process.env.DIRECT_DATA_EMAIL_ENDPOINT || "/enrich/email";
  const phoneEndpoint = process.env.DIRECT_DATA_PHONE_ENDPOINT || "/enrich/phone";
  const idEndpoint = process.env.DIRECT_DATA_ID_ENDPOINT || (isAPIV3 ? "/api/RegistrationDataBrazil" : "/enrich/id");
  const nameEndpoint = process.env.DIRECT_DATA_NAME_ENDPOINT || "/enrich/name";
  const searchEndpoint = process.env.DIRECT_DATA_SEARCH_ENDPOINT || "/search";
  // Métodos configuráveis por tipo
  const emailMethodEnv = (process.env.DIRECT_DATA_EMAIL_METHOD || "POST").toUpperCase();
  const phoneMethodEnv = (process.env.DIRECT_DATA_PHONE_METHOD || "POST").toUpperCase();
  const idMethodEnv = (process.env.DIRECT_DATA_ID_METHOD || (isAPIV3 ? "GET" : "POST")).toUpperCase();
  const nameMethodEnv = (process.env.DIRECT_DATA_NAME_METHOD || "POST").toUpperCase();
  const searchMethodEnv = (process.env.DIRECT_DATA_SEARCH_METHOD || "GET").toUpperCase();
  // Nomes de parâmetros configuráveis (GET/POST)
  const emailGetParam = process.env.DIRECT_DATA_EMAIL_GET_PARAM || "q";
  const phoneGetParam = process.env.DIRECT_DATA_PHONE_GET_PARAM || "q";
  const idGetParam = process.env.DIRECT_DATA_ID_GET_PARAM || (isAPIV3 ? "cpf" : "q");
  const nameGetParam = process.env.DIRECT_DATA_NAME_GET_PARAM || "q";
  const searchGetParam = process.env.DIRECT_DATA_SEARCH_GET_PARAM || "q";
  const emailPostField = process.env.DIRECT_DATA_EMAIL_POST_FIELD || "query";
  const phonePostField = process.env.DIRECT_DATA_PHONE_POST_FIELD || "query";
  const idPostField = process.env.DIRECT_DATA_ID_POST_FIELD || "query";
  const namePostField = process.env.DIRECT_DATA_NAME_POST_FIELD || "query";
  const searchPostField = process.env.DIRECT_DATA_SEARCH_POST_FIELD || "query";
  const idKindParam = process.env.DIRECT_DATA_ID_KIND_PARAM || (isAPIV3 ? "" : "kind");
  const idKindPostField = process.env.DIRECT_DATA_ID_KIND_POST_FIELD || (isAPIV3 ? "" : "kind");

  let endpoint = searchEndpoint;
  let method: "GET" | "POST" = "GET";
  let body: Record<string, unknown> | null = null;
  let kind: string | null = null;
  let qForGet: string = q;
  let queryParamName = searchGetParam;
  let postField = searchPostField;
  let kindParamName = idKindParam;
  let kindPostField = idKindPostField;
  if (isEmail) {
    endpoint = emailEndpoint;
    method = emailMethodEnv === "GET" ? "GET" : "POST";
    if (method === "POST") {
      postField = emailPostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = q;
      body = obj;
    } else {
      queryParamName = emailGetParam;
    }
  } else if ((isPhone || /^55\d{10,11}$/.test(digits)) && !isCpf) {
    endpoint = phoneEndpoint;
    method = phoneMethodEnv === "GET" ? "GET" : "POST";
    let local = digits;
    if (local.startsWith("55") && local.length >= 12) local = local.slice(2);
    const e164 = `+55${local}`;
    if (method === "POST") {
      postField = phonePostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = e164;
      body = obj;
    } else {
      queryParamName = phoneGetParam;
      qForGet = e164;
    }
  } else if (isCpf) {
    endpoint = idEndpoint;
    method = idMethodEnv === "GET" ? "GET" : "POST";
    kind = "cpf";
    if (method === "POST") {
      postField = idPostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = digits;
      obj[kindPostField] = kind;
      body = obj;
    } else {
      queryParamName = idGetParam;
      kindParamName = idKindParam;
    }
  } else if (isPis) {
    endpoint = idEndpoint;
    method = idMethodEnv === "GET" ? "GET" : "POST";
    kind = "pis";
    if (method === "POST") {
      postField = idPostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = digits;
      obj[kindPostField] = kind;
      body = obj;
    } else {
      queryParamName = idGetParam;
      kindParamName = idKindParam;
    }
  } else if (isCnh) {
    endpoint = idEndpoint;
    method = idMethodEnv === "GET" ? "GET" : "POST";
    kind = "cnh";
    if (method === "POST") {
      postField = idPostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = digits;
      obj[kindPostField] = kind;
      body = obj;
    } else {
      queryParamName = idGetParam;
      kindParamName = idKindParam;
    }
  } else if (isRg) {
    endpoint = idEndpoint;
    method = idMethodEnv === "GET" ? "GET" : "POST";
    kind = "rg";
    if (method === "POST") {
      postField = idPostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = digits;
      obj[kindPostField] = kind;
      body = obj;
    } else {
      queryParamName = idGetParam;
      kindParamName = idKindParam;
    }
  } else if (isName) {
    endpoint = nameEndpoint;
    method = nameMethodEnv === "GET" ? "GET" : "POST";
    if (method === "POST") {
      postField = namePostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = q;
      body = obj;
    } else {
      queryParamName = nameGetParam;
    }
  } else {
    endpoint = searchEndpoint;
    method = searchMethodEnv === "POST" ? "POST" : "GET";
    if (method === "POST") {
      postField = searchPostField;
      const obj: Record<string, unknown> = {};
      obj[postField] = q;
      obj["limit"] = 5;
      body = obj;
    } else {
      queryParamName = searchGetParam;
    }
  }
  // Force API v3 semantics for ID endpoints (CPF/PIS/RG/CNH)
  if (isAPIV3 && endpoint === idEndpoint) {
    method = "GET";
    kindParamName = "";
    kindPostField = "";
  }
  const base = effectiveBaseUrl.replace(/\/$/, "");
  let url = `${base}${endpoint}`;
  const headers: Record<string, string> = { Accept: "application/json" };

  const safeApiKey = apiKey || "";
  const safeAuthScheme = (authScheme || "").trim();
  if (!authQueryParam) {
    if (authHeader.toLowerCase() === "authorization") {
      headers["Authorization"] = safeAuthScheme ? `${safeAuthScheme} ${safeApiKey}` : safeApiKey;
    } else {
      headers[authHeader] = safeApiKey;
    }
  }

  const options: RequestInit & { next?: { revalidate?: number } } = { headers, next: { revalidate: 30 } };
  if (method === "POST") {
    options.method = "POST";
    options.headers = { ...headers, "Content-Type": "application/json" } as any;
    options.body = JSON.stringify(body || { [postField]: q });
    if (authQueryParam) {
      const authParams = new URLSearchParams();
      authParams.set(authQueryParam, safeApiKey);
      url = `${url}?${authParams.toString()}`;
    }
  } else {
    const params = new URLSearchParams();
    params.set(queryParamName, qForGet);
    if (kind && kindParamName) params.set(kindParamName, kind);
    if (authQueryParam) params.set(authQueryParam, safeApiKey);
    const includeLimit = endpoint.includes("/search") && !isAPIV3;
    if (includeLimit) params.set("limit", "5");
    url = `${url}?${params.toString()}`;
  }

  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if (res.status === 404) {
        const notFoundTitle = isCpf ? `CPF ${formatCpf(digits)} não encontrado` : "Nenhum resultado";
        const notFoundDesc = isCpf ? "DirectData v3 não possui dados para CPF informado." : "DirectData v3 não retornou dados para a consulta.";
        return [{
          title: notFoundTitle,
          description: notFoundDesc,
          snippet: notFoundDesc,
          url: `${effectiveBaseUrl}${endpoint}`,
          source: "directdata",
          not_found: true,
        } as SearchItem];
      }
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
      const titleBase = typeof obj.title === "string"
        ? obj.title
        : typeof obj.name === "string"
        ? obj.name
        : typeof obj.heading === "string"
        ? obj.heading
        : q;
      const snippetBase = typeof obj.snippet === "string"
        ? obj.snippet
        : typeof obj.description === "string"
        ? obj.description
        : typeof obj.summary === "string"
        ? obj.summary
        : "";
      const link = typeof obj.url === "string"
        ? obj.url
        : typeof obj.link === "string"
        ? obj.link
        : "";

      const item: SearchItem = {
        title: titleBase,
        description: snippetBase,
        snippet: snippetBase,
        url: link,
        source: "directdata",
        raw: obj,
      } as SearchItem;

      // CPF: enriquecer campos com Nome, Nascimento, UF, cidade, CEP e DDD/Telefone
      const cpfFromObj = typeof (obj as any).Cpf === "string" ? (obj as any).Cpf : (typeof (obj as any).cpf === "string" ? (obj as any).cpf : undefined);
      const isCpfKind = kind === "cpf" || !!cpfFromObj;
      if (isCpfKind) {
        const cpfDigits = normalizeCpf(cpfFromObj || digits);
        const cpfFmt = formatCpf(cpfDigits);
        const ret: any = (obj as any).retorno || (obj as any).Retorno || {};
        const nome = ret.Nome || ret.name || ret.nome || (obj as any).Nome || (obj as any).name || (obj as any).nome;
        const nascRaw = ret.DataNascimento || ret.nascimento || ret.dob || ret.birth_date || (obj as any).DataNascimento || (obj as any).nascimento || (obj as any).dob || (obj as any).birth_date;
        const nasc = (typeof nascRaw === "string" && /^\d{8}$/.test(nascRaw))
          ? `${(nascRaw as string).slice(6,8)}/${(nascRaw as string).slice(4,6)}/${(nascRaw as string).slice(0,4)}`
          : (typeof nascRaw === "string" ? nascRaw : undefined);
        const uf = ret.UF || ret.state || (obj as any).UF || (obj as any).state;
        const municipio = ret.Municipio || ret.city || (obj as any).Municipio || (obj as any).city;
        const ddd = ret.DDD || ret.ddd || ret?.phone?.ddd || (obj as any).DDD || (obj as any).ddd || (obj as any)?.phone?.ddd;
        const tel = ret.Telefone || ret.telefone || ret?.phone?.number || (obj as any).Telefone || (obj as any).telefone || (obj as any)?.phone?.number;
        const cepRaw = ret.Cep || ret.cep || ret?.address?.zip || (obj as any).Cep || (obj as any).cep || (obj as any)?.address?.zip;
        const cepDigits = typeof cepRaw === "string" ? normalizeCep(cepRaw as string) : (typeof cepRaw === "number" ? String(cepRaw) : undefined);

        // título e descrição amigáveis
        item.title = nome ? `CPF ${cpfFmt} — ${nome}` : `CPF ${cpfFmt}`;
        const parts: string[] = [];
        if (nasc) parts.push(`Nascimento: ${nasc}`);
        const loc = municipio && uf ? `${municipio}-${uf}` : (municipio || uf);
        if (loc) parts.push(`Local: ${loc}`);
        if (ddd && tel) parts.push(`Telefone: (${String(ddd)}) ${String(tel)}`);
        const situ = (obj as any).DescSituacaoCadastral || ret.DescSituacaoCadastral || ret.situacaoCadastral || ret.SituacaoCadastral;
        if (situ) parts.push(`Situação: ${situ}`);
        const desc = parts.join(" • ") || snippetBase;
        item.description = desc;
        item.snippet = desc;

        // campos de topo para cruzamento
        (item as any).cpf = cpfDigits;
        if (cepDigits) (item as any).cep = cepDigits;
        if (ddd && tel) {
          const phoneDigits = normalizePhoneBR(`${ddd}${tel}`);
          (item as any).phone = phoneDigits;
          (item as any).ddd = String(ddd);
        }

        // enriquecer raw com estrutura esperada pelo resumo/cruzamento
        const street = [ret.TipoLogradouro || (obj as any).TipoLogradouro, ret.Logradouro || (obj as any).Logradouro, ret.NumeroLogradouro || (obj as any).NumeroLogradouro, ret.Complemento || (obj as any).Complemento].filter(Boolean).join(" ");
        const address = { street, city: municipio, state: uf, zip: cepDigits };
        const phonesArr = (ddd && tel) ? [{ area: String(ddd), number: String(tel) }] : [];
        item.raw = { ...(obj as any), retorno: ret, cpf: cpfDigits, nome, nascimento: nasc, address, phones: phonesArr } as any;
      }

      return item;
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

// Email (reputação — EmailRep)
async function searchEmailRep(query: string): Promise<SearchItem[]> {
  const email = String(query).trim().toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return [];
  const url = `https://emailrep.io/${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 300 } });
    if (!res.ok) {
      return [{ title: `EmailRep falhou (${res.status})`, description: "Erro ao consultar reputação de email", snippet: `Falha HTTP ${res.status}`, url, source: "email_rep" }];
    }
    const data: any = await res.json();
    const reputation = data?.reputation ?? "unknown";
    const suspicious = data?.suspicious === true;
    const details = data?.details ?? {};
    const references: string[] = Array.isArray(data?.references) ? data.references.slice(0, 5) : [];
    const desc = `Reputação: ${reputation} | Suspicious: ${suspicious ? "sim" : "não"}`;
    const items: SearchItem[] = [{
      title: "Reputação de email (EmailRep)",
      description: desc,
      snippet: desc,
      url: `https://emailrep.io/${encodeURIComponent(email)}`,
      source: "email_rep",
      reputation,
      suspicious,
      domain: data?.domain,
      references,
      details,
    }];
    const extra: SearchItem[] = references.map((ref: string) => ({
      title: "Referência de reputação",
      description: ref,
      snippet: ref,
      url: ref,
      source: "email_rep",
    }));
    return items.concat(extra).slice(0, 5);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return [{ title: "EmailRep erro", description: msg, snippet: msg, url, source: "email_rep" }];
  }
}

// Email (verificação — Hunter.io)
async function searchHunterVerifier(query: string): Promise<SearchItem[]> {
  const email = String(query).trim().toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return [];
  const apiKey = process.env.HUNTER_API_KEY;
  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey || ''}`;
  if (!apiKey) {
    return [{ title: "Hunter.io não configurado", description: "Defina HUNTER_API_KEY no ambiente", snippet: "HUNTER_API_KEY ausente", url: "https://hunter.io/api/email-verifier", source: "email_hunter" }];
  }
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 300 } });
    if (!res.ok) {
      return [{ title: `Hunter falhou (${res.status})`, description: "Erro ao verificar email", snippet: `Falha HTTP ${res.status}`, url, source: "email_hunter" }];
    }
    const data: any = await res.json();
    const v = data?.data || {};
    const result = v?.result;
    const score = v?.score;
    const desc = `Resultado: ${result || "unknown"} | Score: ${typeof score === 'number' ? score : 'n/a'}`;
    const item: SearchItem = {
      title: "Verificação de email (Hunter.io)",
      description: desc,
      snippet: desc,
      url: `https://hunter.io/verify/${encodeURIComponent(email)}`,
      source: "email_hunter",
      result,
      score,
      regexp: v?.regexp,
      gibberish: v?.gibberish,
      disposable: v?.disposable,
      webmail: v?.webmail,
      mx_records: v?.mx_records,
      smtp_server: v?.smtp_server,
      smtp_check: v?.smtp_check,
      accept_all: v?.accept_all,
      block: v?.block,
      sources: Array.isArray(v?.sources) ? v.sources.slice(0, 5) : [],
    };
    return [item];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return [{ title: "Hunter erro", description: msg, snippet: msg, url, source: "email_hunter" }];
  }
}

// Email (avatar/perfil — Gravatar)
async function searchGravatar(query: string): Promise<SearchItem[]> {
  const email = String(query).trim().toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return [];
  const hash = crypto.createHash("md5").update(email).digest("hex");
  const profileUrl = `https://en.gravatar.com/${hash}.json`;
  const avatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404&s=200`;
  try {
    const res = await fetch(profileUrl, { next: { revalidate: 300 } });
    if (res.ok) {
      const data: any = await res.json();
      const entry = Array.isArray(data?.entry) ? data.entry[0] : null;
      const displayName = entry?.displayName || entry?.name?.formatted || email;
      const aboutMe = entry?.aboutMe || "";
      const profileLink = entry?.profileUrl || `https://en.gravatar.com/${hash}`;
      const photos = Array.isArray(entry?.photos) ? entry.photos : [];
      const photo = photos.find((p: any) => p?.value)?.value || avatarUrl;
      return [{
        title: `Perfil Gravatar (${displayName})`,
        description: aboutMe,
        snippet: aboutMe,
        url: profileLink,
        source: "gravatar",
        avatar: photo,
        hash,
      }];
    } else if (res.status === 404) {
      return [{
        title: "Avatar Gravatar",
        description: "Avatar público se existir",
        snippet: "Avatar público se existir",
        url: `https://en.gravatar.com/${hash}`,
        source: "gravatar",
        avatar: avatarUrl,
        hash,
      }];
    } else {
      return [{ title: `Gravatar falhou (${res.status})`, description: "Erro ao consultar perfil", snippet: `Falha HTTP ${res.status}`, url: profileUrl, source: "gravatar" }];
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return [{ title: "Gravatar erro", description: msg, snippet: msg, url: profileUrl, source: "gravatar" }];
  }
}

// Telefone (formatação BR)
function normalizePhoneBR(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}
async function formatPhoneBR(query: string): Promise<SearchItem[]> {
  const s = normalizePhoneBR(query);
  if (s.length < 10 || s.length > 11) return [];
  // Não tratar CPF como telefone
  if (isCpfValid(s)) return [];
  const ddd = s.slice(0, 2);
  const local = s.slice(2);
  const isCell = local.length === 9 && local.startsWith("9");
  const fmt = isCell ? `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}` : `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
  const e164 = `+55${s}`;
  return [{ title: "Telefone formatado", description: fmt, snippet: isCell ? "Celular" : "Fixo", url: `tel:${e164}`, source: "phone", ddd, e164, phone: s }];
 }

// Portabilidade — ABR Telecom (Consulta Número)
async function searchABRTelecomPortabilidade(query: string): Promise<SearchItem[]> {
  const s = normalizePhoneBR(query);
  if (s.length < 10 || s.length > 11) return [];
  if (isCpfValid(s)) return [];
  const ddd = s.slice(0, 2);
  const number = s.slice(2);
  const e164 = `+55${s}`;
  const base = "https://consultanumero.abrtelecom.com.br";
  const endpoint = "/consultanumero/consulta/consultaSituacaoAtualCtg";
  const url = `${base}${endpoint}`;

  const parsePairs = (html: string): Record<string, string> => {
    const pairs: Record<string, string> = {};
    const re = /<tr[^>]*>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, " ");
      const val = m[2].trim();
      pairs[key] = val;
    }
    return pairs;
  };
  const pick = (obj: Record<string, string>, keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = obj[k];
      if (v) return v;
    }
    const foundKey = Object.keys(obj).find((kk) => keys.some((k) => kk.includes(k)));
    return foundKey ? obj[foundKey] : undefined;
  };

  try {
    const form = new URLSearchParams();
    form.set("numero", s);
    form.set("ctg", s);
    form.set("codigo", s);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "InvestigaOSINT",
      } as any,
      body: form.toString(),
      next: { revalidate: 300 },
    });

    const ct = res.headers.get("content-type") || "";
    let text = "";
    if (ct.includes("application/json")) {
      const data: any = await res.json().catch(() => ({}));
      text = JSON.stringify(data);
    } else {
      text = await res.text();
    }

    if (!res.ok) {
      const desc = `ABR Telecom falhou (${res.status})`;
      return [{
        title: "Portabilidade indisponível",
        description: desc,
        snippet: desc,
        url,
        source: "phone_portabilidade",
        ddd,
        phone: number,
        e164,
        abrtelecom_url: url,
        error_message: `HTTP ${res.status}`,
      } as SearchItem];
    }

    const pairs = parsePairs(text);
    const operadora = pick(pairs, ["prestadora", "operadora", "prestadora atual"]);
    const situacao = pick(pairs, ["situação", "situacao", "status", "situação atual"]);
    const tecnologia = pick(pairs, ["tecnologia"]);
    const atualizado = pick(pairs, ["data", "atualização", "atualizado", "atualizado em", "data atualização"]);
    const dddOut = pick(pairs, ["ddd", "código de área", "codigo de area"]);
    const numeroOut = pick(pairs, ["número", "numero"]);

    const title = `Portabilidade — ${operadora || "desconhecida"}`;
    const descParts = [
      operadora ? `Prestadora: ${operadora}` : undefined,
      situacao ? `Situação: ${situacao}` : undefined,
      tecnologia ? `Tecnologia: ${tecnologia}` : undefined,
      atualizado ? `Atualizado: ${atualizado}` : undefined,
    ].filter(Boolean) as string[];
    const desc = descParts.join(" — ") || `Consulta de portabilidade para ${e164}`;

    const item: SearchItem = {
      title,
      description: desc,
      snippet: desc,
      url,
      source: "phone_portabilidade",
      ddd: dddOut || ddd,
      phone: numeroOut || number,
      e164,
      operadora,
      situacao,
      tecnologia,
      atualizado,
      abrtelecom_url: url,
      raw_html: text.slice(0, 4000),
    };
    return [item];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return [{
      title: "Portabilidade erro",
      description: msg,
      snippet: msg,
      url,
      source: "phone_portabilidade",
      ddd,
      phone: number,
      e164,
      abrtelecom_url: url,
      error_message: msg,
    } as SearchItem];
  }
}

// Email (logo — Clearbit)
async function searchClearbitLogo(query: string): Promise<SearchItem[]> {
  const q = String(query).trim();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const extractDomain = (input: string): string | null => {
    if (emailRe.test(input)) {
      const parts = input.split("@");
      return parts[1]?.toLowerCase() || null;
    }
    try {
      const u = new URL(input.includes("//") ? input : `https://${input}`);
      return u.hostname.toLowerCase();
    } catch {
      const m = input.toLowerCase().match(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      return m ? m[0] : null;
    }
  };
  const domain = extractDomain(q);
  if (!domain) return [];
  const logo = `https://logo.clearbit.com/${domain}`;
  const home = `https://${domain}`;
  const items: SearchItem[] = [{
    title: `Logo do domínio (${domain})`,
    description: `Logotipo público via Clearbit Logo para ${domain}`,
    snippet: domain,
    url: home,
    source: "clearbit_logo",
    domain,
    logo,
  }];
  return items;
}

// Telefone (DDD — BrasilAPI)
async function searchDDD(query: string): Promise<SearchItem[]> {
  const s = normalizePhoneBR(query);
  if (s.length < 10 || s.length > 11) return [];
  // Evitar CPFs válidos
  if (isCpfValid(s)) return [];
  const ddd = s.slice(0, 2);
  const url = `https://brasilapi.com.br/api/ddd/v1/${ddd}`;
  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) {
      return [{ title: `DDD falhou (${res.status})`, description: "Erro ao consultar BrasilAPI", snippet: `Falha HTTP ${res.status}`, url, source: "ddd_brasilapi", ddd }];
    }
    const data: any = await res.json();
    const state = data?.state;
    const cities: string[] = Array.isArray(data?.cities) ? data.cities.slice(0, 5) : [];
    const desc = state ? `Estado: ${state} — Cidades: ${cities.join(", ")}` : `DDD ${ddd}`;
    const items: SearchItem[] = [{
      title: `DDD ${ddd} — ${state || ""}`.trim(),
      description: desc,
      snippet: desc,
      url,
      source: "ddd_brasilapi",
      ddd,
      state,
      cities,
    }];
    return items;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return [{ title: "DDD erro", description: msg, snippet: msg, url, source: "ddd_brasilapi", ddd }];
  }
}

// Telefone (DDD — APIBrasil/Anatel)
async function searchAPIBrasilDDD(query: string, opts?: { noFallback?: boolean }): Promise<SearchItem[]> {
  const s = normalizePhoneBR(query);
  if (s.length < 10 || s.length > 11) return [];
  if (isCpfValid(s)) return [];
  const ddd = s.slice(0, 2);
  const base = (process.env.APIBRASIL_BASE_URL || "").replace(/\/$/, "") || "https://api.apibrasil.io";
  const endpoint = process.env.APIBRASIL_DDD_ENDPOINT || "/ddd/anatel";
  const url = `${base}${endpoint}/${ddd}`;
  const apiKey = process.env.APIBRASIL_API_KEY || process.env.APIBRASIL_TOKEN || process.env.APIBRASIL_SECRET || "";
  const authHeader = (process.env.APIBRASIL_AUTH_HEADER || "Authorization").toLowerCase();
  const authScheme = (process.env.APIBRASIL_AUTH_SCHEME || "Bearer").trim();
  const envFallbackRaw = (process.env.APIBRASIL_DDD_FALLBACK ?? "true").toString().toLowerCase();
  const enableFallback = !["false", "0", "off", "no"].includes(envFallbackRaw);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    if (authHeader === "authorization") headers["Authorization"] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
    else headers[process.env.APIBRASIL_AUTH_HEADER || "X-API-Key"] = apiKey;
  }
  try {
    const res = await fetch(url, { headers, next: { revalidate: 600 } });
    if (!res.ok) {
      const title = `DDD APIBrasil falhou (${res.status})`;
      const desc = "Erro ao consultar APIBrasil DDD/Anatel";
      // Fallback: se não houver chave e retorno for 401/403, usar BrasilAPI (respeitando env e opção)
      if (enableFallback && !opts?.noFallback && !apiKey && (res.status === 401 || res.status === 403)) {
        const fallback = await searchDDD(query);
        const mapped: SearchItem[] = fallback.map((it) => ({ ...it, source: "ddd_apibrasil" as Provider, fallback: true, fallback_reason: String(res.status), fallback_provider: "ddd_brasilapi", fallback_provider_url: `https://brasilapi.com.br/api/ddd/v1/${ddd}` }));
        return [
          { title, description: `${desc} — chave ausente/sem acesso, usando fallback BrasilAPI`, snippet: desc, url, source: "ddd_apibrasil", ddd, fallback: true, fallback_reason: String(res.status), fallback_provider: "ddd_brasilapi", fallback_provider_url: `https://brasilapi.com.br/api/ddd/v1/${ddd}`, apibrasil_url: url } as SearchItem,
          ...mapped,
        ];
      }
      return [{ title, description: desc, snippet: desc, url, source: "ddd_apibrasil", ddd } as SearchItem];
    }
    const data: any = await res.json();
    const state = data?.state || data?.uf || data?.estado;
    const rawCities = (data?.cities || data?.cidades || data?.municipios);
    const cities: string[] = Array.isArray(rawCities) ? (rawCities as string[]).slice(0, 5) : [];
    const REGION_BY_UF: Record<string, string> = {
      AC: "Norte", AL: "Nordeste", AP: "Norte", AM: "Norte", BA: "Nordeste", CE: "Nordeste", DF: "Centro-Oeste", ES: "Sudeste", GO: "Centro-Oeste", MA: "Nordeste", MT: "Centro-Oeste", MS: "Centro-Oeste", MG: "Sudeste", PA: "Norte", PB: "Nordeste", PR: "Sul", PE: "Nordeste", PI: "Nordeste", RJ: "Sudeste", RN: "Nordeste", RS: "Sul", RO: "Norte", RR: "Norte", SC: "Sul", SP: "Sudeste", SE: "Nordeste", TO: "Norte"
    };
    const region = state ? REGION_BY_UF[String(state).toUpperCase()] : undefined;
    const citiesCount = Array.isArray(rawCities) ? (rawCities as string[]).length : undefined;
    const desc = state ? `Estado: ${state}${region ? ` — Região: ${region}` : ""} — Cidades: ${cities.join(", ")}` : `DDD ${ddd}`;
    const item: SearchItem = {
      title: `DDD ${ddd} — ${state || ""}`.trim(),
      description: desc,
      snippet: desc,
      url,
      source: "ddd_apibrasil",
      ddd,
      state,
      region,
      cities,
      cities_count: citiesCount,
      apibrasil_url: url,
      raw: data,
    };
    return [item];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Fallback genérico em erro de rede quando não há chave (respeitando env e opção)
    if (enableFallback && !opts?.noFallback && !apiKey) {
      const fallback = await searchDDD(query);
      const mapped: SearchItem[] = fallback.map((it) => ({ ...it, source: "ddd_apibrasil" as Provider, fallback: true, fallback_reason: "network_error", fallback_provider: "ddd_brasilapi", fallback_provider_url: `https://brasilapi.com.br/api/ddd/v1/${ddd}`, error_message: msg }));
      return [{ title: "APIBrasil indisponível", description: `${msg} — usando fallback BrasilAPI`, snippet: msg, url, source: "ddd_apibrasil", ddd, fallback: true, fallback_reason: "network_error", fallback_provider: "ddd_brasilapi", fallback_provider_url: `https://brasilapi.com.br/api/ddd/v1/${ddd}`, apibrasil_url: url, error_message: msg } as SearchItem, ...mapped];
    }
    return [{ title: "DDD APIBrasil erro", description: msg, snippet: msg, url, source: "ddd_apibrasil", ddd } as SearchItem];
  }
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
    const options = body?.options || {};

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
      } else if (p === "email_rep") {
        tasks.push(searchEmailRep(query));
        labels.push("email_rep");
      } else if (p === "email_hunter") {
        tasks.push(searchHunterVerifier(query));
        labels.push("email_hunter");
      } else if (p === "gravatar") {
        tasks.push(searchGravatar(query));
        labels.push("gravatar");
      } else if (p === "clearbit_logo") {
        tasks.push(searchClearbitLogo(query));
        labels.push("clearbit_logo");
      } else if (p === "phone") {
        tasks.push(formatPhoneBR(query));
        labels.push("phone");
      } else if (p === "phone_portabilidade") {
        tasks.push(searchABRTelecomPortabilidade(query));
        labels.push("phone_portabilidade");
      } else if (p === "ddd_brasilapi") {
        tasks.push(searchDDD(query));
        labels.push("ddd_brasilapi");
      } else if (p === "ddd_apibrasil") {
        tasks.push(searchAPIBrasilDDD(query, { noFallback: Boolean(options?.apibrasil_no_fallback) || Boolean(options?.no_fallback) }));
        labels.push("ddd_apibrasil");
      } else if (p === "clt_pis") {
        tasks.push(validatePIS(query));
        labels.push("clt_pis");
      } else if (p === "datajud") {
        tasks.push(searchDatajud(query));
        labels.push("datajud");
      } else if (p === "cnpj") {
        tasks.push(searchCNPJAOffice(query));
        labels.push("cnpj");
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

function normalizeCnpj(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}
function formatCnpj(cnpj: string): string {
  const s = normalizeCnpj(cnpj);
  if (!/^\d{14}$/.test(s)) return cnpj;
  return `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}`;
}
function isCnpjValid(cnpj: string): boolean {
  const s = normalizeCnpj(cnpj);
  if (!/^\d{14}$/.test(s)) return false;
  if (/^(\d)\1{13}$/.test(s)) return false; // todos iguais
  const nums = s.split("").map((d) => parseInt(d, 10));
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum1 = weights1.reduce((acc, w, i) => acc + nums[i] * w, 0);
  const d1 = sum1 % 11 < 2 ? 0 : 11 - (sum1 % 11);
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum2 = weights2.reduce((acc, w, i) => acc + (i === 12 ? d1 : nums[i]) * w, 0);
  const d2 = sum2 % 11 < 2 ? 0 : 11 - (sum2 % 11);
  return d1 === nums[12] && d2 === nums[13];
}
async function searchCNPJAOffice(query: string): Promise<SearchItem[]> {
  const s = normalizeCnpj(query);
  if (!/^\d{14}$/.test(s)) return [];
  const valid = isCnpjValid(s);
  const fmt = formatCnpj(s);
  const base = process.env.CNPJA_BASE_URL || "https://open.cnpja.com";
  const url = `${base}/office/${s}`;
  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) {
      const status = valid ? "Válido" : "Inválido";
      const desc = `CNPJ ${fmt} — ${status} • validação local (CNPJa indisponível)`;
      return [{
        title: `CNPJ ${fmt}`,
        description: desc,
        snippet: desc,
        url,
        source: "cnpj",
        cnpj: fmt,
        digits: s,
        valid,
      } as SearchItem];
    }
    const data: any = await res.json();
    const company = data?.company;
    const name = company?.name || data?.name || "Empresa";
    const alias = data?.alias;
    const statusText = data?.status?.text;
    const address = data?.address || {};
    const city = address?.city;
    const state = address?.state;
    const zip = address?.zip;
    const phone = (Array.isArray(data?.phones) && data.phones[0]) ? `${data.phones[0].area}-${data.phones[0].number}` : undefined;
    const email = (Array.isArray(data?.emails) && data.emails[0]?.address) || undefined;
    const mainActivity = data?.mainActivity?.text;
    const members = Array.isArray(company?.members) ? company.members.slice(0, 5) : [];
    const membersSummary = members.map((m: any) => m?.person?.name).filter(Boolean).join(", ");
    const title = `${name}${alias ? ` (${alias})` : ""} — CNPJ ${fmt}`;
    const descParts = [statusText, mainActivity, city && state ? `${city} (${state})` : city || state, zip]
      .filter(Boolean);
    const snippet = descParts.join(" — ");
    const item: SearchItem = {
      title,
      description: snippet,
      snippet,
      url,
      source: "cnpj",
      cnpj: fmt,
      digits: s,
      valid,
      status: statusText,
      state,
      city,
      zip,
      phone,
      email,
      mainActivity,
      members: membersSummary,
      raw: data,
    };
    return [item];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = valid ? "Válido" : "Inválido";
    const desc = `CNPJ ${fmt} — ${status} • validação local (CNPJa erro)`;
    return [{ title: `CNPJ ${fmt}`, description: desc, snippet: desc, url, source: "cnpj", cnpj: fmt, digits: s, error: msg, valid } as SearchItem];
  }
}