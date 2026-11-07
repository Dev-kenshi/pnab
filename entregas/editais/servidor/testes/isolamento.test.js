// Isolamento por organização (S5) e papéis (S6).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { corpoEdital, criarAmbiente, fichaValida, pdfMinimo } from './ajuda.js';

let amb, A, B;

async function upload(cliente, id, chave, bytes, nome = 'portfolio.pdf') {
  return cliente.pedir('POST', `/api/inscricoes/${id}/anexos/${chave}`, undefined, {
    bruto: bytes, cabecalhos: { 'content-type': 'application/pdf', 'x-nome-arquivo': encodeURIComponent(nome) },
  });
}

before(async () => {
  amb = await criarAmbiente();
  const c = amb.contas;
  A = { gestor: await amb.entrar(c.a.gestor), avaliador: await amb.entrar(c.a.avaliador), proponente: await amb.entrar(c.a.proponente) };
  B = { gestor: await amb.entrar(c.b.gestor), avaliador: await amb.entrar(c.b.avaliador), proponente: await amb.entrar(c.b.proponente) };

  A.slug = await amb.editalAberto(A.gestor, { numero: 'A-001/2026' });
  B.slug = await amb.editalAberto(B.gestor, { numero: 'B-001/2026' });
  A.rascunho = await A.gestor.pedir('POST', '/api/gestor/editais', { ...corpoEdital(amb.relogio), numero: 'A-RASC/2026' });

  const insA = await amb.inscricaoEnviada(A.proponente, A.slug);
  A.id = insA.id; A.protocolo = insA.protocolo;

  const rasc = await B.proponente.pedir('POST', '/api/inscricoes', { edital: B.slug, ficha: {} });
  B.id = rasc.corpo.inscricao.id;
  const up = await upload(B.proponente, B.id, 'extra-portfolio', pdfMinimo('B'));
  assert.equal(up.status, 201, JSON.stringify(up.corpo));
  B.anexo = up.corpo.anexo.id;
  const env = await B.proponente.pedir('POST', `/api/inscricoes/${B.id}/enviar`, { ficha: fichaValida() });
  assert.equal(env.status, 200, JSON.stringify(env.corpo));
  B.protocolo = env.corpo.inscricao.protocolo;

  assert.equal((await B.gestor.pedir('POST', `/api/gestor/inscricoes/${B.protocolo}/avaliador`, { avaliador: c.b.avaliador.id })).status, 200);
  assert.equal((await B.avaliador.pedir('POST', `/api/avaliador/inscricoes/${B.protocolo}/avaliacao`, { notas: { qualidade: 5, viabilidade: 5, 'bonus-regional': 0 }, parecer: 'Parecer B.' })).status, 201);
  assert.equal((await B.gestor.pedir('POST', `/api/gestor/editais/${B.slug}/encerrar`, {})).status, 200);
  assert.equal((await B.gestor.pedir('PUT', `/api/gestor/inscricoes/${B.protocolo}/resultado`, { resultado: 'nao_selecionado' })).status, 200);
  assert.equal((await B.gestor.pedir('POST', `/api/gestor/editais/${B.slug}/publicar-resultado`, {})).status, 200);
  amb.relogio.avancar(60 * 60 * 1000);
  const rec = await B.proponente.pedir('POST', `/api/inscricoes/${B.protocolo}/recurso`, { justificativa: 'Recurso B.' });
  assert.equal(rec.status, 201, JSON.stringify(rec.corpo));
  B.recurso = rec.corpo.recurso.id;
});

after(async () => { await amb?.fechar(); });

const naoEncontrado = (r, rotulo) => {
  assert.equal(r.status, 404, `${rotulo}: ${r.status} ${JSON.stringify(r.corpo)}`);
};

test('S5: ninguém da organização A lê o edital da B', async () => {
  for (const papel of ['gestor', 'avaliador', 'proponente']) {
    naoEncontrado(await A[papel].pedir('GET', `/api/editais/${B.slug}`), papel);
    assert.equal((await B[papel].pedir('GET', `/api/editais/${B.slug}`)).status, 200);
  }
  const lista = await A.gestor.pedir('GET', '/api/gestor/editais');
  assert.ok(lista.corpo.editais.every(e => e.slug !== B.slug));
  const painel = await A.proponente.pedir('GET', '/api/proponente/painel');
  assert.ok(painel.corpo.editaisAbertos.every(e => e.slug !== B.slug));
});

test('S5: gestor da A não altera edital da B', async () => {
  const corpo = corpoEdital(amb.relogio);
  naoEncontrado(await A.gestor.pedir('PUT', `/api/gestor/editais/${B.slug}`, corpo), 'salvar');
  for (const acao of ['abrir', 'encerrar', 'publicar-resultado']) naoEncontrado(await A.gestor.pedir('POST', `/api/gestor/editais/${B.slug}/${acao}`, {}), acao);
  const ed = await B.gestor.pedir('GET', `/api/editais/${B.slug}`);
  assert.equal(ed.corpo.edital.titulo, 'Edital de teste');
});

test('S5: inscrição da B é invisível e intocável para a A', async () => {
  naoEncontrado(await A.proponente.pedir('GET', `/api/inscricoes/${B.protocolo}`), 'por protocolo');
  naoEncontrado(await A.proponente.pedir('GET', `/api/inscricoes/${B.id}`), 'por id');
  naoEncontrado(await A.proponente.pedir('PUT', `/api/inscricoes/${B.id}`, { ficha: fichaValida() }), 'salvar');
  naoEncontrado(await A.proponente.pedir('POST', `/api/inscricoes/${B.id}/enviar`, { ficha: fichaValida() }), 'enviar');
  naoEncontrado(await upload(A.proponente, B.id, 'extra-portfolio', pdfMinimo()), 'anexo');
  naoEncontrado(await A.proponente.pedir('POST', '/api/inscricoes', { edital: B.slug, ficha: {} }), 'criar no edital da B');
  naoEncontrado(await A.gestor.pedir('POST', `/api/gestor/inscricoes/${B.protocolo}/avaliador`, { avaliador: amb.contas.a.avaliador.id }), 'atribuir');
  naoEncontrado(await A.gestor.pedir('PUT', `/api/gestor/inscricoes/${B.protocolo}/resultado`, { resultado: 'selecionado' }), 'resultado');
  naoEncontrado(await A.gestor.pedir('POST', `/api/gestor/inscricoes/${A.protocolo}/avaliador`, { avaliador: amb.contas.b.avaliador.id }), 'avaliador da B na A');
  naoEncontrado(await A.avaliador.pedir('GET', `/api/avaliador/inscricoes/${B.protocolo}`), 'avaliador lê');
  naoEncontrado(await A.avaliador.pedir('POST', `/api/avaliador/inscricoes/${B.protocolo}/avaliacao`, { notas: { qualidade: 1, viabilidade: 1, 'bonus-regional': 0 }, parecer: 'x' }), 'avaliador avalia');
  const lista = await A.gestor.pedir('GET', '/api/gestor/inscricoes');
  assert.deepEqual(lista.corpo.inscricoes.map(i => i.protocolo), [A.protocolo]);
});

test('S5: recurso da B não é decidido nem visto pela A', async () => {
  naoEncontrado(await A.gestor.pedir('POST', `/api/gestor/recursos/${B.recurso}/decisao`, { decisao: 'deferido', parecer: 'Tentativa.' }), 'decidir');
  naoEncontrado(await A.proponente.pedir('POST', `/api/inscricoes/${B.protocolo}/recurso`, { justificativa: 'x' }), 'recorrer');
  const lista = await A.gestor.pedir('GET', '/api/gestor/inscricoes?situacao=com-recurso');
  assert.equal(lista.corpo.inscricoes.length, 0);
  const daB = await B.gestor.pedir('GET', '/api/gestor/inscricoes?situacao=com-recurso');
  assert.equal(daB.corpo.inscricoes[0].recurso.situacao, 'Em análise');
});

test('S5: anexo da B só sai para quem tem acesso na B', async () => {
  for (const papel of ['gestor', 'avaliador', 'proponente']) naoEncontrado(await A[papel].pedir('GET', `/api/anexos/${B.anexo}`), papel);
  for (const papel of ['gestor', 'avaliador', 'proponente']) {
    const r = await B[papel].pedir('GET', `/api/anexos/${B.anexo}`);
    assert.equal(r.status, 200, papel);
    assert.equal(r.cabecalhos.get('content-type'), 'application/pdf');
    assert.match(r.cabecalhos.get('content-disposition'), /^attachment/);
    assert.deepEqual(r.bytes, pdfMinimo('B'));
  }
});

test('S6: proponente recebe 403 nas rotas de gestor, avaliador e plataforma', async () => {
  const rotas = [
    ['GET', '/api/gestor/editais'], ['POST', '/api/gestor/editais'], ['GET', '/api/gestor/inscricoes'], ['GET', '/api/gestor/avisos'],
    ['POST', `/api/gestor/editais/${A.slug}/encerrar`], ['POST', `/api/gestor/inscricoes/${A.protocolo}/avaliador`],
    ['GET', '/api/avaliador/inscricoes'], ['GET', '/api/plataforma/organizacoes'],
  ];
  for (const [m, rota] of rotas) {
    const r = await A.proponente.pedir(m, rota, m === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${m} ${rota}`);
    assert.equal(r.corpo.erro, 'sem_permissao');
  }
  assert.equal((await A.avaliador.pedir('GET', '/api/gestor/editais')).status, 403);
  assert.equal((await A.gestor.pedir('GET', '/api/plataforma/organizacoes')).status, 403);
  assert.equal((await A.gestor.pedir('GET', `/api/inscricoes/${A.protocolo}`)).status, 403);
});

test('S6: rascunho de edital só aparece para o gestor', async () => {
  const slug = A.rascunho.corpo.edital.slug;
  assert.equal((await A.gestor.pedir('GET', `/api/editais/${slug}`)).status, 200);
  naoEncontrado(await A.proponente.pedir('GET', `/api/editais/${slug}`), 'proponente');
  naoEncontrado(await A.proponente.pedir('POST', '/api/inscricoes', { edital: slug, ficha: {} }), 'inscrever em rascunho');
});

test('S6: avaliador só vê inscrição atribuída, sem dados de contato do proponente', async () => {
  let lista = await A.avaliador.pedir('GET', '/api/avaliador/inscricoes');
  assert.deepEqual(lista.corpo.inscricoes, []);
  naoEncontrado(await A.avaliador.pedir('GET', `/api/avaliador/inscricoes/${A.protocolo}`), 'não atribuída');
  assert.equal((await A.gestor.pedir('POST', `/api/gestor/inscricoes/${A.protocolo}/avaliador`, { avaliador: amb.contas.a.avaliador.id })).status, 200);
  lista = await A.avaliador.pedir('GET', '/api/avaliador/inscricoes');
  assert.deepEqual(lista.corpo.inscricoes.map(i => i.protocolo), [A.protocolo]);
  const det = await A.avaliador.pedir('GET', `/api/avaliador/inscricoes/${A.protocolo}`);
  assert.equal(det.status, 200);
  assert.equal(det.corpo.inscricao.criterios.length, 3);
  const p = det.corpo.inscricao.ficha.proponente;
  assert.equal(p.nome, 'proponente a');
  assert.equal(p.documento, undefined);
  assert.equal(p.email, undefined);
  assert.equal(p.telefone, undefined);
  naoEncontrado(await B.avaliador.pedir('GET', `/api/avaliador/inscricoes/${A.protocolo}`), 'avaliador de outra org');
});

test('S6: plataforma não lê inscrições e a lista de organizações não traz inscrição', async () => {
  const pl = await amb.entrar(amb.contas.plataforma);
  const rotas = [
    ['GET', `/api/inscricoes/${A.protocolo}`], ['GET', '/api/gestor/inscricoes'], ['GET', '/api/avaliador/inscricoes'],
    ['GET', `/api/anexos/${B.anexo}`], ['GET', '/api/proponente/painel'], ['POST', '/api/inscricoes'],
  ];
  for (const [m, rota] of rotas) assert.equal((await pl.pedir(m, rota, m === 'GET' ? undefined : {})).status, 403, rota);
  naoEncontrado(await pl.pedir('GET', `/api/editais/${A.slug}`), 'edital');
  const orgs = await pl.pedir('GET', '/api/plataforma/organizacoes');
  assert.equal(orgs.status, 200);
  assert.deepEqual(orgs.corpo.organizacoes.map(o => o.slug).sort(), ['org-a', 'org-b']);
  const texto = JSON.stringify(orgs.corpo);
  assert.ok(!/inscri|protocolo|TEB-/i.test(texto));
  assert.deepEqual(Object.keys(orgs.corpo.organizacoes[0]).sort(), ['gestores', 'nome', 'slug', 'totalEditais']);

  const nova = await pl.pedir('POST', '/api/plataforma/organizacoes', {
    nome: 'Organização C de teste', slug: 'org-c', gestor: { nome: 'Gestor C', documento: '935.411.347-80', email: 'c@teste.example', senha: 'Senha-boa-123' },
  });
  assert.equal(nova.status, 201, JSON.stringify(nova.corpo));
  const repetida = await pl.pedir('POST', '/api/plataforma/organizacoes', {
    nome: 'Outra', slug: 'org-c', gestor: { nome: 'G', documento: '11222333000181', email: 'g@teste.example', senha: 'Senha-boa-123' },
  });
  assert.equal(repetida.corpo.erro, 'slug_existente');
  const gC = amb.cliente();
  assert.equal((await gC.pedir('POST', '/api/acesso/entrar', { documento: '93541134780', senha: 'Senha-boa-123' })).status, 200);
  assert.deepEqual((await gC.pedir('GET', '/api/gestor/inscricoes')).corpo.inscricoes, []);
});
