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
    const targetSteps = [254, 266, 275, 287, 296, 306, 318, 327];
    if (targetSteps.includes(obj.step_index)) {
      console.log(`=== STEP ${obj.step_index} (${obj.source} / ${obj.type}) ===`);
      if (obj.content) console.log(`Content: ${obj.content}`);
      if (obj.tool_calls) console.log(`Tool Calls: ${JSON.stringify(obj.tool_calls, null, 2)}`);
    }
  } catch (err) {
    // Ignore
  }
});
