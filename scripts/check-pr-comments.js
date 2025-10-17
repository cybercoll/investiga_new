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
    const prNumber = 1;
    const comments = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, { headers });
    if (!comments.ok) throw new Error(`Falha ao obter comentários: ${comments.status} ${comments.text}`);
    const list = Array.isArray(comments.json) ? comments.json : [];
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