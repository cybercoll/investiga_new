#!/usr/bin/env node
/**
 * Watch Vercel deploy health and rerun smoke tests automatically when ready.
 * Usage:
 *   OSINT_BASE_URL=https://<domain>.vercel.app node scripts/watch-vercel-health.mjs
 *   or: node scripts/watch-vercel-health.mjs https://<domain>.vercel.app
 * Env:
 *   WATCH_INTERVAL_MS (default 8000) - interval between checks
 *   WATCH_MAX_ATTEMPTS (default 45) - max attempts before giving up
 *   WATCH_TIMEOUT_MS (default 15000) - per-request timeout
 */

const BASE = process.env.OSINT_BASE_URL || process.argv[2];
if (!BASE || !/^https?:\/\//.test(BASE)) {
  console.error('Base URL inválida. Use OSINT_BASE_URL ou passe como argumento. Ex: https://investiga-preview-test.vercel.app');
  process.exit(1);
}

const INTERVAL = Number(process.env.WATCH_INTERVAL_MS || 8000);
const MAX_ATTEMPTS = Number(process.env.WATCH_MAX_ATTEMPTS || 45);
const TIMEOUT_MS = Number(process.env.WATCH_TIMEOUT_MS || 15000);

const endpoints = [
  { name: 'root', method: 'GET', path: '/' },
  { name: 'history', method: 'GET', path: '/api/history' },
  { name: 'search:general', method: 'POST', path: '/api/search', body: { query: 'Next.js', providers: ['wikipedia', 'duckduckgo', 'github'] } },
  { name: 'search:cep', method: 'POST', path: '/api/search', body: { query: '01001000', providers: ['cep'] } },
  { name: 'search:cpf', method: 'POST', path: '/api/search', body: { query: '52998224725', providers: ['cpf'] } },
];

async function checkOne(ep) {
  const url = new URL(ep.path, BASE).toString();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: ep.method,
      headers: ep.method === 'POST' ? { 'Content-Type': 'application/json', 'Accept': 'application/json' } : {},
      body: ep.method === 'POST' ? JSON.stringify(ep.body) : undefined,
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    const ok = res.status < 400;
    return { name: ep.name, code: res.status, ms, ok };
  } catch (e) {
    const ms = Date.now() - t0;
    return { name: ep.name, code: 'ERR', ms, ok: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(to);
  }
}

async function checkAll() {
  const results = [];
  for (const ep of endpoints) {
    results.push(await checkOne(ep));
  }
  return results;
}

function line(results) {
  return results.map(r => `${r.name}:${r.code} ${r.ms}ms${r.error ? ` (${r.error})` : ''}`).join(' | ');
}

async function runSmokeTests(base) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/osint-smoke-tests.mjs'], {
      env: { ...process.env, OSINT_BASE_URL: base },
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      console.log(`[smoke] exit code ${code}`);
      resolve();
    });
  });
}

async function main() {
  console.log(`[watch] base=${BASE} interval=${INTERVAL} max=${MAX_ATTEMPTS} timeout=${TIMEOUT_MS}`);
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const results = await checkAll();
    console.log(`[${i}/${MAX_ATTEMPTS}] ${new Date().toISOString()} ${line(results)}`);
    const allOk = results.every(r => r.ok);
    if (allOk) {
      console.log('[watch] Todas rotas responderam <400. Rodando smoke tests...');
      await runSmokeTests(BASE);
      console.log('[watch] Concluído.');
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
  console.error('[watch] Max attempts atingido sem todas rotas ok. Saindo.');
  process.exit(2);
}

main().catch(e => {
  console.error('[watch] erro', e);
  process.exit(1);
});