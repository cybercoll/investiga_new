import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim();
    const results: unknown = body?.results;

    if (!query || results === undefined) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: query e results." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("investigations")
      .insert({
        query,
        results,
        created_at: new Date().toISOString(),
      })
      .select("id, created_at")
      .single();

    if (error) {
      const msg = error.message || "Falha ao salvar no Supabase.";
      const hint = msg.toLowerCase().includes("relation")
        ? "Crie a tabela: CREATE TABLE public.investigations (id bigserial primary key, created_at timestamptz default now(), query text not null, results jsonb not null);"
        : undefined;
      return NextResponse.json({ error: msg, hint }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: data?.id, created_at: data?.created_at }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro inesperado ao salvar.";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !(anon || service)) {
    return NextResponse.json(
      {
        error: "Supabase não configurado",
        required: [
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY",
        ],
      },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}