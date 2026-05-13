const fs = require('fs');

const html = fs.readFileSync('temp.html', 'utf8');
const cheerio = require('cheerio'); // wait, cheerio might not be installed. Let's use simple regex or just string manipulation if cheerio is not available.

// Instead of cheerio, let's just strip tags for text, or better, we can just look at the raw html.
// Let's check if we have cheerio. If not, I'll write a simple regex stripper.
