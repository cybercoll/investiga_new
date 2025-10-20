import { NextResponse } from "next/server";

function buildItems(q: string) {
  return {
    items: [
      {
        title: `Busca geral: ${q}`,
        description: "Resultado simulado 1",
        url: "https://example.com/r1",
      },
      {
        title: `Busca geral: ${q}`,
        description: "Resultado simulado 2",
        url: "https://example.com/r2",
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