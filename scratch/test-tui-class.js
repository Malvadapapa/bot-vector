import { TerminalTui } from '../dist/interfaces/tui/terminal-tui.js';

console.log('Instantiating TerminalTui...');
try {
  const tui = new TerminalTui();
  console.log('TerminalTui instantiated successfully!');
  
  setTimeout(() => {
    tui.destroy();
    console.log('Auto-closed TUI.');
    process.exit(0);
  }, 3000);
} catch (err) {
  console.error('TerminalTui init failed:', err);
}
