#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');

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

    // User info
    const user = await fetchJSON('https://api.github.com/user', { headers });
    if (!user.ok) throw new Error(`Falha ao obter usuário: ${user.status} ${user.text}`);
    const owner = user.json.login;

    const repo = 'investiga-preview-test';
    const repoUrl = `https://github.com/${owner}/${repo}`;

    // Check repo existence
    let check = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (check.status === 404) {
      let body = { name: repo, description: 'Preview test para investiga', auto_init: true, private: false };
      let create = await fetchJSON('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!create.ok) {
        // tenta privado
        body.private = true;
        create = await fetchJSON('https://api.github.com/user/repos', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!create.ok) throw new Error(`Criação de repo falhou: ${create.status} ${create.text}`);
      }
    } else if (!check.ok) {
      throw new Error(`Falha ao checar repo: ${check.status} ${check.text}`);
    }

    // Configure git
    try { cp.execSync(`git remote add preview https://github.com/${owner}/${repo}.git`, { stdio: 'inherit' }); } catch {}
    try { cp.execSync(`git config user.name "Trae CI"`, { stdio: 'inherit' }); } catch {}
    try { cp.execSync(`git config user.email "${owner}@users.noreply.github.com"`, { stdio: 'inherit' }); } catch {}
    const pushUrl = `https://${token}@github.com/${owner}/${repo}.git`;
    cp.execSync(`git remote set-url --push preview ${pushUrl}`, { stdio: 'inherit' });

    // Commit e branch
    try { cp.execSync('git add -A', { stdio: 'inherit' }); } catch {}
    try { cp.execSync('git commit -m "chore: preview PR test"', { stdio: 'inherit' }); } catch {}
    try { cp.execSync('git checkout -B pr/test', { stdio: 'inherit' }); } catch {}

    // Push branch
    cp.execSync('git push -u preview pr/test', { stdio: 'inherit' });

    // Abre PR
    const prTitle = 'Preview test PR';
    const prBody = 'Automated PR para validar preview, badge dinâmico e resumo de bundle.';
    const pr = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: prTitle, head: 'pr/test', base: 'main', body: prBody }),
    });
    if (!pr.ok) throw new Error(`Criação do PR falhou: ${pr.status} ${pr.text}`);

    console.log(JSON.stringify({ owner, repo, repoUrl, prUrl: pr.json.html_url, prNumber: pr.json.number }));
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();