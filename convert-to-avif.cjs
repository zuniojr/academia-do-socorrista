const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Diretórios para processar
const DIRS = ['images', 'cursos', 'blog'];

// Extensões para converter
const EXTENSIONS = ['.png', '.jpg', '.jpeg'];

// Qualidade AVIF (menor = mais compacto, 30-50 é bom equilíbrio)
const AVIF_QUALITY = 40;

async function convertToAvif(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!EXTENSIONS.includes(ext)) return null;

  const avifPath = filePath.replace(/\.(png|jpg|jpeg)$/i, '.avif');

  // Pula se já existe um .avif
  if (fs.existsSync(avifPath)) {
    console.log(`  ⏩ Já existe: ${path.basename(avifPath)}`);
    return null;
  }

  try {
    const originalSize = fs.statSync(filePath).size;

    await sharp(filePath)
      .avif({ quality: AVIF_QUALITY, effort: 6 })
      .toFile(avifPath);

    const newSize = fs.statSync(avifPath).size;
    const savings = ((1 - newSize / originalSize) * 100).toFixed(1);

    console.log(`  ✅ ${path.basename(filePath)} → ${path.basename(avifPath)} (${formatSize(originalSize)} → ${formatSize(newSize)}, -${savings}%)`);

    return { original: filePath, avif: avifPath, originalSize, newSize };
  } catch (err) {
    console.error(`  ❌ Erro ao converter ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function main() {
  let totalOriginal = 0;
  let totalNew = 0;
  let count = 0;

  for (const dir of DIRS) {
    const dirPath = path.join(PUBLIC_DIR, dir);
    if (!fs.existsSync(dirPath)) {
      console.log(`⚠️  Diretório não encontrado: ${dir}`);
      continue;
    }

    console.log(`\n📁 Processando: ${dir}/`);

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const result = await convertToAvif(filePath);
      if (result) {
        totalOriginal += result.originalSize;
        totalNew += result.newSize;
        count++;
      }
    }
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`📊 Resumo:`);
  console.log(`   Imagens convertidas: ${count}`);
  console.log(`   Tamanho original:    ${formatSize(totalOriginal)}`);
  console.log(`   Tamanho AVIF:        ${formatSize(totalNew)}`);
  console.log(`   Economia total:      ${formatSize(totalOriginal - totalNew)} (-${((1 - totalNew / totalOriginal) * 100).toFixed(1)}%)`);
  console.log(`═══════════════════════════════════════\n`);

  console.log(`✅ Conversão concluída!`);
  console.log(`⚠️  Os arquivos originais (PNG/JPG) foram mantidos.`);
  console.log(`   Após verificar que tudo está correto, você pode deletá-los.\n`);
}

main().catch(console.error);
