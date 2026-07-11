const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');

// Extensões de arquivo para processar
const FILE_EXTENSIONS = ['.astro', '.html', '.css', '.js', '.ts', '.jsx', '.tsx'];

// Regex para encontrar referências a imagens PNG/JPG (exceto SVG)
// Captura paths como: /images/foto.png, /cursos/banner.jpg, etc.
const IMAGE_REGEX = /(\/(?:images|cursos|blog)\/[^"'\s]+?)\.(png|jpg|jpeg)/gi;

function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!FILE_EXTENSIONS.includes(ext)) return 0;

  let content = fs.readFileSync(filePath, 'utf8');
  let count = 0;

  const newContent = content.replace(IMAGE_REGEX, (match, name, extension) => {
    count++;
    return `${name}.avif`;
  });

  if (count > 0) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`  ✅ ${path.relative(__dirname, filePath)} — ${count} referência(s) atualizada(s)`);
  }

  return count;
}

function walkDir(dir) {
  let totalChanges = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Ignora node_modules, .git, dist
      if (['node_modules', '.git', 'dist', '.astro'].includes(entry.name)) continue;
      totalChanges += walkDir(fullPath);
    } else {
      totalChanges += processFile(fullPath);
    }
  }

  return totalChanges;
}

console.log(`\n🔄 Atualizando referências de imagens para AVIF...\n`);
const total = walkDir(SRC_DIR);
console.log(`\n═══════════════════════════════════════`);
console.log(`📊 Total de referências atualizadas: ${total}`);
console.log(`═══════════════════════════════════════\n`);
