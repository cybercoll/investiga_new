import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("investigations")
      .select("id, created_at, query")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      const msg = error.message || "Falha ao listar histórico do Supabase.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json({ items: data || [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Supabase não configurado.";
    return NextResponse.json(
      {
        error:
          msg ||
          "Supabase não configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 400 }
    );
  }
}