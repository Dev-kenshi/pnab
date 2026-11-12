// Correções da revisão dos commits feitos no PC (trabalho/editais/testes-pc.md, falhas 1 a 5).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { criarApi } from '../../js/api.js';
import { somenteDigitos } from '../../js/regras.js';
import { abrirBanco } from '../banco.js';
import { fazerBackup } from '../backup/rotina.js';
import { inserirUsuario } from '../rotas/acesso.js';
import { SENHA, criarAmbiente, gerarCPF } from './ajuda.js';

let semApelido, comApelido;
before(async () => {
  semApelido = await criarAmbiente();
  comApelido = await criarAmbiente({ loginPlataforma: 'admin' });
});
after(async () => {
  await semApelido?.fechar();
  await comApelido?.fechar();
});

test('falhas 1 e 2: modo.json diz se o usuário de teste está ligado, sem revelar qual é', async () => {
  const des = await (await fetch(`${semApelido.base}/modo.json`)).json();
  const lig = await (await fetch(`${comApelido.base}/modo.json`)).json();
  assert.deepEqual(des, { modo: 'servidor', loginUsuario: false });
  assert.deepEqual(lig, { modo: 'servidor', loginUsuario: true });
  assert.ok(!JSON.stringify(lig).includes('admin'));
});

const memoria = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('falhas 1 e 2: a api só aceita usuário de teste no modo servidor com o recurso ligado', () => {
  assert.equal(criarApi({ modo: 'servidor', loginUsuario: true, fetch: async () => {} }).loginUsuario, true);
  assert.equal(criarApi({ modo: 'servidor', fetch: async () => {} }).loginUsuario, false);
  assert.equal(criarApi({ modo: 'demonstracao', loginUsuario: true, armazenamento: memoria(), fetch: async () => {} }).loginUsuario, false);
});

test('falha 3: trava do backup solta quando a limpeza de sobras falha', async t => {
  const { execFileSync } = await import('node:child_process');
  const pasta = await mkdtemp(join(tmpdir(), 'teb-trava-'));
  const banco = await abrirBanco({ caminho: join(pasta, 'b.sqlite') });
  const pastaTemp = join(pasta, 'tmp');
  const preso = join(pastaTemp, 'bkp-sobra', 'preso');
  let imutavel = false;
  try {
    await mkdir(join(pastaTemp, 'bkp-sobra'), { recursive: true });
    await writeFile(preso, 'sobra que não pode ser apagada');
    // Arquivo imutável: nem o root apaga. Simula um antivírus segurando o arquivo.
    try { execFileSync('chattr', ['+i', preso], { stdio: 'ignore' }); imutavel = true; } catch { /* sem chattr */ }
    if (!imutavel) { t.skip('chattr indisponível nesta máquina'); return; }
    const destino = { nome: 'falso', guardaAnexos: false, enviar: async () => {}, listar: async () => [], apagar: async () => {} };
    await assert.rejects(fazerBackup({ banco, pastaAnexos: null, chave: randomBytes(32), destinos: [destino], pastaTemp }));
    assert.ok(!(await readdir(pastaTemp)).includes('backup.trava'), 'a trava ficou presa');
  } finally {
    if (imutavel) execFileSync('chattr', ['-i', preso], { stdio: 'ignore' });
    await banco.fechar();
    await rm(pasta, { recursive: true, force: true });
  }
});

test('falha 4: o apelido não entra numa conta que não é da plataforma', async () => {
  // Ambiente com o apelido apontando para o CPF de um gestor (configuração errada).
  const amb = await criarAmbiente({ loginPlataforma: 'admin' });
  try {
    const { banco, contas } = amb;
    const docPlataforma = contas.plataforma.documento;
    // Troca os papéis: o documento do apelido passa a ser de um gestor.
    await banco.executar("UPDATE usuarios SET papel = 'gestor', organizacao_id = ? WHERE documento = ?", [contas.a.orgId, docPlataforma]);
    const r = await amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: 'admin', senha: SENHA });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro, 'senha_incorreta');
    // O mesmo documento, digitado como CPF, continua entrando normalmente como gestor.
    const pelo = await amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: docPlataforma, senha: SENHA });
    assert.equal(pelo.status, 200);
    assert.equal(pelo.corpo.usuario.papel, 'gestor');
  } finally {
    await amb.fechar();
  }
});

test('falha 5: objeto no lugar do documento dá 400, nunca 500', async () => {
  assert.equal(somenteDigitos({ toString: 'x' }), '');
  assert.equal(somenteDigitos(['1', '2']), '');
  assert.equal(somenteDigitos(true), '');
  assert.equal(somenteDigitos(12345), '12345');
  for (const rota of ['/api/acesso/documento', '/api/acesso/entrar', '/api/acesso/esqueci-senha', '/api/acesso/criar-conta']) {
    const r = await semApelido.cliente().pedir('POST', rota, { documento: { toString: 'x' }, senha: 'x' });
    assert.ok(r.status >= 400 && r.status < 500, `${rota}: ${r.status}`);
  }
});

test('falha 4: usuário de outro papel criado com o CPF do apelido também é recusado', async () => {
  const amb = await criarAmbiente({ loginPlataforma: 'admin' });
  try {
    // Garante que o caminho comum (conta da plataforma certa) segue entrando.
    const ok = await amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: 'admin', senha: SENHA });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.usuario.papel, 'plataforma');
    const docOutro = gerarCPF(990000001);
    await inserirUsuario(amb.banco, { organizacaoId: amb.contas.a.orgId, papel: 'avaliador', nome: 'Outro', documento: docOutro, email: 'o@teste.example', senha: SENHA, agora: amb.relogio.agora() });
    assert.equal((await amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: 'root', senha: SENHA })).status, 400);
  } finally {
    await amb.fechar();
  }
});
