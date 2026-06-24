const fs = require('fs');
const content = fs.readFileSync('web/src/presentation/pages/GroupAdminDashboard.tsx', 'utf8');

let braces = 0;
let lineNum = 1;
let colNum = 1;
const stack = [];

for (let i = 0; i < content.length; i++) {
  const char = content[i];
  if (char === '\n') {
    lineNum++;
    colNum = 1;
  } else {
    colNum++;
  }

  if (char === '{') {
    braces++;
    stack.push({ lineNum, colNum });
  } else if (char === '}') {
    braces--;
    stack.pop();
  }
}

console.log('Final brace count:', braces);
if (stack.length > 0) {
  console.log('Unclosed braces at:');
  console.log(stack);
}
