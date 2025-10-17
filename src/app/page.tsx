"use client";
import { useState } from "react";

type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata";

type SearchResult = {
  title?: string;
  snippet?: string;
  url?: string;
  source?: string;
  [key: string]: unknown;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<Record<Provider, boolean>>({
    wikipedia: true,
    duckduckgo: true,
    github: true,
    directdata: false,
  });
  const [results, setResults] = useState<Record<string, SearchResult[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ path: string; url: string; raw_url: string; size?: number }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [supabaseHistory, setSupabaseHistory] = useState<{ id: number; created_at: string; query: string }[]>([]);
  const [supabaseHistoryLoading, setSupabaseHistoryLoading] = useState(false);
  const [supabaseHistoryFilter, setSupabaseHistoryFilter] = useState("");
  const [supabaseHistoryPage, setSupabaseHistoryPage] = useState(1);
  const SUPABASE_ENABLED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const selectedProviders = Object.entries(providers)
    .filter(([, v]) => v)
    .map(([k]) => k as Provider);

  async function onSearch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, providers: selectedProviders }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha na busca");
      setResults(data.results || {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar histórico");
      setHistory(data?.files || []);
      setHistoryPage(1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function sendToGitHub() {
    setError(null);
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao enviar ao GitHub");
      alert(`Enviado ao GitHub! commit: ${data?.commit || "(ok)"}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }

  async function saveToSupabase() {
    setError(null);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao salvar no Supabase");
      alert("Salvo no Supabase!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }

  async function loadSupabaseHistory() {
    setSupabaseHistoryLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/supabase/history");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar histórico do Supabase");
      setSupabaseHistory(data?.items || []);
      setSupabaseHistoryPage(1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSupabaseHistoryLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Investiga</h1>
        <p className="text-sm mb-6">Ferramenta simples para buscar, salvar e enviar resultados de investigação.</p>

        <div className="bg-white rounded-lg shadow p-4 space-y-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite sua busca..."
            className="w-full border rounded px-3 py-2"
          />

          <div className="flex flex-wrap gap-4">
            {(["wikipedia", "duckduckgo", "github", "directdata"] as Provider[]).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={providers[p]}
                  onChange={(e) => setProviders((prev) => ({ ...prev, [p]: e.target.checked }))}
                />
                <span className="capitalize">{p}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onSearch}
              disabled={loading || !query.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {loading ? "Buscando..." : "Buscar"}
            </button>
            <button
              onClick={sendToGitHub}
              disabled={!Object.keys(results).length}
              className="bg-gray-800 hover:bg-black text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Enviar ao GitHub
            </button>
            {SUPABASE_ENABLED && (
              <button
                onClick={saveToSupabase}
                disabled={!Object.keys(results).length}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                Salvar no Supabase
              </button>
            )}
            {SUPABASE_ENABLED && (
              <button
                onClick={loadSupabaseHistory}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {supabaseHistoryLoading ? "Carregando..." : "Histórico (Supabase)"}
              </button>
            )}
            <button
              onClick={loadHistory}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {historyLoading ? "Carregando..." : "Carregar histórico"}
            </button>
          </div>

          {error && (
            <div className="text-red-600 text-sm">Erro: {error}</div>
          )}

          {/* Resultados por provedor */}
          {Object.keys(results).length > 0 && (
            <div className="space-y-6 mt-6">
              {(
                Object.keys(results) as Provider[]
              ).map((provider) => (
                <div key={provider} className="border rounded p-3">
                  <h2 className="text-lg font-semibold mb-2">{provider.toUpperCase()}</h2>
                  <ul className="list-disc pl-5 space-y-1">
                    {results[provider].map((item) => (
                      <li key={item.url}>
                        <a
                          className="text-blue-700 hover:underline break-words"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {item.title}
                        </a>
                        {typeof item.description === "string" && item.description.trim().length > 0 && (
                          <p className="text-sm text-gray-600">{item.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Histórico de arquivos salvos no GitHub */}
          {history.length > 0 && (() => {
            const PAGE_SIZE = 10;
            const getTs = (path: string) => {
              try {
                const parts = path.split("/");
                const dd = Number(parts[1]);
                const mm = Number(parts[2]);
                const yyyy = Number(parts[3]);
                const file = parts[parts.length - 1] || "";
                const base = file.replace(/\.json$/i, "");
                const lastDash = base.lastIndexOf("-");
                const tsStr = lastDash >= 0 ? base.slice(lastDash + 1) : "";
                const ts = tsStr && /^\d+$/.test(tsStr) ? Number(tsStr) : new Date(yyyy, mm - 1, dd).getTime();
                return ts || 0;
              } catch {
                return 0;
              }
            };
            const extractDate = (path: string) => {
              const m = path.match(/^investigations\/(\d{2})\/(\d{2})\/(\d{4})\//);
              return m ? `${m[1]}/${m[2]}/${m[3]}` : "";
            };
            const sorted = [...history].sort((a, b) => getTs(b.path) - getTs(a.path));
            const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
            const page = Math.min(historyPage, totalPages);
            const start = (page - 1) * PAGE_SIZE;
            const items = sorted.slice(start, start + PAGE_SIZE);
            return (
              <section className="space-y-2 mt-8">
                <h2 className="text-lg font-semibold">Histórico</h2>
                <div className="flex items-center gap-2 text-sm">
                  <span>Página {page} de {totalPages}</span>
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-2 py-1 border rounded disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-2 py-1 border rounded disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
                <ul className="space-y-2">
                  {items.map((f, idx) => (
                    <li key={idx} className="border rounded p-3">
                      <a
                        className="font-medium text-blue-700 hover:underline break-words"
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.path}
                      </a>
                      <span className="text-xs text-gray-600 ml-2">{extractDate(f.path)}</span>
                      <a
                        className="text-sm text-gray-700 ml-2 hover:underline"
                        href={f.raw_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        raw
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}        </div>
          {SUPABASE_ENABLED && supabaseHistory.length > 0 && (() => {
            const PAGE_SIZE = 10;
            const filter = supabaseHistoryFilter.toLowerCase();
            const filtered = supabaseHistory.filter((i) => i.query.toLowerCase().includes(filter));
            const sorted = [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
            const page = Math.min(supabaseHistoryPage, totalPages);
            const start = (page - 1) * PAGE_SIZE;
            const items = sorted.slice(start, start + PAGE_SIZE);
            const formatDate = (s: string) => {
              const d = new Date(s);
              const dd = String(d.getDate()).padStart(2, "0");
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const yyyy = d.getFullYear();
              return `${dd}/${mm}/${yyyy}`;
            };
            const exportCSV = () => {
              const header = "id,created_at,query\n";
              const rows = items.map((i) => `${i.id},"${i.created_at.replace(/"/g, '""')}",${JSON.stringify(i.query).replace(/"/g, '""')}`);
              const blob = new Blob([header + rows.join("\n")], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "supabase-history.csv";
              a.click();
              URL.revokeObjectURL(url);
            };
            const exportJSON = () => {
              const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "supabase-history.json";
              a.click();
              URL.revokeObjectURL(url);
            };
            return (
              <section className="space-y-2 mt-8">
                <h2 className="text-lg font-semibold">Histórico (Supabase)</h2>
                <div className="flex items-center gap-2 text-sm">
                  <input
                    value={supabaseHistoryFilter}
                    onChange={(e) => { setSupabaseHistoryFilter(e.target.value); setSupabaseHistoryPage(1); }}
                    placeholder="Filtrar por termo..."
                    className="px-2 py-1 border rounded"
                  />
                  <span>Página {page} de {totalPages}</span>
                  <button
                    onClick={() => setSupabaseHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-2 py-1 border rounded disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setSupabaseHistoryPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-2 py-1 border rounded disabled:opacity-50"
                  >
                    Próxima
                  </button>
                  <button onClick={exportCSV} className="px-2 py-1 border rounded">Exportar CSV</button>
                  <button onClick={exportJSON} className="px-2 py-1 border rounded">Exportar JSON</button>
                </div>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li key={item.id} className="border rounded p-3">
                      <div className="text-sm text-gray-700">
                        <span className="font-medium">{formatDate(item.created_at)}</span>
                        <span className="ml-2">{item.query}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })()}
      </div>
    </main>
  );
}
