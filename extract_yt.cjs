const fs = require('fs');
const html = fs.readFileSync('temp.html', 'utf8');
const match = html.match(/(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)[^\s\"']+)/ig);
console.log(match);
