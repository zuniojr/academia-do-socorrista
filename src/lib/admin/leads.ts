// ID da planilha Google Sheets da Academia do Socorrista
export const SPREADSHEET_ID = '1VIO65l2rGB8eUCxiCuuH0zHybFmHGaSltoAZSJLuvIo';

export interface FallbackCols {
  date: number;
  name: number;
  phone: number;
  email?: number;
  course?: number;
  message?: number;
}

export interface SheetConfig {
  name: string;
  label: string;
  fallbackCols: FallbackCols;
}

export interface Lead {
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

// Configuração das abas com fallback de posições caso a aba não possua cabeçalho nomeado
export const SHEETS_CONFIG: SheetConfig[] = [
  { name: 'popup hemorragia',             label: 'Controle de Hemorragias', fallbackCols: { date: 0, name: 1, email: 2, phone: 3 } },
  { name: 'popup AFOGADOS',               label: 'Afogados / Guarda-Vidas', fallbackCols: { date: 0, name: 1, email: 2, phone: 3 } },
  { name: 'lista espera Start Portugal',   label: 'Start Portugal',          fallbackCols: { date: 0, name: 1, email: 2, phone: 3 } },
  { name: 'lista espera Altura',           label: 'Salvamento em Altura',    fallbackCols: { date: 0, name: 1, email: 2, phone: 3 } },
  { name: 'Pag Contato',                   label: 'Contato',                 fallbackCols: { date: 0, name: 1, phone: 2, course: 3, message: 4 } },
];

/**
 * Detecta se a primeira linha contém headers nomeados ou se já é dado
 */
export function hasNamedHeader(firstRow: string[]): boolean {
  const HEADER_KEYWORDS = ['data', 'hora', 'nome', 'name', 'email', 'e-mail', 'telefone', 'phone', 'whatsapp', 'treinamento', 'curso', 'mensagem'];
  return firstRow.some(cell => {
    const lower = cell.toLowerCase().trim();
    return HEADER_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw + '/'));
  });
}

export function parseCSV(text: string): string[][] {
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

export async function fetchSheetTab(config: SheetConfig): Promise<Lead[]> {
  const { name: sheetName, label, fallbackCols } = config;
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

    // Rejeita respostas HTML (planilha não publicada ou ID inválido)
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      console.error(`[leads] Aba "${sheetName}" retornou HTML — planilha pode não estar publicada`);
      return [];
    }

    const rows = parseCSV(text);
    if (rows.length === 0) return [];

    // Detecta se a aba tem header nomeado ou se a primeira linha já é dado
    const namedHeader = hasNamedHeader(rows[0]);
    const dataStartIdx = namedHeader ? 1 : 0;

    // Resolve índices de coluna por header ou por fallback posicional
    let colDate   = fallbackCols.date;
    let colName   = fallbackCols.name;
    let colPhone  = fallbackCols.phone;
    let colEmail  = fallbackCols.email ?? -1;
    let colCourse = fallbackCols.course ?? -1;
    let colMsg    = fallbackCols.message ?? -1;

    if (namedHeader) {
      const header = rows[0].map(h => h.toLowerCase().trim());
      const findCol = (names: string[]) => {
        for (const n of names) {
          const idx = header.findIndex(h => h.includes(n));
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const hDate   = findCol(['data', 'hora', 'timestamp']);
      const hName   = findCol(['nome', 'name']);
      const hPhone  = findCol(['telefone', 'phone', 'fone', 'whatsapp']);
      const hEmail  = findCol(['email', 'e-mail']);
      const hCourse = findCol(['treinamento', 'curso', 'course']);
      const hMsg    = findCol(['mensagem', 'message', 'obs']);

      if (hDate   >= 0) colDate   = hDate;
      if (hName   >= 0) colName   = hName;
      if (hPhone  >= 0) colPhone  = hPhone;
      if (hEmail  >= 0) colEmail  = hEmail;
      if (hCourse >= 0) colCourse = hCourse;
      if (hMsg    >= 0) colMsg    = hMsg;
    }

    const leads: Lead[] = [];

    for (let i = dataStartIdx; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(cell => cell.trim() === '')) continue;

      const name  = colName  >= 0 ? (row[colName]?.trim()  ?? '') : '';
      const phone = colPhone >= 0 ? (row[colPhone]?.trim() ?? '') : '';
      if (!name && !phone) continue;

      leads.push({
        id:      `${(i + 1).toString().padStart(4, '0')}-${sheetName.replace(/\s/g, '').slice(0, 6).toUpperCase()}`,
        name,
        phone,
        email:   colEmail  >= 0 ? (row[colEmail]?.trim()  ?? '') : '',
        course:  colCourse >= 0 ? (row[colCourse]?.trim() || label) : label,
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

/**
 * Busca todos os leads de todas as abas configuradas em paralelo
 */
export async function fetchAllLeads(): Promise<Lead[]> {
  const results = await Promise.all(
    SHEETS_CONFIG.map(config => fetchSheetTab(config))
  );
  return results.flat().reverse();
}
