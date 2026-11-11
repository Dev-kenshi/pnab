// Backups cifrados (AES-256-GCM) do banco e dos anexos para Google Drive, Backblaze B2 e GitHub privado.
// Sem rede: os três destinos são simulados por nuvem-falsa.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco } from '../banco.js';
import { criarArmazemDisco } from '../anexos.js';
import { inserirUsuario } from '../rotas/acesso.js';
import { cifrarArquivo, decifrarArquivo, lerChaveBackup } from '../backup/cifra.js';
import { destinosDoAmbiente, githubPrivado } from '../backup/destinos.js';
import { exportarBanco, importarBanco } from '../backup/exportar.js';
import { fazerBackup, listarBackups, nomeBanco, restaurar } from '../backup/rotina.js';
import { CRED, nuvemFalsa } from './nuvem-falsa.js';
import { gerarCPF, SENHA } from './ajuda.js';

const TODAS = { ...CRED.gdrive, ...CRED.b2, ...CRED.github };
let pasta, banco, anexos, pastaAnexos, chaveAnexos, chave, ids;

before(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'teb-backup-'));
  banco = await abrirBanco({ caminho: join(pasta, 'origem.sqlite') });
  chaveAnexos = randomBytes(32);
  chave = randomBytes(32);
  pastaAnexos = join(pasta, 'anexos');
  anexos = criarArmazemDisco({ pasta: pastaAnexos, chave: chaveAnexos });
  const agora = new Date('2026-06-15T15:00:00Z');
  const org = await banco.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['org-bkp', 'Organização de teste', agora.toISOString()]);
  for (let i = 0; i < 3; i++) {
    await inserirUsuario(banco, {
      organizacaoId: org.ultimoId, papel: 'proponente', nome: `Pessoa ${i} "aspas" ç <b>`, natureza: 'Pessoa Física',
      documento: gerarCPF(200000000 + i), email: `p${i}@teste.example`, telefone: '71900000000', senha: SENHA, agora,
    });
  }
  await banco.executar('INSERT INTO sessoes (token_hash, usuario_id, expira_em, criado_em) VALUES (?, 1, ?, ?)', ['hash-sessao', agora.toISOString(), agora.toISOString()]);
  await banco.executar('INSERT INTO tokens_redefinicao (token_hash, usuario_id, expira_em) VALUES (?, 1, ?)', ['hash-token', agora.toISOString()]);
  ids = [];
  for (const texto of ['%PDF-1.4 primeiro', '%PDF-1.4 segundo']) ids.push(await anexos.gravar(Buffer.from(texto)));
});

after(async () => {
  await banco.fechar();
  await rm(pasta, { recursive: true, force: true });
});

const destinos = nuvem => destinosDoAmbiente(TODAS, { fetch: nuvem.fetch });
const backup = (nuvem, extra = {}) => fazerBackup({ banco, pastaAnexos, chave, destinos: destinos(nuvem), pastaTemp: join(pasta, 'tmp'), ...extra });

test('backup: chave própria de 32 bytes, diferente da chave dos anexos', () => {
  assert.throws(() => lerChaveBackup(''), /TEB_CHAVE_BACKUP/);
  assert.throws(() => lerChaveBackup(randomBytes(16).toString('base64')), /32 bytes/);
  assert.throws(() => lerChaveBackup(chaveAnexos.toString('base64'), chaveAnexos), /diferente/);
  assert.equal(lerChaveBackup(chave.toString('base64'), chaveAnexos).length, 32);
});

test('backup: cifra AES-256-GCM, sem texto em claro, e falha com adulteração, chave errada ou nome trocado', async () => {
  const claro = join(pasta, 'claro.txt');
  await writeFile(claro, 'CONTEUDO-SECRETO '.repeat(1000));
  const cif = join(pasta, 'claro.teb');
  await cifrarArquivo(claro, cif, { chave, nome: 'banco/x', gzip: true });
  const bytes = await readFile(cif);
  assert.equal(bytes.subarray(0, 4).toString(), 'TEBB');
  assert.ok(!bytes.includes(Buffer.from('CONTEUDO-SECRETO')));
  const volta = join(pasta, 'volta.txt');
  await decifrarArquivo(cif, volta, { chave, nome: 'banco/x', gzip: true });
  assert.equal(await readFile(volta, 'utf8'), 'CONTEUDO-SECRETO '.repeat(1000));

  const adulterado = Buffer.from(bytes);
  adulterado[40] ^= 1;
  await writeFile(join(pasta, 'ad.teb'), adulterado);
  await assert.rejects(decifrarArquivo(join(pasta, 'ad.teb'), join(pasta, 'ad.txt'), { chave, nome: 'banco/x', gzip: true }), /adulterado ou chave errada/);
  assert.ok(!existsSync(join(pasta, 'ad.txt')) && !existsSync(join(pasta, 'ad.txt.parcial')));
  await assert.rejects(decifrarArquivo(cif, join(pasta, 'k.txt'), { chave: randomBytes(32), nome: 'banco/x', gzip: true }), /adulterado ou chave errada/);
  await assert.rejects(decifrarArquivo(cif, join(pasta, 'n.txt'), { chave, nome: 'banco/y', gzip: true }), /adulterado ou chave errada/);
  await writeFile(join(pasta, 'curto.teb'), Buffer.from('TEBB'));
  await assert.rejects(decifrarArquivo(join(pasta, 'curto.teb'), join(pasta, 'c.txt'), { chave, nome: 'banco/x' }), /curto/);
});

test('backup: exportação deixa de fora sessões e tokens, e a importação recusa banco com dados', async () => {
  const arq = join(pasta, 'dump.ndjson');
  const contagem = await exportarBanco(banco, arq);
  assert.equal(contagem.usuarios, 3);
  assert.equal(contagem.sessoes, undefined);
  assert.equal(contagem.tokens_redefinicao, undefined);
  const texto = await readFile(arq, 'utf8');
  assert.ok(!texto.includes('hash-sessao') && !texto.includes('hash-token'));
  await assert.rejects(importarBanco(banco, arq), /já tem dados/);
});

test('backup: envia banco aos 3 destinos e anexos só ao Drive e ao B2, tudo cifrado', async () => {
  const nuvem = nuvemFalsa();
  const r = await backup(nuvem, { agora: new Date('2026-07-01T03:00:00Z') });
  assert.equal(r.ok, true, JSON.stringify(r.destinos));
  assert.deepEqual(r.destinos.map(d => d.destino), ['Google Drive', 'Backblaze B2', 'GitHub privado']);
  const nome = 'banco/2026-07-01T03-00-00-000Z.ndjson.gz.teb';
  assert.equal(r.nomeBanco, nome);
  assert.ok([...nuvem.gdrive.values()].some(a => a.nome === nome));
  assert.ok(nuvem.b2.has(nome));
  assert.ok(nuvem.github.has(nome));
  for (const id of ids) {
    assert.ok(nuvem.b2.has(`anexos/${id}.bin.teb`));
    assert.ok([...nuvem.gdrive.values()].some(a => a.nome === `anexos/${id}.bin.teb`));
  }
  assert.ok([...nuvem.github.keys()].every(k => k.startsWith('banco/')), 'GitHub não recebe anexos');
  const todos = [...nuvem.b2.values(), ...nuvem.github.values(), ...nuvem.gdrive.values()].map(a => a.bytes);
  for (const b of todos) {
    assert.equal(b.subarray(0, 4).toString(), 'TEBB');
    for (const claro of ['p0@teste.example', 'Pessoa 0', '%PDF', 'scrypt$']) assert.ok(!b.includes(Buffer.from(claro)), claro);
  }
  assert.ok(nuvem.chamadas.every(c => c.url.startsWith('https://')), 'só HTTPS');
});

test('backup: anexos são incrementais e a retenção apaga só backups antigos do banco', async () => {
  const nuvem = nuvemFalsa();
  const diario = () => destinosDoAmbiente({ ...TODAS, TEB_GITHUB_INTERVALO_DIAS: '0' }, { fetch: nuvem.fetch });
  for (let d = 1; d <= 4; d++) {
    const r = await backup(nuvem, { reter: 2, agora: new Date(`2026-07-0${d}T03:00:00Z`), destinos: diario() });
    assert.equal(r.ok, true);
    const b2 = r.destinos.find(x => x.destino === 'Backblaze B2');
    assert.equal(b2.anexosEnviados, d === 1 ? 2 : 0);
    assert.equal(b2.anexosJaExistiam, d === 1 ? 0 : 2);
    assert.equal(b2.apagados, d <= 2 ? 0 : 1);
  }
  for (const d of diario()) {
    assert.deepEqual(await listarBackups(d), ['banco/2026-07-04T03-00-00-000Z.ndjson.gz.teb', 'banco/2026-07-03T03-00-00-000Z.ndjson.gz.teb'], d.nome);
  }
  assert.equal([...nuvem.b2.keys()].filter(k => k.startsWith('anexos/')).length, 2);
});

test('backup: um destino fora do ar não impede os outros e o relatório aponta a falha sem segredo', async () => {
  const nuvem = nuvemFalsa();
  nuvem.falhar.add('b2');
  const logs = [];
  const r = await backup(nuvem, { log: m => logs.push(m) });
  assert.equal(r.ok, false);
  const b2 = r.destinos.find(d => d.destino === 'Backblaze B2');
  assert.equal(b2.ok, false);
  assert.match(b2.erro, /Backblaze B2 respondeu 503/);
  assert.equal(r.destinos.filter(d => d.ok).length, 2);
  const texto = JSON.stringify(r) + logs.join('\n');
  for (const v of Object.values(TODAS)) if (v.length > 6 && !v.includes('/')) assert.ok(!texto.includes(v), `vazou ${v}`);
});

test('backup: token vencido do B2 é renovado sozinho', async () => {
  const nuvem = nuvemFalsa();
  const [, b2] = destinos(nuvem);
  await b2.enviar('banco/teste-a', Buffer.from('a'));
  nuvem.vencerTokenB2();
  await b2.enviar('banco/teste-b', Buffer.from('b'));
  assert.ok(nuvem.b2.has('banco/teste-b'));
});

test('backup: GitHub público é recusado e nada é enviado', async () => {
  const nuvem = nuvemFalsa({ githubPublico: true });
  const r = await backup(nuvem);
  const gh = r.destinos.find(d => d.destino === 'GitHub privado');
  assert.equal(gh.ok, false);
  assert.match(gh.erro, /precisa ser privado/);
  assert.equal(nuvem.github.size, 0);
});

test('backup: GitHub recusa banco acima de 50 MB e repositório com nome inválido', async () => {
  const nuvem = nuvemFalsa();
  const gh = githubPrivado({ token: CRED.github.TEB_GITHUB_TOKEN, repo: CRED.github.TEB_GITHUB_REPO, fetch: nuvem.fetch });
  await assert.rejects(gh.enviar('banco/grande', Buffer.alloc(50 * 1024 * 1024 + 1)), /50 MB/);
  assert.throws(() => githubPrivado({ token: 'x', repo: '../../etc' }), /dono\/nome/);
});

test('backup: variáveis pela metade são erro, ausentes desligam o destino, e sem destino não há backup', async () => {
  assert.throws(() => destinosDoAmbiente({ TEB_B2_KEY_ID: 'x' }), /Backblaze B2: faltam as variáveis TEB_B2_APP_KEY, TEB_B2_BUCKET_ID, TEB_B2_BUCKET_NOME/);
  assert.deepEqual(destinosDoAmbiente({ ...CRED.github }).map(d => d.chave), ['github']);
  assert.deepEqual(destinosDoAmbiente({}), []);
  await assert.rejects(fazerBackup({ banco, pastaAnexos, chave, destinos: [], pastaTemp: join(pasta, 'tmp') }), /Nenhum destino/);
});

test('restauração: de cada destino para um banco novo, com dados iguais e anexos legíveis', async () => {
  const nuvem = nuvemFalsa();
  await backup(nuvem, { agora: new Date('2026-07-01T03:00:00Z') });
  const origem = (await banco.executar('SELECT id, nome, documento, email, senha_hash FROM usuarios ORDER BY id')).linhas;
  for (const d of destinos(nuvem)) {
    const alvo = join(pasta, `restaurado-${d.chave}.sqlite`);
    const pastaNova = join(pasta, `anexos-${d.chave}`);
    const r = await restaurar({ destino: d, chave, abrirDestinoBanco: () => abrirBanco({ caminho: alvo }), pastaAnexos: pastaNova, pastaTemp: join(pasta, 'tmp') });
    assert.equal(r.contagem.usuarios, 3);
    const novo = await abrirBanco({ caminho: alvo });
    assert.deepEqual((await novo.executar('SELECT id, nome, documento, email, senha_hash FROM usuarios ORDER BY id')).linhas, origem);
    assert.equal((await novo.executar('SELECT COUNT(*) AS n FROM sessoes')).linhas[0].n, 0);
    await novo.fechar();
    if (d.guardaAnexos) {
      assert.equal(r.anexos, 2);
      const lidos = criarArmazemDisco({ pasta: pastaNova, chave: chaveAnexos });
      assert.equal((await lidos.ler(ids[0])).toString(), '%PDF-1.4 primeiro');
      assert.equal((await lidos.ler(ids[1])).toString(), '%PDF-1.4 segundo');
    } else {
      assert.equal(r.anexos, 0);
      assert.ok(!existsSync(pastaNova) || (await readdir(pastaNova)).length === 0);
    }
  }
});

test('restauração: recusa chave errada, backup inexistente e banco de destino com dados', async () => {
  const nuvem = nuvemFalsa();
  await backup(nuvem, { agora: new Date('2026-07-01T03:00:00Z') });
  const [, b2] = destinos(nuvem);
  const tmp = join(pasta, 'tmp');
  await assert.rejects(restaurar({ destino: b2, chave: randomBytes(32), abrirDestinoBanco: () => abrirBanco({ caminho: join(pasta, 'x1.sqlite') }), pastaTemp: tmp }), /adulterado ou chave errada/);
  await assert.rejects(restaurar({ destino: b2, chave, nome: 'banco/2020-01-01T00-00-00-000Z.ndjson.gz.teb', abrirDestinoBanco: () => abrirBanco({ caminho: join(pasta, 'x2.sqlite') }), pastaTemp: tmp }), /não encontrado/);
  await assert.rejects(restaurar({ destino: b2, chave, abrirDestinoBanco: async () => banco, pastaTemp: tmp }).catch(e => { throw e; }), /já tem dados/);
  // O banco de origem foi fechado pela restauração recusada; reabre para os próximos testes.
  banco = await abrirBanco({ caminho: join(pasta, 'origem.sqlite') });
});

test('restauração: arquivo do banco trocado de nome no destino não é aceito', async () => {
  const nuvem = nuvemFalsa();
  await backup(nuvem, { agora: new Date('2026-07-01T03:00:00Z') });
  const original = nuvem.b2.get('banco/2026-07-01T03-00-00-000Z.ndjson.gz.teb');
  nuvem.b2.set('banco/2026-07-02T03-00-00-000Z.ndjson.gz.teb', { ...original, id: 'troca' });
  const [, b2] = destinos(nuvem);
  await assert.rejects(restaurar({ destino: b2, chave, abrirDestinoBanco: () => abrirBanco({ caminho: join(pasta, 'x3.sqlite') }), pastaTemp: join(pasta, 'tmp') }), /adulterado ou chave errada/);
});

test('backup: nome do banco usa data em UTC ordenável', () => {
  assert.equal(nomeBanco(new Date('2026-01-02T03:04:05.006Z')), 'banco/2026-01-02T03-04-05-006Z.ndjson.gz.teb');
});

test('restauração: sistema completo volta igual, tabela por tabela, e os anexos ficam idênticos', async () => {
  const { criarAmbiente, pdfMinimo } = await import('./ajuda.js');
  const amb = await criarAmbiente();
  try {
    const gestor = await amb.entrar(amb.contas.a.gestor);
    const prop = await amb.entrar(amb.contas.a.proponente);
    const slug = await amb.editalAberto(gestor);
    const c = await prop.pedir('POST', '/api/inscricoes', { edital: slug, ficha: {} });
    const id = c.corpo.inscricao.id;
    const up = await prop.pedir('POST', `/api/inscricoes/${id}/anexos/extra-portfolio`, undefined, {
      bruto: pdfMinimo('backup'), cabecalhos: { 'content-type': 'application/pdf', 'x-nome-arquivo': 'portfolio.pdf' },
    });
    assert.equal(up.status, 201, JSON.stringify(up.corpo));
    await amb.inscricaoEnviada(prop, slug);
    const nuvem = nuvemFalsa();
    const r = await fazerBackup({ banco: amb.banco, pastaAnexos: amb.pastaAnexos, chave, destinos: destinos(nuvem), pastaTemp: join(pasta, 'tmp') });
    assert.equal(r.ok, true, JSON.stringify(r.destinos));
    const alvo = join(pasta, 'completo.sqlite');
    const pastaNova = join(pasta, 'anexos-completo');
    await restaurar({ destino: destinos(nuvem)[1], chave, abrirDestinoBanco: () => abrirBanco({ caminho: alvo }), pastaAnexos: pastaNova, pastaTemp: join(pasta, 'tmp') });
    const novo = await abrirBanco({ caminho: alvo });
    const tabelas = (await amb.banco.executar("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).linhas.map(l => l.name);
    for (const t of tabelas) {
      const a = (await amb.banco.executar(`SELECT * FROM ${t} ORDER BY rowid`)).linhas;
      const b = (await novo.executar(`SELECT * FROM ${t} ORDER BY rowid`)).linhas;
      if (['sessoes', 'tentativas_login', 'tokens_redefinicao'].includes(t)) assert.equal(b.length, 0, t);
      else assert.deepEqual(b, a, t);
    }
    assert.ok((await novo.executar('SELECT COUNT(*) AS n FROM anexos')).linhas[0].n >= 1);
    assert.equal((await novo.executar('PRAGMA foreign_key_check')).linhas.length, 0);
    await novo.fechar();
    for (const arq of await readdir(amb.pastaAnexos)) {
      assert.deepEqual(await readFile(join(pastaNova, arq)), await readFile(join(amb.pastaAnexos, arq)), arq);
    }
  } finally {
    await amb.fechar();
  }
});

test('backup: comando de apoio cria a pasta do Drive e devolve o ID', async () => {
  const nuvem = nuvemFalsa();
  const [drive] = destinos(nuvem);
  assert.match(await drive.criarPasta('Backup Sistema Integrado TEB'), /^pasta\d+$/);
});

test('correção 1: cadastro durante o backup não gera backup que deixa de restaurar', async () => {
  const nuvem = nuvemFalsa();
  const agora = new Date('2026-08-01T03:00:00Z');
  const [r] = await Promise.all([
    backup(nuvem, { agora }),
    (async () => {
      const org = await banco.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['org-concorrente', 'Concorrente', agora.toISOString()]);
      await inserirUsuario(banco, { organizacaoId: org.ultimoId, papel: 'proponente', nome: 'Entrou no meio', natureza: 'Pessoa Física', documento: gerarCPF(210000000), email: 'meio@teste.example', senha: SENHA, agora });
    })(),
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.destinos));
  const alvo = join(pasta, 'concorrente.sqlite');
  await restaurar({ destino: destinos(nuvem)[1], chave, abrirDestinoBanco: () => abrirBanco({ caminho: alvo }), pastaTemp: join(pasta, 'tmp') });
});

test('correção 1: backup que não restaura não é enviado', async () => {
  const nuvem = nuvemFalsa();
  const quebrado = {
    tipo: 'sqlite',
    transacao: fn => fn(quebrado),
    executar: async sql => {
      if (/sqlite_master/.test(sql)) return { linhas: [{ name: 'usuarios' }] };
      if (/FROM usuarios/.test(sql)) return { linhas: [{ __rowid: 1, id: 1, organizacao_id: 999, papel: 'proponente', nome: 'x', documento: '1', email: 'x', senha_hash: 'x', criado_em: 'x' }] };
      return { linhas: [] };
    },
  };
  await assert.rejects(fazerBackup({ banco: quebrado, pastaAnexos, chave, destinos: destinos(nuvem), pastaTemp: join(pasta, 'tmp') }), /não restaura e não foi enviado/);
  assert.equal(nuvem.b2.size + nuvem.github.size + nuvem.gdrive.size, 0);
});

test('correção 2: GitHub recebe o banco a cada 7 dias por padrão', async () => {
  const nuvem = nuvemFalsa();
  for (const dia of ['01', '03', '08', '09']) await backup(nuvem, { agora: new Date(`2026-09-${dia}T03:00:00Z`) });
  assert.deepEqual([...nuvem.github.keys()].sort(), ['banco/2026-09-01T03-00-00-000Z.ndjson.gz.teb', 'banco/2026-09-08T03-00-00-000Z.ndjson.gz.teb']);
  assert.equal([...nuvem.b2.keys()].filter(k => k.startsWith('banco/')).length, 4);
  assert.throws(() => destinosDoAmbiente({ ...CRED.github, TEB_GITHUB_INTERVALO_DIAS: '-1' }), /INTERVALO/);
});

test('correção 3: relógio atrasado não apaga o backup recém-enviado', async () => {
  const nuvem = nuvemFalsa();
  await backup(nuvem, { reter: 1, agora: new Date('2026-07-10T03:00:00Z') });
  const r = await backup(nuvem, { reter: 1, agora: new Date('2026-07-05T03:00:00Z') });
  assert.equal(r.ok, true);
  assert.ok(nuvem.b2.has('banco/2026-07-05T03-00-00-000Z.ndjson.gz.teb'));
});

test('correção 4: anexo adulterado na restauração diz qual anexo falhou', async () => {
  const nuvem = nuvemFalsa();
  await backup(nuvem, { agora: new Date('2026-07-01T03:00:00Z') });
  const nome = `anexos/${ids[1]}.bin.teb`;
  const a = nuvem.b2.get(nome);
  const bytes = Buffer.from(a.bytes); bytes[30] ^= 1;
  nuvem.b2.set(nome, { ...a, bytes });
  await assert.rejects(
    restaurar({ destino: destinos(nuvem)[1], chave, abrirDestinoBanco: () => abrirBanco({ caminho: join(pasta, 'c4.sqlite') }), pastaAnexos: join(pasta, 'anexos-c4'), pastaTemp: join(pasta, 'tmp') }),
    new RegExp(`Anexo ${ids[1]}: Backup adulterado`),
  );
});

test('correção 5 e 6: repositório com .. é recusado e arquivo vazio sem gzip decifra', async () => {
  for (const repo of ['../x', 'x/..', './x', 'a/b/c']) assert.throws(() => githubPrivado({ token: 't', repo }), /dono\/nome/, repo);
  const vazio = join(pasta, 'vazio.bin');
  await writeFile(vazio, Buffer.alloc(0));
  await cifrarArquivo(vazio, join(pasta, 'vazio.teb'), { chave, nome: 'anexos/v' });
  await decifrarArquivo(join(pasta, 'vazio.teb'), join(pasta, 'vazio.volta'), { chave, nome: 'anexos/v' });
  assert.equal((await readFile(join(pasta, 'vazio.volta'))).length, 0);
});

test('trava: duas execuções juntas não rodam e sobras de execução morta são apagadas', async () => {
  const tmp = join(pasta, 'tmp-trava');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(tmp, 'bkp-morto'), { recursive: true });
  await writeFile(join(tmp, 'bkp-morto', 'banco.ndjson'), 'dados em claro');
  const nuvem = nuvemFalsa();
  await backup(nuvem, { pastaTemp: tmp });
  assert.ok(!existsSync(join(tmp, 'bkp-morto')));
  await writeFile(join(tmp, 'backup.trava'), 'outro');
  await assert.rejects(backup(nuvem, { pastaTemp: tmp }), /em andamento/);
});
