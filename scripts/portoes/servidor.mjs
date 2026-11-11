// Servidor estático mínimo, compartilhado pelo portão 4 e pela prévia.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

export async function servir(pasta, porta = 0) {
  const raiz = resolve(pasta);
  const servidor = createServer(async (req, res) => {
    try {
      let rota = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (rota.endsWith('/')) rota += 'index.html';
      const alvo = resolve(join(raiz, rota));
      if (alvo !== raiz && !alvo.startsWith(raiz + sep)) { res.writeHead(403); res.end(); return; }
      await stat(alvo);
      const texto = /^(text|application\/json|image\/svg)/.test(TIPOS[extname(alvo)] || '');
      res.writeHead(200, { 'Content-Type': (TIPOS[extname(alvo)] || 'application/octet-stream') + (texto ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
      res.end(await readFile(alvo));
    } catch (e) {
      res.writeHead(404); res.end('404');
    }
  });
  await new Promise(ok => servidor.listen(porta, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${servidor.address().port}/`, fechar: () => new Promise(ok => servidor.close(ok)) };
}
