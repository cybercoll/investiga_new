#!/usr/bin/env node
const fs = require('fs');

function readToken() {
  const path = __dirname + '/../.env.local';
  if (!fs.existsSync(path)) throw new Error('Arquivo .env.local não encontrado');
  const content = fs.readFileSync(path, 'utf8');
  const m = content.match(/^GITHUB_TOKEN=(.*)$/m);
  if (!m || !m[1]) throw new Error('GITHUB_TOKEN ausente em .env.local');
  return m[1].trim();
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

(async () => {
  try {
    const token = readToken();
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'TraeAgent', Accept: 'application/vnd.github+json' };
    const user = await fetchJSON('https://api.github.com/user', { headers });
    if (!user.ok) throw new Error(`Falha ao obter usuário: ${user.status} ${user.text}`);
    const owner = user.json.login;
    const repo = 'investiga-preview-test';
    const prNumber = 2;
    const comments = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, { headers });
    if (!comments.ok) throw new Error(`Falha ao obter comentários: ${comments.status} ${comments.text}`);
    const list = Array.isArray(comments.json) ? comments.json : [];

    const preview = list.find(c => (c.body || '').includes('<!-- vercel-preview-url -->'));
    if (preview) {
      const body = preview.body || '';
      const urlMatch = body.match(/\*\*URL\*\*:\s*(https?:\/\/[^\s\)]+)/);
      const bundleMatch = body.match(/\*\*Bundle size\*\*: `([0-9.]+) MB`/);
      const rootMatch = body.match(/\*\*Page \/\*\*:\s*`([0-9]+) ms`\s*\(HTTP\s*(\d+)\)/);
      const histMatch = body.match(/\*\*API \/api\/history\*\*:\s*`([0-9]+) ms`\s*\(HTTP\s*(\d+)\)/);
      const searchMatch = body.match(/\*\*POST \/api\/search\*\*:\s*`([0-9]+) ms`\s*\(HTTP\s*(\d+)\)/);
      const url = urlMatch ? urlMatch[1].replace(/[)\]>,]+$/, '') : null;
      const bundleMb = bundleMatch ? Number(bundleMatch[1]) : null;
      const rootMs = rootMatch ? Number(rootMatch[1]) : null;
      const rootStatus = rootMatch ? Number(rootMatch[2]) : null;
      const histMs = histMatch ? Number(histMatch[1]) : null;
      const histStatus = histMatch ? Number(histMatch[2]) : null;
      const searchMs = searchMatch ? Number(searchMatch[1]) : null;
      const searchStatus = searchMatch ? Number(searchMatch[2]) : null;

      console.log(JSON.stringify({
        pr: prNumber,
        url,
        bundle_mb: bundleMb,
        resp_root_ms: rootMs,
        resp_root_status: rootStatus,
        resp_history_ms: histMs,
        resp_history_status: histStatus,
        resp_search_ms: searchMs,
        resp_search_status: searchStatus,
        comment_id: preview.id,
      }));
      return;
    }

    const sticky = list.find(c => (c.body || '').includes('<!-- sticky:investiga-integration -->'));
    if (sticky) {
      console.log(JSON.stringify({ found: true, id: sticky.id, body: sticky.body }));
    } else {
      console.log(JSON.stringify({ found: false, count: list.length }));
    }
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();