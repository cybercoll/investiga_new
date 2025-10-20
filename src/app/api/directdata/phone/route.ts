import { NextResponse } from "next/server";

function digitsOnly(s: string): string { return (s || "").replace(/[^0-9]/g, ""); }

function buildItems(q: string) {
  const d = digitsOnly(q);
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  const e164 = local.length >= 10 ? `+55${local}` : `+${local}`;
  const ddd = local.slice(0, 2);
  const isCell = local.length === 11 && local[2] === "9";
  const desc = isCell ? `Celular (DDD ${ddd})` : `Fixo (DDD ${ddd})`;
  return {
    items: [
      {
        title: `Telefone ${e164}`,
        description: desc,
        url: `tel:${e164}`,
        phone: local,
        ddd,
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