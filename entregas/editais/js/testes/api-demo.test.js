// Testes do modo demonstração, sem navegador e sem rede.
// localStorage simulado em memória, relógio fixo e fetch simulado.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErroApi, criarApi } from '../api.js';
import { CHAVE_BANCO, CHAVE_SESSAO, criarDemo } from '../api-demo.js';
import { SENHA_EXEMPLO, semear } from '../semente.js';
import * as regras from '../regras.js';

const MARINA = '52998224725';
const GESTOR = '11144477735';
const AVALIADORA = '39053344705';
const PLATAFORMA = '16899535009';
const NOVO_CPF = '93541134780';
const HORA = 60 * 60 * 1000;

function memoria() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _mapa: m,
  };
}

function relogio(inicio = '2026-11-07T15:00:00.000Z') {
  let t = new Date(inicio).getTime();
  const f = () => new Date(t);
  f.avancar = ms => { t += ms; };
  return f;
}

function montar({ fetch, armazenamento = memoria(), agora = relogio() } = {}) {
  const api = criarApi({ modo: 'demonstracao', armazenamento, agora, fetch: fetch || (async () => { throw new Error('sem rede nos testes'); }) });
  return { api, armazenamento, agora };
}

async function erroDe(promessa) {
  try { await promessa; } catch (e) { return e; }
  assert.fail('A chamada deveria ter falhado.');
}

async function entrarComo(api, documento) {
  return api.entrar(documento, SENHA_EXEMPLO);
}

const FICHA_COMPLETA = {
  titulo: 'Oficina Exemplo de Teatro',
  categoria: 'Teatro',
  cota: 'Ampla concorrência',
  extras: { 'extra-resumo': 'Resumo de exemplo fictício do projeto.' },
  metas: [{ etapa: 'Ensaios', inicio: '', fim: '', acao: 'Realizar 10 ensaios abertos' }],
  equipe: [],
  orcamento: [],
  aceite: true,
};

test('modo.json declara demonstração e api expõe o modo', async () => {
  const { api } = montar();
  assert.equal(api.modo, 'demonstracao');
  const { readFile } = await import('node:fs/promises');
  const j = JSON.parse(await readFile(new URL('../../modo.json', import.meta.url), 'utf8'));
  assert.deepEqual(j, { modo: 'demonstracao' });
});

test('semente: contas, datas relativas, protocolos e nenhuma senha em texto', async () => {
  const hoje = new Date('2026-11-07T15:00:00.000Z');
  const db = await semear(hoje);
  assert.deepEqual(db.usuarios.map(u => u.documento), [MARINA, GESTOR, AVALIADORA, PLATAFORMA]);
  for (const u of db.usuarios) {
    assert.ok(regras.validarCPF(u.documento));
    assert.ok(u.email.endsWith('@teb.example'));
    assert.ok(u.nome.includes('exemplo fictício'));
    assert.ok(!JSON.stringify(u).includes(SENHA_EXEMPLO));
  }
  assert.deepEqual(db.inscricoes.map(i => i.protocolo), ['TEB-2026-000101', 'TEB-2026-000102', 'TEB-2026-000103', 'TEB-2026-000104']);
  assert.equal(db.sequencias['protocolo-2026'], 104);
  const e1 = db.editais.find(e => e.slug === 'ed-exemplo-001');
  assert.equal(e1.inicio, '2026-10-28');
  assert.equal(e1.fim, '2026-12-07');
  assert.equal(e1.teto, 1000000);
  for (const e of db.editais) assert.ok(e.titulo.includes('(exemplo fictício)'));
  for (const o of db.organizacoes) assert.ok(o.nome.includes('exemplo fictício'));
  const outro = await semear(new Date('2027-03-01T15:00:00.000Z'));
  assert.equal(outro.editais.find(e => e.slug === 'ed-exemplo-001').inicio, '2027-02-19');
});

test('C1 login com sucesso e sessão', async () => {
  const { api, armazenamento } = montar();
  assert.equal((await erroDe(api.sessao())).status, 401);
  assert.deepEqual(await api.verificarDocumento('529.982.247-25'), { existe: true });
  const { usuario } = await entrarComo(api, MARINA);
  assert.equal(usuario.papel, 'proponente');
  assert.equal(usuario.natureza, 'Pessoa Física');
  assert.equal(usuario.organizacao.slug, 'fundacao-exemplo');
  assert.ok(armazenamento.getItem(CHAVE_SESSAO));
  assert.equal((await api.sessao()).usuario.documento, MARINA);
});

test('C2 senha errada e limite de tentativas', async () => {
  const { api, agora } = montar();
  const e = await erroDe(api.entrar(MARINA, 'SenhaErrada#1'));
  assert.ok(e instanceof ErroApi);
  assert.equal(e.status, 401);
  assert.equal(e.erro, 'senha_incorreta');
  assert.equal(e.mensagem, 'Senha incorreta.');
  for (let i = 0; i < 3; i++) await erroDe(api.entrar(MARINA, 'x'));
  assert.equal((await erroDe(api.entrar(MARINA, 'x'))).status, 401);
  const bloqueado = await erroDe(api.entrar(MARINA, SENHA_EXEMPLO));
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.erro, 'bloqueado');
  agora.avancar(15 * 60 * 1000 + 1000);
  assert.equal((await entrarComo(api, MARINA)).usuario.documento, MARINA);
});

test('documento sem conta também responde Senha incorreta', async () => {
  const { api } = montar();
  const e = await erroDe(api.entrar(NOVO_CPF, 'qualquer-senha'));
  assert.equal(e.status, 401);
  assert.equal(e.mensagem, 'Senha incorreta.');
});

test('C3 CPF inválido e documento vazio', async () => {
  const { api } = montar();
  const e = await erroDe(api.verificarDocumento('11111111111'));
  assert.equal(e.status, 400);
  assert.equal(e.erro, 'documento_invalido');
  assert.equal(e.mensagem, 'Documento inválido. Confira os números.');
  const v = await erroDe(api.verificarDocumento(''));
  assert.equal(v.erro, 'documento_obrigatorio');
  assert.equal(v.mensagem, 'Documento obrigatório.');
});

test('C4 documento novo e conta criada em fundacao-exemplo', async () => {
  const { api } = montar();
  assert.deepEqual(await api.verificarDocumento(NOVO_CPF), { existe: false });
  const dados = {
    organizacao: 'fundacao-exemplo', natureza: 'MEI', nome: 'Ana Exemplo', documento: NOVO_CPF, email: 'ana@teb.example',
    telefone: '71900000000', senha: SENHA_EXEMPLO, senhaConfirmacao: SENHA_EXEMPLO,
  };
  const erroConf = await erroDe(api.criarConta({ ...dados, senhaConfirmacao: 'outra-senha' }));
  assert.equal(erroConf.status, 400);
  assert.equal(erroConf.erro, 'validacao');
  assert.ok(erroConf.campos.some(c => c.campo === 'senhaConfirmacao'));
  assert.equal((await erroDe(api.criarConta({ ...dados, organizacao: 'nao-existe' }))).erro, 'organizacao_inexistente');
  const { usuario } = await api.criarConta(dados);
  assert.equal(usuario.papel, 'proponente');
  assert.equal(usuario.natureza, 'MEI');
  assert.equal(usuario.organizacao.slug, 'fundacao-exemplo');
  const painel = await api.painelProponente();
  assert.equal(painel.usuario.nome, 'Ana Exemplo');
  assert.equal(painel.contadores.enviados, 0);
  assert.equal((await erroDe(api.criarConta(dados))).erro, 'documento_existente');
});

test('C5 painel: aviso, 4 contadores, histórico e organizações', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const p = await api.painelProponente();
  assert.deepEqual(p.contadores, { enviados: 4, andamento: 2, concluidos: 1, naoAprovados: 1 });
  assert.equal(p.aviso.texto, 'Aviso de exemplo fictício: prazo de envio da habilitação.');
  assert.deepEqual(p.editaisAbertos.map(e => e.slug), ['ed-exemplo-001']);
  assert.deepEqual(p.historico.map(h => h.ano), [2026, 2025]);
  assert.equal(p.historico[1].editais[0].slug, 'ed-exemplo-2025');
  assert.equal(p.historico[0].editais.length, 2);
  assert.equal(p.historico[0].editais[0].linkEdital, 'exemplos/edital-exemplo.pdf');
  assert.equal(p.historico[0].editais[0].linkAnexos, 'exemplos/anexos-exemplo.pdf');
  assert.deepEqual(p.organizacoes.map(o => o.slug).sort(), ['fundacao-exemplo', 'produtora-aurora']);
  const i102 = p.inscricoes.find(i => i.protocolo === 'TEB-2026-000102');
  assert.equal(regras.formatarNota(i102.notaGeral), '14,0');
  assert.equal(i102.selo, 'Não aprovado');
});

test('C6 linha do tempo de 7 etapas com Habilitação atual na 000101', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const { inscricao } = await api.obterInscricao('TEB-2026-000101');
  assert.equal(inscricao.etapas.length, 7);
  assert.equal(inscricao.etapas[6].nome, 'Execução');
  assert.deepEqual(inscricao.etapas.map(e => e.estado), ['passada', 'passada', 'passada', 'passada', 'atual', 'futura', 'futura']);
  assert.equal(inscricao.etapas[4].nome, 'Habilitação');
  assert.equal(inscricao.selo, 'Selecionado');
});

test('abas travadas: 000103 sem habilitação, 000101 com habilitação e termo travado', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  assert.deepEqual((await api.obterInscricao('TEB-2026-000103')).inscricao.abas, { habilitacao: false, termo: false });
  assert.deepEqual((await api.obterInscricao('TEB-2026-000101')).inscricao.abas, { habilitacao: true, termo: false });
  assert.deepEqual((await api.obterInscricao('TEB-2026-000104')).inscricao.abas, { habilitacao: true, termo: true });
  // Nota só aparece depois do resultado publicado.
  assert.equal((await api.obterInscricao('TEB-2026-000103')).inscricao.avaliacao, null);
  assert.equal((await api.obterInscricao('TEB-2026-000101')).inscricao.avaliacao.notaGeral, 19);
});

test('C7 envio vazio é bloqueado com erros de obrigatório', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const { inscricao } = await api.criarInscricao('ed-exemplo-001', {});
  assert.equal(inscricao.situacao, 'rascunho');
  assert.equal(inscricao.protocolo, null);
  const e = await erroDe(api.enviarInscricao(inscricao.id, {}));
  assert.equal(e.status, 400);
  assert.equal(e.erro, 'validacao');
  const campos = e.campos.map(c => c.campo);
  for (const c of ['titulo', 'categoria', 'cota', 'extra-resumo', 'aceite']) assert.ok(campos.includes(c), c);
  assert.ok(e.campos.every(c => c.mensagem.startsWith('Campo obrigatório')));
});

test('C8 envio completo gera TEB-2026-000105 e congela a ficha', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const { inscricao } = await api.criarInscricao('ed-exemplo-001', {});
  const { inscricao: enviada } = await api.enviarInscricao(inscricao.id, FICHA_COMPLETA);
  assert.equal(enviada.protocolo, 'TEB-2026-000105');
  assert.equal(enviada.situacao, 'enviada');
  assert.equal(enviada.selo, 'Enviado');
  assert.equal(enviada.ficha.proponente.documento, MARINA);
  assert.equal(enviada.etapas[1].estado, 'atual');
  const e = await erroDe(api.salvarRascunho(inscricao.id, FICHA_COMPLETA));
  assert.equal(e.status, 409);
  assert.equal(e.erro, 'ficha_congelada');
  assert.equal((await erroDe(api.enviarInscricao(inscricao.id, FICHA_COMPLETA))).erro, 'ficha_congelada');
  const p = await api.painelProponente();
  assert.equal(p.contadores.enviados, 5);
  assert.equal(p.inscricoes[0].protocolo, 'TEB-2026-000105');
  const seguinte = await api.criarInscricao('ed-exemplo-001', FICHA_COMPLETA);
  assert.equal((await api.enviarInscricao(seguinte.inscricao.id, FICHA_COMPLETA)).inscricao.protocolo, 'TEB-2026-000106');
});

test('C9 soma da planilha, alerta de teto e envio acima do teto recusado', async () => {
  const linhas = [{ descricao: 'Cenário', qtd: 10, valor: regras.reaisParaCentavos('1500') }];
  assert.equal(regras.formatarMoeda(regras.totalOrcamento(linhas)), 'R$ 15.000,00');
  assert.equal(regras.mensagemTeto(regras.totalOrcamento(linhas), 1000000), 'Total R$ 15.000,00 passa do teto de R$ 10.000,00.');
  const { api } = montar();
  await entrarComo(api, MARINA);
  const { edital } = await api.obterEdital('ed-exemplo-001');
  assert.equal(edital.teto, 1000000);
  const { inscricao } = await api.criarInscricao('ed-exemplo-001', {});
  const e = await erroDe(api.enviarInscricao(inscricao.id, { ...FICHA_COMPLETA, orcamento: linhas }));
  assert.equal(e.status, 400);
  assert.equal(e.erro, 'acima_do_teto');
  assert.equal(e.mensagem, 'Total R$ 15.000,00 passa do teto de R$ 10.000,00.');
  const salvo = await api.obterInscricao(inscricao.id);
  assert.equal(salvo.inscricao.situacao, 'rascunho');
  assert.equal(salvo.inscricao.ficha.orcamento.length, 1);
});

test('salvarRascunho grava a ficha parcial', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const { inscricao } = await api.criarInscricao('ed-exemplo-001', { titulo: 'Primeiro' });
  const { inscricao: salva } = await api.salvarRascunho(inscricao.id, { titulo: 'Segundo', categoria: 'Música' });
  assert.equal(salva.ficha.titulo, 'Segundo');
  assert.equal(salva.ficha.categoria, 'Música');
  assert.equal(salva.situacao, 'rascunho');
  assert.equal((await api.obterInscricao(inscricao.id)).inscricao.ficha.titulo, 'Segundo');
  assert.equal((await erroDe(api.obterInscricao('nao-existe'))).status, 404);
});

test('C10 gestor cria e abre edital, e a lista tem 2 abertos', async () => {
  const { api } = montar();
  await entrarComo(api, GESTOR);
  const dados = {
    numero: 'EX-002/2026', titulo: 'Edital Exemplo Oficinas', descricao: 'Edital de exemplo fictício.', inicio: '2026-01-01', fim: '2027-12-31',
    teto: regras.reaisParaCentavos('5000'), categorias: ['Geral'], cotas: ['Ampla concorrência'], criterios: [{ nome: 'Mérito', maximo: 10, bonus: false }], camposExtras: [],
  };
  const { edital } = await api.criarEdital(dados);
  assert.equal(edital.slug, 'ex-002-2026');
  assert.equal(edital.situacao, 'rascunho');
  assert.equal(edital.ano, 2026);
  assert.equal(edital.criterios[0].chave, 'merito');
  assert.equal((await api.abrirEdital(edital.slug)).edital.situacao, 'aberto');
  const { editais } = await api.gestorEditais();
  assert.equal(editais.filter(e => e.situacao === 'aberto').length, 2);
  assert.ok(!editais.some(e => e.slug === 'ed-aurora-001'));
  assert.equal((await erroDe(api.abrirEdital(edital.slug))).erro, 'situacao');
  assert.equal((await erroDe(api.abrirEdital('ed-aurora-001'))).status, 404);
  assert.equal((await api.encerrarEdital(edital.slug)).edital.situacao, 'encerrado');
  assert.equal((await erroDe(api.salvarEdital(edital.slug, dados))).erro, 'edital_encerrado');
});

test('gestor: edital sem critério não abre e validação de campos', async () => {
  const { api } = montar();
  await entrarComo(api, GESTOR);
  const e = await erroDe(api.criarEdital({ numero: '', titulo: '', inicio: '', fim: '', teto: '' }));
  assert.equal(e.status, 400);
  assert.deepEqual(e.campos.map(c => c.campo).sort(), ['fim', 'inicio', 'numero', 'teto', 'titulo']);
  const { edital } = await api.criarEdital({ numero: 'EX-9', titulo: 'Sem modelo', inicio: '2026-01-01', fim: '2026-02-01', teto: 100000 });
  const nao = await erroDe(api.abrirEdital(edital.slug));
  assert.equal(nao.status, 400);
  assert.equal(nao.erro, 'nao_pode_abrir');
  assert.ok(nao.campos.length >= 3);
  const igual = await api.criarEdital({ numero: 'EX-9', titulo: 'Repetido', inicio: '2026-01-01', fim: '2026-02-01', teto: 100000 });
  assert.equal(igual.edital.slug, 'ex-9-2');
});

test('C11 avaliador lança 8, 7 e 0 e a nota geral é 15,0', async () => {
  const { api } = montar();
  await entrarComo(api, AVALIADORA);
  const { inscricoes } = await api.avaliadorInscricoes();
  assert.ok(inscricoes.some(i => i.protocolo === 'TEB-2026-000103' && !i.avaliacaoEnviada));
  const { inscricao } = await api.avaliadorInscricao('TEB-2026-000103');
  assert.deepEqual(inscricao.criterios.map(c => c.chave), ['qualidade', 'viabilidade', 'bonus-regional']);
  assert.equal(inscricao.ficha.proponente.documento, undefined);
  assert.equal(inscricao.ficha.proponente.nome.includes('Marina'), true);
  const vazia = await erroDe(api.enviarAvaliacao('TEB-2026-000103', { qualidade: 8, viabilidade: 7, 'bonus-regional': null }, 'Parecer'));
  assert.equal(vazia.erro, 'nota_invalida');
  const alta = await erroDe(api.enviarAvaliacao('TEB-2026-000103', { qualidade: 11, viabilidade: 7, 'bonus-regional': 0 }, 'Parecer'));
  assert.equal(alta.erro, 'nota_invalida');
  assert.equal((await erroDe(api.enviarAvaliacao('TEB-2026-000103', { qualidade: 8, viabilidade: 7, 'bonus-regional': 0 }, ''))).erro, 'validacao');
  const { avaliacao } = await api.enviarAvaliacao('TEB-2026-000103', { qualidade: '8', viabilidade: '7', 'bonus-regional': '0' }, 'Parecer de exemplo fictício.');
  assert.equal(avaliacao.notaGeral, 15);
  assert.equal(regras.formatarNota(avaliacao.notaGeral), '15,0');
  assert.equal((await erroDe(api.enviarAvaliacao('TEB-2026-000103', { qualidade: 8, viabilidade: 7, 'bonus-regional': 0 }, 'x'))).erro, 'avaliacao_enviada');
  assert.equal((await erroDe(api.avaliadorInscricao('TEB-2026-000104'))).status, 404);
});

test('C12 recurso na 000102 fica Em análise, um só, e o gestor decide', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const antes = (await api.obterInscricao('TEB-2026-000102')).inscricao;
  assert.equal(antes.recursoPermitido, true);
  assert.equal((await erroDe(api.enviarRecurso('TEB-2026-000102', '  '))).erro, 'validacao');
  const { recurso } = await api.enviarRecurso('TEB-2026-000102', 'Justificativa de exemplo fictício para o recurso.');
  assert.equal(recurso.situacao, 'Em análise');
  assert.equal(recurso.protocolo, 'TEB-2026-000102');
  assert.equal((await erroDe(api.enviarRecurso('TEB-2026-000102', 'de novo'))).erro, 'recurso_existente');
  const depois = (await api.obterInscricao('TEB-2026-000102')).inscricao;
  assert.equal(depois.recurso.situacao, 'Em análise');
  assert.equal(depois.recursoPermitido, false);
  await api.sair();
  assert.equal((await erroDe(api.painelProponente())).status, 401);
  await entrarComo(api, GESTOR);
  const lista = (await api.gestorInscricoes({ situacao: 'com-recurso' })).inscricoes;
  assert.equal(lista.length, 1);
  assert.equal((await erroDe(api.decidirRecurso(recurso.id, 'deferido', ''))).erro, 'validacao');
  const decidido = (await api.decidirRecurso(recurso.id, 'indeferido', 'Parecer de exemplo fictício.')).recurso;
  assert.equal(decidido.situacao, 'Indeferido');
  assert.equal((await erroDe(api.decidirRecurso(recurso.id, 'deferido', 'x'))).erro, 'ja_decidido');
});

test('recurso fora do prazo depois de 15 dias', async () => {
  const { api, agora } = montar();
  await entrarComo(api, MARINA);
  assert.equal((await api.obterInscricao('TEB-2026-000102')).inscricao.recursoPermitido, true);
  agora.avancar(13 * 24 * HORA);
  await entrarComo(api, MARINA);
  assert.equal((await api.obterInscricao('TEB-2026-000102')).inscricao.recursoPermitido, false);
  const e = await erroDe(api.enviarRecurso('TEB-2026-000102', 'Tarde demais'));
  assert.equal(e.status, 400);
  assert.equal(e.erro, 'fora_do_prazo');
});

test('papéis e isolamento por organização', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  assert.equal((await erroDe(api.gestorEditais())).status, 403);
  assert.equal((await erroDe(api.avaliadorInscricoes())).status, 403);
  assert.equal((await erroDe(api.obterEdital('ed-aurora-001'))).status, 404);
  assert.equal((await erroDe(api.criarInscricao('ed-aurora-001', {}))).status, 404);
  await api.trocarOrganizacao('produtora-aurora');
  const p = await api.painelProponente();
  assert.deepEqual(p.editaisAbertos.map(e => e.slug), ['ed-aurora-001']);
  assert.equal(p.contadores.enviados, 0);
  assert.equal((await erroDe(api.trocarOrganizacao('nada'))).erro, 'organizacao_inexistente');
  await api.sair();
  await entrarComo(api, PLATAFORMA);
  assert.equal((await erroDe(api.painelProponente())).status, 403);
  assert.equal((await erroDe(api.gestorInscricoes())).status, 403);
  assert.equal((await erroDe(api.obterEdital('ed-exemplo-001'))).status, 404);
  const { organizacoes } = await api.plataformaOrganizacoes();
  assert.equal(organizacoes.length, 2);
  assert.ok(!JSON.stringify(organizacoes).includes('TEB-2026'));
  assert.deepEqual(organizacoes.find(o => o.slug === 'fundacao-exemplo').gestores.map(g => g.email), ['gestor@teb.example']);
});

test('gestor: avaliadores, atribuir, resultado e publicar', async () => {
  const { api } = montar();
  await entrarComo(api, GESTOR);
  const { avaliadores } = await api.gestorAvaliadores();
  assert.equal(avaliadores.length, 1);
  const todas = (await api.gestorInscricoes()).inscricoes;
  assert.equal(todas.length, 4);
  assert.equal(todas.find(i => i.protocolo === 'TEB-2026-000103').avaliador.nome.includes('Avaliadora'), true);
  assert.equal((await api.gestorInscricoes({ edital: 'ed-exemplo-002' })).inscricoes.length, 1);
  assert.equal((await api.gestorInscricoes({ situacao: 'nao_selecionado' })).inscricoes[0].protocolo, 'TEB-2026-000102');
  assert.equal((await erroDe(api.atribuirAvaliador('TEB-2026-000103', 9999))).status, 404);
  assert.equal((await erroDe(api.atribuirAvaliador('TEB-2026-000101', avaliadores[0].id))).erro, 'avaliacao_enviada');
  assert.equal((await api.atribuirAvaliador('TEB-2026-000103', avaliadores[0].id)).inscricao.avaliador.id, avaliadores[0].id);
  assert.equal((await erroDe(api.definirResultado('TEB-2026-000103', 'talvez'))).erro, 'validacao');
  assert.equal((await erroDe(api.definirResultado('TEB-2026-000101', 'suplente'))).erro, 'ja_publicado');
  assert.equal((await erroDe(api.publicarResultado('ed-exemplo-000'))).erro, 'ja_publicado');
  assert.equal((await erroDe(api.publicarResultado('ed-exemplo-001'))).erro, 'edital_nao_encerrado');
  assert.equal((await erroDe(api.publicarResultado('ed-exemplo-002'))).erro, 'resultado_incompleto');
  await api.definirResultado('TEB-2026-000103', 'suplente');
  const { edital } = await api.publicarResultado('ed-exemplo-002');
  assert.ok(edital.resultadoPublicadoEm);
  assert.ok(edital.prazoRecursoAte);
  await api.sair();
  await entrarComo(api, MARINA);
  const i103 = (await api.obterInscricao('TEB-2026-000103')).inscricao;
  assert.equal(i103.resultado, 'suplente');
  assert.equal(i103.etapas[3].nome, 'Suplente');
  assert.equal(i103.etapas[3].estado, 'atual');
});

test('gestor: avisos e criação de avaliador', async () => {
  const { api } = montar();
  await entrarComo(api, GESTOR);
  assert.equal((await erroDe(api.criarAviso({ texto: ' ' }))).status, 400);
  const { aviso } = await api.criarAviso({ texto: 'Outro aviso de exemplo fictício.', ativo: true });
  assert.equal((await api.gestorAvisos()).avisos[0].id, aviso.id);
  const dados = { nome: 'Outro Avaliador Exemplo', documento: NOVO_CPF, email: 'outro@teb.example', senha: 'SenhaNova#2026' };
  const { avaliador } = await api.criarAvaliador(dados);
  assert.equal((await api.gestorAvaliadores()).avaliadores.length, 2);
  assert.equal((await erroDe(api.criarAvaliador(dados))).erro, 'documento_existente');
  await api.sair();
  assert.equal((await api.entrar(NOVO_CPF, 'SenhaNova#2026')).usuario.id, avaliador.id);
  await api.sair();
  await entrarComo(api, MARINA);
  assert.equal((await api.painelProponente()).aviso.texto, 'Outro aviso de exemplo fictício.');
});

test('plataforma cria organização com gestor', async () => {
  const { api } = montar();
  await entrarComo(api, PLATAFORMA);
  const e = await erroDe(api.criarOrganizacao({ nome: '', slug: 'Slug Ruim', gestor: {} }));
  assert.equal(e.status, 400);
  const dados = { nome: 'Órgão Exemplo Novo (exemplo fictício)', slug: 'orgao-novo', gestor: { nome: 'Gestora Nova', documento: NOVO_CPF, email: 'g@teb.example', senha: 'SenhaNova#2026' } };
  const r = await api.criarOrganizacao(dados);
  assert.equal(r.organizacao.slug, 'orgao-novo');
  assert.equal((await erroDe(api.criarOrganizacao(dados))).erro, 'slug_existente');
  assert.equal((await api.listarOrganizacoes()).organizacoes.length, 3);
  await api.sair();
  const { usuario } = await api.entrar(NOVO_CPF, 'SenhaNova#2026');
  assert.equal(usuario.papel, 'gestor');
  assert.equal(usuario.organizacao.slug, 'orgao-novo');
});

test('esqueciSenha e redefinirSenha: link só se existe, 1 hora, 1 uso', async () => {
  const { api, agora } = montar();
  const sem = await api.esqueciSenha(NOVO_CPF);
  assert.equal(sem.link, undefined);
  const com = await api.esqueciSenha(MARINA);
  assert.equal(sem.mensagem, com.mensagem);
  assert.ok(com.link.startsWith('#/redefinir?token='));
  const token = decodeURIComponent(com.link.split('token=')[1]);
  assert.equal((await erroDe(api.redefinirSenha({ token: 'inventado', senha: 'NovaSenha#1', senhaConfirmacao: 'NovaSenha#1' }))).erro, 'token_invalido');
  assert.equal((await erroDe(api.redefinirSenha({ token, senha: 'curta', senhaConfirmacao: 'curta' }))).erro, 'validacao');
  await api.redefinirSenha({ token, senha: 'NovaSenha#1', senhaConfirmacao: 'NovaSenha#1' });
  assert.equal((await erroDe(api.redefinirSenha({ token, senha: 'OutraSenha#1', senhaConfirmacao: 'OutraSenha#1' }))).erro, 'token_invalido');
  assert.equal((await erroDe(api.entrar(MARINA, SENHA_EXEMPLO))).status, 401);
  assert.equal((await api.entrar(MARINA, 'NovaSenha#1')).usuario.documento, MARINA);
  await api.sair();
  const outro = await api.esqueciSenha(MARINA);
  agora.avancar(HORA + 1000);
  const t2 = decodeURIComponent(outro.link.split('token=')[1]);
  assert.equal((await erroDe(api.redefinirSenha({ token: t2, senha: 'NovaSenha#2', senhaConfirmacao: 'NovaSenha#2' }))).erro, 'token_invalido');
});

test('alterarSenha, salvarConta, documento inalterável e sair', async () => {
  const { api, armazenamento } = montar();
  await entrarComo(api, MARINA);
  const e1 = await erroDe(api.alterarSenha({ senhaAtual: 'errada', novaSenha: 'NovaSenha#1', novaSenhaConfirmacao: 'NovaSenha#1' }));
  assert.equal(e1.status, 400);
  assert.equal(e1.erro, 'senha_atual_incorreta');
  const e2 = await erroDe(api.alterarSenha({ senhaAtual: SENHA_EXEMPLO, novaSenha: 'NovaSenha#1', novaSenhaConfirmacao: 'diferente' }));
  assert.equal(e2.erro, 'validacao');
  assert.equal(e2.campos[0].campo, 'novaSenhaConfirmacao');
  assert.equal(await api.alterarSenha({ senhaAtual: SENHA_EXEMPLO, novaSenha: 'NovaSenha#1', novaSenhaConfirmacao: 'NovaSenha#1' }), null);
  assert.equal((await api.sessao()).usuario.documento, MARINA);

  const conta = (await api.obterConta()).usuario;
  assert.equal((await erroDe(api.salvarConta({ ...conta, documento: '11144477735' }))).erro, 'documento_inalteravel');
  const { usuario } = await api.salvarConta({
    nome: 'Marina Exemplo', email: 'MARINA@teb.example', telefone: '00900000009',
    endereco: { cep: '01001-000', logradouro: 'Rua Exemplo', numero: '1', complemento: '', bairro: 'Centro', cidade: 'Cidade Exemplo', uf: 'sp' },
  });
  assert.equal(usuario.email, 'marina@teb.example');
  assert.equal(usuario.endereco.cep, '01001000');
  assert.equal(usuario.endereco.uf, 'SP');
  assert.equal(usuario.documento, MARINA);
  assert.equal((await erroDe(api.salvarConta({ nome: '', email: 'x' }))).erro, 'validacao');

  assert.equal(await api.sair(), null);
  assert.equal(armazenamento.getItem(CHAVE_SESSAO), null);
  assert.equal((await erroDe(api.obterConta())).status, 401);
  assert.equal((await erroDe(api.entrar(MARINA, SENHA_EXEMPLO))).status, 401);
  assert.equal((await api.entrar(MARINA, 'NovaSenha#1')).usuario.nome, 'Marina Exemplo');
});

test('sessão vence em 8 horas', async () => {
  const { api, agora } = montar();
  await entrarComo(api, MARINA);
  agora.avancar(7 * HORA);
  assert.equal((await api.sessao()).usuario.documento, MARINA);
  agora.avancar(2 * HORA);
  assert.equal((await erroDe(api.sessao())).status, 401);
});

test('buscarCep com fetch simulado', async () => {
  const chamadas = [];
  const respostas = {
    '01001000': { cep: '01001-000', logradouro: 'Praça Exemplo', bairro: 'Sé', localidade: 'Cidade Exemplo', uf: 'SP' },
    '99999999': { erro: true },
  };
  const fetch = async url => {
    chamadas.push(String(url));
    const cep = String(url).match(/ws\/(\d+)\/json/)?.[1];
    if (cep === '11111111') throw new TypeError('rede fora');
    if (cep === '22222222') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => respostas[cep] };
  };
  const { api } = montar({ fetch });
  assert.equal((await erroDe(api.buscarCep('01001000'))).status, 401);
  await entrarComo(api, MARINA);
  assert.deepEqual(await api.buscarCep('01001-000'), { cep: '01001000', logradouro: 'Praça Exemplo', bairro: 'Sé', cidade: 'Cidade Exemplo', uf: 'SP' });
  assert.equal(chamadas[0], 'https://viacep.com.br/ws/01001000/json/');
  assert.equal((await erroDe(api.buscarCep('123'))).erro, 'cep_invalido');
  const nao = await erroDe(api.buscarCep('99999999'));
  assert.equal(nao.status, 404);
  assert.equal(nao.erro, 'cep_nao_encontrado');
  const fora = await erroDe(api.buscarCep('11111111'));
  assert.equal(fora.status, 502);
  assert.equal(fora.erro, 'cep_indisponivel');
  assert.equal((await erroDe(api.buscarCep('22222222'))).status, 502);
  assert.equal(chamadas.length, 4);
});

test('anexo: só PDF, até 10 MB, guarda só metadados e download dá 404', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  const { inscricao } = await api.criarInscricao('ed-exemplo-001', {});
  const arq = (name, type, size) => ({ name, type, size });
  assert.equal((await erroDe(api.enviarAnexo(inscricao.id, 'anexo', arq('foto.png', 'image/png', 1000)))).status, 415);
  assert.equal((await erroDe(api.enviarAnexo(inscricao.id, 'anexo', arq('doc.txt', 'application/pdf', 1000)))).status, 415);
  const grande = await erroDe(api.enviarAnexo(inscricao.id, 'anexo', arq('grande.pdf', 'application/pdf', regras.LIMITE_ANEXO + 1)));
  assert.equal(grande.status, 413);
  assert.equal(grande.erro, 'arquivo_grande');
  assert.equal((await erroDe(api.enviarAnexo(inscricao.id, 'anexo', arq('vazio.pdf', 'application/pdf', 0)))).status, 400);
  assert.equal((await erroDe(api.enviarAnexo(inscricao.id, 'resumo', arq('a.pdf', 'application/pdf', 10)))).status, 404);
  const { anexo } = await api.enviarAnexo(inscricao.id, 'anexo', arq('portfolio.pdf', 'application/pdf', 2048));
  assert.deepEqual(Object.keys(anexo).sort(), ['id', 'nome', 'tamanho']);
  assert.equal(anexo.tamanho, 2048);
  const atual = (await api.obterInscricao(inscricao.id)).inscricao;
  assert.deepEqual(atual.ficha.anexos.anexo, anexo);
  // Salvar rascunho preserva o anexo.
  assert.deepEqual((await api.salvarRascunho(inscricao.id, { titulo: 'x' })).inscricao.ficha.anexos.anexo, anexo);
  const baixa = await erroDe(api.baixarAnexo(anexo.id));
  assert.equal(baixa.status, 404);
  assert.equal(baixa.erro, 'anexo_nao_guardado');
  await api.enviarInscricao(inscricao.id, FICHA_COMPLETA);
  assert.equal((await erroDe(api.enviarAnexo(inscricao.id, 'anexo', arq('b.pdf', 'application/pdf', 10)))).erro, 'ficha_congelada');
});

test('tudo persiste na chave teb-demo-v1 e senhas não ficam em texto', async () => {
  const armazenamento = memoria();
  const { api } = montar({ armazenamento });
  await entrarComo(api, MARINA);
  await api.criarInscricao('ed-exemplo-001', { titulo: 'Persistido' });
  const bruto = armazenamento.getItem(CHAVE_BANCO);
  assert.ok(bruto.includes('Persistido'));
  assert.ok(!bruto.includes(SENHA_EXEMPLO));
  const outra = criarApi({ modo: 'demonstracao', armazenamento, agora: relogio() });
  assert.equal((await outra.sessao()).usuario.documento, MARINA);
  const { inscricoes } = (await outra.painelProponente());
  assert.ok(inscricoes.some(i => i.titulo === 'Persistido'));
});

test('chamadas em paralelo não perdem dados', async () => {
  const { api } = montar();
  await entrarComo(api, MARINA);
  await Promise.all([1, 2, 3, 4, 5].map(n => api.criarInscricao('ed-exemplo-001', { titulo: `Paralela ${n}` })));
  const { inscricoes } = await api.painelProponente();
  assert.equal(inscricoes.filter(i => i.titulo.startsWith('Paralela')).length, 5);
});

test('rota inexistente e corpo inválido seguem o formato do servidor', async () => {
  const demo = criarDemo({ armazenamento: memoria(), agora: relogio() });
  const r = await demo.requisitar('GET', '/api/nada');
  assert.equal(r.status, 404);
  assert.deepEqual(r.corpo, { erro: 'nao_encontrado', mensagem: 'Endereço não encontrado.' });
  const s = await demo.requisitar('GET', '/api/sessao');
  assert.equal(s.status, 401);
  assert.equal(s.corpo.erro, 'sem_sessao');
  const j = await demo.requisitar('POST', '/api/acesso/documento', [1]);
  assert.equal(j.status, 400);
  assert.equal(j.corpo.erro, 'json_invalido');
  const sair = await demo.requisitar('POST', '/api/acesso/sair', {});
  assert.equal(sair.status, 401);
});

test('modo servidor monta o pedido certo e converte erro em ErroApi', async () => {
  const pedidos = [];
  const fetch = async (caminho, init) => {
    pedidos.push({ caminho, init });
    const json = (status, corpo) => ({
      status, ok: status < 400,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => corpo,
    });
    if (caminho === '/api/acesso/entrar') return json(401, { erro: 'senha_incorreta', mensagem: 'Senha incorreta.' });
    if (caminho === '/api/acesso/sair') return { status: 204, ok: true, headers: { get: () => '' } };
    return json(200, { usuario: { id: 1 } });
  };
  const api = criarApi({ modo: 'servidor', fetch, armazenamento: memoria() });
  assert.equal(api.modo, 'servidor');
  const e = await erroDe(api.entrar(MARINA, 'x'));
  assert.ok(e instanceof ErroApi);
  assert.equal(e.status, 401);
  assert.equal(e.mensagem, 'Senha incorreta.');
  assert.equal(pedidos[0].init.method, 'POST');
  assert.equal(pedidos[0].init.credentials, 'same-origin');
  assert.equal(pedidos[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(pedidos[0].init.body), { documento: MARINA, senha: 'x' });
  await api.sessao();
  assert.equal(pedidos[1].caminho, '/api/sessao');
  assert.equal(pedidos[1].init.method, 'GET');
  assert.equal(pedidos[1].init.body, undefined);
  assert.equal(await api.sair(), null);
  await api.gestorInscricoes({ edital: 'ed-exemplo-002', situacao: 'avaliada' });
  assert.equal(pedidos.at(-1).caminho, '/api/gestor/inscricoes?edital=ed-exemplo-002&situacao=avaliada');
  await api.buscarCep('01001-000');
  assert.equal(pedidos.at(-1).caminho, '/api/cep/01001-000');
  await api.enviarAnexo('abc', 'anexo', { name: 'Portfólio.pdf', type: 'application/pdf', size: 5 });
  const ultimo = pedidos.at(-1);
  assert.equal(ultimo.caminho, '/api/inscricoes/abc/anexos/anexo');
  assert.equal(ultimo.init.headers['Content-Type'], 'application/pdf');
  assert.equal(ultimo.init.headers['X-Nome-Arquivo'], encodeURIComponent('Portfólio.pdf'));
  const semRede = criarApi({ modo: 'servidor', fetch: async () => { throw new TypeError('x'); } });
  const f = await erroDe(semRede.sessao());
  assert.equal(f.status, 0);
  assert.equal(f.erro, 'sem_rede');
});
