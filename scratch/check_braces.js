import fs from 'fs';

const content = fs.readFileSync('src/interfaces/http/http-server.ts', 'utf8');
const lines = content.split('\n');

let balance = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let lineBalance = 0;
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '{') {
      balance++;
      lineBalance++;
    } else if (line[j] === '}') {
      balance--;
      lineBalance--;
    }
  }
  if (balance < 0) {
    console.error(`ERROR: Balance went negative at line ${i + 1} (${balance})! Line: ${line.trim()}`);
    process.exit(1);
  }
}

console.log(`Final brace balance of the file: ${balance}`);
if (balance !== 0) {
  console.error("ERROR: File is not balanced at the end!");
} else {
  console.log("SUCCESS: File is perfectly balanced!");
}
