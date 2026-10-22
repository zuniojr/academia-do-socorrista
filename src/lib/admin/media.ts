import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { 
  getGitHubConfig, 
  saveDraftFileToGitHub, 
  deleteDraftFileFromGitHub, 
  listDraftDirectory,
  getFileFromGitHub 
} from './github.ts';
import { listLocalArticles } from './articles.ts';

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_FILES_PER_REQUEST = 5;
export const ALLOWED_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'avif'];

export interface MediaItem {
  name: string;
  publicPath: string; // Ex: /blog/nome.avif ou /images/foto.webp
  folder: 'blog' | 'images';
  format: string;
  size: number;
  width?: number;
  height?: number;
  modifiedAt?: string;
  isDraft?: boolean;
  inUse?: boolean;
  usedIn?: Array<{ type: 'blog' | 'page'; title: string; location: string }>;
  sha?: string;
}

export interface ValidationResult {
  valid: boolean;
  format?: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Validação rigorosa do conteúdo REAL do arquivo binário.
 * Verifica assinaturas de cabeçalho (magic bytes) e decodifica via sharp.
 * Rejeita scripts mascarados, executáveis ou arquivos corrompidos.
 */
export async function validateImageContent(buffer: Buffer): Promise<ValidationResult> {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Arquivo vazio ou buffer inválido.' };
  }

  if (buffer.length > MAX_FILE_SIZE) {
    const mbLimit = MAX_FILE_SIZE / (1024 * 1024);
    return { valid: false, error: `O arquivo excede o limite máximo permitido de ${mbLimit} MB.` };
  }

  // 1. Verificação prévia de Magic Bytes para formatos permitidos
  const isJpeg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isWebp = buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  
  // AVIF baseia-se no padrão ISO-BMFF com box ftyp e marca compatível avif/avis/mif1
  const isAvif = buffer.length > 12 && 
    buffer.subarray(4, 8).toString('ascii') === 'ftyp' && 
    (
      buffer.subarray(8, 12).toString('ascii').startsWith('avif') ||
      buffer.subarray(8, 12).toString('ascii').startsWith('avis') ||
      buffer.subarray(8, 12).toString('ascii').startsWith('mif1') ||
      buffer.subarray(8, 16).toString('ascii').includes('avif')
    );

  if (!isJpeg && !isPng && !isWebp && !isAvif) {
    return {
      valid: false,
      error: 'Formato não autorizado ou cabeçalho inválido. Apenas imagens JPEG, PNG, WebP e AVIF são aceitas.',
    };
  }

  // 2. Decodificação profunda de metadados reais através do sharp
  try {
    const metadata = await sharp(buffer).metadata();

    if (!metadata || !metadata.format) {
      return { valid: false, error: 'Estrutura da imagem corrompida ou ilegível.' };
    }

    let detectedFormat = metadata.format.toLowerCase();
    // Normalização de formatos reportados pelo libvips
    if (detectedFormat === 'heif' || detectedFormat === 'heic') {
      detectedFormat = 'avif';
    }

    if (!ALLOWED_FORMATS.includes(detectedFormat)) {
      return {
        valid: false,
        error: `Formato decodificado (${detectedFormat}) não pertence à lista de formatos permitidos (JPEG, PNG, WebP, AVIF).`,
      };
    }

    if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
      return { valid: false, error: 'A imagem possui dimensões inválidas.' };
    }

    return {
      valid: true,
      format: detectedFormat,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Falha na verificação de integridade da imagem: ${err.message || 'Arquivo corrompido ou disfarçado.'}`,
    };
  }
}

/**
 * Sanitização estrita do nome de arquivo:
 * - Impede Directory Traversal (.., /, \, caracteres nulos)
 * - Remove acentos, caracteres especiais e espaços
 * - Assegura extensão correta de acordo com o formato real detectado
 */
export function sanitizeMediaFileName(originalName: string, realFormat: string): string {
  // Extrai apenas o nome base ignorando diretórios
  const baseName = path.basename(originalName);
  const ext = path.extname(baseName);
  const nameWithoutExt = baseName.slice(0, baseName.length - ext.length);

  // Normaliza e limpa o nome base
  const cleanBase = nameWithoutExt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const safeName = cleanBase.length >= 2 ? cleanBase : `imagem-${Date.now()}`;

  // Extensão padronizada baseada no formato real
  let targetExt = '.webp';
  if (realFormat === 'jpeg' || realFormat === 'jpg') targetExt = '.jpg';
  else if (realFormat === 'png') targetExt = '.png';
  else if (realFormat === 'avif') targetExt = '.avif';
  else if (realFormat === 'webp') targetExt = '.webp';

  return `${safeName}${targetExt}`;
}

/**
 * Varre todos os artigos e páginas para localizar referências de uma imagem
 */
export async function findImageReferences(
  imagePublicPath: string
): Promise<Array<{ type: 'blog' | 'page'; title: string; location: string }>> {
  const references: Array<{ type: 'blog' | 'page'; title: string; location: string }> = [];
  const fileName = path.basename(imagePublicPath);
  const cleanPath = imagePublicPath.startsWith('/') ? imagePublicPath : `/${imagePublicPath}`;

  // 1. Varredura nos artigos Markdown do Blog no disco local (src/content/blog/)
  const blogDir = path.resolve(process.cwd(), 'src/content/blog');
  try {
    const files = await fs.readdir(blogDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const fullPath = path.join(blogDir, file);
      const content = await fs.readFile(fullPath, 'utf8');

      // Checa se o caminho completo ou o nome da imagem aparece no artigo
      if (content.includes(cleanPath) || content.includes(fileName)) {
        // Extrai título amigável
        const titleMatch = content.match(/title:\s*["']?([^"\r\n]+)["']?/);
        const title = titleMatch ? titleMatch[1] : file;

        references.push({
          type: 'blog',
          title,
          location: `src/content/blog/${file}`,
        });
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Falha ao auditar artigos locais em ${blogDir}: ${err.message}`);
    }
  }

  // 2. Varredura remota na branch cms-drafts do GitHub para rascunhos ainda não mesclados
  const ghConfig = getGitHubConfig();
  if (ghConfig.token) {
    try {
      const remoteDrafts = await listDraftDirectory('src/content/blog');
      if (remoteDrafts && remoteDrafts.length > 0) {
        for (const draft of remoteDrafts) {
          if (!draft.name.endsWith('.md')) continue;
          if (references.some((r) => r.location === `src/content/blog/${draft.name}`)) continue;

          const remoteFile = await getFileFromGitHub(`src/content/blog/${draft.name}`, ghConfig.draftBranch);
          if (remoteFile && (remoteFile.content.includes(cleanPath) || remoteFile.content.includes(fileName))) {
            const titleMatch = remoteFile.content.match(/title:\s*["']?([^"\r\n]+)["']?/);
            const title = titleMatch ? titleMatch[1] : draft.name;

            references.push({
              type: 'blog',
              title: `[Rascunho] ${title}`,
              location: `cms-drafts:src/content/blog/${draft.name}`,
            });
          }
        }
      }
    } catch {
      // Ignora indisponibilidade momentânea da API remota sem quebrar a varredura local
    }
  }

  // 3. Varredura nos arquivos de dados de páginas institucionais (src/data/pages/)
  const pagesDataDir = path.resolve(process.cwd(), 'src/data/pages');
  try {
    const pageFiles = await fs.readdir(pagesDataDir);
    for (const pFile of pageFiles) {
      if (!pFile.endsWith('.json')) continue;
      const fullPath = path.join(pagesDataDir, pFile);
      const content = await fs.readFile(fullPath, 'utf8');

      if (content.includes(cleanPath) || content.includes(fileName)) {
        references.push({
          type: 'page',
          title: `Página /${pFile.replace('.json', '')}`,
          location: `src/data/pages/${pFile}`,
        });
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Falha ao auditar páginas em ${pagesDataDir}: ${err.message}`);
    }
  }

  return references;
}

/**
 * Lista todas as imagens das pastas public/blog e public/images
 * Combina arquivos do disco local com novos rascunhos da branch cms-drafts
 */
export async function listAllMedia(): Promise<MediaItem[]> {
  const mediaMap = new Map<string, MediaItem>();
  const folders: Array<'blog' | 'images'> = ['blog', 'images'];

  // 1. Leitura do disco local
  for (const folder of folders) {
    const dirPath = path.resolve(process.cwd(), `public/${folder}`);
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;

        const ext = path.extname(file).toLowerCase().replace('.', '');
        if (!['avif', 'webp', 'jpg', 'jpeg', 'png', 'svg'].includes(ext)) continue;

        const publicPath = `/${folder}/${file}`;
        let width: number | undefined;
        let height: number | undefined;

        // Tenta obter dimensões para imagens comuns
        if (['avif', 'webp', 'jpg', 'jpeg', 'png'].includes(ext)) {
          try {
            const meta = await sharp(fullPath).metadata();
            width = meta.width;
            height = meta.height;
          } catch {
            // Ignora erro de metadados individuais
          }
        }

        mediaMap.set(publicPath, {
          name: file,
          publicPath,
          folder,
          format: ext === 'jpg' ? 'jpeg' : ext,
          size: stat.size,
          width,
          height,
          modifiedAt: stat.mtime.toISOString(),
          isDraft: false,
        });
      }
    } catch {
      // Diretório pode não existir
    }
  }

  // 2. Consulta à branch cms-drafts do GitHub para mídias novas
  const ghConfig = getGitHubConfig();
  if (ghConfig.token) {
    for (const folder of folders) {
      try {
        const remoteFiles = await listDraftDirectory(`public/${folder}`);
        if (remoteFiles && remoteFiles.length > 0) {
          for (const rf of remoteFiles) {
            const ext = path.extname(rf.name).toLowerCase().replace('.', '');
            if (!['avif', 'webp', 'jpg', 'jpeg', 'png', 'svg'].includes(ext)) continue;

            const publicPath = `/${folder}/${rf.name}`;
            const existing = mediaMap.get(publicPath);

            if (!existing) {
              // Imagem enviada na Vercel que ainda não está no disco local
              mediaMap.set(publicPath, {
                name: rf.name,
                publicPath,
                folder,
                format: ext === 'jpg' ? 'jpeg' : ext,
                size: rf.size,
                isDraft: true,
                sha: rf.sha,
              });
            } else {
              existing.sha = rf.sha;
            }
          }
        }
      } catch {
        // Silencia em caso de indisponibilidade momentânea da API
      }
    }
  }

  // 3. Checagem de uso para cada item
  const allMedia = Array.from(mediaMap.values());
  for (const item of allMedia) {
    const refs = await findImageReferences(item.publicPath);
    item.inUse = refs.length > 0;
    item.usedIn = refs;
  }

  // Ordena imagens: primeiro as mais recentes se houver data, ou alfabeticamente
  allMedia.sort((a, b) => {
    if (a.modifiedAt && b.modifiedAt) {
      return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    }
    return a.name.localeCompare(b.name);
  });

  return allMedia;
}

/**
 * Upload seguro de arquivo de mídia.
 * Salva na branch cms-drafts do GitHub e no disco local (se disponível).
 */
export async function uploadMediaFile(
  buffer: Buffer,
  originalName: string,
  folder: 'blog' | 'images' = 'blog'
): Promise<{ ok: boolean; item?: MediaItem; message: string }> {
  // 1. Validação de conteúdo real
  const validation = await validateImageContent(buffer);
  if (!validation.valid || !validation.format) {
    return { ok: false, message: validation.error || 'Arquivo inválido.' };
  }

  // 2. Sanitização de nome
  let safeFileName = sanitizeMediaFileName(originalName, validation.format);

  // 3. Verificação de conflitos de nome: se já existe local ou remotamente, adiciona timestamp único
  const targetDir = path.resolve(process.cwd(), `public/${folder}`);
  let filePath = path.join(targetDir, safeFileName);
  let fileAlreadyExists = false;

  try {
    await fs.access(filePath);
    fileAlreadyExists = true;
  } catch {
    fileAlreadyExists = false;
  }

  // Se tiver token do GitHub, verifica também se o arquivo já existe na branch cms-drafts
  const ghConfig = getGitHubConfig();
  if (!fileAlreadyExists && ghConfig.token) {
    try {
      const existingRemote = await getFileFromGitHub(`public/${folder}/${safeFileName}`, ghConfig.draftBranch);
      if (existingRemote) {
        fileAlreadyExists = true;
      }
    } catch {
      // Arquivo não existe remotamente
    }
  }

  if (fileAlreadyExists) {
    const ext = path.extname(safeFileName);
    const base = safeFileName.slice(0, safeFileName.length - ext.length);
    const uniqueSuffix = Date.now().toString().slice(-6);
    safeFileName = `${base}-${uniqueSuffix}${ext}`;
    filePath = path.join(targetDir, safeFileName);
  }

  const relativeRepoPath = `public/${folder}/${safeFileName}`;
  const publicPath = `/${folder}/${safeFileName}`;
  let savedOnGitHub = false;
  let remoteSha = '';

  // 4. Persistência na branch cms-drafts do GitHub
  if (ghConfig.token) {
    const ghRes = await saveDraftFileToGitHub(
      relativeRepoPath,
      buffer,
      `[CMS Mídia] Upload de ${safeFileName} em public/${folder}`
    );

    if (!ghRes.ok) {
      return { ok: false, message: `Falha ao gravar imagem na branch ${ghConfig.draftBranch}: ${ghRes.message}` };
    }

    savedOnGitHub = true;
    remoteSha = ghRes.sha || '';
  }

  // 5. Tentativa de persistência no disco local (para ambientes locais / dev)
  let savedLocal = false;
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(filePath, buffer);
    savedLocal = true;
  } catch {
    // Em Vercel Serverless somente leitura, ignora se já salvou no GitHub
    if (!savedOnGitHub) {
      return {
        ok: false,
        message: 'Sistema de arquivos local somente-leitura e GITHUB_TOKEN não configurado.',
      };
    }
  }

  const item: MediaItem = {
    name: safeFileName,
    publicPath,
    folder,
    format: validation.format,
    size: buffer.length,
    width: validation.width,
    height: validation.height,
    modifiedAt: new Date().toISOString(),
    isDraft: savedOnGitHub,
    sha: remoteSha,
    inUse: false,
    usedIn: [],
  };

  return {
    ok: true,
    item,
    message: savedOnGitHub
      ? `Imagem salva com sucesso na branch de trabalho (${ghConfig.draftBranch}).`
      : 'Imagem salva com sucesso no disco local.',
  };
}

/**
 * Exclusão protegida de arquivo de imagem.
 * Bloqueia se a imagem estiver em uso em artigos ou páginas.
 * Fail-closed: se houver erro ao checar dependências, bloqueia por precaução.
 */
export async function deleteMediaFile(
  publicPath: string
): Promise<{ ok: boolean; message: string; blockedByUsage?: boolean; references?: any[] }> {
  // 1. Sanitização estrita do caminho
  const normalized = path.normalize(publicPath).replace(/\\/g, '/');
  if (normalized.includes('..') || (!normalized.startsWith('/blog/') && !normalized.startsWith('/images/'))) {
    return { ok: false, message: 'Caminho de imagem inválido ou não autorizado.' };
  }

  // 2. Verificação obrigatória de referências (Fail-closed)
  let references: Array<{ type: 'blog' | 'page'; title: string; location: string }> = [];
  try {
    references = await findImageReferences(publicPath);
  } catch (err: any) {
    return {
      ok: false,
      blockedByUsage: true,
      message: `A exclusão foi bloqueada preventivamente: falha ao auditar dependências da imagem (${err.message}). Por segurança, a imagem foi preservada.`,
    };
  }

  if (references.length > 0) {
    const titles = references.map((r) => r.title).join(', ');
    return {
      ok: false,
      blockedByUsage: true,
      references,
      message: `A exclusão foi bloqueada: esta imagem está sendo utilizada em ${references.length} artigo(s) ou página(s): ${titles}.`,
    };
  }

  const relativeRepoPath = `public${normalized}`;
  const localFullPath = path.resolve(process.cwd(), relativeRepoPath);
  const ghConfig = getGitHubConfig();

  // 3. Exclusão no GitHub branch cms-drafts
  if (ghConfig.token) {
    const ghRes = await deleteDraftFileFromGitHub(
      relativeRepoPath,
      `[CMS Mídia] Exclusão segura de ${path.basename(normalized)}`
    );
    // Se não encontrou no GitHub, mas existe localmente, prossegue
  }

  // 4. Exclusão no disco local
  try {
    await fs.unlink(localFullPath);
  } catch {
    // Arquivo pode já não existir localmente
  }

  return {
    ok: true,
    message: `Imagem '${path.basename(normalized)}' excluída com sucesso.`,
  };
}
