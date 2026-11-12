// Exemplo no servidor real (TEB_SEMEAR_EXEMPLO e TEB_EXEMPLO_SENHA): criação idempotente e telas pela API.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as regras from '../../js/regras.js';
import { CONTAS_EXEMPLO, ORG_EXEMPLO, semearExemplo } from '../exemplo.js';
import { DOCUMENTOS_RESERVADOS, verificarSenha } from '../seguranca.js';
import { criarAmbiente } from './ajuda.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENHA_EXEMPLO = 'Frase-longa-de-teste-41';
const executar = promisify(execFile);

const contar = async (banco, sql, params = []) => Number((await banco.executar(sql, params)).linhas[0].n);

describe('semearExemplo', () => {
  let amb, r1, r2;
  before(async () => {
    amb = await criarAmbiente();
    r1 = await semearExemplo(amb.banco, { senha: SENHA_EXEMPLO, agora: amb.relogio.agora() });
    r2 = await semearExemplo(amb.banco, { senha: SENHA_EXEMPLO, agora: amb.relogio.agora() });
  });
  after(async () => { await amb?.fechar(); });

  async function entrar(papel) {
    const c = amb.cliente();
    const r = await c.pedir('POST', '/api/acesso/entrar', { documento: CONTAS_EXEMPLO[papel].documento, senha: SENHA_EXEMPLO });
    assert.equal(r.status, 200, `${papel}: ${JSON.stringify(r.corpo)}`);
    assert.equal(r.corpo.usuario.papel, papel);
    assert.equal(r.corpo.usuario.organizacao.slug, ORG_EXEMPLO.slug);
    return c;
  }

  test('cria organização, contas, editais, inscrições, notas, recurso e aviso', async () => {
    assert.equal(r1.criada, true);
    const b = amb.banco;
    const org = (await b.executar('SELECT id, nome FROM organizacoes WHERE slug = ?', [ORG_EXEMPLO.slug])).linhas[0];
    assert.equal(org.nome, 'Fundação Cultural Exemplo (teste)');
    assert.equal(await contar(b, 'SELECT COUNT(*) AS n FROM usuarios WHERE organizacao_id = ?', [org.id]), 3);
    assert.equal(await contar(b, 'SELECT COUNT(*) AS n FROM editais WHERE organizacao_id = ?', [org.id]), 2);
    assert.equal(await contar(b, 'SELECT COUNT(*) AS n FROM inscricoes WHERE organizacao_id = ?', [org.id]), 4);
    assert.equal(await contar(b, 'SELECT COUNT(*) AS n FROM avaliacoes WHERE organizacao_id = ?', [org.id]), 3);
    assert.equal(await contar(b, "SELECT COUNT(*) AS n FROM recursos WHERE organizacao_id = ? AND situacao = 'Em análise'", [org.id]), 1);
    assert.equal(await contar(b, 'SELECT COUNT(*) AS n FROM avisos WHERE organizacao_id = ? AND ativo = 1', [org.id]), 1);
    const { linhas } = await b.executar('SELECT nome, email, senha_hash FROM usuarios WHERE organizacao_id = ?', [org.id]);
    for (const u of linhas) {
      assert.match(u.nome, /\(exemplo\)/);
      assert.match(u.email, /@teb\.example$/);
      assert.match(u.senha_hash, /^scrypt\$/);
      assert.ok(!u.senha_hash.includes(SENHA_EXEMPLO));
      assert.equal(await verificarSenha(SENHA_EXEMPLO, u.senha_hash), true);
    }
  });

  test('é idempotente: a segunda vez não duplica nada', async () => {
    assert.equal(r2.criada, false);
    assert.deepEqual(r2.contas, r1.contas);
    const r3 = await semearExemplo(amb.banco, { senha: SENHA_EXEMPLO, agora: amb.relogio.agora() });
    assert.equal(r3.criada, false);
    const b = amb.banco;
    assert.equal(await contar(b, 'SELECT COUNT(*) AS n FROM organizacoes WHERE slug = ?', [ORG_EXEMPLO.slug]), 1);
    const docs = Object.values(CONTAS_EXEMPLO).map(c => c.documento);
    assert.equal(await contar(b, `SELECT COUNT(*) AS n FROM usuarios WHERE documento IN (${docs.map(() => '?').join(',')})`, docs), 3);
    assert.equal(await contar(b, "SELECT COUNT(*) AS n FROM inscricoes WHERE id LIKE 'exemplo-%'"), 4);
    assert.equal(await contar(b, "SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'exemplo_semeado'"), 1);
  });

  test('nenhum CPF do exemplo é reservado e todos são válidos e diferentes', () => {
    const docs = r1.contas.map(c => c.documento);
    assert.equal(new Set(docs).size, 3);
    for (const d of docs) {
      assert.equal(regras.validarCPF(d), true, d);
      assert.equal(DOCUMENTOS_RESERVADOS.has(d), false, d);
    }
  });

  test('proponente vê contadores, 4 inscrições em etapas diferentes, notas, recurso, abas e aviso', async () => {
    const c = await entrar('proponente');
    const p = await c.pedir('GET', '/api/proponente/painel');
    assert.equal(p.status, 200);
    assert.deepEqual(p.corpo.contadores, { enviados: 4, andamento: 3, concluidos: 0, naoAprovados: 1 });
    assert.equal(p.corpo.inscricoes.length, 4);
    assert.ok(p.corpo.aviso?.texto);
    assert.equal(p.corpo.editaisAbertos.length, 1);
    const atual = i => i.etapas.find(e => e.estado === 'atual')?.nome;
    for (const i of p.corpo.inscricoes) assert.equal(i.etapas.length, 7);
    assert.deepEqual(p.corpo.inscricoes.map(atual).sort(), ['Avaliação', 'Habilitação', 'Resultado', 'Suplente']);

    const porTitulo = Object.fromEntries(p.corpo.inscricoes.map(i => [i.titulo, i]));
    const ver = async t => (await c.pedir('GET', `/api/inscricoes/${porTitulo[t].protocolo}`)).corpo.inscricao;
    const a = await ver('Projeto Exemplo A (exemplo)');
    assert.equal(a.selo, 'Enviado');
    assert.equal(a.avaliacao, null);
    const bb = await ver('Projeto Exemplo B (exemplo)');
    assert.equal(bb.selo, 'Suplente');
    assert.equal(bb.avaliacao.notaGeral, 17);
    assert.ok(bb.avaliacao.parecer);
    const cc = await ver('Projeto Exemplo C (exemplo)');
    assert.equal(cc.selo, 'Não aprovado');
    assert.equal(cc.recurso.situacao, 'Em análise');
    assert.equal(cc.recursoPermitido, false);
    assert.ok(new Date(cc.prazoRecursoAte) > amb.relogio.agora(), 'recurso dentro do prazo');
    const d = await ver('Projeto Exemplo D (exemplo)');
    assert.equal(d.selo, 'Selecionado');
    assert.deepEqual(d.abas, { habilitacao: true, termo: false });
  });

  test('avaliador vê a inscrição atribuída ainda sem nota', async () => {
    const c = await entrar('avaliador');
    const r = await c.pedir('GET', '/api/avaliador/inscricoes');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.inscricoes.length, 4);
    const pendentes = r.corpo.inscricoes.filter(i => !i.avaliacaoEnviada);
    assert.equal(pendentes.length, 1);
    assert.equal(pendentes[0].titulo, 'Projeto Exemplo A (exemplo)');
    const det = await c.pedir('GET', `/api/avaliador/inscricoes/${pendentes[0].protocolo}`);
    assert.equal(det.status, 200);
    assert.equal(det.corpo.inscricao.avaliacao, null);
    assert.equal(det.corpo.inscricao.ficha.proponente.documento, undefined);
  });

  test('gestor vê os editais, as inscrições e o recurso', async () => {
    const c = await entrar('gestor');
    const ed = await c.pedir('GET', '/api/gestor/editais');
    assert.equal(ed.status, 200);
    assert.deepEqual(ed.corpo.editais.map(e => e.situacao).sort(), ['aberto', 'encerrado']);
    assert.ok(ed.corpo.editais.find(e => e.situacao === 'encerrado').resultadoPublicadoEm);
    const ins = await c.pedir('GET', '/api/gestor/inscricoes');
    assert.equal(ins.corpo.inscricoes.length, 4);
    const rec = await c.pedir('GET', '/api/gestor/inscricoes?situacao=com-recurso');
    assert.equal(rec.corpo.inscricoes.length, 1);
    const av = await c.pedir('GET', '/api/gestor/avisos');
    assert.equal(av.corpo.avisos.length, 1);
  });

  test('isolamento: o proponente de outra organização não vê o exemplo', async () => {
    const c = await amb.entrar(amb.contas.a.proponente);
    const p = await c.pedir('GET', '/api/proponente/painel');
    assert.equal(p.corpo.inscricoes.length, 0);
  });
});

describe('validação da senha do exemplo', () => {
  test('senha fraca, curta, de demonstração ou vazia é recusada sem gravar nada', async () => {
    const amb = await criarAmbiente();
    try {
      for (const senha of ['', 'curta', 'Exemplo#2026', 'senha123456789', undefined]) {
        await assert.rejects(semearExemplo(amb.banco, { senha, agora: amb.relogio.agora() }), Error, String(senha));
      }
      assert.equal(await contar(amb.banco, 'SELECT COUNT(*) AS n FROM organizacoes WHERE slug = ?', [ORG_EXEMPLO.slug]), 0);
      assert.equal(await contar(amb.banco, "SELECT COUNT(*) AS n FROM usuarios WHERE email LIKE '%exemplo@teb.example'"), 0);
    } finally {
      await amb.fechar();
    }
  });
});

describe('comando semear-exemplo e subida', () => {
  let pasta;
  before(async () => { pasta = await mkdtemp(join(tmpdir(), 'teb-exemplo-')); });
  after(async () => { await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const envBase = extra => ({
    ...process.env, TEB_BANCO: join(pasta, 'comando.sqlite'), TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
    TEB_EXEMPLO_SENHA: '', TEB_SEMEAR_EXEMPLO: '', TEB_PLATAFORMA_SENHA: '', TEB_PLATAFORMA_LOGIN: '', ...extra,
  });

  test('sem TEB_EXEMPLO_SENHA sai com mensagem clara', async () => {
    const e = await executar(process.execPath, ['servidor/principal.js', 'semear-exemplo'], { cwd: RAIZ, env: envBase() }).then(() => null, x => x);
    assert.ok(e, 'deveria sair com erro');
    assert.equal(e.code, 1);
    assert.match(e.stderr, /TEB_EXEMPLO_SENHA/);
  });

  test('com a senha cria, imprime os CPFs e nunca a senha; a segunda vez só avisa', async () => {
    const env = envBase({ TEB_EXEMPLO_SENHA: SENHA_EXEMPLO });
    const a = await executar(process.execPath, ['servidor/principal.js', 'semear-exemplo'], { cwd: RAIZ, env });
    assert.match(a.stdout, /Exemplo criado/);
    for (const c of Object.values(CONTAS_EXEMPLO)) assert.ok(a.stdout.includes(regras.formatarDocumento(c.documento)), c.documento);
    assert.ok(!a.stdout.includes(SENHA_EXEMPLO) && !a.stderr.includes(SENHA_EXEMPLO));
    const b = await executar(process.execPath, ['servidor/principal.js', 'semear-exemplo'], { cwd: RAIZ, env });
    assert.match(b.stdout, /já existe/);
  });

  test('subida com TEB_SEMEAR_EXEMPLO=1 e senha inválida para com mensagem clara', async () => {
    const env = envBase({
      TEB_BANCO: join(pasta, 'subida.sqlite'), TEB_CHAVE_ANEXOS: randomBytes(32).toString('base64'), TEB_ANEXOS: join(pasta, 'anexos'),
      PORTA: '0', TEB_SEMEAR_EXEMPLO: '1', TEB_EXEMPLO_SENHA: 'curta',
    });
    const e = await executar(process.execPath, ['servidor/principal.js'], { cwd: RAIZ, env, timeout: 30000 }).then(() => null, x => x);
    assert.ok(e, 'deveria parar');
    assert.equal(e.code, 1);
    assert.match(e.stderr, /\[exemplo\] TEB_EXEMPLO_SENHA/);
    const sem = await executar(process.execPath, ['servidor/principal.js'], { cwd: RAIZ, env: { ...env, TEB_EXEMPLO_SENHA: '' }, timeout: 30000 }).then(() => null, x => x);
    assert.equal(sem?.code, 1);
    assert.match(sem.stderr, /TEB_SEMEAR_EXEMPLO=1 exige TEB_EXEMPLO_SENHA/);
  });
});
