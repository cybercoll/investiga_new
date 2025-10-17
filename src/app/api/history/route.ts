import { NextResponse } from "next/server";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 3) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500) {
        return res;
      }
      if (attempt < maxAttempts) {
        await sleep(300 * Math.pow(2, attempt - 1));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(300 * Math.pow(2, attempt - 1));
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Fetch failed");
}

export async function GET() {
  try {
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

    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        // Next.js já trata corretamente server-side; sem cache para garantir frescor
        cache: "no-store",
      },
      3
    );

    const data: unknown = await res.json();
    const message =
      data && typeof data === "object" && typeof (data as Record<string, unknown>).message === "string"
        ? ((data as Record<string, unknown>).message as string)
        : undefined;
    if (!res.ok) {
      return NextResponse.json(
        { error: message || "Falha ao obter histórico do GitHub" },
        { status: res.status }
      );
    }

    const maybeTree = data && typeof data === "object" ? (data as Record<string, unknown>).tree : undefined;
    const rawTree: unknown[] = Array.isArray(maybeTree) ? maybeTree : [];

    type GhTreeNode = { path?: unknown; type?: unknown; sha?: unknown; size?: unknown };

    const files = rawTree
      .filter((n: unknown): n is GhTreeNode => !!n && typeof n === "object")
      .filter((n) => {
        const path = n.path;
        const type = n.type;
        return (
          typeof type === "string" &&
          type === "blob" &&
          typeof path === "string" &&
          path.startsWith("investigations/") &&
          path.endsWith(".json")
        );
      })
      .map((n) => {
        const path = typeof n.path === "string" ? n.path : "";
        const size = typeof n.size === "number" ? n.size : undefined;
        const sha = typeof n.sha === "string" ? n.sha : undefined;
        return {
          path,
          size,
          sha,
          url: `https://github.com/${owner}/${repo}/blob/${branch}/${path}`,
          raw_url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
        };
      })
      // evita listas gigantes; ajuste se necessário
      .slice(0, 200);

    return NextResponse.json({ files });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}