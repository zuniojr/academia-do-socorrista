export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../lib/admin/auth.ts';
import { getGitHubConfig, getOrCreatePublishPullRequest } from '../../../lib/admin/github.ts';

export const POST: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = getGitHubConfig();
  if (!config.token) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: 'A variável GITHUB_TOKEN não está configurada no ambiente. Para abrir o Pull Request oficial, configure o token no arquivo .env ou no painel da Vercel.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const title = body.title || 'Publicação de artigos do Painel CMS';
    const description = body.description || 'Revisão e publicação de alterações preparadas na branch de rascunhos (cms-drafts).';

    const result = await getOrCreatePublishPullRequest(title, description);

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao criar Pull Request.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
