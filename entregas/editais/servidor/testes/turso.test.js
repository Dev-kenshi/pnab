// Adaptador Turso (API HTTP v2, /v2/pipeline) testado com um Turso falso sobre node:sqlite. Sem rede.
// O falso imita o formato da API: requests execute/close, baton para transação, cols/rows tipados e erros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { abrirBanco, abrirTurso } from '../banco.js';
import { exportarBanco } from '../backup/exportar.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TURSO = 'libsql://banco-teste.turso.falso';
const TOKEN = 'token-turso-teste';

function tursoFalso({ falharStatus } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const pedidos = [];
  let batonAtivo = null, seq = 0;
  const valor = a => {
    if (!a || a.type === 'null') return null;
    if (a.type === 'integer') return BigInt(a.value);
    if (a.type === 'float') return Number(a.value);
    if (a.type === 'text') return a.value;
    throw new Error(`tipo inesperado ${a.type}`);
  };
  const celula = v => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v))) return { type: 'integer', value: String(v) };
    if (typeof v === 'number') return { type: 'float', value: v };
    return { type: 'text', value: String(v) };
  };
  async function fetchFalso(url, opcoes) {
    pedidos.push({ url: String(url), cabecalhos: opcoes.headers, corpo: JSON.parse(opcoes.body) });
    if (falharStatus) return new Response('{}', { status: falharStatus });
    if (String(url) !== 'https://banco-teste.turso.falso/v2/pipeline') return new Response('{}', { status: 404 });
    if (opcoes.headers.Authorization !== `Bearer ${TOKEN}`) return new Response('{}', { status: 401 });
    const { baton, requests } = JSON.parse(opcoes.body);
    if (batonAtivo && baton !== batonAtivo) return new Response(JSON.stringify({ message: 'baton inválido' }), { status: 400 });
    const results = [];
    let fechar = false;
    for (const r of requests) {
      if (r.type === 'close') { fechar = true; results.push({ type: 'ok', response: { type: 'close' } }); continue; }
      try {
        const st = db.prepare(r.stmt.sql);
        st.setReadBigInts(true);
        const args = (r.stmt.args || []).map(valor);
        let cols = [], rows = [], afetadas = 0, ultimo = null;
        if (st.columns().length) {
          cols = st.columns().map(c => ({ name: c.name }));
          rows = st.all(...args).map(l => cols.map(c => celula(l[c.name])));
        } else {
          const x = st.run(...args);
          afetadas = Number(x.changes);
          ultimo = String(x.lastInsertRowid);
        }
        results.push({ type: 'ok', response: { type: 'execute', result: { cols, rows, affected_row_count: afetadas, last_insert_rowid: ultimo } } });
      } catch (e) {
        results.push({ type: 'error', error: { message: e.message } });
      }
    }
    const novo = fechar ? null : `baton-${++seq}`;
    batonAtivo = novo;
    return new Response(JSON.stringify({ baton: novo, results }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return { fetch: fetchFalso, db, pedidos };
}

test('Turso: escolhido só com URL e token, cria o esquema e usa HTTPS com Bearer', async () => {
  const t = tursoFalso();
  const banco = await abrirBanco({ tursoUrl: URL_TURSO, tursoToken: TOKEN, fetch: t.fetch });
  assert.equal(banco.tipo, 'turso');
  assert.ok(t.pedidos.every(p => p.url.startsWith('https://') && p.cabecalhos.Authorization === `Bearer ${TOKEN}`));
  const tabelas = t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(l => l.name);
  for (const nome of ['organizacoes', 'usuarios', 'editais', 'inscricoes', 'auditoria']) assert.ok(tabelas.includes(nome), nome);
  const local = await abrirBanco({ tursoUrl: URL_TURSO, tursoToken: '' });
  assert.equal(local.tipo, 'sqlite');
  await local.fechar();
});

test('Turso: parâmetros tipados, linhas convertidas e último id', async () => {
  const t = tursoFalso();
  const banco = await abrirTurso({ url: URL_TURSO, token: TOKEN, fetch: t.fetch });
  const r = await banco.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['org-t', "Nome com 'aspas' e ç", '2026-01-01']);
  assert.equal(r.alteradas, 1);
  assert.equal(typeof r.ultimoId, 'number');
  const { linhas } = await banco.executar('SELECT id, slug, nome FROM organizacoes WHERE slug = ?', ['org-t']);
  assert.deepEqual(linhas, [{ id: r.ultimoId, slug: 'org-t', nome: "Nome com 'aspas' e ç" }]);
  const ultimo = t.pedidos.at(-1).corpo.requests[0].stmt;
  assert.equal(ultimo.sql, 'SELECT id, slug, nome FROM organizacoes WHERE slug = ?');
  assert.deepEqual(ultimo.args, [{ type: 'text', value: 'org-t' }]);
  const injecao = "x' OR '1'='1";
  assert.deepEqual((await banco.executar('SELECT id FROM organizacoes WHERE slug = ?', [injecao])).linhas, []);
  await banco.executar('INSERT INTO sequencias (nome, valor) VALUES (?, ?)', ['n', true]);
  assert.equal((await banco.executar('SELECT valor FROM sequencias WHERE nome = ?', ['n'])).linhas[0].valor, 1);
});

test('Turso: transação confirma com baton e desfaz tudo quando falha', async () => {
  const t = tursoFalso();
  const banco = await abrirTurso({ url: URL_TURSO, token: TOKEN, fetch: t.fetch });
  await banco.transacao(async tx => {
    await tx.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['a', 'A', 'x']);
    await tx.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['b', 'B', 'x']);
  });
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM organizacoes').get().n, 2);
  const comBaton = t.pedidos.filter(p => p.corpo.baton);
  assert.ok(comBaton.length >= 2, 'usa o baton dentro da transação');
  await assert.rejects(banco.transacao(async tx => {
    await tx.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['c', 'C', 'x']);
    await tx.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['a', 'repetido', 'x']);
  }), /UNIQUE/);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM organizacoes').get().n, 2, 'a linha c foi desfeita');
  assert.ok(t.pedidos.some(p => p.corpo.requests.some(r => r.stmt?.sql === 'ROLLBACK')));
  await banco.executar('SELECT 1');
});

test('Turso: erro HTTP e erro de SQL viram exceção sem vazar o token', async () => {
  const t = tursoFalso();
  const banco = await abrirTurso({ url: URL_TURSO, token: TOKEN, fetch: t.fetch });
  await assert.rejects(banco.executar('SELECT * FROM tabela_que_nao_existe'), e => /no such table/.test(e.message) && !e.message.includes(TOKEN));
  const fora = tursoFalso({ falharStatus: 503 });
  await assert.rejects(abrirTurso({ url: URL_TURSO, token: TOKEN, fetch: fora.fetch }), e => e.message === 'Turso respondeu 503' && !e.message.includes(TOKEN));
  const errado = tursoFalso();
  await assert.rejects(abrirTurso({ url: URL_TURSO, token: 'token-errado', fetch: errado.fetch }), /Turso respondeu 401/);
});

test('Turso: o backup exporta do Turso como do SQLite', async () => {
  const t = tursoFalso();
  const banco = await abrirTurso({ url: URL_TURSO, token: TOKEN, fetch: t.fetch });
  await banco.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['org-b', 'Org B', 'x']);
  const pasta = await mkdtemp(join(tmpdir(), 'teb-turso-'));
  try {
    const contagem = await exportarBanco(banco, join(pasta, 'b.ndjson'));
    assert.equal(contagem.organizacoes, 1);
    const texto = await readFile(join(pasta, 'b.ndjson'), 'utf8');
    assert.match(texto, /"origem":"turso"/);
    assert.match(texto, /org-b/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
