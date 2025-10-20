#!/usr/bin/env node
/*
  Checagem de variáveis Vercel para produção.
  Uso: npm run check:vercel
*/

function has(key) {
  return typeof process.env[key] === 'string' && process.env[key].trim().length > 0;
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function main() {
  let exitCode = 0;

  printHeader('Vercel (produção)');
  const required = ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'];
  const missing = required.filter((k) => !has(k));
  if (missing.length) {
    exitCode = 1;
    console.log('Faltando (obrigatório):', missing.join(', '));
    console.log('Como resolver:');
    console.log('- Adicione `VERCEL_TOKEN` como Secret em GitHub Actions (Settings > Secrets and variables > Actions).');
    console.log('- Defina `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` como Secrets ou Variables.');
    console.log('  Organização (exemplo): team_cBXVEFj6YK3OLTTd5JLX8eTw');
    console.log('  Projeto (exemplo): prj_Q2iJe0AiXgNm26Z0dmwzP174HohF');
  } else {
    console.log('OK: variáveis obrigatórias presentes.');
  }

  // Informativos
  console.log('\nDicas:');
  console.log('- Você pode sincronizar variáveis do repositório com scripts/set-actions-vars.js usando o GITHUB_TOKEN do runner.');
  console.log('- Execute `vercel pull --environment=production` para puxar envs do Vercel após configurar o token.');

  console.log('\nResultado:', exitCode === 0 ? 'OK' : 'Faltas detectadas');
  process.exit(exitCode);
}

main();