"use client";
import { useState } from "react";

type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata" | "cep" | "cpf" | "email_hibp" | "phone" | "clt_pis";

type SearchResult = {
  title?: string;
  snippet?: string;
  url?: string;
  source?: string;
  [key: string]: unknown;
};

type Subject = {
  nome?: string;
  cpf?: string;
  telefone?: string;
  cep?: string;
  rg?: string;
  email?: string;
  cnh?: string;
  clt?: string;
};

export default function OsintPage() {
  const [subject, setSubject] = useState<Subject>({});
  const [providers, setProviders] = useState<Record<Provider, boolean>>({
    wikipedia: true,
    duckduckgo: true,
    github: true,
    directdata: false,
    cep: false,
    cpf: false,
    email_hibp: false,
    phone: false,
    clt_pis: false,
  });
  const [resultsByField, setResultsByField] = useState<Record<string, Record<string, SearchResult[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dossierMd, setDossierMd] = useState<string>("");

  const selectedProviders = Object.entries(providers)
    .filter(([, v]) => v)
    .map(([k]) => k as Provider);

  const fields: Array<keyof Subject> = ["nome", "cpf", "telefone", "cep", "rg", "email", "cnh", "clt"];

  function updateField<K extends keyof Subject>(key: K, value: string) {
    setSubject((prev) => ({ ...prev, [key]: value }));
  }

  async function runOsint() {
    setLoading(true);
    setError(null);
    setDossierMd("");
    try {
      const newResults: Record<string, Record<string, SearchResult[]>> = {};
      for (const field of fields) {
        const value = (subject[field] || "").trim();
        if (!value) continue;
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: value, providers: selectedProviders }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Falha na busca para ${field}`);
        newResults[field] = data?.results || {};
      }
      setResultsByField(newResults);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function generateDossier() {
    setError(null);
    try {
      const res = await fetch("/api/dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, resultsByField }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao gerar dossiê");
      setDossierMd(data?.markdown || "");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }

  function downloadMd() {
    const blob = new Blob([dossierMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `dossie-osint-${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Investigação OSINT</h1>
        <p className="text-sm text-gray-700 mb-6">Busque por múltiplos atributos (CPF, telefone, CEP, RG, email, CNH, CLT, nome) em provedores e gere um dossiê consolidado.</p>

        <div className="bg-white rounded-lg shadow p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="border rounded px-3 py-2" placeholder="Nome" value={subject.nome || ""} onChange={(e) => updateField("nome", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="CPF" value={subject.cpf || ""} onChange={(e) => updateField("cpf", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Telefone" value={subject.telefone || ""} onChange={(e) => updateField("telefone", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="CEP" value={subject.cep || ""} onChange={(e) => updateField("cep", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="RG" value={subject.rg || ""} onChange={(e) => updateField("rg", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="Email" value={subject.email || ""} onChange={(e) => updateField("email", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="CNH" value={subject.cnh || ""} onChange={(e) => updateField("cnh", e.target.value)} />
            <input className="border rounded px-3 py-2" placeholder="CLT (PIS/NIT)" value={subject.clt || ""} onChange={(e) => updateField("clt", e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-4">
            {(["wikipedia", "duckduckgo", "github", "directdata", "cep", "cpf", "email_hibp", "phone", "clt_pis"] as Provider[]).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input type="checkbox" checked={providers[p]} onChange={(e) => setProviders((prev) => ({ ...prev, [p]: e.target.checked }))} />
                <span className="capitalize">{p}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={runOsint} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50">
              {loading ? "Buscando..." : "Buscar OSINT"}
            </button>
            <button onClick={generateDossier} disabled={!Object.keys(resultsByField).length} className="bg-gray-800 hover:bg-black text-white px-4 py-2 rounded disabled:opacity-50">
              Gerar Dossiê
            </button>
            <button onClick={downloadMd} disabled={!dossierMd} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded disabled:opacity-50">
              Baixar Markdown
            </button>
          </div>

          {error && <div className="text-red-600 text-sm">Erro: {error}</div>}
        </div>

        {Object.keys(resultsByField).length > 0 && (
          <div className="mt-6 space-y-6">
            {fields.map((f) => {
              const has = resultsByField[f];
              if (!has) return null;
              return (
                <section key={f} className="bg-white rounded-lg shadow p-4">
                  <h2 className="text-lg font-semibold mb-3">{f.toUpperCase()}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(has).map(([prov, items]) => (
                      <div key={prov} className="border rounded p-3">
                        <div className="font-medium mb-2">{prov}</div>
                        <ul className="space-y-2 text-sm">
                          {items.map((it, idx) => (
                            <li key={idx} className="border rounded p-2">
                              <div className="font-medium">{it.title || it.snippet}</div>
                              {it.url && (
                                <a href={it.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{it.url}</a>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {dossierMd && (
          <section className="bg-white rounded-lg shadow p-4 mt-6">
            <h2 className="text-lg font-semibold mb-3">Dossiê (Markdown)</h2>
            <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded border">{dossierMd}</pre>
          </section>
        )}
      </div>
    </main>
  );
}