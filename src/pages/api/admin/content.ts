export const prerender = false;

import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isRequestAuthenticated } from '../../../lib/admin/auth.ts';
import { getGitHubConfig, saveDraftFileToGitHub, getFileFromGitHub } from '../../../lib/admin/github.ts';

function sanitize(val: any): any {
  if (typeof val === 'string') {
    // Remove tags de script e injeções maliciosas
    return val
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '');
  }
  if (Array.isArray(val)) {
    return val.map(sanitize);
  }
  if (val && typeof val === 'object') {
    const res: Record<string, any> = {};
    for (const key of Object.keys(val)) {
      res[key] = sanitize(val[key]);
    }
    return res;
  }
  return val;
}

const ALLOWED_PAGES: Record<string, { filePath: string; title: string }> = {
  sobre: {
    filePath: 'src/data/pages/sobre.json',
    title: 'Sobre Nós',
  },
  home: {
    filePath: 'src/data/pages/home.json',
    title: 'Página Inicial',
  },
  'domine-o-controle-de-hemorragias': {
    filePath: 'src/data/pages/domine-o-controle-de-hemorragias.json',
    title: 'Curso: Domine o Controle de Hemorragias',
  },
};

export const GET: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const page = url.searchParams.get('page') || '';
  const pageConfig = ALLOWED_PAGES[page];

  if (!pageConfig) {
    return new Response(JSON.stringify({ error: 'Página não encontrada ou não cadastrada no editor visual.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const relativeFilePath = pageConfig.filePath;
    const config = getGitHubConfig();
    let fileSha = '';
    let dataContent = '';

    // Se houver token do GitHub configurado, tenta buscar da branch de rascunhos
    if (config.token) {
      try {
        const ghFile = await getFileFromGitHub(relativeFilePath, config.draftBranch);
        if (ghFile) {
          dataContent = ghFile.content;
          fileSha = ghFile.sha;
        }
      } catch (err) {
        // Fallback para arquivo local se a chamada ao GitHub falhar
      }
    }

    // Se ainda não tiver conteúdo, lê o arquivo local
    if (!dataContent) {
      const fullPath = path.resolve(process.cwd(), relativeFilePath);
      dataContent = await fs.readFile(fullPath, 'utf8');
    }

    const parsed = JSON.parse(dataContent);
    return new Response(JSON.stringify({ ok: true, page, data: parsed, sha: fileSha }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Erro ao carregar conteúdo da página.' }), {
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
    const { page, data, currentSha } = body;
    const pageConfig = ALLOWED_PAGES[page];

    if (!pageConfig || !data) {
      return new Response(JSON.stringify({ error: 'Parâmetros inválidos ou página não cadastrada.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Sanitização rigorosa dos dados
    const sanitizedData = sanitize(data);
    const contentString = JSON.stringify(sanitizedData, null, 2) + '\n';
    const relativeFilePath = pageConfig.filePath;
    const config = getGitHubConfig();

    let savedRemote = false;
    let newSha = '';

    // Se GITHUB_TOKEN estiver presente, salva na branch cms-drafts
    if (config.token) {
      const ghResult = await saveDraftFileToGitHub(
        relativeFilePath,
        contentString,
        `[CMS Rascunho] Atualização visual da página /${page === 'home' ? '' : page}`,
        currentSha
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

    // Atualiza também o arquivo local (útil para desenvolvimento local e preview)
    try {
      const fullPath = path.resolve(process.cwd(), relativeFilePath);
      await fs.writeFile(fullPath, contentString, 'utf8');
    } catch {
      // Em ambientes puramente serverless/read-only (como Vercel em runtime estrito), ignoramos erro de escrita local
    }

    return new Response(
      JSON.stringify({
        ok: true,
        page,
        message: savedRemote
          ? `Rascunho de "${pageConfig.title}" salvo com sucesso na branch de trabalho (${config.draftBranch}).`
          : `Rascunho de "${pageConfig.title}" salvo localmente com sucesso.`,
        sha: newSha,
        data: sanitizedData,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Erro ao processar requisição.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
