#!/usr/bin/env node
/*
  Script de verificação de variáveis de ambiente.
  Uso: npm run check:env
*/

function has(key) {
  return typeof process.env[key] === "string" && process.env[key].trim().length > 0;
}

function printHeader(title) {
  console.log("\n=== " + title + " ===");
}

function main() {
  let exitCode = 0;

  // GitHub (obrigatório para salvar investigações)
  printHeader("GitHub");
  const ghRequired = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"];
  const ghOptional = ["GITHUB_BRANCH"]; // default main
  const ghMissing = ghRequired.filter((k) => !has(k));
  if (ghMissing.length > 0) {
    exitCode = 1;
    console.log("Faltando (obrigatório):", ghMissing.join(", "));
    console.log("Dica: gere um token com escopo 'repo' e defina OWNER/REPO.");
  } else {
    console.log("OK: chaves obrigatórias presentes.");
  }
  const ghOptMissing = ghOptional.filter((k) => !has(k));
  if (ghOptMissing.length > 0) {
    console.log("Opcional ausente:", ghOptMissing.join(", "), "(default 'main').");
  }

  // Supabase (opcional). Se URL estiver definida, exigir pelo menos uma chave de autenticação.
  printHeader("Supabase (opcional)");
  const supabaseUrl = has("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAuthKeys = ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const supabaseHasAuth = supabaseAuthKeys.some(has);
  if (!supabaseUrl) {
    console.log("Desativado: NEXT_PUBLIC_SUPABASE_URL não definido.");
  } else if (!supabaseHasAuth) {
    exitCode = 1;
    console.log("Faltando: pelo menos uma das chaves de autenticação:", supabaseAuthKeys.join(", "));
    console.log("Dica: use SERVICE_ROLE_KEY no backend para operações seguras.");
  } else {
    console.log("OK: Supabase habilitado com URL e chave de autenticação.");
  }

  // Direct Data (opcional)
  printHeader("Direct Data (opcional)");
  const directKeys = [
    "DIRECT_DATA_API_KEY",
    "DIRECT_DATA_BASE_URL",
    "DIRECT_DATA_AUTH_HEADER",
    "DIRECT_DATA_AUTH_SCHEME",
  ];
  const directAnyPresent = directKeys.some(has);
  if (!directAnyPresent) {
    console.log("Desativado: nenhuma chave DIRECT_DATA definida.");
  } else {
    const directMissing = directKeys.filter((k) => !has(k));
    if (directMissing.length > 0) {
      console.log("Aviso: faltando chaves DIRECT_DATA:", directMissing.join(", "));
    } else {
      console.log("OK: todas chaves DIRECT_DATA presentes.");
    }
  }

  // Saída
  console.log("\nResultado:", exitCode === 0 ? "OK" : "Faltas detectadas");
  process.exit(exitCode);
}

main();