#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readToken() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) throw new Error('Arquivo .env.local não encontrado');
  const content = fs.readFileSync(p, 'utf8');
  const m = content.match(/^GITHUB_TOKEN=(.*)$/m);
  if (!m || !m[1]) throw new Error('GITHUB_TOKEN ausente em .env.local');
  return m[1].trim();
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text, headers: res.headers };
}

function msBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms >= 0 ? ms : null;
}

(async () => {
  try {
    const token = readToken();
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'TraeAgent', Accept: 'application/vnd.github+json' };
    const user = await fetchJSON('https://api.github.com/user', { headers });
    if (!user.ok) throw new Error(`Falha ao obter usuário: ${user.status} ${user.text}`);
    const owner = user.json.login;
    const repo = 'investiga-preview-test';
    const prNumber = Number(process.env.PR_NUMBER || 1);

    const pr = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers });
    if (!pr.ok) throw new Error(`Falha ao obter PR: ${pr.status} ${pr.text}`);
    const sha = pr.json.head && pr.json.head.sha;
    if (!sha) throw new Error('SHA do PR não encontrado');

    const checks = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`, { headers });
    if (!checks.ok) throw new Error(`Falha ao obter check-runs: ${checks.status} ${checks.text}`);
    const runs = Array.isArray(checks.json.check_runs) ? checks.json.check_runs : [];

    const lines = runs.map(r => {
      const dur = msBetween(r.started_at, r.completed_at);
      const durStr = dur != null ? ` — ${dur}ms` : '';
      const link = r.html_url ? ` ([details](${r.html_url}))` : '';
      return `- ${r.name}: ${r.status}${r.conclusion ? ` (${r.conclusion})` : ''}${durStr}${link}`;
    }).join('\n');

    const order = ['failure','timed_out','cancelled','stale','action_required','neutral','skipped','success'];
    const worst = runs.reduce((acc, r) => {
      const c = (r.conclusion || 'neutral').toLowerCase();
      const a = order.indexOf(acc) >= 0 ? order.indexOf(acc) : order.length;
      const b = order.indexOf(c) >= 0 ? order.indexOf(c) : order.length;
      return b < a ? c : acc;
    }, 'success');
    const colorMap = { success: 'brightgreen', failure: 'red', cancelled: 'lightgrey', neutral: 'blue', timed_out: 'orange', action_required: 'yellow', skipped: 'lightgrey', stale: 'yellow' };
    const color = colorMap[worst] || 'lightgrey';
    const staticBadge = `![integration](https://img.shields.io/badge/integration-${worst}-${color})`;

    const checksPage = `https://github.com/${owner}/${repo}/commit/${sha}/checks`;

    let bundleDiffExcerpt = '';
    try {
      const diffTxtPath = path.join(__dirname, '..', 'bundle-report-diff.txt');
      const diffTxt = fs.readFileSync(diffTxtPath, 'utf8');
      const firstLines = diffTxt.split('\n').slice(0, 20).join('\n');
      bundleDiffExcerpt = `\nBundle report diff (excerpt):\n${firstLines}\n`;
    } catch (e) {
      bundleDiffExcerpt = '\nBundle report diff not available locally.';
    }

    const body = [
      '<!-- sticky:investiga-integration -->',
      staticBadge,
      '',
      'Check-runs detalhados:',
      lines,
      '',
      `Commit: ${sha}`,
      `[Checks page](${checksPage})`,
      bundleDiffExcerpt,
    ].join('\n');

    const comments = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, { headers });
    if (!comments.ok) throw new Error(`Falha ao obter comentários: ${comments.status} ${comments.text}`);
    const list = Array.isArray(comments.json) ? comments.json : [];
    const sticky = list.find(c => (c.body || '').includes('<!-- sticky:investiga-integration -->'));

    let updated;
    if (sticky) {
      const upd = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${sticky.id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      updated = upd.ok;
    } else {
      const crt = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      updated = crt.ok;
    }

    console.log(JSON.stringify({ pr: prNumber, sha, updated, worst }));
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();