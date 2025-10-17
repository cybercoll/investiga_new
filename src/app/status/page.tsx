export default async function StatusPage() {
  const owner = process.env.VERCEL_GIT_REPO_OWNER || process.env.GITHUB_OWNER || "";
  const repo = process.env.VERCEL_GIT_REPO_SLUG || process.env.GITHUB_REPO || "";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_BRANCH || "main";
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  const baseUrl = vercelUrl || "http://localhost:3000";
  const endpoint = `${baseUrl}/api/badge/integration?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`;
  const shieldUrl = `https://img.shields.io/endpoint?url=${encodeURIComponent(endpoint)}`;
  const checksUrl = owner && repo && sha ? `https://github.com/${owner}/${repo}/commit/${sha}/checks` : "";
  const prUrl = owner && repo ? `https://github.com/${owner}/${repo}/pulls` : "";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Investiga — Status de Produção</h1>
          <p className="mt-2 text-gray-700">Visão didática e profissional do estado do projeto em produção/preview no Vercel.</p>
        </header>

        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Resumo</h2>
          <p className="text-gray-700">Este projeto (Next.js 15 + Tailwind) integra busca em provedores gratuitos (Wikipedia, DuckDuckGo, GitHub) e permite salvar resultados diretamente em um repositório GitHub via API server-side. O fluxo de CI/CD utiliza GitHub Actions para integração e deploy de preview no Vercel.</p>
        </section>

        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">CI & Integração</h2>
          <div className="flex items-center gap-3">
            <span className="text-gray-700">Badge de integração:</span>
            {/* Shields endpoint badge baseado no nosso endpoint dinâmico */}
            <img src={shieldUrl} alt="Integration badge" className="h-6" />
          </div>
          <ul className="mt-4 text-gray-700 space-y-1 list-disc pl-5">
            <li><span className="font-medium">Branch:</span> <code className="bg-gray-100 px-1 py-0.5 rounded">{branch}</code></li>
            {sha && <li><span className="font-medium">Commit:</span> <code className="bg-gray-100 px-1 py-0.5 rounded">{sha}</code></li>}
            {checksUrl && (
              <li>
                <span className="font-medium">Checks:</span> <a href={checksUrl} className="text-blue-700 hover:underline" target="_blank" rel="noreferrer">ver no GitHub</a>
              </li>
            )}
          </ul>
        </section>

        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Deploy (Vercel)</h2>
          {vercelUrl ? (
            <div>
              <p className="text-gray-700">Este build está rodando em Vercel.</p>
              <ul className="mt-2 text-gray-700 space-y-1 list-disc pl-5">
                <li><span className="font-medium">Domínio:</span> <a href={vercelUrl} className="text-blue-700 hover:underline" target="_blank" rel="noreferrer">{vercelUrl}</a></li>
                <li><span className="font-medium">Owner/Repo:</span> <code className="bg-gray-100 px-1 py-0.5 rounded">{owner}/{repo}</code></li>
                <li><span className="font-medium">PRs:</span> <a href={prUrl} className="text-blue-700 hover:underline" target="_blank" rel="noreferrer">abrir lista de PRs</a></li>
              </ul>
            </div>
          ) : (
            <div>
              <p className="text-gray-700">Ambiente local detectado. Em produção no Vercel, esta seção exibirá o domínio ativo, branch e commit do deploy.</p>
              <p className="text-gray-700 mt-2">Para habilitar produção/preview, configure o projeto no Vercel e defina as variáveis de ambiente em Production/Preview.</p>
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Funcionalidades</h2>
          <ul className="text-gray-700 space-y-2 list-disc pl-5">
            <li>Busca em Wikipedia, DuckDuckGo e GitHub com agregação de resultados.</li>
            <li>Envio de investigações ao GitHub via API: cria JSON em <code className="bg-gray-100 px-1 py-0.5 rounded">investigations/dd/mm/yyyy/slug-timestamp.json</code>.</li>
            <li>Badge dinâmico de integração mapeado pelos check-runs do commit.</li>
            <li>Workflow de deploy de preview no Vercel com métricas básicas e comentário sticky no PR.</li>
          </ul>
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Como publicar em produção (Vercel)</h2>
          <ol className="text-gray-700 list-decimal pl-5 space-y-2">
            <li>Importe o repositório no Vercel e <code className="bg-gray-100 px-1 py-0.5 rounded">vercel link</code> no projeto local.</li>
            <li>Defina variáveis em Production e Preview: <code className="bg-gray-100 px-1 py-0.5 rounded">GITHUB_TOKEN</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">GITHUB_OWNER</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">GITHUB_REPO</code>, <code className="bg-gray-100 px-1 py-0.5 rounded">GITHUB_BRANCH</code> e (opcional) <code className="bg-gray-100 px-1 py-0.5 rounded">DIRECT_DATA_*</code>.</li>
            <li>Configure secrets/vars do GitHub (Actions) e os tokens do Vercel para o workflow de preview.</li>
            <li>Abra um PR; o workflow comentará com URL de preview, métricas e badges.</li>
            <li>Valide a UI e APIs. Ao aprovar, faça merge e promova para produção.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}