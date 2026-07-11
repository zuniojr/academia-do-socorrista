const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DIRS = ['images', 'cursos', 'blog'];
const EXTENSIONS = ['.png', '.jpg', '.jpeg'];

let deleted = 0;
let freedBytes = 0;

for (const dir of DIRS) {
  const dirPath = path.join(PUBLIC_DIR, dir);
  if (!fs.existsSync(dirPath)) continue;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!EXTENSIONS.includes(ext)) continue;

    const filePath = path.join(dirPath, file);
    const avifPath = filePath.replace(/\.(png|jpg|jpeg)$/i, '.avif');

    // Só deleta se existe o .avif correspondente
    if (fs.existsSync(avifPath)) {
      const size = fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
      deleted++;
      freedBytes += size;
      console.log(`  🗑️  ${dir}/${file} (${(size / 1024).toFixed(1)}KB)`);
    }
  }
}

console.log(`\n═══════════════════════════════════════`);
console.log(`🗑️  Arquivos deletados: ${deleted}`);
console.log(`💾  Espaço liberado: ${(freedBytes / (1024 * 1024)).toFixed(1)}MB`);
console.log(`═══════════════════════════════════════\n`);
