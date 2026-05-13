const fs = require('fs');
const html = fs.readFileSync('temp.html', 'utf8');

// remove scripts and styles
let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '\n');
text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '\n');

// replace block elements with newlines
text = text.replace(/<(div|p|h1|h2|h3|h4|h5|h6|li|br|section|article)[^>]*>/gi, '\n\n');

// remove all other html tags
text = text.replace(/<[^>]+>/g, '');

// decode entities
text = text.replace(/&nbsp;/g, ' ')
           .replace(/&amp;/g, '&')
           .replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>')
           .replace(/&quot;/g, '"')
           .replace(/&#039;/g, "'");

// collapse multiple newlines
text = text.replace(/\n\s*\n/g, '\n\n').trim();

fs.writeFileSync('page_text.txt', text);
console.log('Text extracted to page_text.txt');
