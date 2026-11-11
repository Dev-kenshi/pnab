// Login de teste com usuário (TEB_PLATAFORMA_LOGIN) e criação idempotente da conta da plataforma.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { abrirBanco } from '../banco.js';
import { garantirContaPlataforma, loginPlataformaDoAmbiente } from '../conta-plataforma.js';
import { inserirUsuario } from '../rotas/acesso.js';
import { SENHA, criarAmbiente, gerarCPF } from './ajuda.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENHA_PLATAFORMA = 'Frase-longa-de-teste-77';

describe('com TEB_PLATAFORMA_LOGIN=admin', () => {
  let amb;
  before(async () => { amb = await criarAmbiente({ loginPlataforma: 'admin' }); });
  after(async () => { await amb?.fechar(); });

  test('etapa 1 aceita admin e ADMIN como a conta da plataforma', async () => {
    const c = amb.cliente();
    for (const d of ['admin', 'ADMIN', '  Admin ']) {
      const r = await c.pedir('POST', '/api/acesso/documento', { documento: d });
      assert.equal(r.status, 200, d);
      assert.deepEqual(r.corpo, { existe: true });
    }
    const outro = await c.pedir('POST', '/api/acesso/documento', { documento: 'root' });
    assert.equal(outro.status, 400);
    assert.equal(outro.corpo.erro, 'documento_invalido');
  });

  test('admin e ADMIN entram com a senha certa e recusam a errada', async () => {
    for (const d of ['admin', 'ADMIN']) {
      const c = amb.cliente();
      const errada = await c.pedir('POST', '/api/acesso/entrar', { documento: d, senha: 'Senha-errada-123' });
      assert.equal(errada.status, 401, d);
      assert.equal(errada.corpo.erro, 'senha_incorreta');
      assert.equal(c.cookie, null);
      const certa = await c.pedir('POST', '/api/acesso/entrar', { documento: d, senha: SENHA });
      assert.equal(certa.status, 200, d);
      assert.equal(certa.corpo.usuario.papel, 'plataforma');
      assert.ok(c.cookie);
      assert.equal((await c.pedir('GET', '/api/sessao')).corpo.usuario.papel, 'plataforma');
    }
    // O CPF da plataforma continua valendo.
    const c = amb.cliente();
    assert.equal((await c.pedir('POST', '/api/acesso/entrar', { documento: amb.contas.plataforma.documento, senha: SENHA })).status, 200);
  });

  test('auditoria grava o documento da plataforma e marca a entrada pelo usuário', async () => {
    const { linhas } = await amb.banco.executar("SELECT acao, alvo, detalhe FROM auditoria WHERE acao IN ('login', 'login_falha') AND detalhe LIKE '%apelido%'");
    assert.ok(linhas.some(l => l.acao === 'login'));
    assert.ok(linhas.some(l => l.acao === 'login_falha'));
    assert.ok(linhas.every(l => l.alvo === amb.contas.plataforma.documento));
    assert.ok(linhas.every(l => !/admin/i.test(l.alvo)));
  });

  test('o limite vale para o usuário: 5 erros bloqueiam, mesmo com senha certa e com o CPF', async () => {
    const ips = Array.from({ length: 7 }, () => amb.cliente());
    for (let i = 0; i < 5; i++) {
      const r = await ips[i].pedir('POST', '/api/acesso/entrar', { documento: i % 2 ? 'ADMIN' : 'admin', senha: `Errada-numero-${i}` });
      assert.equal(r.status, 401);
    }
    const bloqueado = await ips[5].pedir('POST', '/api/acesso/entrar', { documento: 'Admin', senha: SENHA });
    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.corpo.erro, 'bloqueado');
    const peloCpf = await ips[6].pedir('POST', '/api/acesso/entrar', { documento: amb.contas.plataforma.documento, senha: SENHA });
    assert.equal(peloCpf.status, 429);
    amb.relogio.avancar(16 * 60 * 1000);
    assert.equal((await amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: 'admin', senha: SENHA })).status, 200);
  });
});

describe('sem TEB_PLATAFORMA_LOGIN', () => {
  let amb;
  before(async () => { amb = await criarAmbiente(); });
  after(async () => { await amb?.fechar(); });

  test('admin é documento inválido (400) nas duas rotas', async () => {
    const c = amb.cliente();
    for (const rota of ['/api/acesso/documento', '/api/acesso/entrar']) {
      for (const d of ['admin', 'ADMIN']) {
        const r = await c.pedir('POST', rota, { documento: d, senha: SENHA });
        assert.equal(r.status, 400, `${rota} ${d}`);
        assert.equal(r.corpo.erro, 'documento_invalido');
      }
    }
    const r = await c.pedir('POST', '/api/acesso/documento', { documento: 'admin1' });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, 'documento_invalido');
  });
});

describe('leitura do ambiente', () => {
  test('sem a variável devolve null. Com ela exige documento válido', () => {
    assert.equal(loginPlataformaDoAmbiente({}), null);
    assert.equal(loginPlataformaDoAmbiente({ TEB_PLATAFORMA_LOGIN: '  ' }), null);
    const doc = gerarCPF(700000001);
    assert.deepEqual(loginPlataformaDoAmbiente({ TEB_PLATAFORMA_LOGIN: 'Admin', TEB_PLATAFORMA_DOCUMENTO: doc }), { usuario: 'admin', documento: doc });
    assert.throws(() => loginPlataformaDoAmbiente({ TEB_PLATAFORMA_LOGIN: 'admin', TEB_PLATAFORMA_DOCUMENTO: '123' }), /TEB_PLATAFORMA_DOCUMENTO/);
    assert.throws(() => loginPlataformaDoAmbiente({ TEB_PLATAFORMA_LOGIN: '12345678909', TEB_PLATAFORMA_DOCUMENTO: doc }), /começar com letra/);
    assert.throws(() => loginPlataformaDoAmbiente({ TEB_PLATAFORMA_LOGIN: 'admin', TEB_PLATAFORMA_DOCUMENTO: '16899535009' }), /reservado/);
  });
});

describe('garantir-plataforma', () => {
  let pasta;
  before(async () => { pasta = await mkdtemp(join(tmpdir(), 'teb-plataforma-')); });
  after(async () => { await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const envBase = documento => ({
    TEB_PLATAFORMA_DOCUMENTO: documento, TEB_PLATAFORMA_NOME: 'Pessoa da plataforma', TEB_PLATAFORMA_EMAIL: 'plataforma@teste.example', TEB_PLATAFORMA_SENHA: SENHA_PLATAFORMA,
  });

  test('a função cria uma vez e depois só avisa', async () => {
    const banco = await abrirBanco({ caminho: join(pasta, 'funcao.sqlite') });
    try {
      const doc = gerarCPF(700000002);
      const r1 = await garantirContaPlataforma(banco, envBase(doc));
      assert.equal(r1.criada, true);
      const r2 = await garantirContaPlataforma(banco, envBase(doc));
      assert.equal(r2.criada, false);
      assert.match(r2.mensagem, /já existe/);
      // Com a conta criada, a senha do ambiente nem é conferida: não troca a senha.
      const r3 = await garantirContaPlataforma(banco, { ...envBase(doc), TEB_PLATAFORMA_SENHA: '' });
      assert.equal(r3.criada, false);
      const { linhas } = await banco.executar("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'plataforma' AND documento = ?", [doc]);
      assert.equal(Number(linhas[0].n), 1);
      const aud = await banco.executar("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'conta_criada' AND alvo = ?", [doc]);
      assert.equal(Number(aud.linhas[0].n), 1);
    } finally { await banco.fechar(); }
  });

  test('recusa documento de outra conta que não é da plataforma e senha fraca', async () => {
    const banco = await abrirBanco({ caminho: join(pasta, 'recusa.sqlite') });
    try {
      const doc = gerarCPF(700000003);
      const r = await banco.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', ['org', 'Org', new Date().toISOString()]);
      await inserirUsuario(banco, { organizacaoId: r.ultimoId, papel: 'gestor', nome: 'Gestor', documento: doc, email: 'g@teste.example', senha: SENHA_PLATAFORMA, agora: new Date() });
      await assert.rejects(garantirContaPlataforma(banco, envBase(doc)), /não é da plataforma/);
      await assert.rejects(garantirContaPlataforma(banco, { ...envBase(gerarCPF(700000004)), TEB_PLATAFORMA_SENHA: 'curta' }));
    } finally { await banco.fechar(); }
  });

  test('o comando roda duas vezes e sai com código 0 nas duas', async () => {
    const executar = promisify(execFile);
    const env = {
      ...process.env, ...envBase(gerarCPF(700000005)), TEB_BANCO: join(pasta, 'comando.sqlite'), TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
    };
    const a = await executar(process.execPath, ['servidor/principal.js', 'garantir-plataforma'], { cwd: RAIZ, env });
    assert.match(a.stdout, /criada/);
    const b = await executar(process.execPath, ['servidor/principal.js', 'garantir-plataforma'], { cwd: RAIZ, env });
    assert.match(b.stdout, /já existe/);
    const c = await executar(process.execPath, ['servidor/principal.js', 'criar-plataforma'], { cwd: RAIZ, env });
    assert.match(c.stdout, /já existe/);
  });
});
