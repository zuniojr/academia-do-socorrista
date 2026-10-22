import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { micromark } from 'micromark';

export interface ArticleMeta {
  title: string;
  description: string;
  pubDate: string;
  updatedDate?: string;
  heroImage?: string;
}

export interface ArticleData {
  slug: string;
  meta: ArticleMeta;
  body: string;
  sha?: string;
  isDraft?: boolean;
}

const BLOG_DIR = path.resolve(process.cwd(), 'src/content/blog');

/**
 * Converte texto em slug limpo e seguro para URLs (compatível com pt-BR)
 */
export function slugify(text: string): string {
  return text
    .toString()
    .normalize('NFD') // Decompõe caracteres acentuados
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove caracteres especiais
    .replace(/\s+/g, '-') // Substitui espaços por hífen
    .replace(/-+/g, '-'); // Remove hífens duplicados
}

/**
 * Analisa arquivo Markdown extraindo o frontmatter YAML e o corpo
 */
export function parseArticleMarkdown(rawContent: string): { meta: ArticleMeta; body: string } {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      meta: {
        title: 'Sem título',
        description: '',
        pubDate: new Date().toISOString().split('T')[0],
      },
      body: rawContent.trim(),
    };
  }

  const rawFrontmatter = match[1];
  const body = match[2].trim();
  const meta: Record<string, string> = {};

  rawFrontmatter.split(/\r?\n/).forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove aspas simples ou duplas ao redor do valor
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && value !== undefined) {
        meta[key] = value;
      }
    }
  });

  return {
    meta: {
      title: meta.title || 'Sem título',
      description: meta.description || '',
      pubDate: meta.pubDate || new Date().toISOString().split('T')[0],
      updatedDate: meta.updatedDate || undefined,
      heroImage: meta.heroImage || undefined,
    },
    body,
  };
}

/**
 * Formata metadados e corpo em Markdown com frontmatter padrão
 */
export function formatArticleMarkdown(meta: ArticleMeta, body: string): string {
  const lines = ['---'];
  // Garante escape de aspas no título e descrição
  const safeTitle = meta.title.replace(/"/g, '\\"');
  const safeDesc = meta.description.replace(/"/g, '\\"');

  lines.push(`title: "${safeTitle}"`);
  lines.push(`description: "${safeDesc}"`);
  lines.push(`pubDate: "${meta.pubDate}"`);

  if (meta.updatedDate) {
    lines.push(`updatedDate: "${meta.updatedDate}"`);
  }

  if (meta.heroImage) {
    lines.push(`heroImage: "${meta.heroImage}"`);
  }

  lines.push('---');
  lines.push('');
  lines.push(body.trim());
  lines.push('');

  return lines.join('\n');
}

/**
 * Calcula o hash SHA-1 do conteúdo para detecção de conflitos
 */
export function calculateContentHash(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

/**
 * Lista todos os artigos existentes no sistema de arquivos local
 */
export async function listLocalArticles(): Promise<Array<{ slug: string; meta: ArticleMeta; sha: string }>> {
  try {
    const files = await fs.readdir(BLOG_DIR);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const articles: Array<{ slug: string; meta: ArticleMeta; sha: string }> = [];

    for (const file of mdFiles) {
      const slug = file.replace(/\.md$/, '');
      const filePath = path.join(BLOG_DIR, file);
      const raw = await fs.readFile(filePath, 'utf8');
      const { meta } = parseArticleMarkdown(raw);
      const sha = calculateContentHash(raw);

      articles.push({ slug, meta, sha });
    }

    // Ordena do mais recente para o mais antigo
    articles.sort((a, b) => new Date(b.meta.pubDate).getTime() - new Date(a.meta.pubDate).getTime());

    return articles;
  } catch (err) {
    console.error('Erro ao listar artigos locais:', err);
    return [];
  }
}

/**
 * Busca um artigo pelo slug no disco local
 */
export async function getLocalArticle(slug: string): Promise<ArticleData | null> {
  try {
    const cleanSlug = slug.replace(/\.md$/, '');
    const filePath = path.join(BLOG_DIR, `${cleanSlug}.md`);
    const raw = await fs.readFile(filePath, 'utf8');
    const { meta, body } = parseArticleMarkdown(raw);
    const sha = calculateContentHash(raw);

    return {
      slug: cleanSlug,
      meta,
      body,
      sha,
    };
  } catch {
    return null;
  }
}

/**
 * Salva um artigo localmente em src/content/blog/<slug>.md
 */
export async function saveLocalArticle(slug: string, fullMarkdown: string): Promise<{ ok: boolean; sha: string }> {
  const cleanSlug = slug.replace(/\.md$/, '');
  const filePath = path.join(BLOG_DIR, `${cleanSlug}.md`);
  await fs.writeFile(filePath, fullMarkdown, 'utf8');
  const sha = calculateContentHash(fullMarkdown);
  return { ok: true, sha };
}

/**
 * Renderiza Markdown seguro para HTML utilizando micromark
 */
export function renderMarkdownToHtml(markdown: string): string {
  // Converte para HTML
  const rawHtml = micromark(markdown, {
    allowDangerousHtml: false, // Previne injeção direta de tags HTML perigosas
  });

  // Sanitização extra para garantir conformidade
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '');
}
