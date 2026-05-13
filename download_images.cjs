const fs = require('fs');
const https = require('https');
const path = require('path');

const urls = [
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/boas-vindas-1.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/introducao-1.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/sistema-cardiovascular.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/tipos-de-hemorragia-1.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/protocolospara-comtrole-de-hemorragia.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/como-controlar-hemorragias.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/como-prevenir-o-choque-hemorragias.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2024/09/braga.jpg',
'https://academiadosocorrista.com.br/wp-content/uploads/2023/04/call-center-desk.svg',
'https://academiadosocorrista.com.br/wp-content/uploads/2023/04/garantia-desk.svg',
'https://academiadosocorrista.com.br/wp-content/uploads/elementor/thumbs/curativo-1-rircm25fvp4urbsb7erare2eqvwb3cpcy6ybuc3ax0.png',
'https://academiadosocorrista.com.br/wp-content/uploads/elementor/thumbs/curso-online-rircm25fmxdkfq5kbml2c6aqjf1zd027ru1am1zuws.png',
'https://academiadosocorrista.com.br/wp-content/uploads/2022/11/Selo7dias-1-1024x740.png'
];

const destDir = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

urls.forEach(url => {
  const filename = path.basename(new URL(url).pathname);
  const destPath = path.join(destDir, filename);
  
  https.get(url, (response) => {
    if (response.statusCode === 200) {
      const file = fs.createWriteStream(destPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded: ${filename}`);
      });
    } else {
      console.log(`Failed to download ${url}: ${response.statusCode}`);
    }
  }).on('error', (err) => {
    console.log(`Error downloading ${url}: ${err.message}`);
  });
});
