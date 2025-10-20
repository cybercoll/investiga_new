"use client";
import { useState, useRef, useEffect } from "react";
import { logAbortDev, isAbortError } from "@/lib/devLog";

type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata" | "cep" | "cpf" | "email_hibp" | "phone" | "phone_portabilidade" | "clt_pis" | "email_rep" | "gravatar" | "ddd_brasilapi" | "clearbit_logo" | "email_hunter" | "cnpj";

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
  cnpj?: string;
};

export default function OsintPage() {
  const [subject, setSubject] = useState<Subject>({});
  const [providers, setProviders] = useState<Record<Provider, boolean>>({
    wikipedia: true,
    duckduckgo: true,
    github: true,
    directdata: true,
    cep: false,
    cpf: false,
    email_hibp: false,
    phone: false,
    phone_portabilidade: false,
    clt_pis: false,
    email_rep: true,
    gravatar: true,
    ddd_brasilapi: true,
    clearbit_logo: true,
    email_hunter: true,
    cnpj: true,
  });

  const [resultsByField, setResultsByField] = useState<Record<string, Record<string, SearchResult[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dossierMd, setDossierMd] = useState<string>("");
  const [onlySummarized, setOnlySummarized] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const abortDossierRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortDossierRef.current?.abort();
    };
  }, []);

  const selectedProviders = Object.entries(providers)
    .filter(([, v]) => v)
    .map(([k]) => k as Provider);

  function summarizeDirectData(raw: any): string {
    const parts: string[] = [];
    const name = (raw?.name || raw?.nome) as string | undefined;
    if (name) parts.push(`Nome: ${name}`);
    const dob = (raw?.dob || raw?.birth_date || raw?.nascimento) as string | undefined;
    if (dob) parts.push(`Nascimento: ${dob}`);
    const address = raw?.address || (Array.isArray(raw?.addresses) ? raw.addresses[0] : null);
    if (address) {
      const city = address?.city || address?.localidade;
      const state = address?.state || address?.uf;
      const street = address?.street || address?.logradouro;
      const zip = address?.zip || address?.cep;
      const addr = [street, city && state ? `${city}-${state}` : city || state, zip].filter(Boolean).join(", ");
      if (addr) parts.push(`Endereço: ${addr}`);
    }
    const phonesArr = Array.isArray(raw?.phones) ? raw.phones : (raw?.phone ? [raw.phone] : []);
    const phones = phonesArr.filter(Boolean).slice(0, 2).map((p: any) => {
      if (typeof p === "string") return p;
      const area = p?.area || p?.ddd;
      const num = p?.number || p?.numero;
      return area && num ? `(${area}) ${num}` : (num || area || "");
    }).filter(Boolean).join(", ");
    if (phones) parts.push(`Telefones: ${phones}`);
    const emailsArr = Array.isArray(raw?.emails) ? raw.emails : (raw?.email ? [raw.email] : []);
    const emails = emailsArr.filter(Boolean).slice(0, 2).map((e: any) => typeof e === "string" ? e : (e?.address || e?.email || "")).filter(Boolean).join(", ");
    if (emails) parts.push(`Emails: ${emails}`);
    const cnh = raw?.cnh || raw?.driver_license || raw?.carteira;
    if (cnh) parts.push(`CNH: ${String(cnh)}`);
    const rg = raw?.rg || raw?.id || raw?.identidade;
    if (rg) parts.push(`RG: ${String(rg)}`);
    return parts.length ? parts.join(" • ") : "";
  }

  function summarizeCEPItem(it: any): string {
    const parts: string[] = [];
    if (it?.cep) parts.push(`CEP: ${String(it.cep)}`);
    if (it?.ddd) parts.push(`DDD: ${String(it.ddd)}`);
    if (it?.ibge) parts.push(`IBGE: ${String(it.ibge)}`);
    return parts.length ? parts.join(" • ") : "";
  }

  function summarizeCPFItem(it: any): string {
    // Se for item de não encontrado, não sumariza para ocultar em "Somente itens com resumo"
    if (it?.not_found === true) return "";
    const cpf = it?.cpf as string | undefined;
    // Preferir campo booleano `valid` se presente; caso contrário, inferir pela descrição
    const valid = typeof it?.valid === "boolean"
      ? it.valid
      : (typeof it?.description === "string" && it.description.toLowerCase().includes("válido"));
    const parts: string[] = [];
    if (cpf) parts.push(`CPF: ${cpf}`);
    parts.push(`Validação: ${valid ? "válido" : "inválido"}`);
    return parts.join(" • ");
  }

  function summarizeCNPJItem(it: any): string {
    const parts: string[] = [];
    if (it?.cnpj) parts.push(`CNPJ: ${String(it.cnpj)}`);
    if (it?.status) parts.push(`Status: ${String(it.status)}`);
    const loc = [it?.city, it?.state].filter(Boolean).join("/");
    if (loc) parts.push(`Localidade: ${loc}`);
    if (it?.zip) parts.push(`CEP: ${String(it.zip)}`);
    const contact = [it?.phone, it?.email].filter(Boolean).join(", ");
    if (contact) parts.push(`Contato: ${contact}`);
    if (it?.mainActivity) parts.push(`Atividade: ${String(it.mainActivity)}`);
    return parts.length ? parts.join(" • ") : "";
  }

  const fields: Array<keyof Subject> = ["nome", "cpf", "telefone", "cep", "rg", "email", "cnh", "clt", "cnpj"];

  function updateField<K extends keyof Subject>(key: K, value: string) {
    setSubject((prev) => ({ ...prev, [key]: value }));
  }

  async function runOsint() {
    setLoading(true);
    setError(null);
    setDossierMd("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    try {
      const newResults: Record<string, Record<string, SearchResult[]>> = {};
      for (const field of fields) {
        const value = (subject[field] || "").trim();
        if (!value) continue;
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ query: value, providers: selectedProviders }),
          signal,
        });
        const ct = res.headers.get("content-type") || "";
        let data: any;
        if (ct.includes("application/json")) {
          data = await res.json();
        } else {
          const text = await res.text().catch(() => "");
          console.error("Resposta não JSON de /api/search", res.status, res.statusText, text.slice(0, 400));
          throw new Error(`Resposta não JSON (${res.status}) de /api/search`);
        }
        if (!res.ok) throw new Error(data?.error || `Falha na busca para ${field}`);
        newResults[field] = data?.results || {};
      }
      setResultsByField(newResults);
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("OSINT", "runOsint");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function generateDossier() {
    setError(null);
    abortDossierRef.current?.abort();
    abortDossierRef.current = new AbortController();
    const { signal } = abortDossierRef.current;
    try {
      const res = await fetch("/api/dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, resultsByField }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao gerar dossiê");
      setDossierMd(data?.markdown || "");
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("OSINT", "generateDossier");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
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
            {([
              "wikipedia",
              "duckduckgo",
              "github",
              "directdata",
              "cep",
              "cpf",
              "email_hibp",
              "phone",
              "phone_portabilidade",
              "clt_pis",
              "email_rep",
              "gravatar",
              "ddd_brasilapi",
              "clearbit_logo",
              "email_hunter",
              "cnpj",
            ] as Provider[]).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input type="checkbox" checked={providers[p]} onChange={(e) => setProviders((prev) => ({ ...prev, [p]: e.target.checked }))} />
                <span className="capitalize">{p === "directdata" ? "directdata (padrão)" : p}</span>
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlySummarized} onChange={(e) => setOnlySummarized(e.target.checked)} />
              <span>Somente itens com resumo</span>
            </label>
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
                          {(() => {
                            const baseItems = items.filter((it) => (it as any)?.not_found !== true);
                            const filteredItems = onlySummarized
                              ? baseItems.filter((it) => {
                                  const provName = String(prov || it.source || "");
                                  const extraSummary = provName === "directdata" && (it as any).raw
                                    ? summarizeDirectData((it as any).raw)
                                    : provName === "cep"
                                    ? summarizeCEPItem(it)
                                    : provName === "cpf"
                                    ? summarizeCPFItem(it)
                                    : provName === "cnpj"
                                    ? summarizeCNPJItem(it)
                                    : provName === "email_rep"
                                    ? summarizeEmailRepItem(it)
                                    : provName === "email_hunter"
                                    ? summarizeHunterItem(it)
                                    : provName === "gravatar"
                                    ? summarizeGravatarItem(it)
                                    : provName === "clearbit_logo"
                                    ? summarizeClearbitLogoItem(it)
                                    : provName === "email_hibp"
                                    ? summarizeHIBPItem(it)
                                    : provName === "clt_pis"
                                    ? summarizeCLTPISItem(it)
                                    : "";
                                  return Boolean(extraSummary);
                                })
                              : baseItems;
                            return filteredItems.length === 0 ? (
                              <li className="text-xs text-gray-600 italic">Dado inválido ou indisponível</li>
                            ) : (
                              filteredItems.map((it, idx) => {
                                const provName = String(prov || it.source || "");
                                const extraSummary = provName === "directdata" && (it as any).raw
                                  ? summarizeDirectData((it as any).raw)
                                  : provName === "cep"
                                  ? summarizeCEPItem(it)
                                  : provName === "cpf"
                                  ? summarizeCPFItem(it)
                                  : provName === "cnpj"
                                  ? summarizeCNPJItem(it)
                                  : provName === "email_rep"
                                  ? summarizeEmailRepItem(it)
                                  : provName === "email_hunter"
                                  ? summarizeHunterItem(it)
                                  : provName === "gravatar"
                                  ? summarizeGravatarItem(it)
                                  : provName === "clearbit_logo"
                                  ? summarizeClearbitLogoItem(it)
                                  : provName === "email_hibp"
                                  ? summarizeHIBPItem(it)
                                  : provName === "clt_pis"
                                  ? summarizeCLTPISItem(it)
                                  : provName === "phone_portabilidade"
                                  ? summarizePortabilidadeItem(it)
                                  : "";
                                return (
                                  <li key={idx} className="border rounded p-2">
                                    <div className="font-medium">{it.title || it.snippet}</div>
                                    {typeof (it as any).description === "string" && (it as any).description.trim().length > 0 && (
                                      <div className="text-xs text-gray-700 mt-1">{String((it as any).description)}</div>
                                    )}
                                    {extraSummary && (
                                      <div className="text-xs text-gray-700 mt-1">{extraSummary}</div>
                                    )}
                                    {(it as any).raw ? (
                                      <details className="mt-1">
                                        <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                        <div className="flex items-center gap-2 mt-1">
                                          <button
                                            className="text-xs px-2 py-1 border rounded"
                                            onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2))}
                                          >
                                            Copiar JSON
                                          </button>
                                        </div>
                                        <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                      </details>
                                    ) : null}
                                    {it.url && (
                                      <a href={it.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{it.url}</a>
                                    )}
                                  </li>
                                );
                              })
                            );
                          })()}
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
        <fieldset className="space-y-1">
          <legend className="font-semibold">CNPJ</legend>
          <div className="flex gap-2">
            <input
              type="text"
              value={subject.cnpj || ""}
              onChange={(e) => setSubject({ ...subject, cnpj: e.target.value })}
              placeholder="Digite o CNPJ (14 dígitos)"
              className="border px-2 py-1 rounded w-full"
            />
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={providers["cnpj"]}
                onChange={(e) => setProviders((prev) => ({ ...prev, cnpj: e.target.checked }))}
              />
              <span>Buscar CNPJ</span>
            </label>
          </div>
        </fieldset>
      </div>
    </main>
  );
}

function summarizeEmailRepItem(it: any): string {
  const rep = typeof it?.reputation === "string" ? it.reputation : undefined;
  const susp = typeof it?.suspicious === "boolean" ? it.suspicious : undefined;
  const dom = typeof it?.domain === "string" ? it.domain : undefined;
  const parts: string[] = [];
  if (rep) parts.push(`Reputação: ${rep}`);
  if (typeof susp === "boolean") parts.push(`Suspeito: ${susp ? "sim" : "não"}`);
  if (dom) parts.push(`Domínio: ${dom}`);
  return parts.join(" • ");
}

function summarizeHunterItem(it: any): string {
  const result = it?.result;
  const score = typeof it?.score === "number" ? it.score : undefined;
  const parts: string[] = [];
  if (result) parts.push(`Resultado: ${String(result)}`);
  if (typeof score === "number") parts.push(`Score: ${score}`);
  return parts.join(" • ");
}

function summarizeGravatarItem(it: any): string {
  const hash = it?.hash;
  const avatar = it?.avatar;
  const parts: string[] = [];
  if (hash) parts.push(`Hash: ${String(hash)}`);
  if (avatar) parts.push(`Avatar disponível`);
  return parts.join(" • ");
}

function summarizeClearbitLogoItem(it: any): string {
  const domain = it?.domain;
  return domain ? `Domínio: ${String(domain)}` : "";
}

function summarizeHIBPItem(it: any): string {
  const breach = it?.breach;
  return breach ? `Breache: ${String(breach)}` : (typeof it?.description === "string" ? it.description : "");
}

function summarizeCLTPISItem(it: any): string {
  const pis = it?.pis;
  const desc = typeof it?.description === "string" ? it.description : "";
  const parts: string[] = [];
  if (pis) parts.push(`PIS/NIT: ${String(pis)}`);
  if (desc) parts.push(desc);
  return parts.join(" • ");
}

function summarizePortabilidadeItem(it: any): string {
  const ddd = it?.ddd;
  const phone = it?.phone;
  const operadora = it?.operadora;
  const situacao = it?.situacao;
  const tecnologia = it?.tecnologia;
  const atualizado = it?.atualizado;
  const parts: string[] = [];
  if (ddd) parts.push(`DDD: ${String(ddd)}`);
  if (phone) parts.push(`Número: ${String(phone)}`);
  if (operadora) parts.push(`Prestadora: ${String(operadora)}`);
  if (situacao) parts.push(`Situação: ${String(situacao)}`);
  if (tecnologia) parts.push(`Tecnologia: ${String(tecnologia)}`);
  if (atualizado) parts.push(`Atualizado: ${String(atualizado)}`);
  return parts.join(" • ");
}