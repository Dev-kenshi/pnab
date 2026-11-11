// Auditoria (S13): cada ação da lista gera uma linha e nenhuma linha guarda senha ou token.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ACOES } from '../auditoria.js';
import { SENHA, corpoEdital, criarAmbiente, fichaValida } from './ajuda.js';

let amb;
before(async () => { amb = await criarAmbiente(); });
after(async () => { await amb?.fechar(); });

const SENHA_NOVA = 'Senha-Unica-Auditoria-77';
const SENHA_ERRADA = 'Errada-Unica-Auditoria-55';
const SENHA_REDEFINIDA = 'Redefinida-Unica-Auditoria-33';
const SENHA_AVALIADOR = 'Avaliador-Unico-Auditoria-11';

async function contar(acao) {
  const { linhas } = await amb.banco.executar('SELECT COUNT(*) AS n FROM auditoria WHERE acao = ?', [acao]);
  return Number(linhas[0].n);
}

test('S13: cada ação gera uma linha de auditoria', async () => {

  const gestor = await amb.entrar(amb.contas.a.gestor);
  const avaliador = await amb.entrar(amb.contas.a.avaliador);
  const prop = await amb.entrar(amb.contas.a.proponente);
  assert.equal(await contar('login'), 3);

  const anon = amb.cliente();
  for (let i = 0; i < 5; i++) await anon.pedir('POST', '/api/acesso/entrar', { documento: amb.contas.b.gestor.documento, senha: SENHA_ERRADA });
  assert.equal(await contar('login_falha'), 5);
  assert.equal((await anon.pedir('POST', '/api/acesso/entrar', { documento: amb.contas.b.gestor.documento, senha: SENHA })).status, 429);
  assert.equal(await contar('login_bloqueado'), 1);

  const nova = await amb.cliente().pedir('POST', '/api/acesso/criar-conta', {
    organizacao: 'org-a', natureza: 'Pessoa Jurídica', nome: 'Empresa de teste', documento: '11.222.333/0001-81', email: 'e@teste.example',
    telefone: '7130000000', senha: SENHA_NOVA, senhaConfirmacao: SENHA_NOVA,
  });
  assert.equal(nova.status, 201);
  assert.equal(await contar('conta_criada'), 1);
  const av = await gestor.pedir('POST', '/api/gestor/avaliadores', { nome: 'Avaliador novo', documento: '935.411.347-80', email: 'av@teste.example', senha: SENHA_AVALIADOR });
  assert.equal(av.status, 201);
  assert.equal(await contar('conta_criada'), 2);

  const criado = await gestor.pedir('POST', '/api/gestor/editais', corpoEdital(amb.relogio, { numero: 'AUD-1/2026' }));
  assert.equal(await contar('edital_criado'), 1);
  const slug = criado.corpo.edital.slug;
  await gestor.pedir('PUT', `/api/gestor/editais/${slug}`, corpoEdital(amb.relogio, { numero: 'AUD-1/2026', titulo: 'Título alterado' }));
  assert.equal(await contar('edital_alterado'), 1);
  await gestor.pedir('POST', `/api/gestor/editais/${slug}/abrir`, {});
  assert.equal(await contar('edital_aberto'), 1);

  const { protocolo } = await amb.inscricaoEnviada(prop, slug, fichaValida());
  assert.equal(await contar('inscricao_enviada'), 1);
  const linhaEnvio = (await amb.banco.executar("SELECT * FROM auditoria WHERE acao = 'inscricao_enviada'")).linhas[0];
  assert.equal(linhaEnvio.alvo, protocolo);
  assert.equal(linhaEnvio.usuario_id, amb.contas.a.proponente.id);
  assert.equal(linhaEnvio.organizacao_id, amb.contas.a.orgId);
  assert.ok(linhaEnvio.ip);
  assert.ok(linhaEnvio.quando);

  await gestor.pedir('POST', `/api/gestor/inscricoes/${protocolo}/avaliador`, { avaliador: amb.contas.a.avaliador.id });
  await avaliador.pedir('POST', `/api/avaliador/inscricoes/${protocolo}/avaliacao`, { notas: { qualidade: 8, viabilidade: 7, 'bonus-regional': 0 }, parecer: 'Ok.' });
  assert.equal(await contar('avaliacao_enviada'), 1);

  await gestor.pedir('POST', `/api/gestor/editais/${slug}/encerrar`, {});
  assert.equal(await contar('edital_encerrado'), 1);
  await gestor.pedir('PUT', `/api/gestor/inscricoes/${protocolo}/resultado`, { resultado: 'nao_selecionado' });
  await gestor.pedir('POST', `/api/gestor/editais/${slug}/publicar-resultado`, {});
  assert.equal(await contar('resultado_publicado'), 1);

  const rec = await prop.pedir('POST', `/api/inscricoes/${protocolo}/recurso`, { justificativa: 'Revisão.' });
  await gestor.pedir('POST', `/api/gestor/recursos/${rec.corpo.recurso.id}/decisao`, { decisao: 'deferido', parecer: 'Aceito.' });
  assert.equal(await contar('recurso_decidido'), 1);

  for (const acao of ACOES) assert.ok((await contar(acao)) >= 1, `sem linha para ${acao}`);
});

test('S13: nenhuma linha de auditoria contém senha ou token', async () => {
  const p = amb.cliente();
  await p.pedir('POST', '/api/acesso/esqueci-senha', { documento: '11222333000181' });
  await new Promise(ok => setImmediate(ok));
  const token = amb.emails.at(-1).token;
  assert.equal((await p.pedir('POST', '/api/acesso/redefinir', { token, senha: SENHA_REDEFINIDA, senhaConfirmacao: SENHA_REDEFINIDA })).status, 204);
  assert.equal((await p.pedir('POST', '/api/acesso/entrar', { documento: '11222333000181', senha: SENHA_REDEFINIDA })).status, 200);
  await p.pedir('PUT', '/api/conta/senha', { senhaAtual: SENHA_REDEFINIDA, novaSenha: `${SENHA_NOVA}-2`, novaSenhaConfirmacao: `${SENHA_NOVA}-2` });

  const { linhas } = await amb.banco.executar('SELECT * FROM auditoria');
  assert.ok(linhas.length > 15);
  const tudo = JSON.stringify(linhas);
  for (const segredo of [SENHA, SENHA_NOVA, SENHA_ERRADA, SENHA_REDEFINIDA, SENHA_AVALIADOR, token]) {
    assert.ok(!tudo.includes(segredo), `auditoria contém ${segredo.slice(0, 6)}`);
  }
  const { linhas: sessoes } = await amb.banco.executar('SELECT token_hash FROM sessoes');
  assert.ok(sessoes.length > 0);
  assert.ok(!/senha_hash|scrypt\$/.test(tudo));
});
