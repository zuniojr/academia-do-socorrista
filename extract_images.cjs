const fs = require('fs');
const html = fs.readFileSync('temp.html', 'utf8');
const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/g;
let match;
const urls = new Set();
while ((match = imgRegex.exec(html)) !== null) {
  urls.add(match[1]);
}
console.log(Array.from(urls).join('\n'));
