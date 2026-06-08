const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:\\Users\\Osmar Junior\\.gemini\\antigravity\\brain\\26bca1f4-2014-44b7-8f10-136054d14e60\\.system_generated\\logs\\transcript.jsonl'),
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'USER_INPUT') {
      console.log(`--- Step ${obj.step_index} (${obj.created_at}) ---`);
      console.log(obj.content);
    }
  } catch (err) {
    // Ignore invalid JSON lines
  }
});
