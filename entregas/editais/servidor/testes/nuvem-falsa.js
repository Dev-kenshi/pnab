// Nuvem falsa para os testes de backup. Não é arquivo de teste. Nenhuma chamada sai para a rede.
// Imita o necessário do Google Drive v3, do Backblaze B2 v3 e da API de conteúdo do GitHub.
// Credenciais aceitas são só as de teste abaixo. Qualquer URL desconhecida falha o teste.
import { createHash } from 'node:crypto';

export const CRED = {
  gdrive: { TEB_GDRIVE_CLIENT_ID: 'id-teste', TEB_GDRIVE_CLIENT_SECRET: 'segredo-teste', TEB_GDRIVE_REFRESH_TOKEN: 'refresh-teste', TEB_GDRIVE_PASTA_ID: 'pasta-teste' },
  b2: { TEB_B2_KEY_ID: 'chave-id-teste', TEB_B2_APP_KEY: 'chave-app-teste', TEB_B2_BUCKET_ID: 'bucket-id-teste', TEB_B2_BUCKET_NOME: 'bucket-teste' },
  github: { TEB_GITHUB_TOKEN: 'token-github-teste', TEB_GITHUB_REPO: 'empresa-teste/backup-teste' },
};

const json = (status, corpo, cab = {}) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cab } });
const bytesDe = async corpo => (corpo == null ? Buffer.alloc(0) : Buffer.isBuffer(corpo) || corpo instanceof Uint8Array ? Buffer.from(corpo) : Buffer.from(String(corpo)));

export function nuvemFalsa({ githubPublico = false } = {}) {
  const gdrive = new Map(); // id -> { nome, bytes }
  const b2 = new Map(); // nome -> { id, bytes }
  const github = new Map(); // caminho -> { sha, bytes }
  const chamadas = [];
  const falhar = new Set(); // 'gdrive' | 'b2' | 'github'
  let seq = 1;
  let b2TokenValido = 'tok-b2-1';
  const pendentes = new Map();

  async function fetchFalso(entrada, opcoes = {}) {
    const url = new URL(String(entrada));
    const metodo = (opcoes.method || 'GET').toUpperCase();
    const h = new Headers(opcoes.headers || {});
    chamadas.push({ metodo, url: url.toString(), cabecalhos: Object.fromEntries(h.entries()) });

    // Google
    if (url.host === 'oauth2.googleapis.com') {
      if (falhar.has('gdrive')) return json(500, { erro: 'falha simulada' });
      const p = new URLSearchParams(String(opcoes.body));
      if (p.get('refresh_token') !== CRED.gdrive.TEB_GDRIVE_REFRESH_TOKEN || p.get('client_secret') !== CRED.gdrive.TEB_GDRIVE_CLIENT_SECRET) return json(401, { error: 'invalid_grant' });
      return json(200, { access_token: 'acesso-gdrive', expires_in: 3600 });
    }
    if (url.host === 'www.googleapis.com') {
      if (h.get('authorization') !== 'Bearer acesso-gdrive' && !url.pathname.startsWith('/upload/sessao/')) return json(401, {});
      if (url.pathname === '/upload/drive/v3/files' && metodo === 'POST') {
        const meta = JSON.parse(String(opcoes.body));
        if (!meta.parents?.includes(CRED.gdrive.TEB_GDRIVE_PASTA_ID)) return json(400, {});
        const sessao = `s${seq++}`;
        pendentes.set(sessao, meta.name);
        return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/sessao/${sessao}` } });
      }
      if (url.pathname.startsWith('/upload/sessao/') && metodo === 'PUT') {
        const sessao = url.pathname.split('/').pop();
        if (!pendentes.has(sessao)) return json(404, {});
        const id = `g${seq++}`;
        gdrive.set(id, { nome: pendentes.get(sessao), bytes: await bytesDe(opcoes.body) });
        pendentes.delete(sessao);
        return json(200, { id });
      }
      if (url.pathname === '/drive/v3/files' && metodo === 'POST') {
        const meta = JSON.parse(String(opcoes.body));
        if (meta.mimeType !== 'application/vnd.google-apps.folder') return json(400, {});
        return json(200, { id: `pasta${seq++}` });
      }
      if (url.pathname === '/drive/v3/files' && metodo === 'GET') {
        const q = url.searchParams.get('q');
        const contem = /name contains '((?:[^'\\]|\\.)*)'/.exec(q)?.[1].replace(/\\(.)/g, '$1') ?? '';
        const files = [...gdrive].filter(([, a]) => a.nome.includes(contem)).map(([id, a]) => ({ id, name: a.nome, size: String(a.bytes.length) }));
        return json(200, { files });
      }
      const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!gdrive.has(id)) return json(404, {});
        if (metodo === 'DELETE') { gdrive.delete(id); return new Response(null, { status: 204 }); }
        if (url.searchParams.get('alt') === 'media') return new Response(gdrive.get(id).bytes, { status: 200 });
      }
      return json(404, {});
    }

    // Backblaze
    if (url.host === 'api.backblazeb2.com') {
      if (falhar.has('b2')) return json(503, {});
      const esperado = `Basic ${Buffer.from(`${CRED.b2.TEB_B2_KEY_ID}:${CRED.b2.TEB_B2_APP_KEY}`).toString('base64')}`;
      if (h.get('authorization') !== esperado) return json(401, {});
      return json(200, { authorizationToken: b2TokenValido, apiInfo: { storageApi: { apiUrl: 'https://api000.b2.falso', downloadUrl: 'https://f000.b2.falso' } } });
    }
    if (url.host === 'api000.b2.falso') {
      if (h.get('authorization') !== b2TokenValido) return json(401, {});
      const corpo = JSON.parse(String(opcoes.body || '{}'));
      if (corpo.bucketId && corpo.bucketId !== CRED.b2.TEB_B2_BUCKET_ID) return json(400, {});
      if (url.pathname.endsWith('/b2_get_upload_url')) return json(200, { uploadUrl: 'https://pod.b2.falso/up', authorizationToken: 'tok-up' });
      if (url.pathname.endsWith('/b2_list_file_names')) {
        const files = [...b2].filter(([n]) => n.startsWith(corpo.prefix || '')).sort().map(([n, a]) => ({ fileName: n, fileId: a.id, contentLength: a.bytes.length }));
        return json(200, { files, nextFileName: null });
      }
      if (url.pathname.endsWith('/b2_delete_file_version')) {
        const a = b2.get(corpo.fileName);
        if (!a || a.id !== corpo.fileId) return json(400, {});
        b2.delete(corpo.fileName);
        return json(200, {});
      }
      return json(404, {});
    }
    if (url.host === 'pod.b2.falso') {
      if (h.get('authorization') !== 'tok-up') return json(401, {});
      const bytes = await bytesDe(opcoes.body);
      if (createHash('sha1').update(bytes).digest('hex') !== h.get('x-bz-content-sha1')) return json(400, { code: 'bad_sha1' });
      const nome = decodeURIComponent(h.get('x-bz-file-name'));
      b2.set(nome, { id: `b${seq++}`, bytes });
      return json(200, {});
    }
    if (url.host === 'f000.b2.falso') {
      if (h.get('authorization') !== b2TokenValido) return json(401, {});
      const prefixo = `/file/${CRED.b2.TEB_B2_BUCKET_NOME}/`;
      if (!url.pathname.startsWith(prefixo)) return json(404, {});
      const a = b2.get(decodeURIComponent(url.pathname.slice(prefixo.length)));
      return a ? new Response(a.bytes, { status: 200 }) : json(404, {});
    }

    // GitHub
    if (url.host === 'api.github.com') {
      if (falhar.has('github')) return json(502, {});
      if (h.get('authorization') !== `Bearer ${CRED.github.TEB_GITHUB_TOKEN}`) return json(401, {});
      const base = `/repos/${CRED.github.TEB_GITHUB_REPO}`;
      if (url.pathname === base) return json(200, { private: !githubPublico });
      if (!url.pathname.startsWith(`${base}/contents`)) return json(404, {});
      const caminho = decodeURIComponent(url.pathname.slice(`${base}/contents`.length).replace(/^\//, ''));
      if (metodo === 'PUT') {
        const corpo = JSON.parse(String(opcoes.body));
        if (github.has(caminho)) return json(422, {});
        github.set(caminho, { sha: `sha${seq++}`, bytes: Buffer.from(corpo.content, 'base64') });
        return json(201, {});
      }
      if (metodo === 'DELETE') {
        const corpo = JSON.parse(String(opcoes.body));
        if (github.get(caminho)?.sha !== corpo.sha) return json(409, {});
        github.delete(caminho);
        return json(200, {});
      }
      if (github.has(caminho)) return new Response(github.get(caminho).bytes, { status: 200 });
      const dentro = [...github].filter(([p]) => p.startsWith(`${caminho}/`));
      if (!dentro.length) return json(404, {});
      return json(200, dentro.map(([p, a]) => ({ type: 'file', name: p.split('/').pop(), path: p, sha: a.sha, size: a.bytes.length })));
    }

    throw new Error(`Nuvem falsa: URL inesperada ${url}`);
  }

  return {
    fetch: fetchFalso, gdrive, b2, github, chamadas, falhar,
    vencerTokenB2() { b2TokenValido = `tok-b2-${seq++}`; },
  };
}
