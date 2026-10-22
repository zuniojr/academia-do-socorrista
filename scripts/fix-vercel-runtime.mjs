import fs from 'node:fs';
import path from 'node:path';

const functionsDir = path.resolve('.vercel/output/functions');
if (fs.existsSync(functionsDir)) {
  const findVcConfigs = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findVcConfigs(fullPath);
      } else if (entry.name === '.vc-config.json') {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const json = JSON.parse(content);
          if (json.runtime && json.runtime.startsWith('nodejs')) {
            json.runtime = 'nodejs24.x';
            fs.writeFileSync(fullPath, JSON.stringify(json, null, 2), 'utf8');
            console.log(`[fix-vercel-runtime] Updated runtime to nodejs24.x in: ${fullPath}`);
          }
        } catch (e) {
          console.error(`[fix-vercel-runtime] Error updating ${fullPath}:`, e);
        }
      }
    }
  };
  findVcConfigs(functionsDir);
}
