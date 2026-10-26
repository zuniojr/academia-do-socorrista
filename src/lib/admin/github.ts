/**
 * Integração segura com a GitHub REST API v3
 * Executa exclusivamente no servidor (Serverless Functions)
 * Nunca expõe o token para o navegador
 */

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
  draftBranch: string;
}

export function getGitHubConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN || '';
  const owner = process.env.GITHUB_OWNER || 'zuniojr';
  const repo = process.env.GITHUB_REPO || 'academia-do-socorrista';
  const baseBranch = process.env.GITHUB_BASE_BRANCH || 'main';
  const draftBranch = process.env.GITHUB_DRAFT_BRANCH || 'cms-drafts';

  return {
    token,
    owner,
    repo,
    baseBranch,
    draftBranch,
  };
}

async function githubFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const config = getGitHubConfig();
  if (!config.token) {
    throw new Error('GITHUB_TOKEN não configurado nas variáveis de ambiente.');
  }

  const url = `https://api.github.com/repos/${config.owner}/${config.repo}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AcademiaDoSocorrista-CMS',
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Verifica a conexão com o repositório no GitHub
 */
export async function testGitHubConnection(): Promise<{ ok: boolean; message: string; data?: any }> {
  try {
    const config = getGitHubConfig();
    if (!config.token) {
      return { ok: false, message: 'GITHUB_TOKEN não configurado.' };
    }

    const res = await githubFetch('');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, message: `Erro GitHub API (${res.status}): ${err.message || res.statusText}` };
    }

    const data = await res.json();
    return { ok: true, message: 'Conectado ao repositório GitHub com sucesso.', data: { name: data.full_name, default_branch: data.default_branch } };
  } catch (error: any) {
    return { ok: false, message: error.message || 'Falha ao conectar com o GitHub.' };
  }
}

/**
 * Garante que a branch de rascunhos exista. Se não existir, cria a partir da branch base (main).
 */
export async function ensureDraftBranchExists(): Promise<{ ok: boolean; message: string }> {
  const config = getGitHubConfig();

  // Verifica se a branch de rascunhos já existe
  const checkRes = await githubFetch(`/git/ref/heads/${config.draftBranch}`);
  if (checkRes.ok) {
    return { ok: true, message: `Branch de rascunhos '${config.draftBranch}' já existe.` };
  }

  // Se não existir, busca o SHA da branch base (main)
  const baseRes = await githubFetch(`/git/ref/heads/${config.baseBranch}`);
  if (!baseRes.ok) {
    return { ok: false, message: `Branch base '${config.baseBranch}' não encontrada no GitHub.` };
  }

  const baseData = await baseRes.json();
  const baseSha = baseData.object.sha;

  // Cria a branch de rascunhos apontando para o SHA da main
  const createRes = await githubFetch('/git/refs', {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${config.draftBranch}`,
      sha: baseSha,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    return { ok: false, message: `Falha ao criar branch '${config.draftBranch}': ${err.message || createRes.statusText}` };
  }

  return { ok: true, message: `Branch de rascunhos '${config.draftBranch}' criada com sucesso a partir de '${config.baseBranch}'.` };
}

/**
 * Lê um arquivo e seu SHA da branch especificada
 */
export async function getFileFromGitHub(filePath: string, branch?: string): Promise<{ content: string; sha: string } | null> {
  const config = getGitHubConfig();
  const targetBranch = branch || config.draftBranch;

  const res = await githubFetch(`/contents/${filePath}?ref=${targetBranch}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Erro ao buscar arquivo no GitHub: ${res.statusText}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return {
    content,
    sha: data.sha,
  };
}

/**
 * Salva ou atualiza um arquivo na branch de rascunhos (cms-drafts).
 * Suporta tanto texto UTF-8 (Markdown, JSON) quanto binários (Buffer de imagens).
 * NUNCA comita diretamente na main.
 */
export async function saveDraftFileToGitHub(
  filePath: string,
  content: string | Buffer,
  commitMessage: string,
  currentSha?: string
): Promise<{ ok: boolean; sha?: string; message: string }> {
  const config = getGitHubConfig();

  // Garante a existência da branch de rascunhos
  await ensureDraftBranchExists();

  // Consulta sempre o SHA real e atual do arquivo na branch de rascunhos do GitHub para evitar conflito de SHA
  const existing = await getFileFromGitHub(filePath, config.draftBranch);
  const sha = existing ? existing.sha : undefined;


  const encodedContent = Buffer.isBuffer(content) 
    ? content.toString('base64') 
    : Buffer.from(content, 'utf8').toString('base64');

  const payload: Record<string, any> = {
    message: commitMessage || `[Rascunho CMS] Atualização de ${filePath}`,
    content: encodedContent,
    branch: config.draftBranch,
  };

  if (sha) {
    payload.sha = sha;
  }

  const res = await githubFetch(`/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return { ok: false, message: 'Conflito de edição detectado no GitHub. O arquivo foi modificado por outra pessoa.' };
    }
    return { ok: false, message: `Erro ao salvar rascunho: ${err.message || res.statusText}` };
  }

  const data = await res.json();
  return { ok: true, sha: data.content?.sha, message: 'Rascunho salvo com sucesso na branch de trabalho.' };
}

/**
 * Exclui um arquivo da branch de rascunhos (cms-drafts).
 * NUNCA opera na branch main diretamente.
 */
export async function deleteDraftFileFromGitHub(
  filePath: string,
  commitMessage: string,
  currentSha?: string
): Promise<{ ok: boolean; message: string }> {
  const config = getGitHubConfig();
  if (!config.token) {
    return { ok: false, message: 'GITHUB_TOKEN não configurado.' };
  }

  const existing = await getFileFromGitHub(filePath, config.draftBranch);
  if (!existing) {
    return { ok: false, message: 'Arquivo não encontrado na branch de rascunhos do GitHub.' };
  }
  const sha = existing.sha;

  const payload = {
    message: commitMessage || `[Rascunho CMS] Exclusão de ${filePath}`,
    sha,
    branch: config.draftBranch,
  };

  const res = await githubFetch(`/contents/${filePath}`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: `Erro ao excluir arquivo no GitHub: ${err.message || res.statusText}` };
  }

  return { ok: true, message: 'Arquivo excluído com sucesso da branch de rascunhos.' };
}

/**
 * Lista todos os arquivos de um diretório na branch de rascunhos (cms-drafts)
 */
export async function listDraftDirectory(directory: string): Promise<Array<{ name: string; path: string; sha: string; size: number; download_url?: string }> | null> {
  const config = getGitHubConfig();
  if (!config.token) return null;

  try {
    const res = await githubFetch(`/contents/${directory}?ref=${config.draftBranch}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) {
      return data
        .filter((item: any) => item.type === 'file')
        .map((item: any) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size || 0,
          download_url: item.download_url,
        }));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Lista arquivos Markdown de um diretório na branch de rascunhos (cms-drafts)
 */
export async function listDraftFiles(directory = 'src/content/blog'): Promise<Array<{ name: string; path: string; sha: string }> | null> {
  const config = getGitHubConfig();
  if (!config.token) return null;

  try {
    const res = await githubFetch(`/contents/${directory}?ref=${config.draftBranch}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) {
      return data
        .filter((item: any) => item.type === 'file' && item.name.endsWith('.md'))
        .map((item: any) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
        }));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cria ou busca um Pull Request aberto da branch de rascunhos para a main
 * Permite revisão e confirmação explícita antes de qualquer publicação
 */
export async function getOrCreatePublishPullRequest(title?: string, body?: string): Promise<{ ok: boolean; prUrl?: string; prNumber?: number; message: string }> {
  const config = getGitHubConfig();

  // Verifica se já existe um PR aberto de cms-drafts para main
  const listRes = await githubFetch(`/pulls?head=${config.owner}:${config.draftBranch}&base=${config.baseBranch}&state=open`);
  if (listRes.ok) {
    const existingPrs = await listRes.json();
    if (Array.isArray(existingPrs) && existingPrs.length > 0) {
      const pr = existingPrs[0];
      return {
        ok: true,
        prUrl: pr.html_url,
        prNumber: pr.number,
        message: `Já existe um Pull Request aberto (#${pr.number}) aguardando revisão e publicação.`,
      };
    }
  }

  // Cria um novo Pull Request
  const createRes = await githubFetch('/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: title || 'Publicação de alterações do Painel CMS',
      head: config.draftBranch,
      base: config.baseBranch,
      body: body || 'Alterações preparadas e revisadas através do painel administrativo da Academia do Socorrista.',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    const errMsg = (err.message || '').toLowerCase();
    const errorDetails = JSON.stringify(err.errors || []);

    if (errMsg.includes('no commits between') || errorDetails.includes('no commits between')) {
      return { 
        ok: false, 
        message: 'A branch de rascunhos (cms-drafts) está idêntica à branch principal (main). Não há alterações pendentes para publicar.' 
      };
    }

    if (errMsg.includes('already exists') || errorDetails.includes('already exists')) {
      const retryList = await githubFetch(`/pulls?head=${config.owner}:${config.draftBranch}&base=${config.baseBranch}&state=open`);
      if (retryList.ok) {
        const prs = await retryList.json();
        if (Array.isArray(prs) && prs.length > 0) {
          return {
            ok: true,
            prUrl: prs[0].html_url,
            prNumber: prs[0].number,
            message: `Já existe um Pull Request aberto (#${prs[0].number}) aguardando revisão e publicação.`,
          };
        }
      }
    }

    return { ok: false, message: `Não foi possível abrir o Pull Request: ${err.message || createRes.statusText}` };
  }

  const newPr = await createRes.json();
  return {
    ok: true,
    prUrl: newPr.html_url,
    prNumber: newPr.number,
    message: `Pull Request #${newPr.number} criado com sucesso para revisão e publicação.`,
  };
}
