import ts from 'typescript';
import fs from 'fs';

const fileName = 'src/interfaces/http/http-server.ts';
const program = ts.createProgram([fileName], { noEmit: true });
const diagnostics = ts.getPreEmitDiagnostics(program);

diagnostics.forEach(diagnostic => {
  if (diagnostic.file && diagnostic.file.fileName === fileName) {
    const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    console.log(`ERROR at line ${line + 1}, col ${character + 1}: ${message}`);
    
    // Print the line content
    const fileContent = fs.readFileSync(fileName, 'utf8');
    const lines = fileContent.split('\n');
    console.log(`  LINE: ${lines[line].trim()}`);
  }
});
