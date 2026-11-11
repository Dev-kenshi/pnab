// Destinos de backup. Só fetch, sem SDK. Credenciais só por variável de ambiente.
// Interface de cada destino:
//   nome, guardaAnexos, enviar(nomeObjeto, bytes), listar(prefixo) -> [{ nome, tamanho }],
//   baixar(nomeObjeto) -> Buffer, apagar(nomeObjeto).
// Mensagens de erro trazem só o código HTTP. Nunca o token, a chave ou o corpo da resposta.
import { createHash } from 'node:crypto';

export class ErroDestino extends Error {}

async function exigirOk(r, quem, oQue) {
  if (r.ok) return r;
  throw new ErroDestino(`${quem} respondeu ${r.status} ao ${oQue}.`);
}

function exigirVariaveis(env, nomes, quem) {
  const preenchidas = nomes.filter(n => String(env[n] || '').trim() !== '');
  if (preenchidas.length === 0) return false;
  const faltam = nomes.filter(n => !preenchidas.includes(n));
  if (faltam.length) throw new Error(`${quem}: faltam as variáveis ${faltam.join(', ')}.`);
  return true;
}

// Google Drive, conta grátis de 15 GB. OAuth com refresh token e escopo drive.file:
// o sistema só enxerga os arquivos que ele mesmo criou.
export function googleDrive({ clientId, clientSecret, refreshToken, pastaId, fetch: f = globalThis.fetch }) {
  const quem = 'Google Drive';
  let token = null, expira = 0;
  const acesso = async () => {
    if (token && Date.now() < expira - 60000) return token;
    const r = await exigirOk(await f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    }), quem, 'renovar o acesso');
    const corpo = await r.json();
    token = corpo.access_token;
    expira = Date.now() + Number(corpo.expires_in || 3600) * 1000;
    return token;
  };
  const cab = async (extra = {}) => ({ Authorization: `Bearer ${await acesso()}`, ...extra });
  const aspas = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const buscar = async (prefixo, exato) => {
    const saida = [];
    let pagina = '';
    do {
      // Lista a pasta inteira e filtra aqui: o "name contains" do Drive casa por termo e falha com / - e . no nome.
      const q = `'${aspas(pastaId)}' in parents and trashed = false`;
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.search = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,size)', pageSize: '1000', spaces: 'drive', ...(pagina ? { pageToken: pagina } : {}) });
      const r = await exigirOk(await f(url, { headers: await cab() }), quem, 'listar');
      const corpo = await r.json();
      for (const a of corpo.files || []) {
        if (exato ? a.name === prefixo : a.name.startsWith(prefixo)) saida.push({ nome: a.name, tamanho: Number(a.size || 0), id: a.id });
      }
      pagina = corpo.nextPageToken || '';
    } while (pagina);
    return saida;
  };
  const idDe = async nome => {
    const [a] = await buscar(nome, true);
    if (!a) throw new ErroDestino(`${quem}: arquivo ${nome} não encontrado.`);
    return a.id;
  };
  return {
    nome: 'Google Drive',
    chave: 'gdrive',
    guardaAnexos: true,
    async enviar(nome, bytes) {
      const ini = await exigirOk(await f('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: await cab({ 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.length) }),
        body: JSON.stringify({ name: nome, parents: [pastaId], mimeType: 'application/octet-stream' }),
      }), quem, 'iniciar o envio');
      const local = ini.headers.get('location');
      if (!local || !local.startsWith('https://www.googleapis.com/')) throw new ErroDestino(`${quem}: endereço de envio inesperado.`);
      await exigirOk(await f(local, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }), quem, 'enviar');
    },
    listar: prefixo => buscar(prefixo, false),
    async baixar(nome) {
      const r = await exigirOk(await f(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(await idDe(nome))}?alt=media`, { headers: await cab() }), quem, 'baixar');
      return Buffer.from(await r.arrayBuffer());
    },
    async apagar(nome) {
      await exigirOk(await f(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(await idDe(nome))}`, { method: 'DELETE', headers: await cab() }), quem, 'apagar');
    },
    // Cria a pasta do backup. Com o escopo drive.file, o app só enxerga pastas que ele mesmo criou.
    async criarPasta(nomePasta) {
      const r = await exigirOk(await f('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST', headers: await cab({ 'Content-Type': 'application/json; charset=UTF-8' }),
        body: JSON.stringify({ name: nomePasta, mimeType: 'application/vnd.google-apps.folder' }),
      }), quem, 'criar a pasta');
      return (await r.json()).id;
    },
  };
}

// Backblaze B2, API nativa v3. Use uma chave de aplicação restrita a um único bucket privado.
export function backblazeB2({ keyId, appKey, bucketId, bucketNome, fetch: f = globalThis.fetch }) {
  const quem = 'Backblaze B2';
  let conta = null;
  const autorizar = async () => {
    const basic = Buffer.from(`${keyId}:${appKey}`).toString('base64');
    const r = await exigirOk(await f('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } }), quem, 'autorizar');
    const corpo = await r.json();
    const api = corpo.apiInfo?.storageApi || {};
    if (!api.apiUrl?.startsWith('https://') || !api.downloadUrl?.startsWith('https://')) throw new ErroDestino(`${quem}: resposta de autorização inesperada.`);
    conta = { token: corpo.authorizationToken, apiUrl: api.apiUrl, downloadUrl: api.downloadUrl };
    return conta;
  };
  // Repete uma vez com autorização nova se o token venceu (401).
  const chamar = async (fn, oQue) => {
    let r = await fn(conta || await autorizar());
    if (r.status === 401) r = await fn(await autorizar());
    return exigirOk(r, quem, oQue);
  };
  const api = (metodo, corpo, oQue) => chamar(c => f(`${c.apiUrl}/b2api/v3/${metodo}`, {
    method: 'POST', headers: { Authorization: c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  }), oQue);
  const listarComId = async (prefixo, exato) => {
    const saida = [];
    let inicio = null;
    do {
      const r = await api('b2_list_file_names', { bucketId, prefix: prefixo, maxFileCount: 1000, ...(inicio ? { startFileName: inicio } : {}) }, 'listar');
      const corpo = await r.json();
      for (const a of corpo.files || []) if (!exato || a.fileName === prefixo) saida.push({ nome: a.fileName, tamanho: Number(a.contentLength || 0), id: a.fileId });
      inicio = corpo.nextFileName || null;
    } while (inicio);
    return saida;
  };
  return {
    nome: 'Backblaze B2',
    chave: 'b2',
    guardaAnexos: true,
    async enviar(nome, bytes) {
      const up = await (await api('b2_get_upload_url', { bucketId }, 'pedir endereço de envio')).json();
      if (!String(up.uploadUrl).startsWith('https://')) throw new ErroDestino(`${quem}: endereço de envio inesperado.`);
      const r = await f(up.uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: up.authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(nome).replace(/%2F/g, '/'),
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.length),
          'X-Bz-Content-Sha1': createHash('sha1').update(bytes).digest('hex'),
        },
        body: bytes,
      });
      await exigirOk(r, quem, 'enviar');
    },
    listar: prefixo => listarComId(prefixo, false),
    async baixar(nome) {
      const caminho = `/file/${encodeURIComponent(bucketNome)}/${encodeURIComponent(nome).replace(/%2F/g, '/')}`;
      const r = await chamar(c => f(`${c.downloadUrl}${caminho}`, { headers: { Authorization: c.token } }), 'baixar');
      return Buffer.from(await r.arrayBuffer());
    },
    async apagar(nome) {
      const [a] = await listarComId(nome, true);
      if (!a) return;
      await api('b2_delete_file_version', { fileName: a.nome, fileId: a.id }, 'apagar');
    },
  };
}

// GitHub, repositório PRIVADO, só com o banco (sem anexos). Recusa repositório público.
// Token fino (fine-grained) com acesso só a esse repositório e permissão Contents: leitura e escrita.
export const GITHUB_MAXIMO = 50 * 1024 * 1024;

// O Git guarda no histórico todo arquivo apagado. Por isso o GitHub recebe o banco só a cada `intervaloDias`.
export function githubPrivado({ token, repo, ramo = 'main', intervaloDias = 7, fetch: f = globalThis.fetch }) {
  const quem = 'GitHub';
  const partes = String(repo).split('/');
  if (partes.length !== 2 || partes.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || /^\.+$/.test(p))) throw new Error('TEB_GITHUB_REPO precisa ser dono/nome.');
  if (!Number.isInteger(intervaloDias) || intervaloDias < 0) throw new Error('TEB_GITHUB_INTERVALO_DIAS precisa ser um inteiro de 0 para cima.');
  const base = `https://api.github.com/repos/${repo}`;
  const cab = extra => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sistema-integrado-teb', ...extra });
  let conferido = false;
  const conferirPrivado = async () => {
    if (conferido) return;
    const r = await exigirOk(await f(base, { headers: cab() }), quem, 'conferir o repositório');
    const corpo = await r.json();
    if (corpo.private !== true) throw new ErroDestino(`${quem}: o repositório de backup precisa ser privado. Nada foi enviado.`);
    conferido = true;
  };
  const caminho = nome => nome.split('/').map(encodeURIComponent).join('/');
  const listar = async prefixo => {
    await conferirPrivado();
    const pasta = prefixo.includes('/') ? prefixo.slice(0, prefixo.lastIndexOf('/')) : '';
    const r = await f(`${base}/contents/${caminho(pasta)}?ref=${encodeURIComponent(ramo)}`, { headers: cab() });
    if (r.status === 404) return [];
    await exigirOk(r, quem, 'listar');
    const corpo = await r.json();
    return (Array.isArray(corpo) ? corpo : []).filter(a => a.type === 'file' && a.path.startsWith(prefixo)).map(a => ({ nome: a.path, tamanho: Number(a.size || 0), sha: a.sha }));
  };
  return {
    nome: 'GitHub privado',
    chave: 'github',
    guardaAnexos: false,
    intervaloDias,
    async enviar(nome, bytes) {
      await conferirPrivado();
      if (bytes.length > GITHUB_MAXIMO) throw new ErroDestino(`${quem}: backup do banco passa de 50 MB. Use o B2 ou o Drive para esse tamanho.`);
      const r = await f(`${base}/contents/${caminho(nome)}`, {
        method: 'PUT', headers: cab({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: `Backup cifrado ${nome}`, content: bytes.toString('base64'), branch: ramo }),
      });
      await exigirOk(r, quem, 'enviar');
    },
    listar,
    async baixar(nome) {
      await conferirPrivado();
      const r = await exigirOk(await f(`${base}/contents/${caminho(nome)}?ref=${encodeURIComponent(ramo)}`, { headers: cab({ Accept: 'application/vnd.github.raw+json' }) }), quem, 'baixar');
      return Buffer.from(await r.arrayBuffer());
    },
    async apagar(nome) {
      const [a] = (await listar(nome)).filter(x => x.nome === nome);
      if (!a) return;
      await exigirOk(await f(`${base}/contents/${caminho(nome)}`, {
        method: 'DELETE', headers: cab({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: `Remove backup antigo ${nome}`, sha: a.sha, branch: ramo }),
      }), quem, 'apagar');
    },
  };
}

// Monta os destinos configurados no ambiente. Destino sem nenhuma variável fica desligado.
// Destino com variáveis pela metade é erro, para ninguém achar que tem backup sem ter.
export function destinosDoAmbiente(env, { fetch } = {}) {
  const lista = [];
  if (exigirVariaveis(env, ['TEB_GDRIVE_CLIENT_ID', 'TEB_GDRIVE_CLIENT_SECRET', 'TEB_GDRIVE_REFRESH_TOKEN', 'TEB_GDRIVE_PASTA_ID'], 'Google Drive')) {
    lista.push(googleDrive({ clientId: env.TEB_GDRIVE_CLIENT_ID, clientSecret: env.TEB_GDRIVE_CLIENT_SECRET, refreshToken: env.TEB_GDRIVE_REFRESH_TOKEN, pastaId: env.TEB_GDRIVE_PASTA_ID, fetch }));
  }
  if (exigirVariaveis(env, ['TEB_B2_KEY_ID', 'TEB_B2_APP_KEY', 'TEB_B2_BUCKET_ID', 'TEB_B2_BUCKET_NOME'], 'Backblaze B2')) {
    lista.push(backblazeB2({ keyId: env.TEB_B2_KEY_ID, appKey: env.TEB_B2_APP_KEY, bucketId: env.TEB_B2_BUCKET_ID, bucketNome: env.TEB_B2_BUCKET_NOME, fetch }));
  }
  if (exigirVariaveis(env, ['TEB_GITHUB_TOKEN', 'TEB_GITHUB_REPO'], 'GitHub')) {
    lista.push(githubPrivado({
      token: env.TEB_GITHUB_TOKEN, repo: env.TEB_GITHUB_REPO, ramo: env.TEB_GITHUB_RAMO || 'main',
      intervaloDias: Number(env.TEB_GITHUB_INTERVALO_DIAS ?? 7), fetch,
    }));
  }
  return lista;
}
