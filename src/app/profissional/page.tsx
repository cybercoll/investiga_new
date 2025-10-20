"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Search, FileSpreadsheet, FileText, Home, Globe, User, ChevronRight, X, Plug, List, Sun, Moon, Copy } from "lucide-react";
import { useToast } from "../ToastProvider";
import { logAbortDev, isAbortError } from "@/lib/devLog";

// Provedores disponíveis no agregador
type Provider =
  | "wikipedia"
  | "duckduckgo"
  | "github"
  | "directdata"
  | "cep"
  | "cpf"
  | "cnpj"
  | "phone"
  | "phone_portabilidade"
  | "ddd_brasilapi"
  | "ddd_apibrasil"
  | "datajud";

const providerLabels: Record<Provider, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  cep: "CEP",
  phone: "Telefone",
  ddd_brasilapi: "BrasilAPI (DDD)",
  ddd_apibrasil: "Anatel (APIBrasil)",
  duckduckgo: "DuckDuckGo",
  github: "GitHub",
  wikipedia: "Wikipedia",
  directdata: "DirectData (pago)",
  phone_portabilidade: "Portabilidade (ABR Telecom)",
  datajud: "Datajud (CNJ)",
};

type SearchResult = {
  title?: string;
  snippet?: string;
  description?: string;
  url?: string;
  source?: string;
  [key: string]: unknown;
};

// Dados da busca
type Subject = {
  cpf?: string; // armazenado como dígitos (sem máscara)
  cnpj?: string; // armazenado como dígitos (sem máscara)
  rg?: string;
  cep?: string; // dígitos
  celular?: string; // dígitos (DDD + número)
  nome?: string; // nome completo ou parcial
};

// Helpers de máscara/validação
const onlyDigits = (s: string) => s.replace(/\D+/g, "");

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

function formatCPF(value: string) {
  const s = onlyDigits(value).slice(0, 11);
  if (s.length <= 3) return s;
  if (s.length <= 6) return `${s.slice(0, 3)}.${s.slice(3)}`;
  if (s.length <= 9) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6)}`;
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}

function formatCNPJ(value: string) {
  const s = onlyDigits(value).slice(0, 14);
  if (s.length <= 2) return s;
  if (s.length <= 5) return `${s.slice(0, 2)}.${s.slice(2)}`;
  if (s.length <= 8) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5)}`;
  if (s.length <= 12) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8)}`;
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

function isValidCNPJ(value: string) {
  const s = onlyDigits(value);
  if (s.length !== 14) return false;
  if (/^(.)\1{13}$/.test(s)) return false; // todos dígitos iguais
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(s.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(s.slice(0, 12) + String(d1), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return s[12] === String(d1) && s[13] === String(d2);
}

function isValidCPF(value: string) {
  const s = onlyDigits(value);
  if (s.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(s)) return false; // todos dígitos iguais
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(s[i]) * (len + 1 - i);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(9) === parseInt(s[9]) && calc(10) === parseInt(s[10]);
}

function formatCEP(value: string) {
  const s = onlyDigits(value).slice(0, 8);
  if (s.length <= 5) return s;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

function isValidCEP(value: string) {
  const s = onlyDigits(value);
  return s.length === 8;
}

function formatCelular(value: string) {
  const s = onlyDigits(value).slice(0, 11);
  if (s.length <= 2) return s;
  if (s.length <= 6) return `(${s.slice(0, 2)}) ${s.slice(2)}`;
  if (s.length <= 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`; // 11 dígitos
}

function isValidCelular(value: string) {
  const s = onlyDigits(value);
  return s.length === 10 || s.length === 11;
}

function validationMessage(field: keyof Subject, rawDigits: string): string | null {
  if (!rawDigits) return null;
  if (field === "nome") {
    const s = String(rawDigits).trim();
    return s.length < 3 ? "Nome muito curto" : null;
  }
  if (field === "cpf" && !isValidCPF(rawDigits)) return "CPF inválido";
  if (field === "cnpj" && !isValidCNPJ(rawDigits)) return "CNPJ inválido";
  if (field === "cep" && !isValidCEP(rawDigits)) return "CEP inválido";
  if (field === "celular" && !isValidCelular(rawDigits)) return "Celular inválido";
  return null;
}

function displayValue(field: keyof Subject, value?: string) {
  const raw = value || "";
  if (field === "cpf") return formatCPF(raw);
  if (field === "cnpj") return formatCNPJ(raw);
  if (field === "cep") return formatCEP(raw);
  if (field === "celular") return formatCelular(raw);
  return raw;
}

function summarizeCNPJ(raw: any): { summary: string; directors: string[]; phones: string[]; emails: string[]; address?: string } {
  if (!raw || typeof raw !== "object") return { summary: "", directors: [], phones: [], emails: [] };
  const company = raw.company || {};
  const name = company.name || raw.name || "Empresa";
  const alias = raw.alias ? ` (${raw.alias})` : "";
  const status = raw.status?.text;
  const nature = raw.nature?.text || raw.legalNature?.text;
  const size = raw.size?.text;
  const mainActivity = raw.mainActivity?.text;
  const founded = raw.founded;
  const address = raw.address || {};
  const addressStr = [address.street, address.number, address.complement, address.district, address.city && address.state ? `${address.city} (${address.state})` : (address.city || address.state), address.zip].filter(Boolean).join(", ");
  const phones: string[] = Array.isArray(raw.phones) ? raw.phones.map((p: any) => `${p.area}-${p.number}`).filter(Boolean) : [];
  const emails: string[] = Array.isArray(raw.emails) ? raw.emails.map((e: any) => e.address).filter(Boolean) : [];
  const directors: string[] = Array.isArray(company.members) ? company.members.map((m: any) => m?.person?.name).filter(Boolean) : [];
  const summaryParts = [
    `${name}${alias}`,
    status,
    nature,
    size,
    mainActivity,
    founded ? `Fundada: ${founded}` : undefined,
    addressStr,
  ].filter(Boolean);
  const summary = summaryParts.join(" • ");
  return { summary, directors, phones, emails, address: addressStr };
}

function escapeCSV(v: unknown) {
  if (v === null || v === undefined) return "";
  let s = String(v).replace(/"/g, '""');
  if (/[",\n]/.test(s)) s = '"' + s + '"';
  return s;
}

function buildCSV(
  resultsByField: Record<string, Record<string, SearchResult[]>>,
  filterFn?: (it: SearchResult, field: string, provider: string) => boolean
) {
  const header = ["campo", "provedor", "titulo", "descricao", "url", "fonte", "data", "json", "raw"].join(",");
  const rows: string[] = [header];

  const pickDate = (obj: any): unknown => {
    if (!obj || typeof obj !== "object") return "";
    const candidates = ["date", "created_at", "updated_at", "time", "timestamp"];
    for (const k of candidates) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return "";
  };

  for (const [field, byProv] of Object.entries(resultsByField)) {
    for (const [prov, items] of Object.entries(byProv || {})) {
      for (const it of items || []) {
        if (filterFn && !filterFn(it, field, prov)) continue;
        const dateVal = pickDate(it);
        const jsonStr = (() => {
          try { return JSON.stringify(it); } catch { return ""; }
        })();
        const rawStr = (() => {
          const raw = (it as any)?.raw;
          try { return raw !== undefined ? JSON.stringify(raw) : ""; } catch { return ""; }
        })();
        rows.push(
          [
            escapeCSV(field),
            escapeCSV(prov),
            escapeCSV(it.title || it.snippet || ""),
            escapeCSV((it.description as string) || it.snippet || ""),
            escapeCSV(it.url || ""),
            escapeCSV(it.source || prov),
            escapeCSV(dateVal),
            escapeCSV(jsonStr),
            escapeCSV(rawStr),
          ].join(","),
        );
      }
    }
  }
  return rows.join("\n");
}

export default function ProfissionalPage() {
  const toast = useToast();
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);
  const [subject, setSubject] = useState<Subject>({});
  const [errors, setErrors] = useState<Record<keyof Subject, string | null>>({ cpf: null, cnpj: null, rg: null, cep: null, celular: null, nome: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultsByField, setResultsByField] = useState<Record<string, Record<string, SearchResult[]>>>({});
  // DDD feedback
  const [dddFeedback, setDddFeedback] = useState<{ ddd?: string; state?: string; cities?: string[]; message?: string } | null>(null);
  const [dddFeedbackKind, setDddFeedbackKind] = useState<"ok" | "warn" | "error" | "info" | "neutral" | null>(null);
  const [dddLoading, setDddLoading] = useState(false);
  // Filtros e ordenação por campo
  const [selectedProviderByField, setSelectedProviderByField] = useState<Record<string, string>>({});
  const [sortByField, setSortByField] = useState<Record<string, { key: "title" | "source" | "url" | "description"; dir: "asc" | "desc" }>>({});
  const [pageByGroup, setPageByGroup] = useState<Record<string, number>>({});
  const PAGE_SIZE = 10;
  // Filtros globais e modo de exportação XLSX
  const [globalKeyword, setGlobalKeyword] = useState("");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [xlsxMode, setXlsxMode] = useState<"single" | "per_field" | "per_provider" | "field_provider">("single");

  // Cruzamento de informações
  const [onlyCrossed, setOnlyCrossed] = useState(false);
  const [autoEnrichment, setAutoEnrichment] = useState(true);
  const [preferAnatelNoFallback, setPreferAnatelNoFallback] = useState(false);
  const [extractNamesFromText, setExtractNamesFromText] = useState(false);
  const [hideGenericNames, setHideGenericNames] = useState(true);
  const [forceGenericProviders, setForceGenericProviders] = useState(false);
  const [forceDuckDuckGoForCnpj, setForceDuckDuckGoForCnpj] = useState(false);
  const [forceDuckDuckGoForCpf, setForceDuckDuckGoForCpf] = useState(false);
  const [refineDuckDuckGoForCpfCnpj, setRefineDuckDuckGoForCpfCnpj] = useState(false);
  const [refineDuckDuckGoForNomeRg, setRefineDuckDuckGoForNomeRg] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const v = params.get("anatel_no_fallback") || params.get("preferAnatelNoFallback") || "";
      if (v && ["1", "true", "on", "yes"].includes(v.toLowerCase())) {
        setPreferAnatelNoFallback(true);
      }
    } catch {}
  }, []);
  // Persistência de preferências do modo profissional — movida abaixo de providers
  type CrossGroup = {
    type: "cpf" | "cnpj" | "cep" | "phone" | "email" | "name";
    value: string;
    matches: Array<{ field: string; provider: string; title?: string; url?: string; source?: string; description?: string }>;
  };
  const [crossGroups, setCrossGroups] = useState<CrossGroup[]>([]);
  const [crossMembership, setCrossMembership] = useState<Record<string, true>>({});

  // Tema claro/escuro (persistente)
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      const t = saved === "dark" ? "dark" : saved === "light" ? "light"
        : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", t);
      setTheme(t);
    } catch {}
  }, []);
  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch {}
    setTheme(t);
  };

  // Toggles de provedores por campo
  const [providers, setProviders] = useState<Record<Provider, boolean>>({
    cpf: true,
    cnpj: true,
    cep: true,
    phone: true,
    ddd_brasilapi: true,
    ddd_apibrasil: true,
    phone_portabilidade: false,
    duckduckgo: true,
    github: false,
    wikipedia: true,
    directdata: true, // opcional (RG) se houver API paga configurada
    datajud: true,
  });

  // Persistência de preferências do modo profissional (agora após providers)
  useEffect(() => {
    try {
      const storedProviders = localStorage.getItem("pro.providers");
      if (storedProviders) {
        const saved = JSON.parse(storedProviders);
        if (saved && typeof saved === "object") {
          setProviders((prev) => ({ ...prev, ...saved }));
        }
      }
      const auto = localStorage.getItem("pro.autoEnrichment");
      if (auto !== null) setAutoEnrichment(auto === "true");
      const crossed = localStorage.getItem("pro.onlyCrossed");
      if (crossed !== null) setOnlyCrossed(crossed === "true");
      const extractTextNames = localStorage.getItem("pro.extractNamesFromText");
      if (extractTextNames !== null) setExtractNamesFromText(extractTextNames === "true");
      const hideCommonNames = localStorage.getItem("pro.hideGenericNames");
      if (hideCommonNames !== null) setHideGenericNames(hideCommonNames === "true");
      const forceGeneric = localStorage.getItem("pro.forceGenericProviders");
      if (forceGeneric !== null) setForceGenericProviders(forceGeneric === "true");
      const forceCnpjDdg = localStorage.getItem("pro.forceDuckDuckGoForCnpj");
      if (forceCnpjDdg !== null) setForceDuckDuckGoForCnpj(forceCnpjDdg === "true");
      const forceCpfDdg = localStorage.getItem("pro.forceDuckDuckGoForCpf");
      if (forceCpfDdg !== null) setForceDuckDuckGoForCpf(forceCpfDdg === "true");
      const refineCpfCnpj = localStorage.getItem("pro.refineDuckDuckGoForCpfCnpj");
      if (refineCpfCnpj !== null) setRefineDuckDuckGoForCpfCnpj(refineCpfCnpj === "true");
      const refineNomeRg = localStorage.getItem("pro.refineDuckDuckGoForNomeRg");
      if (refineNomeRg !== null) setRefineDuckDuckGoForNomeRg(refineNomeRg === "true");
      const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const hasUrlAnatel = urlParams.has("anatel_no_fallback") || urlParams.has("preferAnatelNoFallback");
      if (!hasUrlAnatel) {
        const anatel = localStorage.getItem("pro.preferAnatelNoFallback");
        if (anatel !== null) setPreferAnatelNoFallback(anatel === "true");
      }
      const shortNames = localStorage.getItem("pro.useShortSheetNames");
      if (shortNames !== null) setUseShortSheetNames(shortNames === "true");
    } catch {}
  }, []);
  const [useShortSheetNames, setUseShortSheetNames] = useState(false);
  useEffect(() => { try { localStorage.setItem("pro.providers", JSON.stringify(providers)); } catch {} }, [providers]);
  useEffect(() => { try { localStorage.setItem("pro.autoEnrichment", String(autoEnrichment)); } catch {} }, [autoEnrichment]);
  useEffect(() => { try { localStorage.setItem("pro.onlyCrossed", String(onlyCrossed)); } catch {} }, [onlyCrossed]);
  useEffect(() => { try { localStorage.setItem("pro.preferAnatelNoFallback", String(preferAnatelNoFallback)); } catch {} }, [preferAnatelNoFallback]);
  useEffect(() => { try { localStorage.setItem("pro.useShortSheetNames", String(useShortSheetNames)); } catch {} }, [useShortSheetNames]);
  useEffect(() => { try { localStorage.setItem("pro.extractNamesFromText", String(extractNamesFromText)); } catch {} }, [extractNamesFromText]);
  useEffect(() => { try { localStorage.setItem("pro.hideGenericNames", String(hideGenericNames)); } catch {} }, [hideGenericNames]);
  useEffect(() => { try { localStorage.setItem("pro.forceGenericProviders", String(forceGenericProviders)); } catch {} }, [forceGenericProviders]);
  useEffect(() => { try { localStorage.setItem("pro.forceDuckDuckGoForCnpj", String(forceDuckDuckGoForCnpj)); } catch {} }, [forceDuckDuckGoForCnpj]);
  useEffect(() => { try { localStorage.setItem("pro.forceDuckDuckGoForCpf", String(forceDuckDuckGoForCpf)); } catch {} }, [forceDuckDuckGoForCpf]);
  useEffect(() => { try { localStorage.setItem("pro.refineDuckDuckGoForCpfCnpj", String(refineDuckDuckGoForCpfCnpj)); } catch {} }, [refineDuckDuckGoForCpfCnpj]);
  useEffect(() => { try { localStorage.setItem("pro.refineDuckDuckGoForNomeRg", String(refineDuckDuckGoForNomeRg)); } catch {} }, [refineDuckDuckGoForNomeRg]);
  type ExportCols = { consulta: boolean; data: boolean; endereco: boolean; telefones: boolean; emails: boolean; diretores: boolean; json: boolean; raw: boolean };
  const [exportCols, setExportCols] = useState<ExportCols>({ consulta: false, data: true, endereco: false, telefones: false, emails: false, diretores: false, json: true, raw: true });
  type ExportPreset = "Minimal" | "Completo" | "Investigação" | "Analítico" | null;
  const [exportPreset, setExportPreset] = useState<ExportPreset>(null);
  // Ordem dinâmica das colunas exportáveis
  type DynKey = "consulta" | "data" | "endereco" | "telefones" | "emails" | "diretores" | "json" | "raw";
  const defaultExportOrder: DynKey[] = ["consulta", "data", "endereco", "telefones", "emails", "diretores", "json", "raw"];
  const [exportOrder, setExportOrder] = useState<DynKey[]>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("pro.exportOrder") : null;
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          const valid = arr.filter((k: any) => (defaultExportOrder as string[]).includes(k));
          if (valid.length) return valid as DynKey[];
        }
      }
    } catch {}
    return defaultExportOrder;
  });
  useEffect(() => { try { localStorage.setItem("pro.exportOrder", JSON.stringify(exportOrder)); } catch {} }, [exportOrder]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  function applyPreset(name: ExportPreset) {
    if (!name) return;
    if (name === "Minimal") {
      setExportCols({ consulta: true, data: true, endereco: true, telefones: true, emails: true, diretores: false, json: false, raw: false });
    } else if (name === "Completo") {
      setExportCols({ consulta: true, data: true, endereco: true, telefones: true, emails: true, diretores: true, json: true, raw: true });
    } else if (name === "Investigação") {
      setExportCols({ consulta: true, data: true, endereco: true, telefones: true, emails: true, diretores: true, json: false, raw: false });
    } else if (name === "Analítico") {
      // Ativa colunas relevantes e define ordem específica
      setExportCols({ consulta: true, data: true, endereco: true, telefones: true, emails: true, diretores: true, json: true, raw: true });
      setExportOrder(["consulta", "data", "telefones", "emails", "endereco", "diretores", "json", "raw"]);
    }
    setExportPreset(name);
  }
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pro.exportCols");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") setExportCols((prev) => ({ ...prev, ...parsed }));
      }
      const preset = localStorage.getItem("pro.exportPreset");
      if (preset) setExportPreset(preset as ExportPreset);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("pro.exportCols", JSON.stringify(exportCols)); } catch {} }, [exportCols]);
  useEffect(() => { try { localStorage.setItem("pro.exportPreset", exportPreset || ""); } catch {} }, [exportPreset]);
  const [showProvidersMenu, setShowProvidersMenu] = useState(false);

  function inputClass(field: keyof Subject) {
    const hasVal = Boolean(subject[field]);
    const invalid = Boolean(errors[field]);
    const base = "input-brand w-full";
    if (!hasVal) return base;
    return base + " " + (invalid ? "border-red-600 focus:ring-red-500" : "border-green-600 focus:ring-green-500");
  }

  function updateField<K extends keyof Subject>(key: K, value: string) {
    let normalized = value;
    if (key === "nome") normalized = value.trim();
    else if (key === "cpf" || key === "cnpj" || key === "cep" || key === "celular") normalized = onlyDigits(value);
    setSubject((prev) => ({ ...prev, [key]: normalized }));
    setErrors((prev) => ({ ...prev, [key]: validationMessage(key, normalized) }));
    if (key === "celular") {
      setDddFeedback(null);
      setDddFeedbackKind(null);
    }
  }

  function providersForField(field: keyof Subject): Provider[] {
    const active = (p: Provider) => providers[p];
    if (field === "cpf") {
      const arr: Provider[] = ["cpf"];
      if (providers["directdata"]) arr.push("directdata");
      if (forceDuckDuckGoForCpf && providers["duckduckgo"]) arr.push("duckduckgo");
      return arr.filter(active);
    }
    if (field === "cnpj") {
      const arr: Provider[] = ["cnpj"];
      if (providers["directdata"]) arr.push("directdata");
      if (forceDuckDuckGoForCnpj && providers["duckduckgo"]) arr.push("duckduckgo");
      return arr.filter(active);
    }
    if (field === "cep") {
      const arr: Provider[] = ["cep"];
      return arr.filter(active);
    }
    if (field === "celular") {
      const arr: Provider[] = ["phone", "phone_portabilidade", "ddd_brasilapi", "ddd_apibrasil"];
      if (providers["directdata"]) arr.push("directdata");
      return arr.filter(active);
    }
    if (field === "rg") {
      const arr: Provider[] = [];
      if (providers["directdata"]) arr.push("directdata");
      if (providers["duckduckgo"]) arr.push("duckduckgo");
      return arr;
    }
    if (field === "nome") {
      const arr: Provider[] = [];
      const val = String((subject as any)?.nome || "");
      const generic = isGenericName(val);
      const allowGeneric = forceGenericProviders || !generic;
      if (providers["datajud"]) arr.push("datajud");
      if (allowGeneric && providers["duckduckgo"]) arr.push("duckduckgo");
      if (allowGeneric && providers["wikipedia"]) arr.push("wikipedia");
      return arr;
    }
    return [];
  }

  function getItemDate(it: SearchResult): Date | null {
    const cand = (it as any).date || (it as any).created_at || (it as any).updated_at || (it as any).time || (it as any).timestamp;
    if (!cand) return null;
    try {
      if (typeof cand === "number") return new Date(cand);
      const s = String(cand);
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  function applyGlobalFilters(items: SearchResult[]) {
    const kw = globalKeyword.trim().toLowerCase();
    const hasKW = kw.length > 0;
    return items.filter((it) => {
      const okKW = !hasKW
        ? true
        : [it.title, it.description, it.snippet, it.url, it.source]
            .map((v) => String(v || "").toLowerCase())
            .some((v) => v.includes(kw));
      if (!okKW) return false;
      if (!dateStart && !dateEnd) return true;
      const d = getItemDate(it);
      if (!d) return false;
      if (dateStart && d < new Date(dateStart)) return false;
      if (dateEnd) {
        const end = new Date(dateEnd);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
      return true;
    });
  }

  // Helpers para cruzamento
  function normCPF(s: string) { return onlyDigits(s).slice(0, 11); }
  function normCNPJ(s: string) { return onlyDigits(s).slice(0, 14); }
  function normCEP(s: string) { return onlyDigits(s).slice(0, 8); }
  function normPhone(s: string) { const d = onlyDigits(s); return d.length >= 10 ? d.slice(0, 11) : ""; }
  function normEmail(s: string) { return String(s || "").trim().toLowerCase(); }
  function stripAccents(s: string) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ç/gi, "c");
  }
  function normName(s: string) {
    const base = stripAccents(String(s || "").trim().toLowerCase().replace(/\s+/g, " "));
    const stop = new Set(["de","da","do","dos","das","e","y","d'","del","di"]);
    const tokens = base.split(" ").filter(Boolean).filter((t) => !stop.has(t));
    return tokens.join(" ");
  }
  function formatName(value: string) {
    const s = String(value || "");
    return s.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  }

  function isGenericName(value: string) {
    const s = normName(value);
    if (!s) return true;
    const tokens = s.split(" ").filter(Boolean);
    if (tokens.length <= 1) return true;
    const commonFirst = [
      "maria","joao","jose","ana","carlos","paulo","luiz","lucas","pedro","antonio","marcos","roberto",
      "bruno","gabriel","rafael","rodrigo","andre","fernando","francisco","juliana","patricia","aline","claudio"
    ];
    const commonLast = [
      "silva","santos","souza","pereira","almeida","costa","rodrigues","ferreira","oliveira","lima",
      "araujo","mendes","barbosa","ribeiro","carvalho","gomes","martins","pinto","teixeira","morais","miranda","medeiros"
    ];
    const len = tokens.length;
    if (len <= 2 && s.length <= 14) return true;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if ((commonFirst.includes(first) && commonLast.includes(last)) && len <= 3) return true;
    return false;
  }

  function extractFromText(s: string) {
    const cpfsFmt = Array.from(s.matchAll(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g)).map((m) => normCPF(m[0]));
    const cpfsRaw = Array.from(s.matchAll(/\b\d{11}\b/g)).map((m) => normCPF(m[0]));
    const cnpjsFmt = Array.from(s.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)).map((m) => normCNPJ(m[0]));
    const cnpjsRaw = Array.from(s.matchAll(/\b\d{14}\b/g)).map((m) => normCNPJ(m[0]));
    const ceps = Array.from(s.matchAll(/\b\d{5}-?\d{3}\b/g)).map((m) => normCEP(m[0]));
    const phones = Array.from(s.matchAll(/\b(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}\b/g)).map((m) => normPhone(m[0]));
    const emails = Array.from(s.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)).map((m) => normEmail(m[0]));
    const cpfSet = [...new Set([...cpfsFmt, ...cpfsRaw].filter((v) => v.length === 11))];
    const cnpjSet = [...new Set([...cnpjsFmt, ...cnpjsRaw].filter((v) => v.length === 14))];
    const cepSet = [...new Set(ceps.filter((v) => v.length === 8))];
    const phoneSet = [...new Set(phones.filter((v) => v.length === 10 || v.length === 11))];
    const emailSet = [...new Set(emails.filter(Boolean))];

    let nameSet: string[] = [];
    if (extractNamesFromText) {
      const candidates: string[] = [];
      const nameRegex = /\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+(?:de|da|do|dos|das|e|y|d')?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)+)\b/g;
      for (const m of s.matchAll(nameRegex)) {
        const candidate = normName(m[1]);
        const tokens = candidate.split(" ").filter(Boolean);
        if (tokens.length < 2 || tokens.length > 6) continue;
        candidates.push(candidate);
      }
      nameSet = [...new Set(candidates)].filter((v) => v.length > 6);
    }

    return { cpf: cpfSet, cnpj: cnpjSet, cep: cepSet, phone: phoneSet, email: emailSet, name: nameSet };
  }

  function extractAttributes(it: SearchResult): { cpf: string[]; cnpj: string[]; cep: string[]; phone: string[]; email: string[]; name: string[] } {
    const acc = { cpf: [] as string[], cnpj: [] as string[], cep: [] as string[], phone: [] as string[], email: [] as string[], name: [] as string[] };
    const anyIt: any = it as any;
    const raw = anyIt?.raw;
    const push = (arr: string[], v?: any) => { if (!v && v !== 0) return; const s = String(v); if (!s) return; arr.push(s); };
    // Extrai de raw (directdata/cnpj/datajud)
    if (raw) {
      push(acc.cpf, raw?.cpf);
      push(acc.cnpj, raw?.cnpj);
      const addr = raw?.address || (Array.isArray(raw?.addresses) ? raw.addresses[0] : null);
      if (addr) { push(acc.cep, addr?.zip || addr?.cep); }
      const phonesArr = Array.isArray(raw?.phones) ? raw.phones : (raw?.phone ? [raw.phone] : []);
      phonesArr.forEach((p: any) => { if (typeof p === "string") push(acc.phone, p); else push(acc.phone, `${p?.area || p?.ddd || ""}${p?.number || p?.numero || ""}`); });
      const emailsArr = Array.isArray(raw?.emails) ? raw.emails : (raw?.email ? [raw.email] : []);
      emailsArr.forEach((e: any) => { if (typeof e === "string") push(acc.email, e); else push(acc.email, e?.address || e?.email); });
      // nomes comuns nos retornos
      push(acc.name, (raw?.retorno && (raw as any).retorno?.Nome) || (raw as any).Nome || (raw as any).nome || (raw as any).name);
      if (Array.isArray((raw as any)?.partes)) ((raw as any).partes as any[]).forEach((p: any) => push(acc.name, typeof p === "string" ? p : (p?.nome || p?.name)));
      const company = (raw as any)?.company;
      if (company) {
        push(acc.name, company?.name);
        if (Array.isArray(company?.members)) {
          (company.members as any[]).forEach((m: any) => push(acc.name, m?.person?.name || m?.name));
        }
      }
      push(acc.name, (raw as any)?.alias);
    }
    // Campos diretos no item
    push(acc.cpf, anyIt?.cpf);
    push(acc.cnpj, anyIt?.cnpj);
    push(acc.cep, anyIt?.cep);
    [anyIt?.phone, anyIt?.telefone, anyIt?.celular, anyIt?.mobile].forEach((v) => push(acc.phone, v));
    const emailsCandidates = [anyIt?.email, anyIt?.mail];
    emailsCandidates.forEach((v) => push(acc.email, v));
    if (Array.isArray(anyIt?.emails)) (anyIt.emails as any[]).forEach((v) => push(acc.email, v));
    // Datajud: partes no item
    if (Array.isArray((anyIt as any)?.partes)) ((anyIt as any).partes as any[]).forEach((p: any) => push(acc.name, typeof p === "string" ? p : (p?.nome || p?.name)));
    // Extrai de texto
    const text = [it.title, it.description, it.snippet, it.url, it.source].map((v) => String(v || "")).join(" ");
    const fromText = extractFromText(text);
    acc.cpf.push(...fromText.cpf);
    acc.cnpj.push(...fromText.cnpj);
    acc.cep.push(...fromText.cep);
    acc.phone.push(...fromText.phone);
    acc.email.push(...fromText.email);
    acc.name.push(...fromText.name);
    // Normaliza e deduplica
    acc.cpf = [...new Set(acc.cpf.map(normCPF).filter((v) => v.length === 11))];
    acc.cnpj = [...new Set(acc.cnpj.map(normCNPJ).filter((v) => v.length === 14))];
    acc.cep = [...new Set(acc.cep.map(normCEP).filter((v) => v.length === 8))];
    acc.phone = [...new Set(acc.phone.map(normPhone).filter((v) => v.length === 10 || v.length === 11))];
    acc.email = [...new Set(acc.email.map(normEmail).filter(Boolean))];
    acc.name = [...new Set(acc.name.map(normName).filter((v) => v && v.length > 2))];
    return acc;
  }

  function itemKey(it: SearchResult, fieldKey: string, provider: string) {
    return `${fieldKey}|${provider}|${String(it.title || "")}|${String(it.url || "")}|${String(it.source || "")}`;
  }
  function isCrossed(it: SearchResult, fieldKey: string, provider: string) {
    const key = itemKey(it, fieldKey, provider);
    return Boolean(crossMembership[key]);
  }

  function computeCross(all: Record<string, Record<string, SearchResult[]>>) {
    const index = {
      cpf: new Map<string, Array<{ field: string; provider: string; item: SearchResult }>>(),
      cnpj: new Map<string, Array<{ field: string; provider: string; item: SearchResult }>>(),
      cep: new Map<string, Array<{ field: string; provider: string; item: SearchResult }>>(),
      phone: new Map<string, Array<{ field: string; provider: string; item: SearchResult }>>(),
      email: new Map<string, Array<{ field: string; provider: string; item: SearchResult }>>(),
      name: new Map<string, Array<{ field: string; provider: string; item: SearchResult }>>(),
    };
    const pushIdx = (type: keyof typeof index, val: string, occ: { field: string; provider: string; item: SearchResult }) => {
      if (!val) return;
      const map = index[type];
      const arr = map.get(val) || [];
      arr.push(occ);
      map.set(val, arr);
    };
    for (const [field, byProv] of Object.entries(all)) {
      for (const [prov, items] of Object.entries(byProv || {})) {
        for (const it of items || []) {
          const attrs = extractAttributes(it);
          attrs.cpf.forEach((v) => pushIdx("cpf", v, { field, provider: prov, item: it }));
          attrs.cnpj.forEach((v) => pushIdx("cnpj", v, { field, provider: prov, item: it }));
          attrs.cep.forEach((v) => pushIdx("cep", v, { field, provider: prov, item: it }));
          attrs.phone.forEach((v) => pushIdx("phone", v, { field, provider: prov, item: it }));
          attrs.email.forEach((v) => pushIdx("email", v, { field, provider: prov, item: it }));
          if ((attrs as any).name) (attrs.name as string[]).forEach((v) => pushIdx("name", v, { field, provider: prov, item: it }));
        }
      }
    }
    const groups: CrossGroup[] = [];
    const membership: Record<string, true> = {};
    const buildGroup = (type: "cpf" | "cnpj" | "cep" | "phone" | "email" | "name", value: string, occs: Array<{ field: string; provider: string; item: SearchResult }>) => {
      if (occs.length < 2) return;
      const matches = occs.map((o) => ({
        field: o.field,
        provider: o.provider,
        title: o.item?.title as string,
        url: o.item?.url as string,
        source: o.item?.source as string,
        description: o.item?.description as string,
      }));
      occs.forEach((o) => { membership[itemKey(o.item, o.field, o.provider)] = true; });
      groups.push({ type, value: value, matches });
    };
    for (const [v, occs] of index.cpf.entries()) buildGroup("cpf", v, occs);
    for (const [v, occs] of index.cnpj.entries()) buildGroup("cnpj", v, occs);
    for (const [v, occs] of index.cep.entries()) buildGroup("cep", v, occs);
    for (const [v, occs] of index.phone.entries()) buildGroup("phone", v, occs);
    for (const [v, occs] of index.email.entries()) buildGroup("email", v, occs);
    for (const [v, occs] of index.name.entries()) buildGroup("name", v, occs);
    groups.sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
    return { groups, membership };
  }

  async function runSearch() {
    setLoading(true);
    setError(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    try {
      const newResults: Record<string, Record<string, SearchResult[]>> = {} as any;
      const fields: Array<keyof Subject> = ["cpf", "cnpj", "rg", "cep", "celular", "nome"];
      for (const field of fields) {
        const raw = (subject[field] || "").trim();
        if (!raw) continue;
        const value = field === "rg" || field === "nome" ? raw : onlyDigits(raw);
        // Busca permissiva: não interrompe por validação local; delega aos provedores
        const provs = providersForField(field);
        if (!provs.length) continue;
        async function postSearch(query: string, providers: Provider[]) {
          const res = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query, providers }),
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
          if (!res.ok) {
            console.warn(`Falha na busca para ${field}`, data?.error || res.statusText);
            return {};
          }
          return data?.results || {};
        }
        const hasDdg = provs.includes("duckduckgo");
        const provsNoDdg = provs.filter((p) => p !== "duckduckgo");
        let byProvider: Record<string, SearchResult[]> = {};
        if (hasDdg && (field === "cnpj" || field === "cpf" || field === "nome" || field === "rg")) {
          if (provsNoDdg.length) {
            const r1 = await postSearch(value, provsNoDdg as Provider[]);
            byProvider = { ...byProvider, ...r1 };
          }
          let ddgQuery: string;
          if (field === "cnpj" || field === "cpf") {
            const base = field === "cnpj" ? `CNPJ ${formatCNPJ(value)}` : `CPF ${formatCPF(value)}`;
            ddgQuery = `"${base}"` + (refineDuckDuckGoForCpfCnpj ? " site:gov.br OR site:jus.br OR site:mp.br" : "");
          } else if (field === "nome") {
            const base = formatName(value);
            ddgQuery = `"${base}"` + (refineDuckDuckGoForNomeRg ? " site:gov.br OR site:jus.br OR site:mp.br" : "");
          } else {
            const base = `RG ${value}`;
            ddgQuery = `"${base}"` + (refineDuckDuckGoForNomeRg ? " site:gov.br OR site:jus.br OR site:mp.br" : "");
          }
          const r2 = await postSearch(ddgQuery, ["duckduckgo"]);
          byProvider = { ...byProvider, ...r2 };
        } else {
          const r = await postSearch(value, provs as Provider[]);
          byProvider = { ...byProvider, ...r };
        }
        newResults[field] = byProvider;
      }
      // Enriquecimento cruzado baseado em resultados do campo 'celular': buscar CPF e CEP
      if (autoEnrichment) {
        try {
          const celField = newResults["celular"];
          if (celField) {
            const celArrays = Object.values(celField) as SearchResult[][];
            const celItems: SearchResult[] = ([] as SearchResult[]).concat(...celArrays);
            const foundCpfs = new Set<string>();
            const foundCeps = new Set<string>();
            for (const it of celItems) {
              const attrs = extractAttributes(it);
              attrs.cpf.forEach((v) => foundCpfs.add(v));
              attrs.cep.forEach((v) => foundCeps.add(v));
            }
            const cpfsToFetch = Array.from(foundCpfs).slice(0, 3);
            const cepsToFetch = Array.from(foundCeps).slice(0, 3);
            // Buscar detalhes de CPF
            for (const cpf of cpfsToFetch) {
              try {
                const resCpf = await fetch("/api/search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Accept": "application/json" },
                  body: JSON.stringify({ query: cpf, providers: ["cpf"] }),
                  signal,
                });
                const ctCpf = resCpf.headers.get("content-type") || "";
                const dataCpf = ctCpf.includes("application/json") ? await resCpf.json() : {};
                if (resCpf.ok && dataCpf?.results?.cpf) {
                  const byProvCpf = newResults["cpf"] || {};
                  const arr = Array.isArray(dataCpf.results.cpf) ? dataCpf.results.cpf : [];
                  byProvCpf["cpf"] = [ ...(byProvCpf["cpf"] || []), ...arr ];
                  newResults["cpf"] = byProvCpf;
                }
              } catch {}
            }
            // Buscar detalhes de CEP
            for (const cep of cepsToFetch) {
              try {
                const resCep = await fetch("/api/search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Accept": "application/json" },
                  body: JSON.stringify({ query: cep, providers: ["cep"] }),
                  signal,
                });
                const ctCep = resCep.headers.get("content-type") || "";
                const dataCep = ctCep.includes("application/json") ? await resCep.json() : {};
                if (resCep.ok && dataCep?.results?.cep) {
                  const byProvCep = newResults["cep"] || {};
                  const arr = Array.isArray(dataCep.results.cep) ? dataCep.results.cep : [];
                  byProvCep["cep"] = [ ...(byProvCep["cep"] || []), ...arr ];
                  newResults["cep"] = byProvCep;
                }
              } catch {}
            }
          }
        } catch {}
      }
      setResultsByField(newResults);
      setPageByGroup({});
      // Atualiza feedback de DDD a partir dos resultados do campo 'celular'
      const dddItems = (newResults["celular"]?.["ddd_apibrasil"] || newResults["celular"]?.["ddd_brasilapi"] || []);
      if (Array.isArray(dddItems) && dddItems.length) {
        const first = dddItems[0] as any;
        setDddFeedback({
          ddd: String(first?.ddd || String(subject.celular || "").slice(0, 2)),
          state: (first?.state as string) || undefined,
          cities: ((first?.cities as string[]) || []).slice(0, 5),
          message: (first?.description as string) || (first?.snippet as string),
        });
        setDddFeedbackKind(first?.state ? "ok" : "warn");
      } else {
        setDddFeedback(null);
        setDddFeedbackKind(null);
      }
      // Calcula cruzamentos
      const { groups, membership } = computeCross(newResults);
      setCrossGroups(groups);
      setCrossMembership(membership);
    } catch (e: unknown) {
      if (isAbortError(e)) {
        logAbortDev("Profissional", "runSearch");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function checkDDD() {
    setDddLoading(true);
    try {
      const raw = subject.celular || "";
      const phone = onlyDigits(raw);
      const ddd = phone.slice(0, 2);
      if (!phone || phone.length < 10) {
        setDddFeedback({ ddd, message: "Informe o telefone completo (DDD+Número)" });
        setDddFeedbackKind("info");
        return;
      }
      const res = await fetch("/api/search", {
         method: "POST",
         headers: { "Content-Type": "application/json", "Accept": "application/json" },
         body: JSON.stringify({ query: phone, providers: ["ddd_brasilapi", "ddd_apibrasil"], options: { apibrasil_no_fallback: preferAnatelNoFallback } }),
       });
      const ct2 = res.headers.get("content-type") || "";
      let data: any;
      if (ct2.includes("application/json")) {
         data = await res.json();
       } else {
         const text = await res.text().catch(() => "");
         console.error("Resposta não JSON de /api/search", res.status, res.statusText, text.slice(0, 400));
         throw new Error(`Resposta não JSON (${res.status}) de /api/search`);
       }
      if (!res.ok) throw new Error(data?.error || "Falha na validação de DDD");
      const items = ([...((data?.results?.["ddd_apibrasil"] as any[]) || []), ...((data?.results?.["ddd_brasilapi"] as any[]) || [])]);
      if (Array.isArray(items) && items.length) {
        const first = (items.find((x: any) => x?.state) || items[0]) as any;
        setDddFeedback({
          ddd,
          state: (first?.state as string) || undefined,
          cities: ((first?.cities as string[]) || []).slice(0, 5),
          message: (first?.description as string) || (first?.snippet as string),
        });
        setDddFeedbackKind(first?.state ? "ok" : "warn");
      } else {
        setDddFeedback({ ddd, message: "DDD não encontrado" });
        setDddFeedbackKind("warn");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setDddFeedback({ ddd: onlyDigits(subject.celular || "").slice(0, 2), message: msg });
      setDddFeedbackKind("error");
    } finally {
      setDddLoading(false);
    }
  }
  function exportCSV() {
    const filterFn = onlyCrossed ? (it: SearchResult, field: string, prov: string) => isCrossed(it, field, prov) : undefined;
    const pickDate = (obj: any): unknown => {
      if (!obj || typeof obj !== "object") return "";
      const candidates = ["date", "created_at", "updated_at", "time", "timestamp"];
      for (const k of candidates) { if (obj[k] !== undefined && obj[k] !== null) return obj[k]; }
      return "";
    };
    const getSearchedValueForField = (field: string): string => {
      const map: Record<string, keyof Subject> = { cpf: "cpf", cnpj: "cnpj", rg: "rg", cep: "cep", celular: "celular", phone: "celular", phone_portabilidade: "celular", ddd_brasilapi: "celular", ddd_apibrasil: "celular", duckduckgo: "nome", wikipedia: "nome", datajud: "nome" };
      const key = map[field]; if (!key) return ""; const val = (subject as any)[key] as string | undefined; return displayValue(key, val) || "";
    };
    const extractKnownFields = (it: SearchResult, prov?: string) => {
      try {
        const raw = (it as any)?.raw || it;
        const pick = (obj: any, path: string[]) => {
          try { return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj); } catch { return undefined; }
        };
        const normalizeAddrObj = (obj: any) => {
          if (!obj || typeof obj !== "object") return "";
          const parts = [obj.logradouro || obj.street, obj.numero || obj.number, obj.bairro || obj.neighborhood, obj.municipio || obj.cidade || obj.city, obj.uf || obj.state, obj.cep || obj.zip].filter(Boolean);
          return parts.length ? parts.join(", ") : "";
        };
        const addr = (() => {
          if (!raw) return "";
          const directFull = (raw as any)?.address_full || (raw as any)?.endereco_full || pick(raw, ["contacts","address_full"]);
          if (typeof directFull === "string" && directFull) return directFull as string;
          if (typeof (raw as any).address === "string") return (raw as any).address;
          if (typeof (raw as any).address === "object") {
            const res = normalizeAddrObj((raw as any).address);
            if (res) return res;
          }
          if (prov === "wikipedia") {
            const inf: any = (raw as any)?.infobox || {};
            const coord = inf?.coordenadas || inf?.coordinates;
            const base = (inf?.endereco as string) || normalizeAddrObj({ local: inf?.local, cidade: inf?.cidade, estado: inf?.estado, pais: inf?.pais });
            const coordStr = (() => {
              if (!coord) return "";
              if (typeof coord === "string") return coord;
              const lat = coord?.lat || coord?.latitude;
              const lng = coord?.lng || coord?.lon || coord?.longitude;
              if (lat !== undefined && lng !== undefined) return `${lat},${lng}`;
              return "";
            })();
            return [base, coordStr ? `Coordenadas: ${coordStr}` : ""].filter(Boolean).join(" | ");
          }
          if (prov === "github") {
            const ghLoc = (raw as any)?.location || pick(raw, ["company","location"]) || (raw as any)?.address_full;
            if (ghLoc) return String(ghLoc);
          }
          if (prov === "directdata") {
            const ddLoc = (raw as any)?.address_full || pick(raw, ["contacts","address_full"]);
            if (ddLoc) return String(ddLoc);
          }
          const liLoc = pick(raw, ["profile","location"]) || (raw as any)?.location || (raw as any)?.address_full;
          if (liLoc) return String(liLoc);
          if (Array.isArray((raw as any).enderecos) && (raw as any).enderecos.length) return normalizeAddrObj((raw as any).enderecos[0]);
          const res = normalizeAddrObj(raw);
          return res;
        })();
        const clean = (s: any) => String(s || "").trim();
        const onlyDigitsLocal = (s: any) => clean(s).replace(/\D+/g, "");
        const phones = (() => {
          const acc: any[] = [];
          const pushList = (val: any) => { if (Array.isArray(val)) acc.push(...val); else if (val !== undefined && val !== null) acc.push(val); };
          pushList((raw as any)?.telefones); pushList((raw as any)?.phones); pushList((raw as any)?.telefone); pushList((raw as any)?.phone);
          pushList(pick(raw, ["contacts","phones"])); pushList(pick(raw, ["contact","phones"]));
          pushList(pick(raw, ["linkedin","contact","phones"])); pushList(pick(raw, ["github","contact","phones"])); pushList(pick(raw, ["directdata","contacts","phones"]));
          const norm = acc.map((x) => {
            if (typeof x === "string") return clean(x);
            const num = x?.numero || x?.number || x?.value || x?.phone;
            const ddd = x?.ddd || x?.area || x?.areaCode;
            const both = [ddd, num].filter(Boolean).join(" ");
            return clean(both || num);
          });
          const byDigits = new Map<string, string>();
          for (const v of norm) { const digits = onlyDigitsLocal(v); if (!byDigits.has(digits)) byDigits.set(digits, v); }
          return Array.from(byDigits.values()).filter(Boolean).join(" | ");
        })();
        const emails = (() => {
          const acc: any[] = [];
          const pushList = (val: any) => { if (Array.isArray(val)) acc.push(...val); else if (val !== undefined && val !== null) acc.push(val); };
          pushList((raw as any)?.emails); pushList((raw as any)?.email);
          pushList(pick(raw, ["contacts","emails"])); pushList(pick(raw, ["contact","emails"]));
          pushList(pick(raw, ["linkedin","contact","emails"]));
          const linkedinProfileEmail = pick(raw, ["linkedin","profile","email"]) || pick(raw, ["profile","email"]);
          if (linkedinProfileEmail) acc.push(linkedinProfileEmail);
          pushList(pick(raw, ["github","contact","emails"])); pushList(pick(raw, ["directdata","contacts","emails"]));
          const norm = acc.map((x) => (typeof x === "string" ? clean(x) : clean(x?.email || x?.value)));
          const set = new Set(norm.filter(Boolean));
          return Array.from(set).join(" | ");
        })();
        const diretores = (() => {
          const collectNames = (list: any): string[] => {
            if (!list) return [];
            const arr = Array.isArray(list) ? list : typeof list === "object" ? Object.values(list) : [];
            return arr
              .map((x: any) => {
                if (!x) return "";
                if (typeof x === "string") return x;
                return x?.nome || x?.name || x?.pessoa || x?.person?.name || x?.autor || x?.reu || "";
              })
              .map((s) => String(s || "").trim())
              .filter(Boolean);
          };
          const fromQsa = collectNames((raw as any)?.qsa || (raw as any)?.socios || (raw as any)?.partners || (raw as any)?.diretores);
          const fromPartes = collectNames((raw as any)?.partes || (raw as any)?.parts || pick(raw, ["processo","partes"]) || pick(raw, ["datajud","partes"]));
          const names = [...fromQsa, ...fromPartes];
          const uniq = Array.from(new Set(names));
          return uniq.length ? uniq.join(" | ") : "";
        })();
        return { endereco: addr, telefones: phones, emails, diretores };
      } catch { return { endereco: "", telefones: "", emails: "", diretores: "" }; }
    };
    const baseLabels = ["Campo", "Provedor", "Título", "Descrição", "URL", "Fonte"];
    const labelMap: Record<DynKey, string> = { consulta: "Consulta", data: "Data", endereco: "Endereço", telefones: "Telefones", emails: "Emails", diretores: "Diretores", json: "JSON", raw: "RAW" };
    const orderedDynKeys = [...exportOrder, ...defaultExportOrder.filter((k) => !exportOrder.includes(k))] as DynKey[];
    const dynamicDefs = orderedDynKeys.map((k) => ({ key: k, label: labelMap[k] })) as { key: DynKey; label: string }[];
    const dynamicLabels: string[] = dynamicDefs.filter((d) => (exportCols as any)[d.key]).map((d) => d.label);
    const rows: string[] = [[...baseLabels, ...dynamicLabels].join(",")];
    for (const [field, byProv] of Object.entries(resultsByField)) {
      for (const [prov, items] of Object.entries(byProv || {})) {
        for (const it of items || []) {
          if (filterFn && !filterFn(it, field, prov)) continue;
          const dateVal = pickDate(it);
          const jsonStr = (() => { try { return JSON.stringify(it); } catch { return ""; } })();
          const rawStr = (() => { const raw = (it as any)?.raw; try { return raw !== undefined ? JSON.stringify(raw) : ""; } catch { return ""; } })();
          const known = extractKnownFields(it, prov);
          const base = [
            escapeCSV(field),
            escapeCSV(prov),
            escapeCSV((it.title as string) || (it.snippet as string) || ""),
            escapeCSV(((it.description as string) || (it.snippet as string) || "")),
            escapeCSV((it.url as string) || ""),
            escapeCSV((it.source as string) || prov),
          ];
          const dyn: string[] = [];
          for (const d of dynamicDefs) {
            if (!(exportCols as any)[d.key]) continue;
            const v = d.key === "consulta" ? getSearchedValueForField(field)
              : d.key === "data" ? dateVal
              : d.key === "endereco" ? known.endereco
              : d.key === "telefones" ? known.telefones
              : d.key === "emails" ? known.emails
              : d.key === "diretores" ? known.diretores
              : d.key === "json" ? jsonStr
              : d.key === "raw" ? rawStr
              : "";
            dyn.push(escapeCSV(v));
          }
          rows.push([...base, ...dyn].join(","));
        }
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = onlyCrossed ? "resultados_profissional_cruzados.csv" : "resultados_profissional.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXLSX() {
    const filterFn = onlyCrossed ? (it: SearchResult, field: string, prov: string) => isCrossed(it, field, prov) : undefined;
    const pickDate = (obj: any): unknown => {
      if (!obj || typeof obj !== "object") return "";
      const candidates = ["date", "created_at", "updated_at", "time", "timestamp"];
      for (const k of candidates) {
        if (obj[k] !== undefined && obj[k] !== null) return obj[k];
      }
      return "";
    };
    const getSearchedValueForField = (field: string): string => {
      const map: Record<string, keyof Subject> = { cpf: "cpf", cnpj: "cnpj", rg: "rg", cep: "cep", celular: "celular", phone: "celular", phone_portabilidade: "celular", ddd_brasilapi: "celular", ddd_apibrasil: "celular", duckduckgo: "nome", wikipedia: "nome", datajud: "nome" };
      const key = map[field]; if (!key) return ""; const val = (subject as any)[key] as string | undefined; return displayValue(key, val) || "";
    };
    const extractKnownFields = (it: SearchResult, prov?: string) => {
      try {
        const raw = (it as any)?.raw || it;
        const normalizeAddr = (obj: any) => {
          if (!obj || typeof obj !== "object") return "";
          const parts = [obj.logradouro || obj.street, obj.numero || obj.number, obj.bairro || obj.neighborhood, obj.municipio || obj.cidade || obj.city, obj.uf || obj.state, obj.cep || obj.zip].filter(Boolean);
          return parts.length ? parts.join(", ") : "";
        };
        const addr = (() => {
          if (!raw) return "";
          if (typeof (raw as any).address === "string") return (raw as any).address;
          if (typeof (raw as any).address === "object") {
            const res = normalizeAddr((raw as any).address);
            if (res) return res;
          }
          if (Array.isArray((raw as any).enderecos) && (raw as any).enderecos.length) return normalizeAddr((raw as any).enderecos[0]);
          const res = normalizeAddr(raw);
          return res;
        })();
        const phones = (() => {
          const p = (raw as any)?.telefones || (raw as any)?.phones || (raw as any)?.telefone || (raw as any)?.phone;
          if (Array.isArray(p)) {
            return p.map((x: any) => {
              if (typeof x === "string") return x;
              const num = x?.numero || x?.number || x?.value || x?.phone;
              const ddd = x?.ddd || x?.area || x?.areaCode;
              return [ddd, num].filter(Boolean).join(" ");
            }).filter(Boolean).join(" | ");
          }
          if (typeof p === "string") return p;
          return "";
        })();
        const emails = (() => {
          const e = (raw as any)?.emails || (raw as any)?.email;
          if (Array.isArray(e)) {
            return e.map((x: any) => typeof x === "string" ? x : (x?.email || x?.value)).filter(Boolean).join(" | ");
          }
          if (typeof e === "string") return e;
          return "";
        })();
        const diretores = (() => {
          const collectNames = (list: any): string[] => {
            if (!list) return [];
            const arr = Array.isArray(list) ? list : typeof list === "object" ? Object.values(list) : [];
            return arr
              .map((x: any) => {
                if (!x) return "";
                if (typeof x === "string") return x;
                return x?.nome || x?.name || x?.pessoa || x?.person?.name || x?.autor || x?.reu || "";
              })
              .map((s) => String(s || "").trim())
              .filter(Boolean);
          };
          const fromQsa = collectNames((raw as any)?.qsa || (raw as any)?.socios || (raw as any)?.partners || (raw as any)?.diretores);
          const fromPartes = collectNames((raw as any)?.partes || (raw as any)?.parts);
          const names = [...fromQsa, ...fromPartes];
          const uniq = Array.from(new Set(names));
          return uniq.length ? uniq.join(" | ") : "";
        })();
        return { endereco: addr, telefones: phones, emails, diretores };
      } catch { return { endereco: "", telefones: "", emails: "", diretores: "" }; }
    };
    const baseLabels = ["Campo", "Provedor", "Título", "Descrição", "URL", "Fonte"];
    const labelMap: Record<DynKey, string> = { consulta: "Consulta", data: "Data", endereco: "Endereço", telefones: "Telefones", emails: "Emails", diretores: "Diretores", json: "JSON", raw: "RAW" };
    const orderedDynKeys = [...exportOrder, ...defaultExportOrder.filter((k) => !exportOrder.includes(k))] as DynKey[];
    const dynamicDefs = orderedDynKeys.map((k) => ({ key: k, label: labelMap[k] })) as { key: DynKey; label: string }[];
    const headerLabels = [...baseLabels, ...dynamicDefs.filter((d) => (exportCols as any)[d.key]).map((d) => d.label)];

    const rows: Array<any[]> = [];
    for (const [field, byProv] of Object.entries(resultsByField)) {
      for (const [prov, items] of Object.entries(byProv || {})) {
        for (const it of items || []) {
          if (filterFn && !filterFn(it, field, prov)) continue;
          const dateVal = pickDate(it);
          const jsonStr = (() => { try { return JSON.stringify(it); } catch { return ""; } })();
          const rawStr = (() => { const raw = (it as any)?.raw; try { return raw !== undefined ? JSON.stringify(raw) : ""; } catch { return ""; } })();
          const known = extractKnownFields(it, prov);
          const baseVals: any[] = [
            field,
            prov,
            (it.title as string) || (it.snippet as string) || "",
            ((it.description as string) || (it.snippet as string) || ""),
            (it.url as string) || "",
            (it.source as string) || prov,
          ];
          const dynVals: any[] = [];
          for (const d of dynamicDefs) {
            if (!(exportCols as any)[d.key]) continue;
            const v = d.key === "consulta" ? getSearchedValueForField(field)
              : d.key === "data" ? dateVal
              : d.key === "endereco" ? (known.endereco || "")
              : d.key === "telefones" ? (known.telefones || "")
              : d.key === "emails" ? (known.emails || "")
              : d.key === "diretores" ? (known.diretores || "")
              : d.key === "json" ? jsonStr
              : d.key === "raw" ? rawStr
              : "";
            dynVals.push(v);
          }
          rows.push([...baseVals, ...dynVals]);
        }
      }
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headerLabels, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    const fileNameSingle = useShortSheetNames
      ? (onlyCrossed ? "profissional_cruzados.xlsx" : "profissional.xlsx")
      : (onlyCrossed ? "resultados_profissional_cruzados.xlsx" : "resultados_profissional.xlsx");
    XLSX.writeFile(wb, fileNameSingle);
  }

  function collectRows(filterField?: string, filterProvider?: string, filterFn?: (it: SearchResult, field: string, prov: string) => boolean) {
    const pickDate = (obj: any): unknown => {
      if (!obj || typeof obj !== "object") return "";
      const candidates = ["date", "created_at", "updated_at", "time", "timestamp"];
      for (const k of candidates) {
        if (obj[k] !== undefined && obj[k] !== null) return obj[k];
      }
      return "";
    };
    const rows: Array<{ campo: string; provedor: string; titulo: string; descricao: string; url: string; fonte: string; data?: unknown; json?: string; raw?: string }> = [];
    for (const [field, byProv] of Object.entries(resultsByField)) {
      if (filterField && field !== filterField) continue;
      for (const [prov, items] of Object.entries(byProv || {})) {
        if (filterProvider && prov !== filterProvider) continue;
        for (const it of items || []) {
          if (filterFn && !filterFn(it, field, prov)) continue;
          const dateVal = pickDate(it);
          const jsonStr = (() => {
            try { return JSON.stringify(it); } catch { return ""; }
          })();
          const rawStr = (() => {
            const raw = (it as any)?.raw;
            try { return raw !== undefined ? JSON.stringify(raw) : ""; } catch { return ""; }
          })();
          rows.push({
            campo: field,
            provedor: prov,
            titulo: (it.title as string) || (it.snippet as string) || "",
            descricao: ((it.description as string) || (it.snippet as string) || ""),
            url: (it.url as string) || "",
            fonte: (it.source as string) || prov,
            data: dateVal,
            json: jsonStr,
            raw: rawStr,
          });
        }
      }
    }
    return rows;
  }

  function exportXLSXMulti(mode: "single" | "per_field" | "per_provider" | "field_provider") {
    const filterFn = onlyCrossed ? (it: SearchResult, field: string, prov: string) => isCrossed(it, field, prov) : undefined;
    const pickDate = (obj: any): unknown => {
      if (!obj || typeof obj !== "object") return "";
      const candidates = ["date", "created_at", "updated_at", "time", "timestamp"];
      for (const k of candidates) {
        if (obj[k] !== undefined && obj[k] !== null) return obj[k];
      }
      return "";
    };
    const getSearchedValueForField = (field: string): string => {
      const map: Record<string, keyof Subject> = { cpf: "cpf", cnpj: "cnpj", rg: "rg", cep: "cep", celular: "celular", phone: "celular", phone_portabilidade: "celular", ddd_brasilapi: "celular", ddd_apibrasil: "celular", duckduckgo: "nome", wikipedia: "nome", datajud: "nome" };
      const key = map[field]; if (!key) return ""; const val = (subject as any)[key] as string | undefined; return displayValue(key, val) || "";
    };
    const extractKnownFields = (it: SearchResult, prov?: string) => {
      try {
        const raw = (it as any)?.raw || it;
        const normalizeAddr = (obj: any) => {
          if (!obj || typeof obj !== "object") return "";
          const parts = [obj.logradouro || obj.street, obj.numero || obj.number, obj.bairro || obj.neighborhood, obj.municipio || obj.cidade || obj.city, obj.uf || obj.state, obj.cep || obj.zip].filter(Boolean);
          return parts.length ? parts.join(", ") : "";
        };
        const addr = (() => {
          if (!raw) return "";
          if (typeof (raw as any).address === "string") return (raw as any).address;
          if (typeof (raw as any).address === "object") {
            const res = normalizeAddr((raw as any).address);
            if (res) return res;
          }
          if (Array.isArray((raw as any).enderecos) && (raw as any).enderecos.length) return normalizeAddr((raw as any).enderecos[0]);
          const res = normalizeAddr(raw);
          return res;
        })();
        const phones = (() => {
          const p = (raw as any)?.telefones || (raw as any)?.phones || (raw as any)?.telefone || (raw as any)?.phone;
          if (Array.isArray(p)) {
            return p.map((x: any) => {
              if (typeof x === "string") return x;
              const num = x?.numero || x?.number || x?.value || x?.phone;
              const ddd = x?.ddd || x?.area || x?.areaCode;
              return [ddd, num].filter(Boolean).join(" ");
            }).filter(Boolean).join(" | ");
          }
          if (typeof p === "string") return p;
          return "";
        })();
        const emails = (() => {
          const e = (raw as any)?.emails || (raw as any)?.email;
          if (Array.isArray(e)) {
            return e.map((x: any) => typeof x === "string" ? x : (x?.email || x?.value)).filter(Boolean).join(" | ");
          }
          if (typeof e === "string") return e;
          return "";
        })();
        const diretores = (() => {
          const qsa = (raw as any)?.qsa || (raw as any)?.socios || (raw as any)?.partners;
          if (Array.isArray(qsa)) {
            const names = qsa.map((x: any) => x?.nome || x?.name).filter(Boolean);
            if (names.length) return names.join(" | ");
          }
          // Fallback: nomes das partes (Datajud)
          const partes = (raw as any)?.partes || (raw as any)?.parties || (raw as any)?.partesProcessuais || (raw as any)?.poloAtivo || (raw as any)?.poloPassivo;
          if (Array.isArray(partes)) {
            const names = partes
              .map((x: any) => (typeof x === "string" ? x : (x?.nome || x?.name || x?.pessoa || x?.parte)))
              .map((s: any) => String(s || "").trim())
              .filter(Boolean);
            const uniq = Array.from(new Set(names));
            if (uniq.length) return uniq.join(" | ");
          }
          return "";
        })();
        return { endereco: addr, telefones: phones, emails, diretores };
      } catch { return { endereco: "", telefones: "", emails: "", diretores: "" }; }
    };

    const wb = XLSX.utils.book_new();
    const pushSheet = (name: string, rowSelector: (field?: string, prov?: string) => Array<Record<string, any>>, filterField?: string, filterProv?: string) => {
      const baseLabels = ["Campo", "Provedor", "Título", "Descrição", "URL", "Fonte"];
      const labelMap: Record<DynKey, string> = { consulta: "Consulta", data: "Data", endereco: "Endereço", telefones: "Telefones", emails: "Emails", diretores: "Diretores", json: "JSON", raw: "RAW" };
      const orderedDynKeys = [...exportOrder, ...defaultExportOrder.filter((k) => !exportOrder.includes(k))] as DynKey[];
      const dynKeys = orderedDynKeys.filter((k) => (exportCols as any)[k]);
      const headerLabels = [...baseLabels, ...dynKeys.map((k) => labelMap[k])];
      const rowsObj = rowSelector(filterField, filterProv);
      const rowsAoa = rowsObj.map((r) => [r.campo, r.provedor, r.titulo, r.descricao, r.url, r.fonte, ...dynKeys.map((k) => (r as any)[k])]);
      const ws = XLSX.utils.aoa_to_sheet([headerLabels, ...rowsAoa]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    const buildRows = (filterField?: string, filterProv?: string) => {
      const rows: Array<Record<string, any>> = [];
      for (const [field, byProv] of Object.entries(resultsByField)) {
        if (filterField && field !== filterField) continue;
        for (const [prov, items] of Object.entries(byProv || {})) {
          if (filterProv && prov !== filterProv) continue;
          for (const it of items || []) {
            if (filterFn && !filterFn(it, field, prov)) continue;
            const baseRow: Record<string, any> = {
              campo: field,
              provedor: prov,
              titulo: (it.title as string) || (it.snippet as string) || "",
              descricao: ((it.description as string) || (it.snippet as string) || ""),
              url: (it.url as string) || "",
              fonte: (it.source as string) || prov,
            };
            if (exportCols.consulta) baseRow.consulta = getSearchedValueForField(field);
            if (exportCols.data) baseRow.data = pickDate(it);
            const known = extractKnownFields(it, prov);
            if (exportCols.endereco) baseRow.endereco = known.endereco || "";
            if (exportCols.telefones) baseRow.telefones = known.telefones || "";
            if (exportCols.emails) baseRow.emails = known.emails || "";
            if (exportCols.diretores) baseRow.diretores = known.diretores || "";
            if (exportCols.json) baseRow.json = (() => { try { return JSON.stringify(it); } catch { return ""; } })();
            if (exportCols.raw) baseRow.raw = (() => { const raw = (it as any)?.raw; try { return raw !== undefined ? JSON.stringify(raw) : ""; } catch { return ""; } })();
            rows.push(baseRow);
          }
        }
      }
      return rows;
    };

    if (mode === "single") {
      const ws = XLSX.utils.json_to_sheet(buildRows());
      XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    } else if (mode === "per_field") {
      const fieldLabels: Record<string, string> = { cpf: "CPF", cnpj: "CNPJ", rg: "RG", cep: "CEP", celular: "Celular", nome: "Nome", phone: "Telefone", phone_portabilidade: "Portabilidade", ddd_brasilapi: "DDD (BrasilAPI)", ddd_apibrasil: "DDD (APIBrasil)" };
      const fieldShortLabels: Record<string, string> = { cpf: "CPF", cnpj: "CNPJ", rg: "RG", cep: "CEP", celular: "CEL", nome: "NOM", phone: "TEL", phone_portabilidade: "ABR", ddd_brasilapi: "DDD-BA", ddd_apibrasil: "DDD-AB" };
      for (const field of Object.keys(resultsByField)) {
        const ws = XLSX.utils.json_to_sheet(buildRows(field, undefined));
        const label = useShortSheetNames ? (fieldShortLabels[String(field)] || fieldLabels[String(field)] || String(field)) : (fieldLabels[String(field)] || String(field));
        const sheetName = String(label).substring(0, 28);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
    } else if (mode === "per_provider") {
      const providersSet = new Set<string>();
      for (const byProv of Object.values(resultsByField)) {
        for (const p of Object.keys(byProv)) providersSet.add(p);
      }
      const providerShortLabels: Record<string, string> = {
        cpf: "CPF",
        cnpj: "CNPJ",
        cep: "CEP",
        phone: "TEL",
        ddd_brasilapi: "DDD-BA",
        ddd_apibrasil: "DDD-AB",
        duckduckgo: "DDG",
        github: "GH",
        wikipedia: "WK",
        directdata: "DD",
        phone_portabilidade: "ABR",
      };
      for (const p of providersSet) {
        const label = useShortSheetNames ? (providerShortLabels[String(p)] || providerLabels[p as Provider] || p) : (providerLabels[p as Provider] || p);
        const sheetName = String(label).substring(0, 28);
        pushSheet(sheetName, buildRows, undefined, p);
      }
    } else {
      const fieldLabels: Record<string, string> = { cpf: "CPF", cnpj: "CNPJ", rg: "RG", cep: "CEP", celular: "Celular", nome: "Nome", phone: "Telefone", phone_portabilidade: "Portabilidade", ddd_brasilapi: "DDD (BrasilAPI)", ddd_apibrasil: "DDD (APIBrasil)" };
      const fieldShortLabels: Record<string, string> = { cpf: "CPF", cnpj: "CNPJ", rg: "RG", cep: "CEP", celular: "CEL", nome: "NOM", phone: "TEL", phone_portabilidade: "ABR", ddd_brasilapi: "DDD-BA", ddd_apibrasil: "DDD-AB" };
      const providerShortLabels: Record<string, string> = {
          cpf: "CPF",
          cnpj: "CNPJ",
          cep: "CEP",
          phone: "TEL",
          ddd_brasilapi: "DDD-BA",
          ddd_apibrasil: "DDD-AB",
          duckduckgo: "DDG",
          github: "GH",
          wikipedia: "WK",
          directdata: "DD",
          phone_portabilidade: "ABR",
        };
      for (const [field, byProv] of Object.entries(resultsByField)) {
        for (const p of Object.keys(byProv)) {
          const leftLabel = useShortSheetNames ? (fieldShortLabels[String(field)] || fieldLabels[String(field)] || String(field)) : (fieldLabels[String(field)] || String(field));
          const rightLabel = useShortSheetNames ? (providerShortLabels[String(p)] || providerLabels[p as Provider] || p) : (providerLabels[p as Provider] || p);
          const name = `${String(leftLabel).toUpperCase()}-${String(rightLabel)}`.substring(0, 28);
          pushSheet(name, buildRows, field, p);
        }
      }
    }

    const fileNameMulti = useShortSheetNames
      ? (onlyCrossed ? "profissional_multi_cruzados.xlsx" : "profissional_multi.xlsx")
      : (onlyCrossed ? "resultados_profissional_multiplas_abas_cruzados.xlsx" : "resultados_profissional_multiplas_abas.xlsx");
    XLSX.writeFile(wb, fileNameMulti);
  }

  const hasErrors = Object.values(errors).some(Boolean);
  const hasResults = Object.values(resultsByField).some((byProv) => Object.values(byProv || {}).some((arr) => Array.isArray(arr) && arr.length > 0));
  const canSearch = ["cpf", "cnpj", "rg", "cep", "celular", "nome"].some((f) => {
    const raw = (subject as any)[f] as string | undefined;
    return !!raw;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Topbar / Menu com breadcrumb */}
      <header className="brand-header shadow">
        <div className="max-w-6xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg">Investiga</span>
              <nav className="ml-6 flex gap-4 text-sm" role="navigation" aria-label="Main">
                <a href="/" className="brand-link"><Home size={16} className="inline-block mr-1" /> Home</a>
                <a href="/osint" className="brand-link"><Globe size={16} className="inline-block mr-1" /> OSINT</a>
                <a href="/profissional" className="brand-link font-medium" aria-current="page"><User size={16} className="inline-block mr-1" /> Profissional</a>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs opacity-90">Busca com Nome, CPF, RG, CEP e celular</div>
              <button className="btn-brand-secondary" onClick={toggleTheme} aria-label="Alternar tema">
                {theme === "dark" ? (<><Sun size={16} className="inline-block mr-1" />Claro</>) : (<><Moon size={16} className="inline-block mr-1" />Escuro</>)}
              </button>
            </div>
          </div>
          <div className="mt-2 text-xs opacity-80 flex items-center gap-1" aria-label="Breadcrumb">
            <Home size={14} className="inline-block" />
            <ChevronRight size={12} className="inline-block opacity-80" />
            <span>Profissional</span>
          </div>
        </div>
      </header>


      <div className="max-w-6xl mx-auto p-6">
        {/* Filtros e Campos */}
        <section className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 bg-white shadow rounded p-4">
            <h2 className="text-lg font-semibold mb-3">Dados de consulta</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <input
                  className={inputClass("cpf")}
                  placeholder="CPF"
                  value={displayValue("cpf", subject.cpf)}
                  onChange={(e) => updateField("cpf", e.target.value)}
                />
                {subject.cpf && (
                  <div className={(errors.cpf ? "text-red-600" : "text-green-600") + " mt-1 text-xs"}>
                    {errors.cpf ? "⚠️ CPF inválido" : "✓ CPF válido"}
                  </div>
                )}
              </div>
              <div>
                <input
                  className={inputClass("cnpj")}
                  placeholder="CNPJ"
                  value={displayValue("cnpj", subject.cnpj)}
                  onChange={(e) => updateField("cnpj", e.target.value)}
                />
                {subject.cnpj && (
                  <div className={(errors.cnpj ? "text-red-600" : "text-green-600") + " mt-1 text-xs"}>
                    {errors.cnpj ? "⚠️ CNPJ inválido" : "✓ CNPJ válido"}
                  </div>
                )}
              </div>
              <div>
                <input
                  className={inputClass("rg")}
                  placeholder="RG"
                  value={subject.rg || ""}
                  onChange={(e) => updateField("rg", e.target.value)}
                />
                {subject.rg && (
                  <div className={(errors.rg ? "text-red-600" : "text-gray-600") + " mt-1 text-xs"}>
                    {errors.rg ? "⚠️ RG inválido" : "ℹ️ RG sem validação automática"}
                  </div>
                )}
              </div>
              <div>
                <input
                  className={inputClass("cep")}
                  placeholder="CEP"
                  value={displayValue("cep", subject.cep)}
                  onChange={(e) => updateField("cep", e.target.value)}
                />
                {subject.cep && (
                  <div className={(errors.cep ? "text-red-600" : "text-green-600") + " mt-1 text-xs"}>
                    {errors.cep ? "⚠️ CEP inválido" : "✓ CEP válido"}
                  </div>
                )}
              </div>
              <div>
                <input
                  className={inputClass("celular")}
                  placeholder="Celular (DDD+Número)"
                  value={displayValue("celular", subject.celular)}
                  onChange={(e) => updateField("celular", e.target.value)}
                />
                {errors.celular && <div className="text-red-600 mt-1 text-xs">{errors.celular}</div>}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={checkDDD}
                    disabled={dddLoading || !subject.celular}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                    title="Validar DDD via BrasilAPI"
                    aria-label="Validar DDD via BrasilAPI"
                  >
                    {dddLoading ? "Validando DDD..." : "Validar DDD"}
                  </button>
                  {dddFeedback && (
                    <span
                      className={
                        "badge " + (
                          dddFeedbackKind === "ok"
                            ? "badge-success"
                            : dddFeedbackKind === "warn"
                            ? "badge-warning"
                            : dddFeedbackKind === "info"
                            ? "badge-info"
                            : dddFeedbackKind === "neutral"
                            ? "badge-neutral"
                            : "badge-danger"
                        )
                      }
                    >
                      {dddFeedback.state
                        ? `DDD ${dddFeedback.ddd} — ${dddFeedback.state} — Cidades: ${(dddFeedback.cities || []).join(", ")}`
                        : dddFeedback.message || `DDD ${dddFeedback.ddd || ""}`}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <input
                  className={inputClass("nome")}
                  placeholder="Nome"
                  value={subject.nome || ""}
                  onChange={(e) => updateField("nome", e.target.value)}
                />
                {subject.nome && (
                  <div className={(errors.nome ? "text-red-600" : "text-green-600") + " mt-1 text-xs"}>
                    {errors.nome ? `⚠️ ${errors.nome}` : "✓ Nome válido"}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      const url = "https://www.cnj.jus.br/pesquisas-judiciais/";
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!subject.nome}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                    title="Buscar no CNJ (abre o portal em nova aba)"
                    aria-label="Buscar no CNJ (via navegador)"
                  >
                    <Globe size={14} className="inline-block mr-1" /> Buscar no CNJ
                  </button>
                  <span className="text-xs text-gray-500 flex items-center gap-2">
                    <span>Nome:</span>
                    <span className="px-2 py-0.5 bg-gray-100 rounded break-all">{subject.nome || ""}</span>
                    <button
                      onClick={() => {
                        if (!subject.nome) return;
                        navigator.clipboard
                          .writeText(subject.nome)
                          .then(() => toast.show("Copiado!", 2000, "success"))
                          .catch(() => {});
                      }}
                      disabled={!subject.nome}
                      className="px-2 py-1 border rounded text-xs disabled:opacity-50"
                      title="Copiar nome para área de transferência"
                      aria-label="Copiar nome"
                    >
                      <Copy size={12} className="inline-block mr-1" /> Copiar
                    </button>
                    
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={runSearch}
                disabled={loading || !canSearch}
                className="btn-brand-primary disabled:opacity-50"
                title={!canSearch ? "Informe ao menos um campo" : "Buscar"}
              >
                {loading ? "Buscando..." : (<><Search size={16} className="inline-block mr-2" />Buscar</>)}
              </button>
              <button
                onClick={exportCSV}
                disabled={!hasResults}
                className="bg-gray-800 hover:bg-black text-white px-4 py-2 rounded disabled:opacity-50"
                title={!hasResults ? "Sem resultados para exportar" : "Exportar resultados em CSV (Excel)"}
              >
                <FileText size={16} className="inline-block mr-2" /> Exportar CSV
              </button>
              <div className="flex items-center gap-2">
                <select
                  className="select-brand"
                  value={xlsxMode}
                  onChange={(e) => setXlsxMode(e.target.value as any)}
                  title="Estilo das abas do XLSX"
                >
                  <option value="single">Única aba</option>
                  <option value="per_field">Por campo</option>
                  <option value="per_provider">Por provedor</option>
                  <option value="field_provider">Campo + Provedor</option>
                </select>
                <button
                  onClick={() => exportXLSXMulti(xlsxMode)}
                  disabled={!hasResults}
                  className="btn-brand-secondary disabled:opacity-50"
                  title={!hasResults ? "Sem resultados para exportar" : "Exportar resultados em XLSX com múltiplas abas"}
                >
                  <FileSpreadsheet size={16} className="inline-block mr-2" /> Exportar XLSX
                </button>
                <span className="text-xs text-gray-500">(Respeita “Somente itens cruzados” quando ativo)</span>
              </div>
              {error && <span className="text-red-600 ml-3 text-sm">Erro: {error}</span>}
            </div>
          </div>

          {/* Filtros ativos como tags */}
          {(globalKeyword || dateStart || dateEnd) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {globalKeyword && (
                <span className="tag">
                  Keyword: {globalKeyword}
                  <button className="remove" aria-label="Remover keyword" onClick={() => setGlobalKeyword("")}><X size={12} /></button>
                </span>
              )}
              {dateStart && (
                <span className="tag">
                  De: {dateStart}
                  <button className="remove" aria-label="Remover data inicial" onClick={() => setDateStart("")}><X size={12} /></button>
                </span>
              )}
              {dateEnd && (
                <span className="tag">
                  Até: {dateEnd}
                  <button className="remove" aria-label="Remover data final" onClick={() => setDateEnd("")}><X size={12} /></button>
                </span>
              )}
            </div>
          )}

          {/* Sidebar de provedores */}
          <aside className="card">
            <h3 className="font-semibold mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Plug size={16} /> Provedores</span><button className="text-sm text-blue-700 hover:underline" onClick={() => setShowProvidersMenu((v) => !v)} aria-expanded={showProvidersMenu}>{showProvidersMenu ? "Ocultar" : "Mostrar"}</button></h3>
            {(Object.entries(providers).some(([, v]) => v) || autoEnrichment || preferAnatelNoFallback) && (
              <div className="mb-3 flex flex-wrap gap-2">
                {Object.entries(providers).map(([p, v]) => v && (
                  <span key={p} className="chip">
                    Provedor: {providerLabels[p as Provider] || p}
                    <button
                      className="remove"
                      aria-label={`Desativar ${p}`}
                      onClick={() => setProviders((prev) => ({ ...prev, [p as Provider]: false }))}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {autoEnrichment && (
                  <span className="chip">
                    Enriquecimento automático
                    <button
                      className="remove"
                      aria-label="Desativar enriquecimento automático"
                      onClick={() => setAutoEnrichment(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {preferAnatelNoFallback && (
                  <span className="chip">
                    Preferir Anatel (sem fallback)
                    <button
                      className="remove"
                      aria-label="Desativar preferência Anatel"
                      onClick={() => setPreferAnatelNoFallback(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {forceGenericProviders && (
                  <span className="chip">
                    Forçar Wikipedia/DDG
                    <button
                      className="remove"
                      aria-label="Desativar forçar Wikipedia/DDG"
                      onClick={() => setForceGenericProviders(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {forceDuckDuckGoForCnpj && (
                  <span className="chip">
                    DuckDuckGo para CNPJ
                    <button
                      className="remove"
                      aria-label="Desativar DuckDuckGo para CNPJ"
                      onClick={() => setForceDuckDuckGoForCnpj(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {forceDuckDuckGoForCpf && (
                  <span className="chip">
                    DuckDuckGo para CPF
                    <button
                      className="remove"
                      aria-label="Desativar DuckDuckGo para CPF"
                      onClick={() => setForceDuckDuckGoForCpf(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {refineDuckDuckGoForCpfCnpj && (
                  <span className="chip">
                    Refino DDG: CNPJ/CPF (sites oficiais)
                    <button
                      className="remove"
                      aria-label="Desativar refino DDG para CNPJ/CPF"
                      onClick={() => setRefineDuckDuckGoForCpfCnpj(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {refineDuckDuckGoForNomeRg && (
                  <span className="chip">
                    Refino DDG: Nome/RG (sites oficiais)
                    <button
                      className="remove"
                      aria-label="Desativar refino DDG para Nome/RG"
                      onClick={() => setRefineDuckDuckGoForNomeRg(false)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
              </div>
            )}
            {showProvidersMenu && (
              <div className="space-y-2 text-sm">
                {(["cpf", "cnpj", "cep", "phone", "phone_portabilidade", "ddd_brasilapi", "ddd_apibrasil", "duckduckgo", "wikipedia", "github", "directdata", "datajud"] as Provider[]).map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="checkbox" checked={providers[p]} onChange={(e) => setProviders((prev) => ({ ...prev, [p]: e.target.checked }))} />
                    <span className="capitalize">{providerLabels[p as Provider] || p}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={autoEnrichment} onChange={(e) => setAutoEnrichment(e.target.checked)} />
                  <span>Enriquecimento automático (CPF/CEP a partir de celular)</span>
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={preferAnatelNoFallback} onChange={(e) => setPreferAnatelNoFallback(e.target.checked)} />
                  <span>Preferir Anatel (sem fallback)</span>
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={forceDuckDuckGoForCnpj} onChange={(e) => setForceDuckDuckGoForCnpj(e.target.checked)} />
                  <span>Pesquisar CNPJ na web (DuckDuckGo)</span>
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={forceDuckDuckGoForCpf} onChange={(e) => setForceDuckDuckGoForCpf(e.target.checked)} />
                  <span>Pesquisar CPF na web (DuckDuckGo)</span>
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={refineDuckDuckGoForCpfCnpj} onChange={(e) => setRefineDuckDuckGoForCpfCnpj(e.target.checked)} />
                  <span>Refinar DDG para CNPJ/CPF (sites oficiais)</span>
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={refineDuckDuckGoForNomeRg} onChange={(e) => setRefineDuckDuckGoForNomeRg(e.target.checked)} />
                  <span>Refinar DDG para Nome/RG (sites oficiais)</span>
                </label>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={forceGenericProviders} onChange={(e) => setForceGenericProviders(e.target.checked)} />
                  <span>Forçar Wikipedia/DDG para nomes comuns</span>
                </label>
              </div>
            )}
            {showProvidersMenu && (
              <div className="mt-3 border-t pt-3">
                <h4 className="font-semibold text-sm mb-2">Exportação</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.consulta} onChange={(e) => setExportCols((prev) => ({ ...prev, consulta: e.target.checked }))} />
                    <span>Consulta (valor pesquisado)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.data} onChange={(e) => setExportCols((prev) => ({ ...prev, data: e.target.checked }))} />
                    <span>Data</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.endereco} onChange={(e) => setExportCols((prev) => ({ ...prev, endereco: e.target.checked }))} />
                    <span>Endereço</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.telefones} onChange={(e) => setExportCols((prev) => ({ ...prev, telefones: e.target.checked }))} />
                    <span>Telefones</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.emails} onChange={(e) => setExportCols((prev) => ({ ...prev, emails: e.target.checked }))} />
                    <span>Emails</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.diretores} onChange={(e) => setExportCols((prev) => ({ ...prev, diretores: e.target.checked }))} />
                    <span>Diretores</span>
                  </label>
                  <label className="flex items-center gap-2 col-span-2">
                    <input type="checkbox" checked={useShortSheetNames} onChange={(e) => setUseShortSheetNames(e.target.checked)} />
                    <span>Usar nomes curtos nas abas XLSX</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.json} onChange={(e) => setExportCols((prev) => ({ ...prev, json: e.target.checked }))} />
                    <span>JSON</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportCols.raw} onChange={(e) => setExportCols((prev) => ({ ...prev, raw: e.target.checked }))} />
                    <span>RAW</span>
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button className="btn-brand-secondary btn-xs" onClick={() => applyPreset("Minimal")}>Preset: Minimal</button>
                  <button className="btn-brand-secondary btn-xs" onClick={() => applyPreset("Completo")}>Preset: Completo</button>
                  <button className="btn-brand-secondary btn-xs" onClick={() => applyPreset("Investigação")}>Preset: Investigação</button>
                  <button className="btn-brand-secondary btn-xs" onClick={() => applyPreset("Analítico")}>Preset: Analítico</button>
                  {exportPreset && (<span className="text-xs text-gray-600">Atual: {exportPreset}</span>)}
                </div>
                <p className="mt-1 text-xs text-gray-600">Ordem atual: {(() => exportOrder.map((k) => ({ consulta: "Consulta", data: "Data", endereco: "Endereço", telefones: "Telefones", emails: "Emails", diretores: "Diretores", json: "JSON", raw: "RAW" } as Record<string, string>)[k]).join(", ")).call(null)}</p>
                <div className="mt-2">
                  <div className="text-xs text-gray-600 mb-1">Arraste para reordenar:</div>
                  <ul className="flex flex-wrap gap-2">
                    {exportOrder.map((k, i) => (
                      <li
                        key={k}
                        draggable
                        onDragStart={() => setDragIndex(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIndex === null || dragIndex === i) return;
                          const next = [...exportOrder];
                          const [moved] = next.splice(dragIndex, 1);
                          next.splice(i, 0, moved);
                          setDragIndex(null);
                          setExportOrder(next);
                        }}
                        className="chip cursor-move select-none"
                        title="Arraste para reordenar"
                      >
                        {{ consulta: "Consulta", data: "Data", endereco: "Endereço", telefones: "Telefones", emails: "Emails", diretores: "Diretores", json: "JSON", raw: "RAW" }[k]}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center gap-2">
                    <button className="btn-brand-secondary btn-xs" onClick={() => setExportOrder(["consulta", "data", "endereco", "telefones", "emails", "diretores", "json", "raw"])}>Resetar ordem padrão</button>
                    <span className="text-xs text-gray-500">Persistido em localStorage</span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-600">CSV/XLSX respeita seleção; JSON leva objeto integral; RAW quando disponível.</p>
              </div>
            )}
            {showProvidersMenu && (
              <p className="mt-3 text-xs text-gray-600">
                Observação: RG depende de provedor pago (<code>directdata</code>) se configurado; caso contrário, usa busca pública (DuckDuckGo) como referência.
              </p>
            )}
          </aside>
        </section>
 
         {/* Cruzamentos */}
         {hasResults && (
           <section className="mt-6 card">
             <div className="flex items-center justify-between mb-2">
               <h2 className="text-lg font-semibold">Cruzamentos</h2>
               <div className="flex items-center gap-4 text-sm">
                 <label className="flex items-center gap-2">
                   <input type="checkbox" checked={onlyCrossed} onChange={(e) => setOnlyCrossed(e.target.checked)} />
                   <span>Somente itens cruzados</span>
                 </label>
                 <label className="flex items-center gap-2">
                   <input type="checkbox" checked={extractNamesFromText} onChange={(e) => setExtractNamesFromText(e.target.checked)} />
                   <span>Extrair nomes de resultados textuais</span>
                 </label>
                 <label className="flex items-center gap-2">
                   <input type="checkbox" checked={hideGenericNames} onChange={(e) => setHideGenericNames(e.target.checked)} />
                   <span>Ocultar nomes muito comuns</span>
                 </label>
               </div>
             </div>
             {crossGroups.length === 0 ? (
               <div className="text-sm text-gray-600">Nenhum cruzamento encontrado.</div>
             ) : (
               <ul className="space-y-2">
                 {crossGroups
                   .filter((g) => (g.type !== "name" || !hideGenericNames || !isGenericName(g.value)))
                   .slice(0, 50)
                   .map((g, idx) => {
                     const occ = g.matches.length;
                     const liClass =
                       occ >= 5 ? "bg-green-50 border-green-300 ring-1 ring-green-200" :
                       occ >= 3 ? "bg-yellow-50 border-yellow-300 ring-1 ring-yellow-200" :
                       "bg-gray-50 border-gray-200";
                     const icon = g.type === "cpf" ? "🔢" : g.type === "cnpj" ? "🏢" : g.type === "cep" ? "📍" : g.type === "phone" ? "📞" : g.type === "email" ? "📧" : "👤";
                     const hasCompany = g.type === "name" && g.matches.some((m) => m.provider === "cnpj");
                     const hasPerson = g.type === "name" && g.matches.some((m) => ["cpf", "directdata", "datajud"].includes(m.provider));
                     return (
                       <li key={idx} className={`border rounded p-2 ${liClass}`}>
                         <div className="text-sm font-medium flex items-center gap-2">
                           <span>{icon}</span>
                           <span>
                             {g.type === "cpf" ? `CPF: ${formatCPF(g.value)}` : g.type === "cnpj" ? `CNPJ: ${formatCNPJ(g.value)}` : g.type === "cep" ? `CEP: ${formatCEP(g.value)}` : g.type === "phone" ? `Telefone: ${formatCelular(g.value)}` : g.type === "email" ? `Email: ${g.value}` : `Nome: ${formatName(g.value)}`}
                           </span>
                           <span className={"ml-2 badge " + (occ >= 5 ? "badge-success" : occ >= 3 ? "badge-warning" : "badge-neutral")}>
                             Ocorrências: {occ}
                           </span>
                           {g.type === "name" && hasCompany && hasPerson ? (
                             <span className="ml-2 badge badge-info">Pessoa ↔ Empresa</span>
                           ) : null}
                         </div>
                         <div className="mt-1 text-xs text-gray-700">
                           {g.matches.slice(0, 8).map((m, i) => (
                             <span key={i} className="mr-2">[{m.field}] {m.provider}{m.title ? ` — ${m.title}` : ""}</span>
                           ))}
                           {g.matches.length > 8 ? <span>…</span> : null}
                         </div>
                       </li>
                     );
                   })}
               </ul>
             )}
           </section>
         )}
 
         {/* Resultados por campo */}
        {hasResults && (
          <section className="mt-6 space-y-8">
            {(Object.keys(resultsByField) as (keyof Subject)[]).map((field) => {
              const byProv = resultsByField[field];
              if (!byProv) return null;
              const fieldKey = String(field);
              return (
                <div key={fieldKey} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2"><List size={18} /> Resultados: {fieldKey.toUpperCase()}</h2>
                    <div className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-1">
                        <span>Provedor:</span>
                        <select
                          className="select-brand"
                          value={selectedProviderByField[fieldKey] ?? ""}
                          onChange={(e) => setSelectedProviderByField((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                        >
                          <option value="">Todos</option>
                          {Object.keys(byProv).map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1">
                        <span>Ordenar:</span>
                        <select
                          className="select-brand"
                          value={sortByField[fieldKey]?.key || "title"}
                          onChange={(e) => setSortByField((prev) => ({ ...prev, [fieldKey]: { ...(prev[fieldKey] || { dir: "asc" }), key: e.target.value as any } }))}
                        >
                          <option value="title">Título</option>
                          <option value="source">Fonte</option>
                          <option value="url">URL</option>
                          <option value="description">Descrição</option>
                        </select>
                      </label>
                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() => setSortByField((prev) => ({ ...prev, [fieldKey]: { key: prev[fieldKey]?.key || "title", dir: prev[fieldKey]?.dir === "asc" ? "desc" : "asc" } }))}
                        title="Alternar direção"
                      >
                        {sortByField[fieldKey]?.dir === "desc" ? "↓" : "↑"}
                      </button>
                    </div>
                  </div>
                  {/* Estado vazio por campo quando nenhum item foi retornado */}
                  {Object.values(byProv).every((arr) => !arr || arr.length === 0) ? (
                    <div className="text-sm text-gray-600 italic">Nenhum dado retornado pelos provedores para este campo.</div>
                  ) : null}
                  {/* Tabelas por provedor */}
                  {(
                    selectedProviderByField[fieldKey]
                      ? Object.entries(byProv).filter(([p]) => p === selectedProviderByField[fieldKey])
                      : Object.entries(byProv)
                  ).map(([prov, items]) => {
                    const groupKey = `${fieldKey}:${prov}`;
                    const page = pageByGroup[groupKey] ?? 1;
                    const sortConf = sortByField[fieldKey];
                    const sorted = sortConf
                      ? [...items].sort((a, b) => {
                          const va = String(((a as any)[sortConf.key] || "")).toLowerCase();
                          const vb = String(((b as any)[sortConf.key] || "")).toLowerCase();
                          const cmp = va.localeCompare(vb, "pt-BR", { sensitivity: "base" });
                          return sortConf.dir === "desc" ? -cmp : cmp;
                        })
                      : items;
                    const kwFiltered = applyGlobalFilters(sorted);
                    const visibleBase = kwFiltered.filter((it) => (it as any)?.not_found !== true);
                    const filtered = onlyCrossed ? visibleBase.filter((it) => isCrossed(it, fieldKey as string, prov)) : visibleBase;
                    const total = filtered.length;
                    const start = (page - 1) * PAGE_SIZE;
                    const end = Math.min(start + PAGE_SIZE, total);
                    const sliced = filtered.slice(start, end);
                    const showNotFoundBadge = total === 0 && kwFiltered.length > 0;
                    return (
                      <div key={prov} className="mb-5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium"><span className="badge badge-brand">{prov}</span>{showNotFoundBadge ? <span className="inline-block bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-xs ml-1">Não encontrado</span> : null}</div>
                          <div className="text-xs text-gray-600">
                            Mostrando {total ? start + 1 : 0}-{end} de {total}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="table-brand">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="text-left p-2 border">Título</th>
                                <th className="text-left p-2 border">Descrição</th>
                                <th className="text-left p-2 border">URL</th>
                                <th className="text-left p-2 border">Fonte</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sliced.length === 0 ? (
                                <tr>
                                  <td className="p-2 border text-sm italic" colSpan={4}>Dado inválido ou indisponível</td>
                                </tr>
                              ) : sliced.map((it, idx) => (
                                <tr key={idx} className="border-t">
                                  <td className="p-2 border">{it.title || it.snippet || "—"}</td>
                                  <td className="p-2 border">
                                    {((it.description as string) || it.snippet || "")}
                                    {it.source === "cpf" ? (() => {
                                      const statusStr = String(it.title || it.description || it.snippet || "").toLowerCase();
                                      const valido = typeof (it as any).valid === "boolean" ? (it as any).valid : statusStr.includes("válido");
                                      const cpfFmt = (it as any).cpf || formatCPF(subject.cpf || "");
                                      const digits = (it as any).digits || onlyDigits(subject.cpf || "");
                                      const raw = (it as any).raw || {};
                                      const nome = raw?.Nome || raw?.NomeSocial || raw?.name;
                                      const nomeSocial = raw?.NomeSocial;
                                      const nascRaw = raw?.DataNascimento || raw?.nascimento || raw?.dob;
                                      const nasc = typeof nascRaw === "string" && /^\d{8}$/.test(nascRaw)
                                        ? `${nascRaw.slice(6,8)}/${nascRaw.slice(4,6)}/${nascRaw.slice(0,4)}`
                                        : (typeof nascRaw === "string" ? nascRaw : undefined);
                                      const situacao = raw?.DescSituacaoCadastral || raw?.SituacaoCadastral;
                                      const residenteExterior = raw?.ResidenteExterior || raw?.Estrangeiro;
                                      const paisExterior = raw?.NomePaisExterior || raw?.CodigoPaisExterior;
                                      const nomeMae = raw?.NomeMae;
                                      const sexo = raw?.Sexo;
                                      const natureza = [raw?.NaturezaOcupacao, raw?.NomeNaturezaOcupacao].filter(Boolean).join(" — ");
                                      const ocupacao = [raw?.OcupacaoPrincipal, raw?.NomeOcupacaoPrincipal].filter(Boolean).join(" — ");
                                      const exercicio = raw?.ExercicioOcupacao;
                                      const unidadeNome = raw?.NomeUnidadeAdministrativa;
                                      const unidadeCod = raw?.UnidadeAdministrativa;
                                      const uf = raw?.UF || raw?.state;
                                      const municipio = raw?.Municipio || raw?.city;
                                      const dddVal = raw?.DDD || raw?.phone?.ddd;
                                      const telVal = raw?.Telefone || raw?.phone?.number;
                                      const cepRaw = raw?.Cep || raw?.cep || raw?.address?.zip;
                                      const cepDigits = typeof cepRaw === "string" ? onlyDigits(cepRaw) : (typeof cepRaw === "number" ? String(cepRaw) : "");
                                      const cepFmt = cepDigits ? formatCEP(cepDigits) : undefined;
                                      const naturalidadeCod = raw?.CodigoMunicipioNaturalidade;
                                      const naturalidadeNome = raw?.NomeMunicipioNacionalidade;
                                      const naturalidadeUF = raw?.UFMunicipioNaturalidade;
                                      const dataAtualizacaoRaw = raw?.DataAtualizacao;
                                      const dataInscricaoRaw = raw?.DataInscricao;
                                      const dataAtualizacao = typeof dataAtualizacaoRaw === "string" && /^\d{8}$/.test(dataAtualizacaoRaw)
                                        ? `${dataAtualizacaoRaw.slice(6,8)}/${dataAtualizacaoRaw.slice(4,6)}/${dataAtualizacaoRaw.slice(0,4)}`
                                        : (typeof dataAtualizacaoRaw === "string" ? dataAtualizacaoRaw : undefined);
                                      const dataInscricao = typeof dataInscricaoRaw === "string" && /^\d{8}$/.test(dataInscricaoRaw)
                                        ? `${dataInscricaoRaw.slice(6,8)}/${dataInscricaoRaw.slice(4,6)}/${dataInscricaoRaw.slice(0,4)}`
                                        : (typeof dataInscricaoRaw === "string" ? dataInscricaoRaw : undefined);
                                      const anoObito = raw?.AnoObito;
                                      const nacionalidadeCod = raw?.CodPaisNacionalidade;
                                      const nacionalidadeNome = raw?.NomePaisNacionalidade;

                                      const enderecoStr = (() => {
                                        const tipo = raw?.TipoLogradouro;
                                        const logradouro = raw?.Logradouro;
                                        const numero = raw?.NumeroLogradouro;
                                        const complemento = raw?.Complemento;
                                        const bairro = raw?.Bairro;
                                        const locUF = municipio && uf ? `${municipio}-${uf}` : (municipio || uf);
                                        return [tipo, logradouro, numero, complemento, bairro, locUF, cepFmt].filter(Boolean).join(", ");
                                      })();

                                      const boolStr = (v: any) => v === "S" || v === true ? "Sim" : v === "N" ? "Não" : (v === undefined ? undefined : String(v));

                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              <tr><td className="p-1 font-semibold w-32">Status</td><td className="p-1">{valido ? "Válido" : "Inválido"}</td></tr>
                                              <tr><td className="p-1 font-semibold">CPF</td><td className="p-1">{cpfFmt}</td></tr>
                                              {digits ? <tr><td className="p-1 font-semibold">Dígitos</td><td className="p-1">{digits}</td></tr> : null}
                                              {situacao ? <tr><td className="p-1 font-semibold">Situação</td><td className="p-1">{String(situacao)}</td></tr> : null}
                                              {nome ? <tr><td className="p-1 font-semibold">Nome</td><td className="p-1">{String(nome)}</td></tr> : null}
                                              {nomeSocial ? <tr><td className="p-1 font-semibold">Nome Social</td><td className="p-1">{String(nomeSocial)}</td></tr> : null}
                                              {nomeMae ? <tr><td className="p-1 font-semibold">Nome da Mãe</td><td className="p-1">{String(nomeMae)}</td></tr> : null}
                                              {nasc ? <tr><td className="p-1 font-semibold">Nascimento</td><td className="p-1">{String(nasc)}</td></tr> : null}
                                              {sexo !== undefined ? <tr><td className="p-1 font-semibold">Sexo</td><td className="p-1">{String(sexo)}</td></tr> : null}
                                              {natureza ? <tr><td className="p-1 font-semibold">Natureza da Ocupação</td><td className="p-1">{natureza}</td></tr> : null}
                                              {ocupacao ? <tr><td className="p-1 font-semibold">Ocupação Principal</td><td className="p-1">{ocupacao}</td></tr> : null}
                                              {exercicio ? <tr><td className="p-1 font-semibold">Exercício</td><td className="p-1">{String(exercicio)}</td></tr> : null}
                                              {unidadeNome || unidadeCod ? <tr><td className="p-1 font-semibold">Unidade Administrativa</td><td className="p-1">{[unidadeNome, unidadeCod].filter(Boolean).join(" — ")}</td></tr> : null}
                                              {enderecoStr ? <tr><td className="p-1 font-semibold">Endereço</td><td className="p-1">{enderecoStr}</td></tr> : null}
                                              {dddVal ? <tr><td className="p-1 font-semibold">DDD</td><td className="p-1">{String(dddVal)}</td></tr> : null}
                                              {telVal ? <tr><td className="p-1 font-semibold">Telefone</td><td className="p-1">{String(telVal)}</td></tr> : null}
                                              {dataInscricao ? <tr><td className="p-1 font-semibold">Inscrição</td><td className="p-1">{String(dataInscricao)}</td></tr> : null}
                                              {dataAtualizacao ? <tr><td className="p-1 font-semibold">Atualização</td><td className="p-1">{String(dataAtualizacao)}</td></tr> : null}
                                              {anoObito ? <tr><td className="p-1 font-semibold">Ano Óbito</td><td className="p-1">{String(anoObito)}</td></tr> : null}
                                              {residenteExterior !== undefined ? <tr><td className="p-1 font-semibold">Residente Exterior</td><td className="p-1">{boolStr(residenteExterior)}</td></tr> : null}
                                              {paisExterior ? <tr><td className="p-1 font-semibold">País Exterior</td><td className="p-1">{String(paisExterior)}</td></tr> : null}
                                              {nacionalidadeCod || nacionalidadeNome ? <tr><td className="p-1 font-semibold">Nacionalidade</td><td className="p-1">{[nacionalidadeNome, nacionalidadeCod].filter(Boolean).join(" — ")}</td></tr> : null}
                                              {(naturalidadeNome || naturalidadeCod || naturalidadeUF) ? <tr><td className="p-1 font-semibold">Naturalidade</td><td className="p-1">{[naturalidadeNome, naturalidadeCod, naturalidadeUF].filter(Boolean).join(" — ")}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {raw && Object.keys(raw).length ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify(raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "cep" ? (() => {
                                      const cepDigits = (it as any).cep || subject.cep || "";
                                      const cepFmt = formatCEP(String(cepDigits));
                                      const ibge = (it as any).ibge;
                                      const ddd = (it as any).ddd;
                                      const endereco = it.description || it.snippet || "";
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              <tr><td className="p-1 font-semibold w-32">Endereço</td><td className="p-1">{endereco}</td></tr>
                                              <tr><td className="p-1 font-semibold">CEP</td><td className="p-1">{cepFmt}</td></tr>
                                              {ibge ? <tr><td className="p-1 font-semibold">IBGE</td><td className="p-1">{String(ibge)}</td></tr> : null}
                                              {ddd ? <tr><td className="p-1 font-semibold">DDD</td><td className="p-1">{String(ddd)}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "phone" ? (() => {
                                      const ddd = (it as any).ddd;
                                      const e164 = (it as any).e164;
                                      const phoneDigits = (it as any).phone;
                                      const tipo = it.snippet || "";
                                      const fmt = it.description || "";
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              <tr><td className="p-1 font-semibold w-32">Formato BR</td><td className="p-1">{fmt}</td></tr>
                                              {ddd ? <tr><td className="p-1 font-semibold">DDD</td><td className="p-1">{String(ddd)}</td></tr> : null}
                                              {phoneDigits ? <tr><td className="p-1 font-semibold">Número</td><td className="p-1">{String(phoneDigits)}</td></tr> : null}
                                              {e164 ? <tr><td className="p-1 font-semibold">E.164</td><td className="p-1">{String(e164)}</td></tr> : null}
                                              {tipo ? <tr><td className="p-1 font-semibold">Tipo</td><td className="p-1">{tipo}</td></tr> : null}
                                            </tbody>
                                          </table>
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "ddd_brasilapi" ? (() => {
                                      const ddd = (it as any).ddd;
                                      const state = (it as any).state;
                                      const cities = Array.isArray((it as any).cities) ? (it as any).cities : [];
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            {Boolean((it as any).fallback) ? (
                                              <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-300">
                                                {`fallback BrasilAPI${(it as any).fallback_reason ? ` (${String((it as any).fallback_reason)})` : ""}`}
                                              </span>
                                            ) : null}
                                          </div>
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              <tr><td className="p-1 font-semibold w-32">DDD</td><td className="p-1">{String(ddd || "")}</td></tr>
                                              {state ? <tr><td className="p-1 font-semibold">Estado</td><td className="p-1">{String(state)}</td></tr> : null}
                                              {cities.length ? <tr><td className="p-1 font-semibold">Cidades</td><td className="p-1">{cities.join(", ")}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "ddd_apibrasil" ? (() => {
                                      const ddd = (it as any).ddd;
                                      const state = (it as any).state;
                                      const cities = Array.isArray((it as any).cities) ? (it as any).cities : [];
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              <tr><td className="p-1 font-semibold w-32">DDD</td><td className="p-1">{String(ddd || "")}</td></tr>
                                              {state ? <tr><td className="p-1 font-semibold">Estado</td><td className="p-1">{String(state)}</td></tr> : null}
                                              {cities.length ? <tr><td className="p-1 font-semibold">Cidades</td><td className="p-1">{cities.join(", ")}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "phone_portabilidade" ? (() => {
                                      const ddd = (it as any).ddd;
                                      const phone = (it as any).phone;
                                      const e164 = (it as any).e164;
                                      const operadora = (it as any).operadora;
                                      const situacao = (it as any).situacao;
                                      const tecnologia = (it as any).tecnologia;
                                      const atualizado = (it as any).atualizado;
                                      const abrtelecom = (it as any).abrtelecom_url || (it as any).url;
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {ddd ? <tr><td className="p-1 font-semibold w-32">DDD</td><td className="p-1">{String(ddd)}</td></tr> : null}
                                              {phone ? <tr><td className="p-1 font-semibold">Número</td><td className="p-1">{String(phone)}</td></tr> : null}
                                              {e164 ? <tr><td className="p-1 font-semibold">E.164</td><td className="p-1">{String(e164)}</td></tr> : null}
                                              {operadora ? <tr><td className="p-1 font-semibold">Prestadora</td><td className="p-1">{String(operadora)}</td></tr> : null}
                                              {situacao ? <tr><td className="p-1 font-semibold">Situação</td><td className="p-1">{String(situacao)}</td></tr> : null}
                                              {tecnologia ? <tr><td className="p-1 font-semibold">Tecnologia</td><td className="p-1">{String(tecnologia)}</td></tr> : null}
                                              {atualizado ? <tr><td className="p-1 font-semibold">Atualizado</td><td className="p-1">{String(atualizado)}</td></tr> : null}
                                              {abrtelecom ? <tr><td className="p-1 font-semibold">Origem</td><td className="p-1"><a className="text-blue-600 underline" href={String(abrtelecom)} target="_blank" rel="noreferrer">ABR Telecom</a></td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw_html ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver HTML bruto</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button className="text-xs px-2 py-1 border rounded" onClick={() => navigator.clipboard?.writeText(String((it as any).raw_html)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}>Copiar HTML</button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{String((it as any).raw_html)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "email_rep" ? (() => {
                                      const reputation = (it as any).reputation;
                                      const suspicious = (it as any).suspicious;
                                      const domain = (it as any).domain;
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {reputation ? <tr><td className="p-1 font-semibold w-32">Reputação</td><td className="p-1">{String(reputation)}</td></tr> : null}
                                              {typeof suspicious === "boolean" ? <tr><td className="p-1 font-semibold w-32">Suspeito</td><td className="p-1">{suspicious ? "Sim" : "Não"}</td></tr> : null}
                                              {domain ? <tr><td className="p-1 font-semibold w-32">Domínio</td><td className="p-1">{String(domain)}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "email_hunter" ? (() => {
                                      const result = (it as any).result;
                                      const score = (it as any).score;
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {result ? <tr><td className="p-1 font-semibold w-32">Resultado</td><td className="p-1">{String(result)}</td></tr> : null}
                                              {typeof score === "number" ? <tr><td className="p-1 font-semibold w-32">Score</td><td className="p-1">{String(score)}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "gravatar" ? (() => {
                                      const hash = (it as any).hash;
                                      const avatar = (it as any).avatar;
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {hash ? <tr><td className="p-1 font-semibold w-32">Hash</td><td className="p-1">{String(hash)}</td></tr> : null}
                                              {avatar ? <tr><td className="p-1 font-semibold w-32">Avatar</td><td className="p-1">Disponível</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "clearbit_logo" ? (() => {
                                      const domain = (it as any).domain;
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {domain ? <tr><td className="p-1 font-semibold w-32">Domínio</td><td className="p-1">{String(domain)}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "email_hibp" ? (() => {
                                      const breach = (it as any).breach;
                                      const desc = typeof (it as any).description === "string" ? (it as any).description : "";
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {breach ? <tr><td className="p-1 font-semibold w-32">Breach</td><td className="p-1">{String(breach)}</td></tr> : null}
                                              {desc ? <tr><td className="p-1 font-semibold w-32">Descrição</td><td className="p-1">{desc}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "clt_pis" ? (() => {
                                      const pis = (it as any).pis;
                                      const desc = typeof (it as any).description === "string" ? (it as any).description : "";
                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {pis ? <tr><td className="p-1 font-semibold w-32">PIS/NIT</td><td className="p-1">{String(pis)}</td></tr> : null}
                                              {desc ? <tr><td className="p-1 font-semibold w-32">Descrição</td><td className="p-1">{desc}</td></tr> : null}
                                            </tbody>
                                          </table>
                                          {(it as any).raw ? (
                                            <details className="mt-1">
                                              <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                              <div className="flex items-center gap-2 mt-1">
                                                <button
                                                  className="text-xs px-2 py-1 border rounded"
                                                  onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                                >
                                                  Copiar JSON
                                                </button>
                                              </div>
                                              <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                            </details>
                                          ) : null}
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "directdata" && (it as any).raw ? (() => {
                                      const raw = (it as any).raw;
                                      const ret = raw?.retorno || raw;
                                      const meta = raw?.metaDados || {};
                                      const nome = ret?.name || ret?.nome || raw?.Nome;
                                      const nomeMae = ret?.nameMother;
                                      const nascRaw = ret?.dateOfBirth || ret?.dob || ret?.nascimento || raw?.DataNascimento || raw?.birth_date;
                                      const nascimento =
                                        typeof nascRaw === "string" && /^\d{2}\/\d{2}\/\d{4}/.test(nascRaw) ? nascRaw.replace(/\s+\d{2}:\d{2}:\d{2}$/, "") :
                                        typeof nascRaw === "string" ? nascRaw : undefined;
                                      const cpf = ret?.cpf || raw?.Cpf || raw?.cpf;
                                      const genero = ret?.gender || raw?.Sexo;
                                      const idade = ret?.age;
                                      const rg = raw?.rg || raw?.identidade || raw?.id;
                                      const cnh = raw?.cnh || raw?.driver_license || raw?.carteira;
                                      const emailsArr = Array.isArray(ret?.emails) ? ret.emails : (Array.isArray(raw?.emails) ? raw.emails : (raw?.email ? [raw.email] : []));
                                      const emails = emailsArr.filter(Boolean).map((e: any) => typeof e === "string" ? e : (e?.emailAddress || e?.address || e?.email || "")).filter(Boolean);
                                      const phonesArr = Array.isArray(ret?.phones) ? ret.phones : (Array.isArray(raw?.phones) ? raw.phones : (raw?.phone ? [raw.phone] : []));
                                      const phones = phonesArr.filter(Boolean).map((p: any) => {
                                        if (typeof p === "string") return p;
                                        if (p?.phoneNumber) return [p.phoneNumber, p.phoneType].filter(Boolean).join(" ");
                                        const area = p?.area || p?.ddd;
                                        const num = p?.number || p?.numero;
                                        return area && num ? `(${area}) ${num}` : (num || area || "");
                                      }).filter(Boolean);
                                      const addressesArr = Array.isArray(ret?.addresses) ? ret.addresses : (Array.isArray(raw?.addresses) ? raw.addresses : (raw?.address ? [raw.address] : []));
                                      const addressStrs = addressesArr.filter(Boolean).map((a: any) => {
                                        const street = a?.street || a?.logradouro;
                                        const number = a?.number || a?.numero;
                                        const complement = a?.complement || a?.complemento;
                                        const neighborhood = a?.neighborhood || a?.bairro;
                                        const city = a?.city || a?.localidade;
                                        const state = a?.state || a?.uf;
                                        const zip = a?.postalCode || a?.zip || a?.cep;
                                        const loc = city && state ? `${city}-${state}` : (city || state);
                                        return [street, number, complement, neighborhood, loc, zip].filter(Boolean).join(", ");
                                      });
                                      const addressFirst = addressStrs[0];
                                      const cpfFmt = cpf ? formatCPF(String(cpf)) : undefined;
                                      const salaryRange = ret?.salaryRange;
                                      const estimatedSalary = ret?.estimatedSalary;

                                      const resumo = summarizeDirectData(ret);

                                      return (
                                        <div className="text-xs text-gray-700 mt-1">
                                          <table className="table-auto w-full border border-gray-200 rounded">
                                            <tbody className="divide-y">
                                              {resumo ? <tr><td className="p-1 font-semibold w-32">Resumo</td><td className="p-1">{resumo}</td></tr> : null}
                                              {nome ? <tr><td className="p-1 font-semibold w-32">Nome</td><td className="p-1">{String(nome)}</td></tr> : null}
                                              {nomeMae ? <tr><td className="p-1 font-semibold w-32">Nome da Mãe</td><td className="p-1">{String(nomeMae)}</td></tr> : null}
                                              {nascimento ? <tr><td className="p-1 font-semibold w-32">Nascimento</td><td className="p-1">{String(nascimento)}</td></tr> : null}
                                              {genero ? <tr><td className="p-1 font-semibold w-32">Gênero</td><td className="p-1">{String(genero)}</td></tr> : null}
                                              {idade !== undefined ? <tr><td className="p-1 font-semibold w-32">Idade</td><td className="p-1">{String(idade)}</td></tr> : null}
                                              {cpf ? <tr><td className="p-1 font-semibold w-32">CPF</td><td className="p-1">{cpfFmt || String(cpf)}</td></tr> : null}
                                              {rg ? <tr><td className="p-1 font-semibold w-32">RG</td><td className="p-1">{String(rg)}</td></tr> : null}
                                              {cnh ? <tr><td className="p-1 font-semibold w-32">CNH</td><td className="p-1">{String(cnh)}</td></tr> : null}
                                              {emails && emails.length ? <tr><td className="p-1 font-semibold w-32">Emails</td><td className="p-1">{emails.join(", ")}</td></tr> : null}
                                              {phones && phones.length ? <tr><td className="p-1 font-semibold w-32">Telefones</td><td className="p-1">{phones.join(", ")}</td></tr> : null}
                                              {addressFirst ? <tr><td className="p-1 font-semibold w-32">Endereço</td><td className="p-1">{addressFirst}</td></tr> : null}
                                              {addressesArr && addressesArr.length > 1 ? <tr><td className="p-1 font-semibold w-32">Outros Endereços</td><td className="p-1">{addressStrs.slice(1).join(" | ")}</td></tr> : null}
                                              {salaryRange ? <tr><td className="p-1 font-semibold w-32">Faixa Salarial</td><td className="p-1">{String(salaryRange)}</td></tr> : null}
                                              {estimatedSalary ? <tr><td className="p-1 font-semibold w-32">Salário Estimado</td><td className="p-1">{String(estimatedSalary)}</td></tr> : null}
                                              {meta?.resultado ? <tr><td className="p-1 font-semibold w-32">Resultado</td><td className="p-1">{String(meta.resultado)}</td></tr> : null}
                                              {meta?.consultaNome || meta?.consultaUid ? <tr><td className="p-1 font-semibold w-32">Consulta</td><td className="p-1">{[meta?.consultaNome, meta?.consultaUid].filter(Boolean).join(" — ")}</td></tr> : null}
                                              {meta?.apiVersao ? <tr><td className="p-1 font-semibold w-32">API</td><td className="p-1">{String(meta.apiVersao)}</td></tr> : null}
                                              {meta?.data ? <tr><td className="p-1 font-semibold w-32">Data</td><td className="p-1">{String(meta.data)}</td></tr> : null}
                                              {meta?.tempoExecucaoMs !== undefined ? <tr><td className="p-1 font-semibold w-32">Duração</td><td className="p-1">{String(meta.tempoExecucaoMs)} ms</td></tr> : null}
                                            </tbody>
                                          </table>
                                          <details className="mt-1">
                                            <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                            <div className="flex items-center gap-2 mt-1">
                                              <button
                                                className="text-xs px-2 py-1 border rounded"
                                                onClick={() => navigator.clipboard?.writeText(JSON.stringify(raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                              >
                                                Copiar JSON
                                              </button>
                                            </div>
                                            <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify(raw, null, 2)}</pre>
                                          </details>
                                        </div>
                                      );
                                    })() : null}
                                    {it.source === "cnpj" && (it as any).raw ? (
                                      (() => {
                                        const raw = (it as any).raw;
                                        const d = summarizeCNPJ(raw);
                                        const company = raw.company || {};
                                        const cnpjFmt = formatCNPJ(raw.taxId || it.id);
                                        const matrizFilial = raw.head ? "Matriz" : "Filial";
                                        const simples = company.simples?.optant ? `Optante desde ${company.simples.since}` : "Não optante";
                                        const simei = company.simei?.optant ? `Optante desde ${company.simei.since}` : "Não optante";
                                        const cnaePrincipal = [raw.mainActivity?.id, raw.mainActivity?.text].filter(Boolean).join(" — ");
                                        const sideActs = Array.isArray(raw.sideActivities) ? raw.sideActivities.map((a: any) => [a.id, a.text].filter(Boolean).join(" — ")).join("; ") : "";
                                        const equity = typeof company.equity === "number" ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(company.equity) : undefined;
                                        return (
                                          <div className="text-xs text-gray-700 mt-1">
                                            <table className="table-auto w-full border border-gray-200 rounded">
                                              <tbody className="divide-y">
                                                <tr><td className="p-1 font-semibold w-32">Resumo</td><td className="p-1">{d.summary}</td></tr>
                                                <tr><td className="p-1 font-semibold">CNPJ</td><td className="p-1">{cnpjFmt}</td></tr>
                                                {company.name ? <tr><td className="p-1 font-semibold">Razão Social</td><td className="p-1">{company.name}</td></tr> : null}
                                                {raw.status?.text ? <tr><td className="p-1 font-semibold">Status</td><td className="p-1">{raw.status.text}</td></tr> : null}
                                                {company.nature?.text || raw.nature?.text ? <tr><td className="p-1 font-semibold">Natureza Jurídica</td><td className="p-1">{company.nature?.text || raw.nature?.text}</td></tr> : null}
                                                {company.size?.text || company.size?.acronym ? <tr><td className="p-1 font-semibold">Porte</td><td className="p-1">{[company.size?.text, company.size?.acronym].filter(Boolean).join(" — ")}</td></tr> : null}
                                                {cnaePrincipal ? <tr><td className="p-1 font-semibold">Atividade Principal</td><td className="p-1">{cnaePrincipal}</td></tr> : null}
                                                {sideActs ? <tr><td className="p-1 font-semibold">Atividades Secundárias</td><td className="p-1">{sideActs}</td></tr> : null}
                                                {raw.founded ? <tr><td className="p-1 font-semibold">Fundada</td><td className="p-1">{raw.founded}</td></tr> : null}
                                                {d.directors.length ? <tr><td className="p-1 font-semibold">Diretoria</td><td className="p-1">{d.directors.join(", ")}</td></tr> : null}
                                                {d.phones.length ? <tr><td className="p-1 font-semibold">Telefones</td><td className="p-1">{d.phones.join(", ")}</td></tr> : null}
                                                {d.emails.length ? <tr><td className="p-1 font-semibold">Emails</td><td className="p-1">{d.emails.join(", ")}</td></tr> : null}
                                                {d.address ? <tr><td className="p-1 font-semibold">Endereço</td><td className="p-1">{d.address}</td></tr> : null}
                                                <tr><td className="p-1 font-semibold">Matriz/Filial</td><td className="p-1">{matrizFilial}</td></tr>
                                                {equity ? <tr><td className="p-1 font-semibold">Capital Social</td><td className="p-1">{equity}</td></tr> : null}
                                                {raw.statusDate ? <tr><td className="p-1 font-semibold">Situação Desde</td><td className="p-1">{raw.statusDate}</td></tr> : null}
                                                {raw.updated ? <tr><td className="p-1 font-semibold">Atualizado</td><td className="p-1">{raw.updated}</td></tr> : null}
                                                <tr><td className="p-1 font-semibold">Simples</td><td className="p-1">{simples}</td></tr>
                                                <tr><td className="p-1 font-semibold">SIMEI</td><td className="p-1">{simei}</td></tr>
                                              </tbody>
                                            </table>
                                          </div>
                                        );
                                      })()
                                    ) : null}
                                    {it.source === "cnpj" && (it as any).raw ? (
                                      <details className="mt-1">
                                        <summary className="cursor-pointer text-xs text-blue-700">Ver JSON completo</summary>
                                        <div className="flex items-center gap-2 mt-1">
                                          <button
                                            className="text-xs px-2 py-1 border rounded"
                                            onClick={() => navigator.clipboard?.writeText(JSON.stringify((it as any).raw, null, 2)).then(() => toast.show("Copiado!", 2000, "success")).catch(() => {})}
                                          >
                                            Copiar JSON
                                          </button>
                                        </div>
                                        <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded border mt-1">{JSON.stringify((it as any).raw, null, 2)}</pre>
                                      </details>
                                    ) : null}
                                  </td>
                                  <td className="p-2 border break-all">
                                    {it.url ? (
                                      <a href={String(it.url)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                                        {String(it.url)}
                                      </a>
                                    ) : (
                                      ""
                                    )}
                                  </td>
                                  <td className="p-2 border">{String(it.source || prov)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Controles de paginação */}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                            disabled={page <= 1}
                            onClick={() => setPageByGroup((prev) => ({ ...prev, [groupKey]: Math.max(1, page - 1) }))}
                          >
                            Anterior
                          </button>
                          <button
                            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                            disabled={end >= total}
                            onClick={() => setPageByGroup((prev) => ({ ...prev, [groupKey]: page + 1 }))}
                          >
                            Próximo
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}