# Investiga

Ferramenta web (Next.js 15 + Tailwind) para realizar buscas em provedores gratuitos (Wikipedia, DuckDuckGo, GitHub), e salvar resultados diretamente em um repositório GitHub. Pronta para deploy no Vercel.

## Requisitos
- Node 18+
- Repositório no GitHub (owner/repo)
- Vercel para deploy (opcional)

## Desenvolvimento Local
1. Crie o arquivo `.env.local` e defina:
```
GITHUB_TOKEN=...
GITHUB_OWNER=...
GITHUB_REPO=...
GITHUB_BRANCH=main

# Direct Data (opcional, API paga)
DIRECT_DATA_API_KEY=
DIRECT_DATA_BASE_URL=
DIRECT_DATA_AUTH_HEADER=X-API-Key
DIRECT_DATA_AUTH_SCHEME=
```
2. Instale dependências:
```
npm i
```
3. Rode o servidor dev:
```
npm run dev
```

## GitHub (armazenamento)
A API cria um arquivo JSON em `investigations/dd/mm/yyyy/slug-timestamp.json` no repositório configurado (formato de data em português). Defina:
- `GITHUB_TOKEN` (token pessoal com escopo `repo`)
- `GITHUB_OWNER` e `GITHUB_REPO`
- `GITHUB_BRANCH` (opcional, default `main`)

## Supabase (opcional)
Para habilitar salvar local de investigações no Supabase e listar histórico:
1. Defina no `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://<sua-instancia>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> # recomendado para backend
```
2. Crie a tabela:
```
CREATE TABLE public.investigations (
  id bigserial primary key,
  created_at timestamptz default now(),
  query text not null,
  results jsonb not null
);
```
3. Fluxos disponíveis:
- `POST /api/save` salva `{ query, results }` e retorna `{ id, created_at }`.
- `GET /api/supabase/history` lista últimos 50 itens ordenados por `created_at` desc.
- Na UI, o botão "Salvar no Supabase" e "Histórico (Supabase)" aparecem somente quando `NEXT_PUBLIC_SUPABASE_URL` está definido.


## Provedores
- Wikipedia: API pública de busca.
- DuckDuckGo: endpoint de instant answers (limitado).
- GitHub: busca de repositórios.
- Direct Data (API paga):
  - `DIRECT_DATA_API_KEY`: chave da API fornecida por você.
  - `DIRECT_DATA_BASE_URL`: base da API, sem barra final. Ex.: `https://api.seudominio.com`.
  - `DIRECT_DATA_AUTH_HEADER`: cabeçalho de autenticação. Ex.: `X-API-Key` (default) ou `Authorization`.
  - `DIRECT_DATA_AUTH_SCHEME`: esquema quando usar `Authorization`. Ex.: `Bearer` (ou deixe vazio).
  - Observação: a rota genérica chama `${DIRECT_DATA_BASE_URL}/search?q=<query>&limit=5`. Ajuste conforme sua documentação.

## Deploy no Vercel
1. Importar o repositório no Vercel.
2. Definir variáveis de ambiente no projeto Vercel (Production e Preview):
   - `GITHUB_TOKEN`
   - `GITHUB_OWNER`
   - `GITHUB_REPO`
   - `GITHUB_BRANCH` (opcional)
   - `DIRECT_DATA_*` se usar o provedor pago
3. Deploy. As rotas `/api/*` funcionam server-side e a página inicial oferece UI de busca e envio ao GitHub.

## Segurança
- `.env.local` está git-ignored; não commite segredos.
- GitHub token com escopo mínimo necessário (`repo`).

## Testes manuais
- Buscar termos como `Brasil`, `Next.js`.
- Enviar ao GitHub (verificar arquivo criado no repositório).

## Roadmap
- Paginação e filtros.
- Histórico de buscas renderizado a partir dos arquivos no GitHub.

## Checklist de Deploy
- Verificar variáveis: `npm run check:env` (retorna código de saída 0 quando ok).
- Build de produção: `npm run build`.
- Start (self-host): `npm run start`.
- Configurar variáveis no provedor (ex.: Vercel) para Production e Preview.
- Validar a UI e APIs em preview antes do corte para produção.

## Script de verificação de ambiente
- Comando: `npm run check:env`.
- GitHub (obrigatório): `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` (`GITHUB_BRANCH` opcional, default `main`).
- Supabase (opcional): se `NEXT_PUBLIC_SUPABASE_URL` estiver definido, é necessário pelo menos um entre `NEXT_PUBLIC_SUPABASE_ANON_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`.
- Direct Data (opcional): `DIRECT_DATA_API_KEY`, `DIRECT_DATA_BASE_URL`, `DIRECT_DATA_AUTH_HEADER`, `DIRECT_DATA_AUTH_SCHEME`.
- Saída do script indica faltas e fornece dicas. Se faltas obrigatórias existirem, sai com código 1.


## PR Test

Este PR valida preview, badge dinâmico e relatório de bundle.