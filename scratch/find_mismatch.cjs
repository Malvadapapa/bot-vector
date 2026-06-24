const fs = require('fs');
const content = fs.readFileSync('web/src/presentation/pages/GroupAdminDashboard.tsx', 'utf8');
const lines = content.split('\n');

for (let i = 260; i <= 285; i++) {
  const line = lines[i - 1];
  if (line !== undefined) {
    console.log(`Line ${i}: [${line}] (len: ${line.length})`);
  }
}
