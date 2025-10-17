import { NextResponse } from "next/server";

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim();
    const results: unknown = body?.results;
    if (!query || results === undefined) {
      return NextResponse.json(
        { error: "query e results são obrigatórios" },
        { status: 400 }
      );
    }

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !owner || !repo) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN, GITHUB_OWNER e GITHUB_REPO devem estar definidos" },
        { status: 400 }
      );
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const slug = slugify(query);

    const path = `investigations/${dd}/${mm}/${yyyy}/${slug}-${now.getTime()}.json`;
    const content = Buffer.from(JSON.stringify({ query, results }, null, 2)).toString("base64");

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Add investigation: ${query}`,
        content,
        branch,
      }),
    });

    const data: unknown = await res.json();
    const message =
      data && typeof data === "object" && typeof (data as Record<string, unknown>).message === "string"
        ? ((data as Record<string, unknown>).message as string)
        : undefined;
    if (!res.ok) {
      return NextResponse.json(
        { error: message || "Falha ao enviar ao GitHub" },
        { status: res.status }
      );
    }

    const commitSha =
      data && typeof data === "object" && typeof (data as Record<string, unknown>).commit === "object"
        ? ((data as Record<string, unknown>).commit as Record<string, unknown>).sha
        : undefined;
    return NextResponse.json({ ok: true, path, commit: typeof commitSha === "string" ? commitSha : undefined });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}