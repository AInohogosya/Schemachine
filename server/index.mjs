// SCHEMACHINE local server — serves the production build with zero config.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const PORT = Number(process.env.PORT || 3000);

async function main() {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('');
    console.error('  SCHEMACHINE: production build not found (./dist is missing).');
    console.error('  Run "npm run build" first, or simply use ./start.sh which builds automatically.');
    console.error('');
    process.exit(1);
  }

  const app = express();
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  // SPA fallback for any client-side route.
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

  const server = app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.error('');
    console.error(`  ================== SCHEMACHINE ==================`);
    console.error(`   Serving the game at:  ${url}`);
    console.error(`   Press Ctrl+C to stop.`);
    console.error(`  ======================================================`);
    console.error('');
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Try PORT=3001 npm run serve`);
      process.exit(1);
    }
    throw err;
  });
}

main();
