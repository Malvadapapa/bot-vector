import blessed from 'neo-blessed';

console.log('Starting blessed screen test...');
try {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Test Blessed',
  });

  const box = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: '50%',
    content: 'Hello World from Blessed!',
    border: {
      type: 'line',
    },
    style: {
      fg: 'white',
      bg: 'magenta',
      border: {
        fg: '#f0f0f0',
      },
    },
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    screen.destroy();
    console.log('Test completed successfully!');
    process.exit(0);
  });

  screen.render();
  console.log('Screen rendered successfully!');
  
  setTimeout(() => {
    screen.destroy();
    console.log('Auto-closed test.');
    process.exit(0);
  }, 3000);

} catch (err) {
  console.error('Blessed init failed:', err);
}
