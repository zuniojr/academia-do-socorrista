export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../lib/admin/auth.ts';

export const GET: APIRoute = async ({ request }) => {
  const authenticated = isRequestAuthenticated(request);
  return new Response(JSON.stringify({ authenticated }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
};
