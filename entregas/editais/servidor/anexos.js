// Anexos cifrados com AES-256-GCM, em disco ou no Cloudflare R2.
// Formato do arquivo = IV de 12 bytes, tag de 16 bytes e texto cifrado. O id entra como dado autenticado.
// O formato é o mesmo nos dois armazéns, então um anexo pode ser copiado de um para o outro sem decifrar.
// Interface comum: gravar(bytes) -> id, ler(id) -> bytes, apagar(id),
//                  listarIds() -> [id], lerBruto(id) -> bytes cifrados, gravarBruto(id, bytes cifrados).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[a-f0-9]{32}$/;
const ARQ_RE = /^([a-f0-9]{32})\.bin$/;

export function lerChave(base64) {
  if (!base64) throw new Error('Defina TEB_CHAVE_ANEXOS com 32 bytes em base64.');
  const chave = Buffer.from(String(base64), 'base64');
  if (chave.length !== 32) throw new Error('TEB_CHAVE_ANEXOS precisa ter exatamente 32 bytes em base64.');
  return chave;
}

function conferirChave(chave) {
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('A chave dos anexos precisa ter 32 bytes.');
}

function conferirId(id) {
  if (!ID_RE.test(String(id))) throw new Error('Id de anexo inválido.');
  return String(id);
}

export function cifrarAnexo(chave, id, bytes) {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(Buffer.from(id));
  const cifrado = Buffer.concat([cifra.update(bytes), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), cifrado]);
}

export function decifrarAnexo(chave, id, dados) {
  if (dados.length < 28) throw new Error('Anexo corrompido.');
  const decifra = createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12));
  decifra.setAAD(Buffer.from(id));
  decifra.setAuthTag(dados.subarray(12, 28));
  return Buffer.concat([decifra.update(dados.subarray(28)), decifra.final()]);
}

export function criarArmazemDisco({ pasta, chave }) {
  conferirChave(chave);
  const caminho = id => join(pasta, `${conferirId(id)}.bin`);
  const gravarBruto = async (id, dados) => {
    await mkdir(pasta, { recursive: true });
    await writeFile(caminho(id), dados, { flag: 'wx', mode: 0o600 });
  };
  const lerBruto = id => readFile(caminho(id));
  return {
    tipo: 'disco',
    async gravar(bytes) {
      const id = randomBytes(16).toString('hex');
      await gravarBruto(id, cifrarAnexo(chave, id, bytes));
      return id;
    },
    async ler(id) {
      return decifrarAnexo(chave, conferirId(id), await lerBruto(id));
    },
    async apagar(id) {
      await rm(caminho(id), { force: true });
    },
    async listarIds() {
      if (!existsSync(pasta)) return [];
      return (await readdir(pasta)).map(n => ARQ_RE.exec(n)?.[1]).filter(Boolean).sort();
    },
    lerBruto,
    gravarBruto,
    caminho,
  };
}

// ---------------------------------------------------------------------------------------------
// Cloudflare R2 pela API compatível com S3, assinada com AWS Signature Version 4. Sem SDK.
// Região "auto" e serviço "s3", como pede a documentação do R2.

const sha256 = dados => createHash('sha256').update(dados).digest('hex');
const hmac = (chave, texto) => createHmac('sha256', chave).update(texto).digest();
// Codificação de URI da SigV4: tudo menos letras, números e - _ . ~ vira %XX. No caminho, cada parte é codificada e a barra fica.
const codificar = texto => encodeURIComponent(texto).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Assina um pedido. Devolve os cabeçalhos a enviar (com Authorization). Exportada para os testes oficiais da AWS.
export function assinarSigV4({ metodo, url, cabecalhos = {}, corpoHash, accessKeyId, secretAccessKey, regiao, servico, quando }) {
  const u = new URL(url);
  const data = quando.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dia = data.slice(0, 8);
  const todos = { ...Object.fromEntries(Object.entries(cabecalhos).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])), host: u.host, 'x-amz-date': data };
  if (corpoHash !== undefined && servico === 's3') todos['x-amz-content-sha256'] = corpoHash;
  const nomes = Object.keys(todos).sort();
  const consulta = [...u.searchParams.entries()].map(([k, v]) => [codificar(k), codificar(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const caminhoCanonico = servico === 's3' ? u.pathname.split('/').map(p => codificar(decodeURIComponent(p))).join('/') : u.pathname;
  const canonico = [metodo, caminhoCanonico || '/', consulta, nomes.map(n => `${n}:${todos[n]}\n`).join(''), nomes.join(';'), corpoHash ?? sha256('')].join('\n');
  const escopo = `${dia}/${regiao}/${servico}/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', data, escopo, sha256(canonico)].join('\n');
  const chave = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dia), regiao), servico), 'aws4_request');
  const assinatura = createHmac('sha256', chave).update(paraAssinar).digest('hex');
  return {
    ...todos,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}`,
    assinatura,
  };
}

export function criarArmazemR2({ accountId, accessKeyId, secretAccessKey, bucket, prefixo = 'anexos/', chave, fetch: f = globalThis.fetch, agora = () => new Date() }) {
  conferirChave(chave);
  if (!/^[a-f0-9]{32}$/.test(String(accountId))) throw new Error('TEB_R2_ACCOUNT_ID precisa ter 32 caracteres hexadecimais (painel da Cloudflare).');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(String(bucket))) throw new Error('TEB_R2_BUCKET inválido.');
  if (!accessKeyId || !secretAccessKey) throw new Error('Preencha TEB_R2_ACCESS_KEY_ID e TEB_R2_SECRET_ACCESS_KEY.');
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  const chaveObjeto = id => `${prefixo}${conferirId(id)}.bin`;

  async function pedir(metodo, caminho, { corpo, consulta = {}, cabecalhos = {} } = {}) {
    const url = new URL(`${base}/${caminho}`);
    for (const [k, v] of Object.entries(consulta)) url.searchParams.set(k, v);
    const corpoHash = sha256(corpo ?? '');
    const assinados = assinarSigV4({ metodo, url: url.toString(), cabecalhos, corpoHash, accessKeyId, secretAccessKey, regiao: 'auto', servico: 's3', quando: agora() });
    delete assinados.assinatura;
    delete assinados.host;
    try {
      return await f(url, { method: metodo, headers: assinados, body: corpo, signal: AbortSignal.timeout(30000) });
    } catch {
      // Sem rede ou tempo esgotado: mensagem fixa, sem detalhes do pedido.
      const e = new Error('R2 fora do alcance.');
      e.code = 'ARMAZEM_INDISPONIVEL';
      throw e;
    }
  }
  // Erro do R2 leva só o código HTTP, nunca a chave ou a resposta. code marca indisponibilidade para a rota dar 503.
  const falhou = async (r, oQue) => {
    const e = new Error(`R2 respondeu ${r.status} ao ${oQue}.`);
    e.code = 'ARMAZEM_INDISPONIVEL';
    throw e;
  };
  const indisponivel = mensagem => Object.assign(new Error(mensagem), { code: 'ARMAZEM_INDISPONIVEL' });
  // Corpo cortado no meio também é indisponibilidade: a rota responde 503, não 500.
  const lerCorpo = async (r, como, oQue) => {
    try { return await r[como](); } catch { throw indisponivel(`R2 cortou a resposta ao ${oQue}.`); }
  };
  const MAX_PAGINAS = 10000;

  const gravarBruto = async (id, dados) => {
    // If-None-Match: * recusa sobrescrever um anexo que já existe, como o flag "wx" do disco.
    const r = await pedir('PUT', chaveObjeto(id), { corpo: dados, cabecalhos: { 'content-type': 'application/octet-stream', 'if-none-match': '*' } });
    if (!r.ok) await falhou(r, 'gravar o anexo');
  };
  const lerBruto = async id => {
    const r = await pedir('GET', chaveObjeto(id));
    if (r.status === 404) { const e = new Error('Anexo não encontrado no R2.'); e.code = 'ENOENT'; throw e; }
    if (!r.ok) await falhou(r, 'ler o anexo');
    return Buffer.from(await lerCorpo(r, 'arrayBuffer', 'ler o anexo'));
  };
  return {
    tipo: 'r2',
    async gravar(bytes) {
      const id = randomBytes(16).toString('hex');
      await gravarBruto(id, cifrarAnexo(chave, id, bytes));
      return id;
    },
    async ler(id) {
      return decifrarAnexo(chave, conferirId(id), await lerBruto(id));
    },
    async apagar(id) {
      const r = await pedir('DELETE', chaveObjeto(id));
      if (!r.ok && r.status !== 404) await falhou(r, 'apagar o anexo');
    },
    async listarIds() {
      const ids = [];
      const vistos = new Set();
      let continuar = null, paginas = 0;
      do {
        // Freio contra listagem sem fim: token repetido ou páginas demais param com erro.
        if (++paginas > MAX_PAGINAS) throw indisponivel('R2 devolveu páginas demais ao listar os anexos.');
        const consulta = { 'list-type': '2', prefix: prefixo, 'max-keys': '1000', ...(continuar ? { 'continuation-token': continuar } : {}) };
        const r = await pedir('GET', '', { consulta });
        if (!r.ok) await falhou(r, 'listar os anexos');
        const xml = await lerCorpo(r, 'text', 'listar os anexos');
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
          const nome = m[1].replace(/&amp;/g, '&');
          const id = nome.startsWith(prefixo) ? ARQ_RE.exec(nome.slice(prefixo.length))?.[1] : null;
          if (id) ids.push(id);
        }
        if (/<IsTruncated>true<\/IsTruncated>/.test(xml)) {
          continuar = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
          if (!continuar) throw indisponivel('R2 indicou mais páginas sem token de continuação ao listar os anexos.');
          if (vistos.has(continuar)) throw indisponivel('R2 repetiu o token de continuação ao listar os anexos.');
          vistos.add(continuar);
        } else {
          continuar = null;
        }
      } while (continuar);
      return ids.sort();
    },
    lerBruto,
    gravarBruto,
  };
}

// Escolhe o armazém pelo ambiente. Com as quatro variáveis TEB_R2_*, usa o R2; sem nenhuma, usa o disco.
// Variáveis pela metade são erro, para ninguém achar que os anexos estão no R2 sem estar.
export function armazemDoAmbiente(env, { chave, pastaPadrao, fetch } = {}) {
  const nomes = ['TEB_R2_ACCOUNT_ID', 'TEB_R2_ACCESS_KEY_ID', 'TEB_R2_SECRET_ACCESS_KEY', 'TEB_R2_BUCKET'];
  const cheias = nomes.filter(n => String(env[n] || '').trim());
  if (cheias.length === 0) return criarArmazemDisco({ pasta: pastaPadrao, chave });
  const faltam = nomes.filter(n => !cheias.includes(n));
  if (faltam.length) throw new Error(`Cloudflare R2: faltam as variáveis ${faltam.join(', ')}.`);
  return criarArmazemR2({
    accountId: env.TEB_R2_ACCOUNT_ID.trim(), accessKeyId: env.TEB_R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.TEB_R2_SECRET_ACCESS_KEY.trim(),
    bucket: env.TEB_R2_BUCKET.trim(), chave, fetch,
  });
}

// Copia os anexos de um armazém para outro sem decifrar (o formato é o mesmo). Pula os que já existem.
export async function migrarAnexos(origem, destino, { log = () => {} } = {}) {
  const jaTem = new Set(await destino.listarIds());
  let copiados = 0, pulados = 0;
  for (const id of await origem.listarIds()) {
    if (jaTem.has(id)) { pulados++; continue; }
    await destino.gravarBruto(id, await origem.lerBruto(id));
    copiados++;
    if (copiados % 50 === 0) log(`${copiados} anexos copiados...`);
  }
  return { copiados, pulados };
}
