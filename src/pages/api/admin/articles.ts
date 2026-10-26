export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../lib/admin/auth.ts';
import { 
  listLocalArticles, 
  getLocalArticle, 
  saveLocalArticle, 
  formatArticleMarkdown, 
  parseArticleMarkdown,
  slugify,
  calculateContentHash
} from '../../../lib/admin/articles.ts';
import { getGitHubConfig, saveDraftFileToGitHub, getFileFromGitHub } from '../../../lib/admin/github.ts';

export const GET: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  try {
    const config = getGitHubConfig();

    if (slug) {
      // 1. Tenta carregar do disco local
      let article = await getLocalArticle(slug);
      let isDraft = false;
      let remoteSha = article?.sha || '';

      // 2. Se houver token do GitHub, verifica a branch cms-drafts
      if (config.token) {
        try {
          const ghFile = await getFileFromGitHub(`src/content/blog/${slug}.md`, config.draftBranch);
          if (ghFile) {
            // Se o artigo não existia localmente (criado na Vercel), carrega do GitHub
            if (!article) {
              const { meta, body } = parseArticleMarkdown(ghFile.content);
              article = {
                slug,
                meta,
                body,
                sha: ghFile.sha,
                isDraft: true,
              };
            } else if (ghFile.sha !== article.sha) {
              // Rascunho com alterações pendentes no GitHub
              isDraft = true;
            }
            remoteSha = ghFile.sha;
          }
        } catch {
          // Mantém o estado local se houver falha de rede
        }
      }

      if (!article) {
        return new Response(JSON.stringify({ error: 'Artigo não encontrado.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          article: {
            ...article,
            sha: remoteSha,
            isDraft,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Lista todos os artigos (disco local + drafts remotos)
    const articles = await listLocalArticles();

    // Se houver token do GitHub, verifica se há novos rascunhos criados na branch cms-drafts
    if (config.token) {
      try {
        const { listDraftFiles } = await import('../../../lib/admin/github.ts');
        const draftFiles = await listDraftFiles();
        if (draftFiles && draftFiles.length > 0) {
          const localSlugs = new Set(articles.map((a) => a.slug));
          for (const df of draftFiles) {
            const dfSlug = df.name.replace(/\.md$/, '');
            if (!localSlugs.has(dfSlug)) {
              // Rascunho novo que ainda não está no disco local
              const ghFile = await getFileFromGitHub(`src/content/blog/${df.name}`, config.draftBranch);
              if (ghFile) {
                const { meta } = parseArticleMarkdown(ghFile.content);
                articles.unshift({
                  slug: dfSlug,
                  meta,
                  sha: ghFile.sha,
                });
              }
            }
          }
        }
      } catch {
        // Mantém listagem local em caso de indisponibilidade
      }
    }

    return new Response(JSON.stringify({ ok: true, articles }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao carregar artigos.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { 
      slug: rawSlug, 
      originalSlug, 
      title, 
      description, 
      pubDate, 
      updatedDate, 
      heroImage, 
      content, 
      currentSha 
    } = body;

    // 1. Validação de campos obrigatórios
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      return new Response(JSON.stringify({ error: 'O título do artigo é obrigatório (mínimo de 3 caracteres).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      return new Response(JSON.stringify({ error: 'A descrição/resumo é obrigatória (mínimo de 5 caracteres).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!pubDate || isNaN(Date.parse(pubDate))) {
      return new Response(JSON.stringify({ error: 'Data de publicação inválida. Utilize o formato YYYY-MM-DD.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!content || typeof content !== 'string' || content.trim().length < 10) {
      return new Response(JSON.stringify({ error: 'O conteúdo em Markdown é obrigatório (mínimo de 10 caracteres).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Normalização do Slug
    const cleanSlug = slugify(rawSlug || title);
    if (!cleanSlug) {
      return new Response(JSON.stringify({ error: 'Não foi possível gerar um slug válido para o artigo.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Prevenção de Slugs Duplicados
    const isNewArticle = !originalSlug || originalSlug !== cleanSlug;
    if (isNewArticle) {
      const existing = await getLocalArticle(cleanSlug);
      if (existing) {
        return new Response(
          JSON.stringify({ 
            error: `O slug '${cleanSlug}' já está em uso por outro artigo. Escolha um slug diferente.` 
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 4. Detecção de Conflito de Versão (para artigos existentes)
    if (!isNewArticle && currentSha) {
      const existing = await getLocalArticle(cleanSlug);
      if (existing && existing.sha !== currentSha) {
        return new Response(
          JSON.stringify({
            error: 'Conflito de edição: o artigo foi modificado por outra pessoa ou via Antigravity desde que foi carregado. Recarregue a página antes de salvar para não sobrescrever alterações.',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 5. Formatação do Markdown
    const markdownContent = formatArticleMarkdown(
      {
        title: title.trim(),
        description: description.trim(),
        pubDate: pubDate.trim(),
        updatedDate: updatedDate ? updatedDate.trim() : undefined,
        heroImage: heroImage ? heroImage.trim() : undefined,
      },
      content.trim()
    );

    // 6. Salvamento
    const config = getGitHubConfig();
    const relativeFilePath = `src/content/blog/${cleanSlug}.md`;
    let savedRemote = false;
    let newSha = '';

    // Salva na branch cms-drafts do GitHub se token estiver disponível
    if (config.token) {
      const ghResult = await saveDraftFileToGitHub(
        relativeFilePath,
        markdownContent,
        `[CMS Artigo] ${isNewArticle ? 'Criação' : 'Atualização'} de ${cleanSlug}`
      );

      if (!ghResult.ok) {
        return new Response(JSON.stringify({ error: ghResult.message }), {
          status: ghResult.message.includes('Conflito') ? 409 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      savedRemote = true;
      newSha = ghResult.sha || '';
    }

    // Tentativa de sincronização no disco local (apenas em ambiente com permissão de escrita)
    try {
      const localResult = await saveLocalArticle(cleanSlug, markdownContent);
      if (!newSha) {
        newSha = localResult.sha;
      }
    } catch {
      // Em ambientes com filesystem somente-leitura (como Vercel Serverless), ignora se já salvou no GitHub
      if (!savedRemote) {
        return new Response(
          JSON.stringify({ 
            error: 'Ambiente de produção com sistema de arquivos somente-leitura. Configure a variável GITHUB_TOKEN para salvar na branch cms-drafts do GitHub.' 
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: savedRemote
          ? 'Rascunho salvo com sucesso na branch de trabalho (cms-drafts) do GitHub.'
          : 'Rascunho salvo com sucesso localmente.',
        slug: cleanSlug,
        sha: newSha,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao processar salvamento do artigo.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
