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
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'TraeAgent', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    const user = await fetchJSON('https://api.github.com/user', { headers });
    if (!user.ok) throw new Error(`Falha ao obter usuário: ${user.status} ${user.text}`);
    const owner = user.json.login;
    const repo = 'investiga-preview-test';
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
    const body = { title: 'Preview test PR', head: 'pr/test', base: 'master', body: 'Automated PR para validar preview, badge e bundle.' };
    const pr = await fetchJSON(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!pr.ok) throw new Error(`Criação do PR falhou: ${pr.status} ${pr.text}`);
    console.log(JSON.stringify({ prUrl: pr.json.html_url, prNumber: pr.json.number }));
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();