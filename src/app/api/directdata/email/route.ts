import { NextResponse } from "next/server";

function normalizeVendorItems(data: unknown, q: string) {
  const obj = data as any;
  let rawItems: any[] = [];
  if (Array.isArray(data)) rawItems = data as any[];
  else if (Array.isArray(obj?.items)) rawItems = obj.items as any[];
  else if (Array.isArray(obj?.results)) rawItems = obj.results as any[];
  else rawItems = [obj];
  const items = rawItems.slice(0, 5).map((it: any) => {
    const title = typeof it?.name === "string"
      ? it.name
      : typeof it?.full_name === "string"
      ? it.full_name
      : typeof it?.title === "string"
      ? it.title
      : q;
    const description = typeof it?.bio === "string"
      ? it.bio
      : typeof it?.description === "string"
      ? it.description
      : typeof it?.headline === "string"
      ? it.headline
      : undefined;
    const url = typeof it?.linkedin_url === "string"
      ? it.linkedin_url
      : typeof it?.url === "string"
      ? it.url
      : typeof it?.website === "string"
      ? it.website
      : undefined;
    return { title, description, url, raw: it };
  });
  return { items };
}

async function fetchVendorEmail(q: string) {
  const apiKey = process.env.DIRECT_DATA_API_KEY;
  const base = process.env.DIRECT_DATA_VENDOR_EMAIL_BASE_URL || "https://api.enrich.so/v1/api";
  const endpoint = process.env.DIRECT_DATA_VENDOR_EMAIL_ENDPOINT || "/person";
  const paramName = process.env.DIRECT_DATA_VENDOR_EMAIL_PARAM || "email";
  const authHeader = process.env.DIRECT_DATA_AUTH_HEADER || "Authorization";
  const authScheme = (process.env.DIRECT_DATA_AUTH_SCHEME || "Bearer").trim();
  if (!apiKey) return null;
  const url = `${base.replace(/\/$/, "")}${endpoint}?${paramName}=${encodeURIComponent(q)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authHeader.toLowerCase() === "authorization") {
    headers["Authorization"] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
  } else {
    headers[authHeader] = apiKey;
  }
  try {
    const res = await fetch(url, { headers, next: { revalidate: 30 } });
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeVendorItems(data, q);
  } catch {
    return null;
  }
}

function buildItemsMock(q: string) {
  const user = q.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "");
  return {
    items: [
      {
        title: `Email ${q}`,
        name: user || q,
        description: `Enriquecimento simulado para ${q}: possíveis perfis e serviços associados.`,
        url: `mailto:${q}`,
      },
      {
        title: "Perfis potenciais",
        description: "GitHub e LinkedIn agregados (mock)",
        url: "https://example.com/profile",
      },
    ],
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  if (!q) return NextResponse.json({ error: "q ausente" }, { status: 400 });
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(q)) return NextResponse.json({ error: "email inválido" }, { status: 400 });
  const vendor = await fetchVendorEmail(q);
  return NextResponse.json(vendor || buildItemsMock(q));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.query || "").trim().toLowerCase();
  if (!q) return NextResponse.json({ error: "query ausente" }, { status: 400 });
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(q)) return NextResponse.json({ error: "email inválido" }, { status: 400 });
  const vendor = await fetchVendorEmail(q);
  return NextResponse.json(vendor || buildItemsMock(q));
}