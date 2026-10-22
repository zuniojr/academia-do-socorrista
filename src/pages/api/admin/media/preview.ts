export const prerender = false;

import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isRequestAuthenticated } from '../../../../lib/admin/auth.ts';
import { getGitHubConfig } from '../../../../lib/admin/github.ts';

const MIME_MAP: Record<string, string> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export const GET: APIRoute = async ({ request }) => {
  // 1. Verificação de autenticação no servidor
  if (!isRequestAuthenticated(request)) {
    return new Response('Acesso não autorizado.', { status: 401 });
  }

  const url = new URL(request.url);
  const filePath = url.searchParams.get('path') || '';

  // Sanitização estrita contra directory traversal
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  if (normalized.includes('..') || (!normalized.startsWith('/blog/') && !normalized.startsWith('/images/'))) {
    return new Response('Caminho não autorizado.', { status: 400 });
  }

  const ext = path.extname(normalized).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';

  // 1. Tenta carregar do disco local se disponível
  try {
    const localPath = path.resolve(process.cwd(), `public${normalized}`);
    const localData = await fs.readFile(localPath);
    return new Response(localData, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    // Não encontrado localmente (comum em serverless), busca na branch de rascunhos do GitHub
  }

  // 2. Busca na branch cms-drafts do GitHub
  const config = getGitHubConfig();
  if (config.token) {
    try {
      const ghUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/public${normalized}?ref=${config.draftBranch}`;
      const ghRes = await fetch(ghUrl, {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AcademiaDoSocorrista-CMS',
        },
      });

      if (ghRes.ok) {
        const data = await ghRes.json();
        if (data.content && data.encoding === 'base64') {
          const buffer = Buffer.from(data.content, 'base64');
          return new Response(buffer, {
            status: 200,
            headers: {
              'Content-Type': mime,
              'Cache-Control': 'private, max-age=3600',
            },
          });
        }
      }
    } catch {
      // Erro na requisição remota
    }
  }

  return new Response('Imagem não encontrada.', { status: 404 });
};
