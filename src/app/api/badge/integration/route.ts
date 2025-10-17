import { NextResponse } from "next/server";

// Shields JSON schema for dynamic badge
// https://shields.io/endpoint

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner") || process.env.VERCEL_GIT_REPO_OWNER || process.env.GITHUB_OWNER || "";
    const repo = url.searchParams.get("repo") || process.env.VERCEL_GIT_REPO_SLUG || process.env.GITHUB_REPO || "";
    const sha = url.searchParams.get("sha") || process.env.VERCEL_GIT_COMMIT_SHA || "";

    if (!owner || !repo || !sha) {
      const msg = !owner || !repo ? "Missing owner/repo" : "Missing sha";
      return NextResponse.json({ schemaVersion: 1, label: "integration", message: msg, color: "lightgrey", isError: true }, { status: 400 });
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`;
    const res = await fetch(ghUrl, { headers, next: { revalidate: 15 } });
    if (!res.ok) {
      const message = `GitHub ${res.status}`;
      return NextResponse.json({ schemaVersion: 1, label: "integration", message, color: "lightgrey", isError: true }, { status: 200 });
    }
    const data = await res.json() as { check_runs?: Array<{ name?: string; status?: string; conclusion?: string }> };
    const runs = Array.isArray(data.check_runs) ? data.check_runs : [];

    // Try to find an "integration" check; fallback to any check run containing "integration" in the name
    let integ = runs.find(r => r.name === "integration") || runs.find(r => (r.name || "").toLowerCase().includes("integration"));
    // Fallback: if no match, look for our check created on failure of /api/history
    if (!integ) integ = runs.find(r => (r.name || "").toLowerCase().includes("api-history"));

    const status = integ?.status || "unknown";
    const conclusion = integ?.conclusion || "unknown";

    // Map to shields color/message
    const map: Record<string, string> = { success: "brightgreen", failure: "red", cancelled: "lightgrey", neutral: "blue", timed_out: "orange", action_required: "yellow", skipped: "lightgrey" };
    const color = map[conclusion] || (status === "in_progress" || status === "queued" ? "blue" : "lightgrey");
    const message = status === "completed" ? conclusion : status;

    return NextResponse.json({ schemaVersion: 1, label: "integration", message, color });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ schemaVersion: 1, label: "integration", message: msg, color: "lightgrey", isError: true }, { status: 200 });
  }
}