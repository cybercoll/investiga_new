#!/usr/bin/env node
/*
  OSINT Smoke Tests
  - Valida estrutura por provider
  - Mede latência média e p95 com amostras pequenas
  - Exercita tratamento de erros (ausência de API key, rate-limit)

  Uso:
    node scripts/osint-smoke-tests.mjs
  Opções:
    OSINT_BASE_URL=http://localhost:3015
*/

const BASE_URL = process.env.OSINT_BASE_URL || 'http://localhost:3016';

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function postJSON(path, body) {
  const url = `${BASE_URL}${path}`;
  const start = nowMs();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const dur = nowMs() - start;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text, dur, url };
}

function percentile(arr, p = 0.95) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a,b) => a-b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length) - 1));
  return sorted[idx];
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hasKeys(obj, keys) {
  return keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
}

function summarizeLatency(name, durs) {
  const avg = durs.length ? Math.round(durs.reduce((a,b)=>a+b,0)/durs.length) : null;
  const p95 = percentile(durs, 0.95);
  return { name, samples: durs.length, avg_ms: avg, p95_ms: p95 };
}

async function testEmailProviders() {
  const name = 'Email OSINT';
  const providers = ['email_rep','gravatar','clearbit_logo','email_hibp','email_hunter'];
  const body = { query: 'bill@microsoft.com', providers };
  const durs = [];
  let last = null;
  for (let i = 0; i < 7; i++) {
    const r = await postJSON('/api/search', body);
    durs.push(r.dur);
    if (i === 0) last = r;
    await sleep(100);
  }
  assert(last && last.ok, `${name}: resposta não OK (${last && last.status})`);
  const results = last.json && last.json.results ? last.json.results : {};
  assert(typeof results === 'object', `${name}: results não é objeto`);
  providers.forEach(p => assert(Array.isArray(results[p]), `${name}: provider '${p}' ausente ou não array`));
  // gravatar
  const grav = results['gravatar'];
  if (grav.length) {
    assert(grav[0].source === 'gravatar', `${name}: gravatar source inválido`);
    assert(typeof grav[0].avatar === 'string' || typeof grav[0].hash === 'string', `${name}: gravatar sem avatar/hash`);
  }
  // clearbit_logo
  const clr = results['clearbit_logo'];
  if (clr.length) {
    assert(typeof clr[0].domain === 'string', `${name}: clearbit_logo sem domain`);
    assert(typeof clr[0].logo === 'string', `${name}: clearbit_logo sem logo`);
  }
  // email_hibp: sem API key deve retornar mensagem de configuração
  const hibp = results['email_hibp'];
  if (hibp.length) {
    const t = String(hibp[0].title || '').toLowerCase();
    const s = String(hibp[0].snippet || '').toLowerCase();
    const okMsg = t.includes('não configurado') || s.includes('ausente');
    const httpFail = String(hibp[0].description || '').toLowerCase().includes('erro') || String(hibp[0].title || '').toLowerCase().includes('falhou');
    assert(okMsg || httpFail, `${name}: email_hibp não indica configuração ausente ou falha`);
  }
  // email_hunter: sem API key deve retornar mensagem de configuração
  const hunter = results['email_hunter'];
  if (hunter.length) {
    const t = String(hunter[0].title || '').toLowerCase();
    const s = String(hunter[0].snippet || '').toLowerCase();
    const okMsg = t.includes('não configurado') || s.includes('ausente');
    const httpFail = String(hunter[0].description || '').toLowerCase().includes('erro') || String(hunter[0].title || '').toLowerCase().includes('falhou');
    assert(okMsg || httpFail, `${name}: email_hunter não indica configuração ausente ou falha`);
  }
  // email_rep: aceitar 429 como falha conhecida
  const erep = results['email_rep'];
  if (erep.length) {
    const t = String(erep[0].title || '').toLowerCase();
    const allow429 = t.includes('falhou') || t.includes('erro') || t.includes('429');
    // Se não houver falha, deve ter reputação
    const okRep = typeof erep[0].reputation === 'string' || Array.isArray(erep[0].references);
    assert(allow429 || okRep, `${name}: email_rep sem reputação nem falha esperada`);
  }
  return { latency: summarizeLatency(name, durs), providers, resultsKeys: Object.keys(results) };
}

async function testPhoneProviders() {
  const name = 'Telefone OSINT';
  const providers = ['phone','ddd_brasilapi'];
  const body = { query: '11987654321', providers };
  const durs = [];
  let last = null;
  for (let i = 0; i < 5; i++) {
    const r = await postJSON('/api/search', body);
    durs.push(r.dur);
    if (i === 0) last = r;
    await sleep(80);
  }
  assert(last && last.ok, `${name}: resposta não OK (${last && last.status})`);
  const results = last.json && last.json.results ? last.json.results : {};
  providers.forEach(p => assert(Array.isArray(results[p]), `${name}: provider '${p}' ausente ou não array`));
  const phone = results['phone'];
  if (phone.length) {
    assert(typeof phone[0].e164 === 'string', `${name}: phone sem e164`);
    assert(typeof phone[0].ddd === 'string', `${name}: phone sem ddd`);
  }
  const ddd = results['ddd_brasilapi'];
  if (ddd.length) {
    assert(typeof ddd[0].ddd === 'string', `${name}: ddd_brasilapi sem ddd`);
    assert(Array.isArray(ddd[0].cities), `${name}: ddd_brasilapi sem cities`);
  }
  return { latency: summarizeLatency(name, durs), providers, resultsKeys: Object.keys(results) };
}

async function testWebSearchProviders() {
  const name = 'Web Search';
  const providers = ['wikipedia','duckduckgo','github'];
  const body = { query: 'Next.js', providers };
  const durs = [];
  let last = null;
  for (let i = 0; i < 5; i++) {
    const r = await postJSON('/api/search', body);
    durs.push(r.dur);
    if (i === 0) last = r;
    await sleep(80);
  }
  assert(last && last.ok, `${name}: resposta não OK (${last && last.status})`);
  const results = last.json && last.json.results ? last.json.results : {};
  providers.forEach(p => assert(Array.isArray(results[p]), `${name}: provider '${p}' ausente ou não array`));
  const gh = results['github'];
  if (gh.length) {
    assert(gh[0].source === 'github', `${name}: github source inválido`);
    // opcional: checar campos comuns
    assert(typeof gh[0].url === 'string', `${name}: github sem url`);
  }
  return { latency: summarizeLatency(name, durs), providers, resultsKeys: Object.keys(results) };
}

async function main() {
  const out = { base_url: BASE_URL, ts: new Date().toISOString(), results: [], ok: true };
  try {
    out.results.push(await testEmailProviders());
    out.results.push(await testPhoneProviders());
    out.results.push(await testWebSearchProviders());
  } catch (e) {
    out.ok = false;
    out.error = e && e.message ? e.message : String(e);
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main();