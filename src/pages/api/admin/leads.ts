export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../lib/admin/auth.ts';
import { fetchAllLeads } from '../../../lib/admin/leads.ts';

export const GET: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const allLeads = await fetchAllLeads();

    return new Response(JSON.stringify({
      ok: true,
      total: allLeads.length,
      leads: allLeads,
      updatedAt: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[leads] Erro geral:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Erro ao buscar dados', leads: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
