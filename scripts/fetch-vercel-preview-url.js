#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
  // List jobs for the run; prefer deploy-preview job
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
        if (url) return { url, inspect, runId: run.id, jobId: deployJob.id };
      }
    }
  }
  // Fallback: run logs
  const runLogs = await fetchBinary(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/logs`, { headers });
  if (runLogs.ok) {
    let text;
    try { text = zlib.gunzipSync(runLogs.buffer).toString('utf8'); } catch { text = runLogs.buffer.toString('utf8'); }
    const { url, inspect } = extractVercelUrls(text);
    if (url) return { url, inspect, runId: run.id };
  }
  return null;
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

    // List runs for vercel-preview workflow
    const runs = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/vercel-preview.yml/runs?event=pull_request&per_page=50`, { headers });
    if (!runs.ok) throw new Error(`Falha ao listar runs: ${runs.status} ${runs.text}`);
    const list = runs.json && runs.json.workflow_runs ? runs.json.workflow_runs : [];
    if (!list.length) throw new Error('Nenhum workflow run encontrado para vercel-preview.yml');

    // Build candidate list: prefer match by head_sha, then others
    const primary = list.filter(r => r.head_sha === sha);
    const others = list.filter(r => r.head_sha !== sha);
    const candidates = [...primary, ...others].slice(0, 10);

    let found = null;
    for (const run of candidates) {
      const res = await findPreviewForRun(owner, repo, run, headers);
      if (res && res.url) { found = res; break; }
    }

    if (!found) {
      console.log(JSON.stringify({ ok: false, error: 'Preview URL não encontrada em até 10 runs recentes' }));
      process.exit(2);
    }

    console.log(JSON.stringify({ ok: true, url: found.url, inspect: found.inspect || null, runId: found.runId, jobId: found.jobId || null }));
  } catch (e) {
    console.error('Erro:', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();