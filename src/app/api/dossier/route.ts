import { NextResponse } from "next/server";

function safeStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const subject = (body?.subject || {}) as Record<string, unknown>;
    const resultsByField = (body?.resultsByField || {}) as Record<string, Record<string, Array<Record<string, unknown>>>>;

    const titleParts: string[] = [];
    const keys = ["nome","cpf","telefone","cep","rg","email","cnh","clt"];
    for (const k of keys) {
      const v = safeStr(subject[k]);
      if (v) titleParts.push(`${k.toUpperCase()}: ${v}`);
    }
    const title = titleParts.length ? titleParts.join(" · ") : "Dossiê OSINT";

    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`Gerado em ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Sumário do Sujeito");
    for (const k of keys) {
      const v = safeStr(subject[k]);
      lines.push(`- ${k.toUpperCase()}: ${v || "(não informado)"}`);
    }
    lines.push("");

    for (const field of Object.keys(resultsByField)) {
      lines.push(`## ${field.toUpperCase()}`);
      const byProv = resultsByField[field] || {};
      for (const prov of Object.keys(byProv)) {
        lines.push(`### ${prov}`);
        const items = byProv[prov] || [];
        if (!items.length) {
          lines.push("- (sem itens)");
          continue;
        }
        for (const it of items) {
          const title = safeStr(it.title || it["name"] || it["heading"] || it["snippet"]);
          const snippet = safeStr(it.snippet || it["description"] || it["summary"]);
          const url = safeStr(it.url || it["link"]);
          const extras: string[] = [];
          for (const k of Object.keys(it)) {
            if (["title","snippet","url","source"].includes(k)) continue;
            const v = it[k];
            if (typeof v === "string" || typeof v === "number") extras.push(`${k}: ${v}`);
          }
          lines.push(`- ${title}`);
          if (snippet) lines.push(`  - Nota: ${snippet}`);
          if (url) lines.push(`  - URL: ${url}`);
          if (extras.length) lines.push(`  - Extras: ${extras.join("; ")}`);
        }
        lines.push("");
      }
      lines.push("");
    }

    const markdown = lines.join("\n");
    return NextResponse.json({ markdown });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}