// Avaliação (S10) e recurso (S11).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DIA, criarAmbiente } from './ajuda.js';

let amb, gestor, avaliador, prop, slug, i1, i2, i3;

const notas = (q, v, b) => ({ qualidade: q, viabilidade: v, 'bonus-regional': b });
const avaliar = (protocolo, corpo) => avaliador.pedir('POST', `/api/avaliador/inscricoes/${protocolo}/avaliacao`, corpo);

before(async () => {
  amb = await criarAmbiente();
  gestor = await amb.entrar(amb.contas.a.gestor);
  avaliador = await amb.entrar(amb.contas.a.avaliador);
  prop = await amb.entrar(amb.contas.a.proponente);
  slug = await amb.editalAberto(gestor);
  i1 = await amb.inscricaoEnviada(prop, slug);
  i2 = await amb.inscricaoEnviada(prop, slug);
  i3 = await amb.inscricaoEnviada(prop, slug);
  for (const i of [i1, i2, i3]) {
    const r = await gestor.pedir('POST', `/api/gestor/inscricoes/${i.protocolo}/avaliador`, { avaliador: amb.contas.a.avaliador.id });
    assert.equal(r.status, 200);
  }
});
after(async () => { await amb?.fechar(); });

test('S10: nota acima do máximo, vazia, ausente ou negativa é recusada', async () => {
  let r = await avaliar(i1.protocolo, { notas: notas(11, 7, 0), parecer: 'Parecer.' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'nota_invalida');
  assert.deepEqual(r.corpo.campos.map(c => c.campo), ['qualidade']);
  r = await avaliar(i1.protocolo, { notas: notas(8, null, 0), parecer: 'Parecer.' });
  assert.deepEqual(r.corpo.campos.map(c => c.campo), ['viabilidade']);
  r = await avaliar(i1.protocolo, { notas: { qualidade: 8, viabilidade: 7 }, parecer: 'Parecer.' });
  assert.deepEqual(r.corpo.campos.map(c => c.campo), ['bonus-regional']);
  r = await avaliar(i1.protocolo, { notas: notas(8, 7, 3), parecer: 'Parecer.' });
  assert.deepEqual(r.corpo.campos.map(c => c.campo), ['bonus-regional']);
  r = await avaliar(i1.protocolo, { notas: notas(-1, 7, 0), parecer: 'Parecer.' });
  assert.deepEqual(r.corpo.campos.map(c => c.campo), ['qualidade']);
  r = await avaliar(i1.protocolo, { notas: notas(8, 7, 0), parecer: '  ' });
  assert.equal(r.corpo.erro, 'validacao');
  const det = await avaliador.pedir('GET', `/api/avaliador/inscricoes/${i1.protocolo}`);
  assert.equal(det.corpo.inscricao.avaliacao, null);
});

test('S10: zero no bônus é aceito e a nota geral é a soma', async () => {
  const r = await avaliar(i1.protocolo, { notas: notas(8, 7, 0), parecer: 'Parecer de teste.' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.avaliacao.notaGeral, 15);
  const bonus = r.corpo.avaliacao.notas.find(n => n.chave === 'bonus-regional');
  assert.equal(bonus.nota, 0);
  assert.equal(bonus.bonus, true);
  const denovo = await avaliar(i1.protocolo, { notas: notas(1, 1, 1), parecer: 'Outra.' });
  assert.equal(denovo.status, 409);
  assert.equal(denovo.corpo.erro, 'avaliacao_enviada');
  const lista = await avaliador.pedir('GET', '/api/avaliador/inscricoes');
  const item = lista.corpo.inscricoes.find(i => i.protocolo === i1.protocolo);
  assert.equal(item.avaliacaoEnviada, true);
  assert.equal(item.notaGeral, 15);
  const g = await gestor.pedir('GET', `/api/gestor/inscricoes?situacao=avaliada`);
  assert.deepEqual(g.corpo.inscricoes.map(i => [i.protocolo, i.notaGeral]), [[i1.protocolo, 15]]);
  const troca = await gestor.pedir('POST', `/api/gestor/inscricoes/${i1.protocolo}/avaliador`, { avaliador: amb.contas.a.avaliador.id });
  assert.equal(troca.corpo.erro, 'avaliacao_enviada');
  const visto = await prop.pedir('GET', `/api/inscricoes/${i1.protocolo}`);
  assert.equal(visto.corpo.inscricao.avaliacao, null);
  assert.equal(visto.corpo.inscricao.notaGeral, null);
  assert.equal((await avaliar(i2.protocolo, { notas: notas(9, 9, 2), parecer: 'Ótimo.' })).corpo.avaliacao.notaGeral, 20);
  assert.equal((await avaliar(i3.protocolo, { notas: notas(7.5, 7.5, 1), parecer: 'Bom.' })).corpo.avaliacao.notaGeral, 16);
});

test('S11: recurso antes do resultado é recusado', async () => {
  const r = await prop.pedir('POST', `/api/inscricoes/${i1.protocolo}/recurso`, { justificativa: 'Cedo demais.' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'fora_do_prazo');
});

test('publicar resultado exige edital encerrado e resultado de todas', async () => {
  assert.equal((await gestor.pedir('POST', `/api/gestor/editais/${slug}/publicar-resultado`, {})).corpo.erro, 'edital_nao_encerrado');
  assert.equal((await gestor.pedir('POST', `/api/gestor/editais/${slug}/encerrar`, {})).status, 200);
  assert.equal((await gestor.pedir('PUT', `/api/gestor/inscricoes/${i1.protocolo}/resultado`, { resultado: 'talvez' })).corpo.erro, 'validacao');
  assert.equal((await gestor.pedir('PUT', `/api/gestor/inscricoes/${i1.protocolo}/resultado`, { resultado: 'nao_selecionado' })).status, 200);
  assert.equal((await gestor.pedir('PUT', `/api/gestor/inscricoes/${i2.protocolo}/resultado`, { resultado: 'selecionado' })).status, 200);
  assert.equal((await gestor.pedir('POST', `/api/gestor/editais/${slug}/publicar-resultado`, {})).corpo.erro, 'resultado_incompleto');
  assert.equal((await gestor.pedir('PUT', `/api/gestor/inscricoes/${i3.protocolo}/resultado`, { resultado: 'suplente' })).status, 200);
  const pub = await gestor.pedir('POST', `/api/gestor/editais/${slug}/publicar-resultado`, {});
  assert.equal(pub.status, 200);
  assert.ok(pub.corpo.edital.resultadoPublicadoEm);
  assert.equal(new Date(pub.corpo.edital.prazoRecursoAte) - new Date(pub.corpo.edital.resultadoPublicadoEm), 15 * DIA);
  assert.equal((await gestor.pedir('POST', `/api/gestor/editais/${slug}/publicar-resultado`, {})).corpo.erro, 'ja_publicado');
  assert.equal((await gestor.pedir('PUT', `/api/gestor/inscricoes/${i1.protocolo}/resultado`, { resultado: 'selecionado' })).corpo.erro, 'ja_publicado');

  const v1 = (await prop.pedir('GET', `/api/inscricoes/${i1.protocolo}`)).corpo.inscricao;
  assert.equal(v1.selo, 'Não aprovado');
  assert.equal(v1.notaGeral, 15);
  assert.equal(v1.avaliacao.notaGeral, 15);
  assert.equal(v1.recursoPermitido, true);
  const v2 = (await prop.pedir('GET', `/api/inscricoes/${i2.protocolo}`)).corpo.inscricao;
  assert.equal(v2.selo, 'Selecionado');
  assert.equal(v2.etapas[3].estado, 'atual');
  const v3 = (await prop.pedir('GET', `/api/inscricoes/${i3.protocolo}`)).corpo.inscricao;
  assert.equal(v3.etapas[3].nome, 'Suplente');
  const painel = (await prop.pedir('GET', '/api/proponente/painel')).corpo;
  assert.deepEqual(painel.contadores, { enviados: 3, andamento: 2, concluidos: 0, naoAprovados: 1 });
  assert.equal(painel.historico[0].editais[0].slug, slug);
});

test('S11: recurso só do dono, com justificativa, um por inscrição', async () => {
  const vazio = await prop.pedir('POST', `/api/inscricoes/${i1.protocolo}/recurso`, { justificativa: '' });
  assert.equal(vazio.corpo.erro, 'validacao');
  const intruso = amb.cliente();
  await intruso.pedir('POST', '/api/acesso/criar-conta', {
    organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'Intruso', documento: '93541134780', email: 'i@teste.example',
    telefone: '71900000000', senha: 'Senha-boa-123', senhaConfirmacao: 'Senha-boa-123',
  });
  assert.equal((await intruso.pedir('POST', `/api/inscricoes/${i1.protocolo}/recurso`, { justificativa: 'Não é meu.' })).status, 404);
  const propB = await amb.entrar(amb.contas.b.proponente);
  assert.equal((await propB.pedir('POST', `/api/inscricoes/${i1.protocolo}/recurso`, { justificativa: 'Outra org.' })).status, 404);
  const r = await prop.pedir('POST', `/api/inscricoes/${i1.protocolo}/recurso`, { justificativa: 'Peço revisão da nota.' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.recurso.situacao, 'Em análise');
  assert.equal(r.corpo.recurso.protocolo, i1.protocolo);
  const segundo = await prop.pedir('POST', `/api/inscricoes/${i1.protocolo}/recurso`, { justificativa: 'De novo.' });
  assert.equal(segundo.status, 409);
  assert.equal(segundo.corpo.erro, 'recurso_existente');
  const visto = (await prop.pedir('GET', `/api/inscricoes/${i1.protocolo}`)).corpo.inscricao;
  assert.equal(visto.recurso.situacao, 'Em análise');
  assert.equal(visto.recursoPermitido, false);
});

test('S11: só o gestor da organização decide, e com parecer', async () => {
  const lista = await gestor.pedir('GET', '/api/gestor/inscricoes?situacao=com-recurso');
  const recursoId = lista.corpo.inscricoes[0].recurso.id;
  assert.equal((await prop.pedir('POST', `/api/gestor/recursos/${recursoId}/decisao`, { decisao: 'deferido', parecer: 'Eu mesmo.' })).status, 403);
  assert.equal((await avaliador.pedir('POST', `/api/gestor/recursos/${recursoId}/decisao`, { decisao: 'deferido', parecer: 'Eu.' })).status, 403);
  const gestorB = await amb.entrar(amb.contas.b.gestor);
  assert.equal((await gestorB.pedir('POST', `/api/gestor/recursos/${recursoId}/decisao`, { decisao: 'deferido', parecer: 'Outra org.' })).status, 404);
  const sem = await gestor.pedir('POST', `/api/gestor/recursos/${recursoId}/decisao`, { decisao: 'indeferido', parecer: '' });
  assert.equal(sem.status, 400);
  assert.equal(sem.corpo.erro, 'validacao');
  const ok = await gestor.pedir('POST', `/api/gestor/recursos/${recursoId}/decisao`, { decisao: 'indeferido', parecer: 'Nota mantida.' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.recurso.situacao, 'Indeferido');
  assert.equal(ok.corpo.recurso.parecer, 'Nota mantida.');
  const denovo = await gestor.pedir('POST', `/api/gestor/recursos/${recursoId}/decisao`, { decisao: 'deferido', parecer: 'Mudei.' });
  assert.equal(denovo.corpo.erro, 'ja_decidido');
  const visto = (await prop.pedir('GET', `/api/inscricoes/${i1.protocolo}`)).corpo.inscricao;
  assert.equal(visto.recurso.situacao, 'Indeferido');
});

test('S11: recurso depois de 15 dias é recusado', async () => {
  amb.relogio.avancar(15 * DIA + 60 * 1000);
  const p = await amb.entrar(amb.contas.a.proponente);
  const v = (await p.pedir('GET', `/api/inscricoes/${i3.protocolo}`)).corpo.inscricao;
  assert.equal(v.recursoPermitido, false);
  const r = await p.pedir('POST', `/api/inscricoes/${i3.protocolo}/recurso`, { justificativa: 'Tarde demais.' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'fora_do_prazo');
});
