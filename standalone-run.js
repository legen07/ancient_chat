import { startWorkersDevServer } from 'cloudflare';

// Start development server
const server = startWorkersDevServer({
  config: {
    name: 'ancient-chat',
    main: 'src/index.js',
    compatibilityDate: '2026-05-17',
    compatibilityFlags: ['nodejs_compat'],
    ai: {
      binding: 'AI'
    }
  }
});

server.listen(8787, '127.0.0.1', () => {
  console.log('Worker dev server running on http://127.0.0.1:8787');
});