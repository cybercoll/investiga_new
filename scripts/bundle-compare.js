#!/usr/bin/env node
// Compare bundle-report.json between previous and current builds
// Usage: node scripts/bundle-compare.js <prev_json> <curr_json>

const fs = require('fs');
const path = require('path');

function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function toMap(arr) {
  const m = new Map();
  for (const it of arr || []) m.set(it.name, it.bytes || 0);
  return m;
}

function compareSection(prevArr, currArr) {
  const prev = toMap(prevArr);
  const curr = toMap(currArr);
  const names = new Set([...prev.keys(), ...curr.keys()]);
  const diffs = [];
  for (const name of names) {
    const a = prev.get(name) || 0;
    const b = curr.get(name) || 0;
    const d = b - a;
    diffs.push({ name, prev: a, curr: b, delta: d, absDelta: Math.abs(d) });
  }
  diffs.sort((x, y) => y.absDelta - x.absDelta);
  return diffs;
}

function main() {
  const [prevPath, currPath] = process.argv.slice(2);
  if (!prevPath || !currPath) {
    console.error('Usage: node scripts/bundle-compare.js <prev_json> <curr_json>');
    process.exit(2);
  }
  const prev = readJSON(prevPath);
  const curr = readJSON(currPath);
  if (!prev || !curr) {
    console.error('Failed to read input JSON files');
    process.exit(3);
  }

  const routeDiffs = compareSection(prev.routes, curr.routes).slice(0, 10);
  const chunkDiffs = compareSection(prev.chunks, curr.chunks).slice(0, 10);

  const lines = [];
  lines.push('# Bundle Report Diff');
  lines.push(`Total size: prev ${formatBytes(prev.total_bytes || 0)} → curr ${formatBytes(curr.total_bytes || 0)} (Δ ${(curr.total_bytes||0)-(prev.total_bytes||0)} bytes)`);
  lines.push('');
  lines.push('Routes (top changes):');
  for (const d of routeDiffs) {
    const sign = d.delta > 0 ? '+' : d.delta < 0 ? '-' : '±';
    lines.push(`- ${d.name}: ${formatBytes(d.curr)} (Δ ${sign}${formatBytes(Math.abs(d.delta))})`);
  }
  lines.push('');
  lines.push('Chunks (top changes):');
  for (const d of chunkDiffs) {
    const sign = d.delta > 0 ? '+' : d.delta < 0 ? '-' : '±';
    lines.push(`- ${d.name}: ${formatBytes(d.curr)} (Δ ${sign}${formatBytes(Math.abs(d.delta))})`);
  }

  const outTxt = path.join(process.cwd(), 'bundle-report-diff.txt');
  const outJson = path.join(process.cwd(), 'bundle-report-diff.json');
  fs.writeFileSync(outTxt, lines.join('\n'));
  fs.writeFileSync(outJson, JSON.stringify({ routeDiffs, chunkDiffs }, null, 2));

  console.log(JSON.stringify({ ok: true, outTxt, outJson }));
}

main();