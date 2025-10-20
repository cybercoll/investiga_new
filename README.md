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

# OSINT (opcionais)
HIBP_API_KEY=
HUNTER_API_KEY=
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

## Preferências Avançadas (Profissional)
- Forçar Wikipedia/DDG para nomes comuns: habilite no menu de provedores para incluir Wikipedia e DuckDuckGo mesmo quando o nome for detectado como genérico (ex.: “João da Silva”). A preferência é persistida em `localStorage` (`pro.forceGenericProviders`) e aparece como um chip ativo na barra de preferências.
- Pesquisar CNPJ na web (DuckDuckGo): habilite no menu de provedores para incluir DuckDuckGo ao consultar CNPJ. Usa uma query com prefixo “CNPJ” e máscara quando possível (ex.: `CNPJ 12.345.678/0001-90`). A preferência é persistida em `localStorage` (`pro.forceDuckDuckGoForCnpj`) e aparece como um chip “DuckDuckGo para CNPJ”.
- Pesquisar CPF na web (DuckDuckGo): habilite no menu de provedores para incluir DuckDuckGo ao consultar CPF. Usa uma query com prefixo “CPF” e máscara quando possível (ex.: `CPF 123.456.789-00`). A preferência é persistida em `localStorage` (`pro.forceDuckDuckGoForCpf`) e aparece como um chip “DuckDuckGo para CPF”.
- Refinar DDG para CNPJ/CPF (sites oficiais): quando habilitado, as consultas DDG de CNPJ/CPF usam aspas e filtros de site (`site:gov.br OR site:jus.br OR site:mp.br`) para priorizar resultados de fontes oficiais. Persistido em `localStorage` (`pro.refineDuckDuckGoForCpfCnpj`) e aparece como chip “Refino DDG: CNPJ/CPF (sites oficiais)”.
- Refinar DDG para Nome/RG (sites oficiais): quando habilitado, as consultas DDG de Nome/RG usam aspas e os mesmos filtros de site para favorecer órgãos oficiais. Persistido em `localStorage` (`pro.refineDuckDuckGoForNomeRg`) e aparece como chip “Refino DDG: Nome/RG (sites oficiais)”.
- CNJ Helper: ao lado do botão “Buscar no CNJ”, o nome atual é exibido com um atalho “Copiar”. Após copiar, um toast global “Copiado!” aparece por ~2s no canto superior direito.

## Validação manual
- Nome comum sem toggle: por exemplo `João da Silva` → o campo `nome` lista `Datajud` (CNJ) e oculta Wikipedia/DuckDuckGo.
- Nome comum com toggle “Forçar Wikipedia/DDG”: para `João da Silva` → aparecem `Wikipedia` e `DuckDuckGo` no campo `nome`.
- CNPJ com “Pesquisar CNPJ na web (DuckDuckGo)”: por exemplo `12.345.678/0001-90` → o campo `cnpj` consulta CNPJ e DuckDuckGo (usando query com prefixo “CNPJ” e máscara quando possível).
- CPF com “Pesquisar CPF na web (DuckDuckGo)”: por exemplo `123.456.789-00` → o campo `cpf` consulta CPF e DuckDuckGo (usando query com prefixo “CPF” e máscara quando possível).
- Com “Refinar DDG para CNPJ/CPF”: os resultados do DDG tendem a privilegiar páginas de órgãos oficiais (`gov.br`, `jus.br`, `mp.br`).
- Com “Refinar DDG para Nome/RG”: idem, aplicando filtros ao nome ou ao RG informados.
- CNJ Helper: o botão “Copiar” mostra um toast “Copiado!” por ~2s.


## Provedores OSINT (Agregador `/api/search`)
A página `/osint` permite escolher provedores e enviar atributos (email, telefone, etc.) para o agregador `POST /api/search`. Exemplos:

- `email_rep` (verificação reputacional gratuita, sujeito a rate limit):
```
POST /api/search
{
  "query": "bill@microsoft.com",
  "providers": ["email_rep"]
}
```
Observações: pode retornar `HTTP 429` quando excede limite.

- `gravatar` (avatar/perfil via hash MD5 do email):
```
POST /api/search
{
  "query": "bill@microsoft.com",
  "providers": ["gravatar"]
}
```
Retorna título, URL de perfil e avatar quando existir.

- `ddd_brasilapi` (informações do DDD para telefone brasileiro):
```
POST /api/search
{
  "query": "11987654321",
  "providers": ["phone", "ddd_brasilapi"]
}
```
Retorna DDD, estado (UF) e lista de cidades; o provider `phone` também formata para `E.164`.

- `ddd_apibrasil` (DDD via Anatel, fornecido pela APIBrasil):
```
POST /api/search
{
  "query": "11987654321",
  "providers": ["phone", "ddd_apibrasil"]
}
```
Configuração opcional no `.env.local`:
```
APIBRASIL_BASE_URL=https://api.apibrasil.io
APIBRASIL_DDD_ENDPOINT=/ddd/anatel
APIBRASIL_AUTH_HEADER=Authorization
APIBRASIL_AUTH_SCHEME=Bearer
# Preencha UMA destas chaves, se possuir:
#APIBRASIL_API_KEY=
#APIBRASIL_TOKEN=
#APIBRASIL_SECRET=
# Controle de fallback para BrasilAPI quando APIBrasil falhar ou não houver chave
APIBRASIL_DDD_FALLBACK=true
```
Comportamento:
- Com chave, a chamada usa autenticação e consulta diretamente a APIBrasil.
- Sem chave, tenta sem autenticação; se retornar 401/403 ou ocorrer erro de rede e `APIBRASIL_DDD_FALLBACK=true`, o backend usa a BrasilAPI automaticamente como fallback, agrupando os resultados sob a fonte `ddd_apibrasil`.
- Toggle na UI: “Preferir Anatel (sem fallback)” força o provedor `ddd_apibrasil` a não usar BrasilAPI como fallback, mesmo que `APIBRASIL_DDD_FALLBACK=true`.

- `phone_portabilidade` (Consulta Número — ABR Telecom):
```
POST /api/search
{
  "query": "61987654321",
  "providers": ["phone", "phone_portabilidade"]
}
```
Comportamento:
- Sem autenticação; consulta o site público da ABR Telecom e faz parsing de HTML (sujeito a mudanças de layout e indisponibilidade).
- Retorna prestadora (operadora), situação, tecnologia e data de atualização quando disponíveis.
- Na página Profissional, o toggle “Portabilidade (ABR Telecom)” aparece na barra lateral e vem desativado por padrão.

- Extras já integrados:
  - `email_hibp` (Have I Been Pwned): requer `HIBP_API_KEY`. Se ausente, retorna mensagem de configuração.
  - `clearbit_logo` (logo por domínio): extrai domínio do email/URL e retorna logo público (`https://logo.clearbit.com/<domínio>`).
  - `email_hunter` (verificador Hunter.io): requer `HUNTER_API_KEY`. Se ausente, retorna mensagem de configuração.


## Deploy no Vercel
1. Importar o repositório no Vercel.
2. Definir variáveis de ambiente no projeto Vercel (Production e Preview):
   - `GITHUB_TOKEN`
   - `GITHUB_OWNER`
   - `GITHUB_REPO`
   - `GITHUB_BRANCH` (opcional)
   - `DIRECT_DATA_*` se usar o provedor pago
   - `HIBP_API_KEY` e `HUNTER_API_KEY` (opcionais) para OSINT
3. Deploy. As rotas `/api/*` funcionam server-side e a página inicial oferece UI de busca e envio ao GitHub.

## Segurança
- `.env.local` está git-ignored; não commite segredos.
- GitHub token com escopo mínimo necessário (`repo`).

## Testes manuais
- Buscar termos como `Brasil`, `Next.js`.
- Enviar ao GitHub (verificar arquivo criado no repositório).
- Na página `/osint`, testar email e telefone com provedores `email_rep`, `gravatar`, `ddd_brasilapi`.

## Roadmap
- Paginação e filtros.
- Histórico de buscas renderizado a partir dos arquivos no GitHub.

## Checklist de Deploy
- Verificar variáveis: `npm run check:env` (retorna código de saída 0 quando ok).
- Build de produção: `npm run build`. Nota: defina `NODE_ENV=production` no build quando usar Turbopack no Next.js 15 para evitar o erro “<Html> should not be imported outside of pages/_document” na prerenderização do `/404`.
- Start (self-host): `npm run start`.
- Configurar variáveis no provedor (ex.: Vercel) para Production e Preview.
- Validar a UI e APIs em preview antes do corte para produção.

## Script de verificação de ambiente
- Comando: `npm run check:env`.
- GitHub (obrigatório): `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` (`GITHUB_BRANCH` opcional, default `main`).
- Supabase (opcional): se `NEXT_PUBLIC_SUPABASE_URL` estiver definido, é necessário pelo menos um entre `NEXT_PUBLIC_SUPABASE_ANON_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`.
- Direct Data (opcional): `DIRECT_DATA_API_KEY`, `DIRECT_DATA_BASE_URL`, `DIRECT_DATA_AUTH_HEADER`, `DIRECT_DATA_AUTH_SCHEME`.
- OSINT (opcional): `HIBP_API_KEY`, `HUNTER_API_KEY` para provedores de email.
- Saída do script indica faltas e fornece dicas. Se faltas obrigatórias existirem, sai com código 1.


## PR Test

Este PR valida preview, badge dinâmico e relatório de bundle.
