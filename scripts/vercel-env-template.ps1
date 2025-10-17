#requires -Version 5.1
<#!
Template para configurar variáveis de ambiente no Vercel.

Pré-requisitos:
- Vercel CLI instalado: npm i -g vercel
- Login: vercel login
- Linkar projeto: vercel link

Uso:
- Execute este script em PowerShell e siga os prompts do Vercel CLI.
- Cada comando `vercel env add` solicitará o valor da variável.
!>

Write-Host "Configurando variáveis para Production..." -ForegroundColor Cyan
vercel env add GITHUB_TOKEN production
vercel env add GITHUB_OWNER production
vercel env add GITHUB_REPO production
vercel env add GITHUB_BRANCH production

# Supabase (opcional)
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production

# Direct Data (opcional)
vercel env add DIRECT_DATA_API_KEY production
vercel env add DIRECT_DATA_BASE_URL production
vercel env add DIRECT_DATA_AUTH_HEADER production
vercel env add DIRECT_DATA_AUTH_SCHEME production

Write-Host "Configurando variáveis para Preview..." -ForegroundColor Cyan
vercel env add GITHUB_TOKEN preview
vercel env add GITHUB_OWNER preview
vercel env add GITHUB_REPO preview
vercel env add GITHUB_BRANCH preview

vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
vercel env add SUPABASE_SERVICE_ROLE_KEY preview

vercel env add DIRECT_DATA_API_KEY preview
vercel env add DIRECT_DATA_BASE_URL preview
vercel env add DIRECT_DATA_AUTH_HEADER preview
vercel env add DIRECT_DATA_AUTH_SCHEME preview

Write-Host "Configurando variáveis para Development..." -ForegroundColor Cyan
vercel env add GITHUB_TOKEN development
vercel env add GITHUB_OWNER development
vercel env add GITHUB_REPO development
vercel env add GITHUB_BRANCH development

vercel env add NEXT_PUBLIC_SUPABASE_URL development
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY development
vercel env add SUPABASE_SERVICE_ROLE_KEY development

vercel env add DIRECT_DATA_API_KEY development
vercel env add DIRECT_DATA_BASE_URL development
vercel env add DIRECT_DATA_AUTH_HEADER development
vercel env add DIRECT_DATA_AUTH_SCHEME development

Write-Host "Dica: para sincronizar variáveis para .env.local, use:" -ForegroundColor Yellow
Write-Host "  vercel env pull .env.local" -ForegroundColor Yellow