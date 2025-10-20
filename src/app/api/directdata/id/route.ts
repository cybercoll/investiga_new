import { NextResponse } from "next/server";

function digitsOnly(s: string): string { return (s || "").replace(/[^0-9]/g, ""); }

function buildItems(q: string, kind?: string) {
  const d = digitsOnly(q);
  const k = (kind || "id").toLowerCase();
  return {
    items: [
      {
        title: `Documento ${k}`,
        description: `Consulta simulada para ${k} ${d}`,
        url: "https://example.com/id",
      },
    ],
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const kind = (searchParams.get("kind") || "").trim();
  if (!q) return NextResponse.json({ error: "q ausente" }, { status: 400 });
  return NextResponse.json(buildItems(q, kind));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.query || "").trim();
  const kind = String(body?.kind || "").trim();
  if (!q) return NextResponse.json({ error: "query ausente" }, { status: 400 });
  return NextResponse.json(buildItems(q, kind));
}