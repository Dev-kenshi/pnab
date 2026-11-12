// Anexos no Cloudflare R2 (API S3 com assinatura AWS SigV4), sem rede.
// A assinatura é conferida com os exemplos oficiais da documentação da AWS. O bucket é simulado e confere a
// assinatura de cada pedido recebido, recalculando-a com a mesma chave secreta de teste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armazemDoAmbiente, assinarSigV4, criarArmazemDisco, criarArmazemR2, migrarAnexos } from '../anexos.js';
import { fazerBackup, restaurar } from '../backup/rotina.js';
import { abrirBanco } from '../banco.js';
import { destinosDoAmbiente } from '../backup/destinos.js';
import { CRED, nuvemFalsa } from './nuvem-falsa.js';
import { criarAmbiente, pdfMinimo } from './ajuda.js';

const CONTA = 'a'.repeat(32);
const CHAVE_ID = 'chave-r2-teste';
const SEGREDO = 'segredo-r2-de-teste';
const BUCKET = 'teb-anexos';
const VAZIO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Bucket R2 simulado. Confere host, assinatura, data e hash do corpo de cada pedido.
function r2Falso({ porPagina = 1000 } = {}) {
  const objetos = new Map();
  const pedidos = [];
  async function fetchFalso(entrada, opcoes = {}) {
    const url = new URL(String(entrada));
    const metodo = opcoes.method || 'GET';
    const h = Object.fromEntries(Object.entries(opcoes.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const corpo = opcoes.body == null ? Buffer.alloc(0) : Buffer.from(opcoes.body);
    pedidos.push({ metodo, url: url.toString(), h });
    if (url.host !== `${CONTA}.r2.cloudflarestorage.com`) throw new Error(`host inesperado ${url.host}`);
    // Recalcula a assinatura a partir do que chegou.
    const assinados = /SignedHeaders=([^,]+)/.exec(h.authorization || '')?.[1].split(';') || [];
    const recebida = /Signature=([a-f0-9]{64})/.exec(h.authorization || '')?.[1];
    const quando = new Date(h['x-amz-date'].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    const extra = Object.fromEntries(assinados.filter(n => !['host', 'x-amz-date', 'x-amz-content-sha256'].includes(n)).map(n => [n, h[n]]));
    const conta = assinarSigV4({ metodo, url: url.toString(), cabecalhos: extra, corpoHash: h['x-amz-content-sha256'], accessKeyId: CHAVE_ID, secretAccessKey: SEGREDO, regiao: 'auto', servico: 's3', quando });
    if (!recebida || conta.assinatura !== recebida || !h.authorization.includes(`Credential=${CHAVE_ID}/`)) return new Response('<Error>SignatureDoesNotMatch</Error>', { status: 403 });
    if (createHash('sha256').update(corpo).digest('hex') !== h['x-amz-content-sha256']) return new Response('<Error>BadDigest</Error>', { status: 400 });
    if (!url.pathname.startsWith(`/${BUCKET}`)) return new Response('', { status: 404 });
    const chave = decodeURIComponent(url.pathname.slice(BUCKET.length + 2));
    if (metodo === 'PUT') {
      if (h['if-none-match'] === '*' && objetos.has(chave)) return new Response('', { status: 412 });
      objetos.set(chave, corpo);
      return new Response('', { status: 200 });
    }
    if (metodo === 'DELETE') { objetos.delete(chave); return new Response(null, { status: 204 }); }
    if (metodo === 'GET' && chave) return objetos.has(chave) ? new Response(objetos.get(chave), { status: 200 }) : new Response('', { status: 404 });
    if (metodo === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefixo = url.searchParams.get('prefix') || '';
      const todas = [...objetos.keys()].filter(k => k.startsWith(prefixo)).sort();
      const inicio = Number(url.searchParams.get('continuation-token') || 0);
      const pagina = todas.slice(inicio, inicio + porPagina);
      const mais = inicio + porPagina < todas.length;
      const xml = `<ListBucketResult>${pagina.map(k => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>${mais}</IsTruncated>${mais ? `<NextContinuationToken>${inicio + porPagina}</NextContinuationToken>` : ''}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }
    return new Response('', { status: 400 });
  }
  return { fetch: fetchFalso, objetos, pedidos };
}

const ENV_R2 = { TEB_R2_ACCOUNT_ID: CONTA, TEB_R2_ACCESS_KEY_ID: CHAVE_ID, TEB_R2_SECRET_ACCESS_KEY: SEGREDO, TEB_R2_BUCKET: BUCKET };
let pasta, chave;
before(async () => { pasta = await mkdtemp(join(tmpdir(), 'teb-r2-')); chave = randomBytes(32); });
after(async () => { await rm(pasta, { recursive: true, force: true }); });
const novoR2 = (falso, extra = {}) => criarArmazemR2({ accountId: CONTA, accessKeyId: CHAVE_ID, secretAccessKey: SEGREDO, bucket: BUCKET, chave, fetch: falso.fetch, ...extra });

test('SigV4: bate com os 4 exemplos oficiais da documentação da AWS', () => {
  const k = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1', servico: 's3', quando: new Date('2013-05-24T00:00:00Z') };
  assert.equal(assinarSigV4({ metodo: 'GET', url: 'https://example.amazonaws.com/', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1', servico: 'service', quando: new Date('2015-08-30T12:36:00Z') }).assinatura, '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(assinarSigV4({ ...k, metodo: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', cabecalhos: { range: 'bytes=0-9' }, corpoHash: VAZIO }).assinatura, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(assinarSigV4({ ...k, metodo: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J', corpoHash: VAZIO }).assinatura, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  const corpoHash = createHash('sha256').update('Welcome to Amazon S3.').digest('hex');
  assert.equal(assinarSigV4({ ...k, metodo: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test$file.text', cabecalhos: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, corpoHash }).assinatura, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('R2: grava, lê e apaga, com o anexo cifrado no bucket e o id autenticado', async () => {
  const falso = r2Falso();
  const r2 = novoR2(falso);
  const id = await r2.gravar(pdfMinimo('conteúdo secreto do R2'));
  assert.match(id, /^[a-f0-9]{32}$/);
  const guardado = falso.objetos.get(`anexos/${id}.bin`);
  assert.ok(guardado && !guardado.includes(Buffer.from('%PDF')) && !guardado.includes(Buffer.from('secreto')));
  assert.ok((await r2.ler(id)).includes(Buffer.from('secreto do R2')));
  assert.ok(falso.pedidos.every(p => p.url.startsWith('https://')));
  // Bytes trocados de lugar: o id entra como dado autenticado, então a leitura falha.
  const outro = await r2.gravar(pdfMinimo('outro'));
  falso.objetos.set(`anexos/${outro}.bin`, guardado);
  await assert.rejects(r2.ler(outro));
  await r2.apagar(id);
  assert.ok(!falso.objetos.has(`anexos/${id}.bin`));
  await assert.rejects(r2.ler(id), /não encontrado/);
  await assert.rejects(r2.ler('../../etc/passwd'), /inválido/);
});

test('R2: não sobrescreve anexo existente e erros não vazam o segredo', async () => {
  const falso = r2Falso();
  const r2 = novoR2(falso);
  const id = await r2.gravar(pdfMinimo());
  await assert.rejects(r2.gravarBruto(id, Buffer.from('troca')), /412/);
  const errado = criarArmazemR2({ accountId: CONTA, accessKeyId: CHAVE_ID, secretAccessKey: 'segredo-errado', bucket: BUCKET, chave, fetch: falso.fetch });
  await assert.rejects(errado.gravar(pdfMinimo()), e => e.message === 'R2 respondeu 403 ao gravar o anexo.' && !e.message.includes('segredo'));
});

test('R2: lista com paginação', async () => {
  const falso = r2Falso({ porPagina: 2 });
  const r2 = novoR2(falso);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await r2.gravar(pdfMinimo(`p${i}`)));
  falso.objetos.set('anexos/leia-me.txt', Buffer.from('x'));
  assert.deepEqual(await r2.listarIds(), ids.sort());
});

test('R2: variáveis vazias usam o disco, pela metade são erro, completas usam o R2', () => {
  assert.equal(armazemDoAmbiente({}, { chave, pastaPadrao: pasta }).tipo, 'disco');
  assert.throws(() => armazemDoAmbiente({ TEB_R2_BUCKET: BUCKET }, { chave, pastaPadrao: pasta }), /faltam as variáveis TEB_R2_ACCOUNT_ID, TEB_R2_ACCESS_KEY_ID, TEB_R2_SECRET_ACCESS_KEY/);
  assert.equal(armazemDoAmbiente(ENV_R2, { chave, pastaPadrao: pasta, fetch: r2Falso().fetch }).tipo, 'r2');
  assert.throws(() => armazemDoAmbiente({ ...ENV_R2, TEB_R2_ACCOUNT_ID: 'nao-hex' }, { chave, pastaPadrao: pasta }), /32 caracteres/);
  assert.throws(() => armazemDoAmbiente({ ...ENV_R2, TEB_R2_BUCKET: 'A/B' }, { chave, pastaPadrao: pasta }), /BUCKET/);
});

test('migrar-anexos: copia do disco para o R2 sem decifrar, e pode rodar de novo', async () => {
  const disco = criarArmazemDisco({ pasta: join(pasta, 'migrar'), chave });
  const ids = [await disco.gravar(pdfMinimo('um')), await disco.gravar(pdfMinimo('dois'))];
  const falso = r2Falso();
  const r2 = novoR2(falso);
  assert.deepEqual(await migrarAnexos(disco, r2), { copiados: 2, pulados: 0 });
  assert.deepEqual(await migrarAnexos(disco, r2), { copiados: 0, pulados: 2 });
  for (const id of ids) assert.deepEqual(await r2.ler(id), await disco.ler(id));
});

test('servidor com anexos no R2: envio e download pela API', async () => {
  const falso = r2Falso();
  const amb = await criarAmbiente();
  try {
    // Troca o armazém do ambiente de teste pelo R2 simulado, com a mesma chave.
    const r2 = criarArmazemR2({ accountId: CONTA, accessKeyId: CHAVE_ID, secretAccessKey: SEGREDO, bucket: BUCKET, chave, fetch: falso.fetch });
    const { criarApp } = await import('../app.js');
    const { createServer } = await import('node:http');
    const app = criarApp({ banco: amb.banco, anexos: r2, agora: amb.relogio.agora, ipDe: req => String(req.headers['x-ip-teste'] || '10.0.0.1'), enviarEmail: () => {} });
    const servidor = createServer(app);
    await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    try {
      const entrar = async conta => {
        const r = await fetch(`${base}/api/acesso/entrar`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ip-teste': `10.7.${Math.floor(Math.random() * 250)}.1` }, body: JSON.stringify({ documento: conta.documento, senha: 'Senha-de-teste-9' }) });
        return r.headers.getSetCookie()[0].split(';')[0];
      };
      const gestor = await entrar(amb.contas.a.gestor);
      const { corpoEdital } = await import('./ajuda.js');
      const json = (cookie, metodo, caminho, corpo) => fetch(base + caminho, { method: metodo, headers: { cookie, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined }).then(async r => ({ status: r.status, corpo: await r.json().catch(() => null) }));
      const ed = await json(gestor, 'POST', '/api/gestor/editais', corpoEdital(amb.relogio));
      await json(gestor, 'POST', `/api/gestor/editais/${ed.corpo.edital.slug}/abrir`, {});
      const prop = await entrar(amb.contas.a.proponente);
      const insc = await json(prop, 'POST', '/api/inscricoes', { edital: ed.corpo.edital.slug, ficha: {} });
      const pdf = pdfMinimo('anexo que vai para o R2');
      const up = await fetch(`${base}/api/inscricoes/${insc.corpo.inscricao.id}/anexos/extra-portfolio`, { method: 'POST', headers: { cookie: prop, 'content-type': 'application/pdf', 'x-nome-arquivo': 'p.pdf' }, body: pdf });
      assert.equal(up.status, 201);
      const { anexo } = await up.json();
      assert.equal(falso.objetos.size, 1);
      const down = await fetch(`${base}/api/anexos/${anexo.id}`, { headers: { cookie: prop } });
      assert.equal(down.status, 200);
      assert.deepEqual(Buffer.from(await down.arrayBuffer()), pdf);
    } finally {
      servidor.closeAllConnections();
      await new Promise(ok => servidor.close(ok));
    }
  } finally {
    await amb.fechar();
  }
});

test('backup e restauração com os anexos no R2', async () => {
  const origemR2 = r2Falso();
  const r2 = novoR2(origemR2);
  const ids = [await r2.gravar(pdfMinimo('backup um')), await r2.gravar(pdfMinimo('backup dois'))];
  const banco = await abrirBanco({ caminho: join(pasta, 'bkp.sqlite') });
  const chaveBackup = randomBytes(32);
  const nuvem = nuvemFalsa();
  const destinos = destinosDoAmbiente({ ...CRED.b2 }, { fetch: nuvem.fetch });
  try {
    const rel = await fazerBackup({ banco, anexos: r2, chave: chaveBackup, destinos, pastaTemp: join(pasta, 'tmp') });
    assert.equal(rel.ok, true, JSON.stringify(rel.destinos));
    assert.equal(rel.destinos[0].anexosEnviados, 2);
    // Restaura num R2 novo e vazio.
    const novoBucket = r2Falso();
    const r2Novo = novoR2(novoBucket);
    const r = await restaurar({ destino: destinos[0], chave: chaveBackup, abrirDestinoBanco: () => abrirBanco({ caminho: join(pasta, 'rest.sqlite') }), anexos: r2Novo, pastaTemp: join(pasta, 'tmp') });
    assert.equal(r.anexos, 2);
    for (const id of ids) assert.deepEqual(await r2Novo.ler(id), await r2.ler(id));
  } finally {
    await banco.fechar();
  }
});

test('R2 fora do ar: o usuário recebe 503 com mensagem clara, sem detalhes nem segredo', async () => {
  const fora = { fetch: async () => { throw new Error(`falha de rede com ${SEGREDO}`); } };
  const r2 = criarArmazemR2({ accountId: CONTA, accessKeyId: CHAVE_ID, secretAccessKey: SEGREDO, bucket: BUCKET, chave, fetch: fora.fetch });
  await assert.rejects(r2.gravar(pdfMinimo()), e => e.code === 'ARMAZEM_INDISPONIVEL' && !e.message.includes(SEGREDO));
  const caiu = { fetch: async () => new Response('', { status: 503 }) };
  const r2b = criarArmazemR2({ accountId: CONTA, accessKeyId: CHAVE_ID, secretAccessKey: SEGREDO, bucket: BUCKET, chave, fetch: caiu.fetch });
  await assert.rejects(r2b.ler('b'.repeat(32)), e => e.code === 'ARMAZEM_INDISPONIVEL' && e.message === 'R2 respondeu 503 ao ler o anexo.');
  // Pela API: envio com o R2 fora do ar dá 503.
  const amb = await criarAmbiente();
  try {
    const { criarApp } = await import('../app.js');
    const { createServer } = await import('node:http');
    const app = criarApp({ banco: amb.banco, anexos: r2, agora: amb.relogio.agora, ipDe: () => '10.8.0.1', enviarEmail: () => {} });
    const servidor = createServer(app);
    await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const erros = console.error;
    console.error = () => {};
    try {
      const login = await fetch(`${base}/api/acesso/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documento: amb.contas.a.gestor.documento, senha: 'Senha-de-teste-9' }) });
      const gestor = login.headers.getSetCookie()[0].split(';')[0];
      const { corpoEdital } = await import('./ajuda.js');
      const ed = await (await fetch(`${base}/api/gestor/editais`, { method: 'POST', headers: { cookie: gestor, 'content-type': 'application/json' }, body: JSON.stringify(corpoEdital(amb.relogio)) })).json();
      await fetch(`${base}/api/gestor/editais/${ed.edital.slug}/abrir`, { method: 'POST', headers: { cookie: gestor, 'content-type': 'application/json' }, body: '{}' });
      const lp = await fetch(`${base}/api/acesso/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documento: amb.contas.a.proponente.documento, senha: 'Senha-de-teste-9' }) });
      const prop = lp.headers.getSetCookie()[0].split(';')[0];
      const insc = await (await fetch(`${base}/api/inscricoes`, { method: 'POST', headers: { cookie: prop, 'content-type': 'application/json' }, body: JSON.stringify({ edital: ed.edital.slug, ficha: {} }) })).json();
      const up = await fetch(`${base}/api/inscricoes/${insc.inscricao.id}/anexos/extra-portfolio`, { method: 'POST', headers: { cookie: prop, 'content-type': 'application/pdf', 'x-nome-arquivo': 'p.pdf' }, body: pdfMinimo() });
      assert.equal(up.status, 503);
      const corpo = await up.json();
      assert.equal(corpo.erro, 'armazenamento_indisponivel');
      assert.ok(!JSON.stringify(corpo).includes(SEGREDO) && !JSON.stringify(corpo).includes('r2.cloudflarestorage'));
    } finally {
      console.error = erros;
      servidor.closeAllConnections();
      await new Promise(ok => servidor.close(ok));
    }
  } finally {
    await amb.fechar();
  }
});

test('falha 1: token de continuação repetido ou ausente para a listagem com erro, sem travar', async () => {
  const base = r2Falso();
  const r2Repetido = novoR2({ fetch: async (url, op) => {
    const u = new URL(String(url));
    if (u.searchParams.get('list-type') === '2') return new Response('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>mesmo</NextContinuationToken></ListBucketResult>', { status: 200 });
    return base.fetch(url, op);
  } });
  await assert.rejects(r2Repetido.listarIds(), e => e.code === 'ARMAZEM_INDISPONIVEL' && /repetiu/.test(e.message));
  const r2SemToken = novoR2({ fetch: async () => new Response('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>', { status: 200 }) });
  await assert.rejects(r2SemToken.listarIds(), e => e.code === 'ARMAZEM_INDISPONIVEL' && /sem token/.test(e.message));
});

test('falha 2: listagem dos anexos fora do ar não impede o backup do banco', async () => {
  const r2 = novoR2({ fetch: async () => new Response('', { status: 500 }) });
  const banco = await abrirBanco({ caminho: join(pasta, 'f2.sqlite') });
  const nuvem = nuvemFalsa();
  try {
    const rel = await fazerBackup({ banco, anexos: r2, chave: randomBytes(32), destinos: destinosDoAmbiente({ ...CRED.b2, ...CRED.github }, { fetch: nuvem.fetch }), pastaTemp: join(pasta, 'tmp-f2') });
    const b2 = rel.destinos.find(d => d.destino === 'Backblaze B2');
    const gh = rel.destinos.find(d => d.destino === 'GitHub privado');
    assert.equal(b2.banco, true, 'o banco foi enviado ao B2');
    assert.equal(b2.ok, false);
    assert.match(b2.erro, /não foi possível listar os anexos: R2 respondeu 500/);
    assert.equal(gh.ok, true, 'o GitHub não guarda anexos e fica ok');
    assert.ok([...nuvem.b2.keys()].some(k => k.startsWith('banco/')));
  } finally {
    await banco.fechar();
  }
});

test('falha 3: corpo cortado no meio vira indisponibilidade (503), não anexo corrompido', async () => {
  const cortado = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.error(new Error('conexão caiu')); } }), { status: 200 });
  const r2 = novoR2({ fetch: async () => cortado() });
  await assert.rejects(r2.ler('a'.repeat(32)), e => e.code === 'ARMAZEM_INDISPONIVEL' && !/segredo/.test(e.message));
  await assert.rejects(r2.listarIds(), e => e.code === 'ARMAZEM_INDISPONIVEL');
});
