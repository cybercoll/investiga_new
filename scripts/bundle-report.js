// Simple bundle report per route using .next build output
// Scans .next/server/app and .next/static/chunks for sizes
// Outputs top routes and their approximate sizes

const fs = require('fs');
const path = require('path');

function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function walkDir(dir, fileList = []) {
  const entries = safeStat(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, fileList);
    else fileList.push(full);
  }
  return fileList;
}

function sumDir(dir) {
  const files = walkDir(dir);
  let total = 0;
  for (const f of files) {
    const st = safeStat(f);
    if (st && st.isFile()) total += st.size;
  }
  return total;
}

function collectAppRoutes(appDir) {
  const routes = [];
  if (!safeStat(appDir)) return routes;
  const entries = fs.readdirSync(appDir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(appDir, e.name);
    if (e.isDirectory()) {
      const routePath = `/${e.name}`;
      const size = sumDir(full);
      routes.push({ route: routePath, size });
    }
  }
  return routes;
}

function collectPages(pagesDir) {
  const routes = [];
  if (!safeStat(pagesDir)) return routes;
  const files = walkDir(pagesDir);
  for (const f of files) {
    const rel = path.relative(pagesDir, f).replace(/\\/g, '/');
    if (rel.endsWith('.js') || rel.endsWith('.mjs')) {
      const st = safeStat(f);
      routes.push({ route: `/pages/${rel}`, size: st ? st.size : 0 });
    }
  }
  return routes;
}

function main() {
  const root = process.cwd();
  const appDir = path.join(root, '.next', 'server', 'app');
  const pagesDir = path.join(root, '.next', 'server', 'pages');
  const staticChunksDir = path.join(root, '.next', 'static');

  const appRoutes = collectAppRoutes(appDir);
  const pageRoutes = collectPages(pagesDir);

  const all = [...appRoutes, ...pageRoutes];
  all.sort((a, b) => b.size - a.size);

  const totalBytes = sumDir(path.join(root, '.next'));
  const top = all.slice(0, 10);

  console.log('# Bundle Report');
  console.log(`Total .next size: ${formatBytes(totalBytes)}`);
  console.log('');
  console.log('Top routes/files by size:');
  for (const r of top) {
    console.log(`- ${r.route} — ${formatBytes(r.size)}`);
  }
  console.log('');
  console.log('Note: Sizes are approximate and include server build artifacts.');
}

main();