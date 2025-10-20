"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { logAbortDev, isAbortError } from "@/lib/devLog";

type Provider = "wikipedia" | "duckduckgo" | "github" | "directdata";

type SearchResult = {
  title?: string;
  snippet?: string;
  url?: string;
  source?: string;
  [key: string]: unknown;
};

function summarizeDirectData(raw: any): string {
  const parts: string[] = [];
  const ret = raw?.retorno || raw;
  const name = (ret?.name || ret?.nome) as string | undefined;
  if (name) parts.push(`Nome: ${name}`);
  const dob = (ret?.dob || ret?.dateOfBirth || ret?.birth_date || ret?.nascimento) as string | undefined;
  if (dob) parts.push(`Nascimento: ${dob}`);
  const address = ret?.address || (Array.isArray(ret?.addresses) ? ret.addresses[0] : null);
  if (address) {
    const city = address?.city || address?.localidade;
    const state = address?.state || address?.uf;
    const street = address?.street || address?.logradouro;
    const zip = address?.zip || address?.postalCode || address?.cep;
    const addr = [street, city && state ? `${city}-${state}` : city || state, zip].filter(Boolean).join(", ");
    if (addr) parts.push(`Endereço: ${addr}`);
  }
  const phonesArr = Array.isArray(ret?.phones) ? ret.phones : (ret?.phone ? [ret.phone] : []);
  const phones = phonesArr.filter(Boolean).slice(0, 2).map((p: any) => {
    if (typeof p === "string") return p;
    const area = p?.area || p?.ddd;
    const num = p?.number || p?.numero;
    return area && num ? `(${area}) ${num}` : (num || area || "");
  }).filter(Boolean).join(", ");
  if (phones) parts.push(`Telefones: ${phones}`);
  const emailsArr = Array.isArray(ret?.emails) ? ret.emails : (ret?.email ? [ret.email] : []);
  const emails = emailsArr.filter(Boolean).slice(0, 2).map((e: any) => typeof e === "string" ? e : (e?.address || e?.email || "")).filter(Boolean).join(", ");
  if (emails) parts.push(`Emails: ${emails}`);
  const cnh = ret?.cnh || ret?.driver_license || ret?.carteira;
  if (cnh) parts.push(`CNH: ${String(cnh)}`);
  const rg = ret?.rg || ret?.id || ret?.identidade;
  if (rg) parts.push(`RG: ${String(rg)}`);
  return parts.length ? parts.join(" • ") : "";
}

export default function Home() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const abortHistoryRef = useRef<AbortController | null>(null);
  const abortGithubRef = useRef<AbortController | null>(null);
  const abortSupabaseSaveRef = useRef<AbortController | null>(null);
  const abortSupabaseHistoryRef = useRef<AbortController | null>(null);
  useEffect(() => { return () => {
    abortRef.current?.abort();
    abortHistoryRef.current?.abort();
    abortGithubRef.current?.abort();
    abortSupabaseSaveRef.current?.abort();
    abortSupabaseHistoryRef.current?.abort();
  }; }, []);
  useEffect(() => {
    // Redireciona a home para o modo profissional
    router.replace("/profissional");
  }, [router]);

  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<Record<Provider, boolean>>({
    wikipedia: true,
    duckduckgo: true,
    github: true,
    directdata: false,
  });
  const [results, setResults] = useState<Record<string, any[]>>({});
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
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, providers: selectedProviders }),
        signal,
      });

      const ct = res.headers.get("content-type") || "";
      let data: any;
      if (ct.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text().catch(() => "");
        console.error("[Home] Resposta não JSON de /api/search", res.status, res.statusText, text.slice(0, 400));
        throw new Error(`Resposta não JSON (${res.status}) de /api/search`);
      }

      if (!res.ok) throw new Error(data?.error || "Falha na busca");
      setResults(data.results || {});
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("Home", "onSearch");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setError(null);
    abortHistoryRef.current?.abort();
    abortHistoryRef.current = new AbortController();
    const { signal } = abortHistoryRef.current;
    try {
      const res = await fetch("/api/history", { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar histórico");
      setHistory(data?.files || []);
      setHistoryPage(1);
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("Home", "loadHistory");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function sendToGitHub() {
    setError(null);
    abortGithubRef.current?.abort();
    abortGithubRef.current = new AbortController();
    const { signal } = abortGithubRef.current;
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao enviar ao GitHub");
      alert(`Enviado ao GitHub! commit: ${data?.commit || "(ok)"}`);
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("Home", "sendToGitHub");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    }
  }

  async function saveToSupabase() {
    setError(null);
    abortSupabaseSaveRef.current?.abort();
    abortSupabaseSaveRef.current = new AbortController();
    const { signal } = abortSupabaseSaveRef.current;
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao salvar no Supabase");
      alert("Salvo no Supabase!");
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("Home", "saveToSupabase");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    }
  }

  async function loadSupabaseHistory() {
    setSupabaseHistoryLoading(true);
    setError(null);
    abortSupabaseHistoryRef.current?.abort();
    abortSupabaseHistoryRef.current = new AbortController();
    const { signal } = abortSupabaseHistoryRef.current;
    try {
      const res = await fetch("/api/supabase/history", { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar histórico do Supabase");
      setSupabaseHistory(data?.items || []);
      setSupabaseHistoryPage(1);
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("Home", "loadSupabaseHistory");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    } finally {
      setSupabaseHistoryLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Conteúdo legacy permanece por compatibilidade, mas a navegação vai imediatamente para /profissional */}
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Investiga</h1>
        <p className="text-sm mb-6">Redirecionando para o modo profissional…</p>
      </div>
    </main>
  );
}
