export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../lib/admin/auth.ts';

// ID da planilha Google Sheets da Academia do Socorrista
const SPREADSHEET_ID = '1VIO65l2rGB8eUCxiCuuH0zHybFmHGaSltoAZSJLuvlo';

// Abas da planilha
const SHEETS = [
  { name: 'popup hemorragia',        label: 'Controle de Hemorragias' },
  { name: 'popup AFOGADOS',          label: 'Afogados / Guarda-Vidas' },
  { name: 'lista espera Start Portugal', label: 'Start Portugal'      },
  { name: 'lista espera Altura',     label: 'Salvamento em Altura'    },
  { name: 'Pag Contato',             label: 'Contato'                 },
];

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  course: string;
  source: string;
  date: string;
  message: string;
  status: string;
}

async function fetchSheetTab(sheetName: string, label: string): Promise<Lead[]> {
  const encodedName = encodeURIComponent(sheetName);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedName}`;

  try {
    const res = await fetch(csvUrl, {
      headers: { 'User-Agent': 'AcademiaSocorrista-Admin/1.0' },
    });

    if (!res.ok) {
      console.error(`[leads] Erro ao buscar aba "${sheetName}": HTTP ${res.status}`);
      return [];
    }

    const text = await res.text();
    if (!text || text.trim() === '') return [];

    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const header = rows[0].map(h => h.toLowerCase().trim());
    const col = (names: string[]) => {
      for (const n of names) {
        const idx = header.findIndex(h => h.includes(n));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const colDate   = col(['data', 'hora', 'timestamp']);
    const colName   = col(['nome', 'name']);
    const colPhone  = col(['telefone', 'phone', 'fone', 'whatsapp']);
    const colEmail  = col(['email', 'e-mail']);
    const colCourse = col(['treinamento', 'curso', 'course']);
    const colMsg    = col(['mensagem', 'message', 'obs']);

    const leads: Lead[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(cell => cell.trim() === '')) continue;

      const name  = colName  >= 0 ? (row[colName]?.trim()  ?? '') : '';
      const phone = colPhone >= 0 ? (row[colPhone]?.trim() ?? '') : '';
      if (!name && !phone) continue;

      leads.push({
        id:      `${i.toString().padStart(4,'0')}-${sheetName.replace(/\s/g,'').slice(0,6).toUpperCase()}`,
        name,
        phone,
        email:   colEmail  >= 0 ? (row[colEmail]?.trim()  ?? '') : '',
        course:  colCourse >= 0 ? (row[colCourse]?.trim() ?? label) : label,
        source:  label,
        date:    colDate   >= 0 ? (row[colDate]?.trim()   ?? '') : '',
        message: colMsg    >= 0 ? (row[colMsg]?.trim()    ?? '') : '',
        status:  'Lead',
      });
    }

    return leads;
  } catch (err) {
    console.error(`[leads] Falha na aba "${sheetName}":`, err);
    return [];
  }
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (char === ',' && !inQuotes) {
        cells.push(current); current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    rows.push(cells);
  }

  return rows;
}

export const GET: APIRoute = async ({ request }) => {
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const results = await Promise.all(
      SHEETS.map(s => fetchSheetTab(s.name, s.label))
    );

    const allLeads = results.flat().reverse();

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
