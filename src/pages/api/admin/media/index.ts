export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../../lib/admin/auth.ts';
import { listAllMedia, deleteMediaFile } from '../../../../lib/admin/media.ts';

export const GET: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('q')?.toLowerCase().trim() || '';
    const format = url.searchParams.get('format')?.toLowerCase().trim() || '';
    const folder = url.searchParams.get('folder')?.toLowerCase().trim() || '';

    let items = await listAllMedia();

    if (search) {
      items = items.filter((item) => 
        item.name.toLowerCase().includes(search) || 
        item.publicPath.toLowerCase().includes(search)
      );
    }

    if (format && format !== 'all') {
      items = items.filter((item) => item.format.toLowerCase() === format);
    }

    if (folder && folder !== 'all') {
      items = items.filter((item) => item.folder === folder);
    }

    return new Response(JSON.stringify({ ok: true, items, total: items.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao listar mídias.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { publicPath } = body;

    if (!publicPath || typeof publicPath !== 'string') {
      return new Response(JSON.stringify({ error: 'Parâmetro "publicPath" é obrigatório.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await deleteMediaFile(publicPath);

    if (!result.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: result.message,
          blockedByUsage: result.blockedByUsage,
          references: result.references,
        }),
        {
          status: result.blockedByUsage ? 409 : 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, message: result.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao processar exclusão.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
