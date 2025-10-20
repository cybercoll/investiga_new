import { NextResponse } from "next/server";

function buildItems(q: string) {
  const name = q.trim();
  return {
    items: [
      {
        title: name,
        description: `Análise básica de nome: possíveis homônimos e registros (mock)`,
        url: "https://example.com/name",
      },
      {
        title: `${name} — referência pública`,
        description: "Entrada simulada de base pública",
        url: "https://example.com/reference",
      },
    ],
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "q ausente" }, { status: 400 });
  return NextResponse.json(buildItems(q));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.query || "").trim();
  if (!q) return NextResponse.json({ error: "query ausente" }, { status: 400 });
  return NextResponse.json(buildItems(q));
}