export const prerender = false;

import type { APIRoute } from 'astro';
import { isRequestAuthenticated } from '../../../../lib/admin/auth.ts';
import { uploadMediaFile, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST } from '../../../../lib/admin/media.ts';

export const POST: APIRoute = async ({ request }) => {
  // 1. Validação estrita de sessão no servidor
  if (!isRequestAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Acesso não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType = request.headers.get('content-type') || '';

  try {
    interface IncomingFile {
      name: string;
      buffer: Buffer;
      folder?: 'blog' | 'images';
    }

    const incomingFiles: IncomingFile[] = [];

    // Suporte a multipart/form-data (Padrão de envio via input de arquivo HTML)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const folderParam = (formData.get('folder')?.toString() || 'blog') as 'blog' | 'images';
      const folder: 'blog' | 'images' = folderParam === 'images' ? 'images' : 'blog';

      const fileEntries = formData.getAll('files');
      // Se não enviou na chave 'files', verifica 'file'
      const singleFile = formData.get('file');
      if (singleFile && fileEntries.length === 0) {
        fileEntries.push(singleFile);
      }

      for (const entry of fileEntries) {
        if (typeof entry === 'object' && entry !== null && 'arrayBuffer' in entry) {
          const file = entry as File;
          const arrayBuffer = await file.arrayBuffer();
          incomingFiles.push({
            name: file.name,
            buffer: Buffer.from(arrayBuffer),
            folder,
          });
        }
      }
    } 
    // Suporte a JSON com Base64 (útil para testes automatizados e integrações)
    else if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      const folderParam = body.folder === 'images' ? 'images' : 'blog';

      if (Array.isArray(body.files)) {
        for (const item of body.files) {
          if (item && item.name && item.data) {
            incomingFiles.push({
              name: String(item.name),
              buffer: Buffer.from(String(item.data), 'base64'),
              folder: item.folder === 'images' ? 'images' : folderParam,
            });
          }
        }
      } else if (body.name && body.data) {
        incomingFiles.push({
          name: String(body.name),
          buffer: Buffer.from(String(body.data), 'base64'),
          folder: folderParam,
        });
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Tipo de conteúdo não suportado. Utilize multipart/form-data ou application/json.' }),
        {
          status: 415,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Validações de limites de requisição
    if (incomingFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado na requisição.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (incomingFiles.length > MAX_FILES_PER_REQUEST) {
      return new Response(
        JSON.stringify({ 
          error: `Limite de arquivos excedido. Máximo permitido de ${MAX_FILES_PER_REQUEST} arquivos por requisição.` 
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Processamento e validação de cada arquivo individualmente
    const uploadedItems = [];
    const errors: string[] = [];

    for (const file of incomingFiles) {
      if (file.buffer.length > MAX_FILE_SIZE) {
        errors.push(`Arquivo "${file.name}" excede o limite máximo de ${MAX_FILE_SIZE / (1024 * 1024)} MB.`);
        continue;
      }

      const uploadResult = await uploadMediaFile(file.buffer, file.name, file.folder || 'blog');

      if (!uploadResult.ok || !uploadResult.item) {
        errors.push(`Arquivo "${file.name}": ${uploadResult.message}`);
      } else {
        uploadedItems.push(uploadResult.item);
      }
    }

    if (uploadedItems.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Nenhum arquivo pôde ser salvo.',
          details: errors,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: `${uploadedItems.length} imagem(ns) enviada(s) com sucesso.`,
        items: uploadedItems,
        warnings: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro interno ao processar upload.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
