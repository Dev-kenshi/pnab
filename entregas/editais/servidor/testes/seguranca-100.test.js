// As 100 validações de segurança do catálogo, ligadas ao manual Cybersecurity101 e ao NIST CSF 2.0.
// Rodam em ordem, num servidor real de teste com duas organizações. Lista completa em docs/seguranca.md.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { criarAmbiente, pdfMinimo, SENHA } from './ajuda.js';
import { CATALOGO } from './seguranca-catalogo.js';

const c = {};

before(async () => {
  c.amb = await criarAmbiente();
  c.https = await criarAmbiente({ https: true });
  const { contas } = c.amb;
  [c.gA, c.pA, c.avA, c.gB, c.pB, c.avB, c.plat] = await Promise.all([
    c.amb.entrar(contas.a.gestor), c.amb.entrar(contas.a.proponente), c.amb.entrar(contas.a.avaliador),
    c.amb.entrar(contas.b.gestor), c.amb.entrar(contas.b.proponente), c.amb.entrar(contas.b.avaliador), c.amb.entrar(contas.plataforma),
  ]);
  const login = await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: contas.b.proponente.documento, senha: SENHA });
  c.cookieLogin = login.setCookie[0];
  c.cab = (await c.amb.cliente().pedir('GET', '/api/sessao')).cabecalhos;
  c.slugA = await c.amb.editalAberto(c.gA);
  c.inscA = await c.amb.inscricaoEnviada(c.pA, c.slugA);
  const r = await c.pA.pedir('POST', '/api/inscricoes', { edital: c.slugA, ficha: { titulo: 'Rascunho de segurança' } });
  c.rascunhoA = r.corpo.inscricao.id;
  const up = await c.pA.pedir('POST', `/api/inscricoes/${c.rascunhoA}/anexos/extra-portfolio`, undefined, {
    bruto: pdfMinimo('anexo de A'), cabecalhos: { 'content-type': 'application/pdf', 'x-nome-arquivo': 'a.pdf' },
  });
  c.anexoA = up.corpo.anexo;
  c.chaveBackup = randomBytes(32);
});

after(async () => {
  await c.amb?.fechar();
  await c.https?.fechar();
});

test('o catálogo tem 100 validações com id, manual e NIST CSF', () => {
  assert.equal(CATALOGO.length, 100);
  assert.equal(new Set(CATALOGO.map(v => v.id)).size, 100);
  for (const v of CATALOGO) assert.ok(v.manual && /^(GV|ID|PR|DE|RS|RC)\.[A-Z]{2}-\d{2}$/.test(v.csf) && v.titulo, v.id);
});

for (const v of CATALOGO) test(`${v.id} [${v.csf}] ${v.titulo}`, () => v.fn(c));
