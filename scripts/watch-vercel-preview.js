#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cp = require('child_process');

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
  return { ok: res.ok, status: res.status, json, text, headers: res.headers, url };
}

async function fetchBinary(url, options) {
  const res = await fetch(url, options);
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, buffer: buf, headers: res.headers, url, redirected: res.redirected, finalUrl: res.url };
}

function extractVercelUrls(text) {
  const urlMatch = text.match(/https?:\/\/[a-zA-Z0-9.-]+\.vercel\.app\b[^\s]*/g);
  const inspectMatch = text.match(/https?:\/\/vercel\.com\/[^\s]+/g);
  const url = urlMatch && urlMatch.length ? urlMatch[urlMatch.length - 1] : null;
  const inspect = inspectMatch && inspectMatch.length ? inspectMatch[inspectMatch.length - 1] : null;
  return { url, inspect };
}

async function findPreviewForRun(owner, repo, run, headers) {
  try {
    const jobs = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`, { headers });
    if (jobs.ok) {
      const jobList = jobs.json && jobs.json.jobs ? jobs.json.jobs : [];
      const deployJob = jobList.find(j => j.name === 'deploy-preview') || jobList[jobList.length - 1];
      if (deployJob) {
        const jobLogs = await fetchBinary(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${deployJob.id}/logs`, { headers });
        if (jobLogs.ok) {
          let text;
          try { text = zlib.gunzipSync(jobLogs.buffer).toString('utf8'); } catch { text = jobLogs.buffer.toString('utf8'); }
          const { url, inspect } = extractVercelUrls(text);
          if (url) return { url, inspect, runId: run.id, jobId: deployJob.id, source: 'workflow_logs' };
        }
      }
    }
  } catch {}
  try {
    const runLogs = await fetchBinary(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/logs`, { headers });
    if (runLogs.ok) {
      let text;
      try { text = zlib.gunzipSync(runLogs.buffer).toString('utf8'); } catch { text = runLogs.buffer.toString('utf8'); }
      const { url, inspect } = extractVercelUrls(text);
      if (url) return { url, inspect, runId: run.id, source: 'workflow_logs' };
    }
  } catch {}
  return null;
}

// Novo: busca via integração Vercel (check-runs do commit)
async function findPreviewFromChecks(owner, repo, sha, headers) {
  try {
    const r = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`, { headers });
    if (r.ok) {
      const runs = (r.json && r.json.check_runs) ? r.json.check_runs : [];
      const vercelRuns = runs.filter(cr => {
        const n = (cr.name || '').toLowerCase();
        const d = (cr.details_url || '').toLowerCase();
        return n.includes('vercel') || d.includes('vercel.com');
      });
      for (const cr of vercelRuns) {
        const blob = [cr.details_url || '', (cr.output && cr.output.summary) || '', (cr.output && cr.output.text) || ''].filter(Boolean).join('\n');
        const { url, inspect } = extractVercelUrls(blob);
        if (url) return { url, inspect: inspect || null, source: 'checks', check_run_id: cr.id, details_url: cr.details_url || null };
        if (cr.details_url) return { url: cr.details_url, inspect: null, source: 'checks_details', check_run_id: cr.id, details_url: cr.details_url };
      }
    }
  } catch {}
  return null;
}

// Novo: fallback por comentários do PR (app do Vercel costuma comentar)
async function findPreviewFromPRComments(owner, repo, prNumber, headers) {
  try {
    const r = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, { headers });
    if (r.ok) {
      const list = Array.isArray(r.json) ? r.json : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const body = list[i].body || '';
        const { url, inspect } = extractVercelUrls(body);
        if (url || inspect) {
          return { url: url || inspect, inspect: inspect || null, source: 'comments', comment_id: list[i].id };
        }
      }
    }
  } catch {}
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openUrl(u) {
  try {
    if (process.platform === 'win32') {
      cp.exec(`powershell -Command Start-Process \"${u}\"`);
    } else if (process.platform === 'darwin') {
      cp.exec(`open \"${u}\"`);
    } else {
      cp.exec(`xdg-open \"${u}\"`);
    }
  } catch {}
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

    const pr = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers });
    if (!pr.ok) throw new Error(`Falha ao obter PR: ${pr.status} ${pr.text}`);
    const sha = pr.json.head && pr.json.head.sha;
    if (!sha) throw new Error('SHA do PR não encontrado');

    const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 24); // ~4min se 10s/attempt
    const DELAY_MS = Number(process.env.DELAY_MS || 10000);

    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
      attempt++;

      // 1) Integração Vercel via check-runs
      const checkFound = await findPreviewFromChecks(owner, repo, sha, headers);
      if (checkFound && checkFound.url && /\.vercel\.app/.test(checkFound.url)) {
        const u = checkFound.url;
        const home = u.endsWith('/') ? u : (u + '/');
        const status = home + 'status';
        openUrl(home);
        openUrl(status);
        console.log(JSON.stringify({ ok: true, source: checkFound.source, url: u, inspect: checkFound.inspect || null, home, status, check_run_id: checkFound.check_run_id || null, details_url: checkFound.details_url || null }));
        return;
      }
      // Se apenas detalhes genéricos (ex: vercel.com/github), continua tentando outras fontes
      const runs = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/vercel-preview.yml/runs?event=pull_request&per_page=50`, { headers });
      if (runs.ok) {
        const list = runs.json && runs.json.workflow_runs ? runs.json.workflow_runs : [];
        const primary = list.filter(r => r.head_sha === sha);
        const others = list.filter(r => r.head_sha !== sha);
        const candidates = [...primary, ...others].slice(0, 10);
        for (const run of candidates) {
          const found = await findPreviewForRun(owner, repo, run, headers);
          if (found && found.url) {
            const u = found.url;
            if (/\.vercel\.app/.test(u)) {
              const home = u.endsWith('/') ? u : (u + '/');
              const status = home + 'status';
              openUrl(home);
              openUrl(status);
              console.log(JSON.stringify({ ok: true, source: found.source, url: u, inspect: found.inspect || null, home, status, runId: found.runId, jobId: found.jobId || null }));
            } else {
              openUrl(u);
              console.log(JSON.stringify({ ok: true, source: found.source, url: u, openedDetailsOnly: true, runId: found.runId, jobId: found.jobId || null }));
            }
            return;
          }
        }
      }

      // 3) Fallback: comentários do PR (app do Vercel)
      const commentFound = await findPreviewFromPRComments(owner, repo, prNumber, headers);
      if (commentFound && commentFound.url) {
        const u = commentFound.url;
        if (/\.vercel\.app/.test(u)) {
          const home = u.endsWith('/') ? u : (u + '/');
          const status = home + 'status';
          openUrl(home);
          openUrl(status);
          console.log(JSON.stringify({ ok: true, source: commentFound.source, url: u, inspect: commentFound.inspect || null, home, status, comment_id: commentFound.comment_id || null }));
        } else {
          openUrl(u);
          console.log(JSON.stringify({ ok: true, source: commentFound.source, url: u, openedDetailsOnly: true, comment_id: commentFound.comment_id || null }));
        }
        return;
      }

      await sleep(DELAY_MS);
    }

    console.log(JSON.stringify({ ok: false, error: 'Preview URL não encontrada após tentativas', attempts: attempt }));
    process.exit(2);
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();