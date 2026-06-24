import { execSync } from 'child_process';

try {
  const diff = execSync('git diff src/interfaces/http/http-server.ts', { encoding: 'utf8' });
  const lines = diff.split('\n');
  
  // Print all diff lines that are changes or headers
  let inInheritance = false;
  for (const line of lines) {
    if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++')) {
      console.log(line.trim());
    } else if (line.startsWith('+') || line.startsWith('-')) {
      console.log(line.trim());
    }
  }
} catch (err) {
  console.error(err);
}
