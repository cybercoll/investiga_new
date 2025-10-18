#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readGithubToken() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) throw new Error('.env.local não encontrado');
  const content = fs.readFileSync(p, 'utf8');
  const m = content.match(/^GITHUB_TOKEN=(.*)$/m);
  if (!m || !m[1]) throw new Error('GITHUB_TOKEN ausente em .env.local');
  return m[1].trim();
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text, headers: res.headers };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function upsertRepoVariable(owner, repo, name, value, headers) {
  // Try create
  const create = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/actions/variables`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value })
  });
  if (create.ok) return { ok: true, action: 'created' };
  // Try update
  const upd = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/actions/variables/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value })
  });
  if (upd.ok) return { ok: true, action: 'updated' };
  return { ok: false, error: `Failed to set variable ${name}: ${create.status}/${upd.status}` };
}

async function getVercelProject(projectId, token) {
  const res = await fetchJSON(`https://api.vercel.com/v9/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Falha ao obter projeto Vercel: ${res.status} ${res.text}`);
  return res.json;
}

(async () => {
  try {
    const args = parseArgs();
    const vercelToken = args['vercel-token'];
    const projectId = args['project-id'] || 'prj_Q2iJe0AiXgNm26Z0dmwzP174HohF';
    const orgArg = args['org-id'];
    if (!vercelToken) throw new Error('Parâmetro --vercel-token é obrigatório');

    const ghToken = readGithubToken();
    const ghHeaders = { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'TraeAgent', Accept: 'application/vnd.github+json' };

    // Resolve owner e repo
    const user = await fetchJSON('https://api.github.com/user', { headers: ghHeaders });
    if (!user.ok) throw new Error(`Falha ao obter usuário: ${user.status} ${user.text}`);
    const owner = user.json.login;
    const repo = 'investiga-preview-test';

    // Obter orgId do projeto no Vercel (ou usar override)
    let orgId = orgArg || '';
    if (!orgId) {
      const project = await getVercelProject(projectId, vercelToken);
      orgId = project.orgId || project.teamId || '';
    }
    if (!orgId) throw new Error('orgId não encontrado no projeto Vercel (forneça --org-id=team_... como override)');

    // Upsert variables
    const r1 = await upsertRepoVariable(owner, repo, 'VERCEL_PROJECT_ID', projectId, ghHeaders);
    const r2 = await upsertRepoVariable(owner, repo, 'VERCEL_ORG_ID', orgId, ghHeaders);
    const r3 = await upsertRepoVariable(owner, repo, 'VERCEL_TOKEN', vercelToken, ghHeaders);

    console.log(JSON.stringify({ ok: true, owner, repo, projectId, orgId, results: { project_id: r1, org_id: r2, token: r3 } }));
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();