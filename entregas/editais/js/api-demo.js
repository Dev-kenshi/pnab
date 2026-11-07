// Modo demonstração: um servidor falso que roda no navegador.
// Responde cada rota do contrato com o mesmo status, o mesmo código de erro e o mesmo JSON do servidor real.
// Guarda tudo em armazenamento (localStorage no navegador) na chave teb-demo-v1.
// Diferenças deliberadas do servidor real: aceita a senha de exemplo, não tem a lista de documentos
// reservados, limita login só por documento e não guarda os bytes dos anexos.
import * as regras from './regras.js';
import { gerarAleatorio, gerarSal, hashSenha, semear } from './semente.js';

export const CHAVE_BANCO = 'teb-demo-v1';
export const CHAVE_SESSAO = 'teb-demo-sessao';

const SESSAO_MS = 8 * 60 * 60 * 1000;
const REDEFINICAO_MS = 60 * 60 * 1000;
const LIMITE_ERROS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const MAX_LINHAS = 200;
const MAX_ITENS = 50;
const LINK_EDITAL = 'exemplos/edital-exemplo.pdf';
const LINK_ANEXOS = 'exemplos/anexos-exemplo.pdf';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MSG_DOC_VAZIO = 'Documento obrigatório.';
const MSG_DOC_INVALIDO = 'Documento inválido. Confira os números.';
const MSG_ESQUECI = 'Se o documento estiver cadastrado, enviaremos um link de redefinição.';
const FILTROS = ['todas', 'aguardando-avaliacao', 'avaliada', 'selecionado', 'suplente', 'nao_selecionado', 'com-recurso'];

class ErroHttp extends Error {
  constructor(status, erro, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.erro = erro;
    this.campos = campos;
  }
}
const falha = (status, erro, mensagem, campos) => new ErroHttp(status, erro, mensagem, campos);

const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = (v, max = MAX_LINHAS) => (Array.isArray(v) ? v.slice(0, max) : []);
const numeroOuNulo = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const anoBrasil = agora => new Date(agora.getTime() - 3 * 60 * 60 * 1000).getUTCFullYear();

function compilar(caminho) {
  const nomes = [];
  const fonte = caminho.split('/').map(p => {
    if (p.startsWith(':')) { nomes.push(p.slice(1)); return '([^/]+)'; }
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { re: new RegExp(`^${fonte}$`), nomes };
}

// ---------- Conversões para os objetos do contrato ----------

function usuarioPublico(db, u) {
  const org = u.organizacaoId == null ? null : db.organizacoes.find(o => o.id === u.organizacaoId);
  return {
    id: u.id,
    papel: u.papel,
    nome: u.nome,
    natureza: u.natureza ?? null,
    documento: u.documento,
    email: u.email,
    telefone: u.telefone ?? null,
    endereco: u.endereco ?? null,
    organizacao: org ? { slug: org.slug, nome: org.nome } : null,
  };
}

function prazoDoEdital(e) {
  return e.resultadoPublicadoEm ? regras.prazoRecurso(e.resultadoPublicadoEm).toISOString() : null;
}

function editalResumo(e) {
  return {
    slug: e.slug, numero: e.numero, titulo: e.titulo, descricao: e.descricao, inicio: e.inicio, fim: e.fim, teto: e.teto, ano: e.ano,
    situacao: e.situacao, resultadoPublicadoEm: e.resultadoPublicadoEm ?? null, prazoRecursoAte: prazoDoEdital(e),
    linkEdital: LINK_EDITAL, linkAnexos: LINK_ANEXOS,
  };
}

const editalPublico = e => ({ ...editalResumo(e), categorias: e.categorias, cotas: e.cotas, criterios: e.criterios, camposExtras: e.camposExtras });

function avaliacaoPublica(a) {
  return a ? { notas: a.notas, notaGeral: a.notaGeral, parecer: a.parecer, enviadaEm: a.enviadaEm } : null;
}

function recursoPublico(r, protocolo) {
  if (!r) return null;
  return {
    id: r.id, protocolo: protocolo ?? null, justificativa: r.justificativa, situacao: r.situacao, parecer: r.parecer ?? null,
    criadoEm: r.criadoEm, decididoEm: r.decididoEm ?? null,
  };
}

function inscricaoResumo(insc, edital, avaliacao) {
  const publicado = Boolean(edital.resultadoPublicadoEm);
  const r = editalResumo(edital);
  return {
    id: insc.id,
    protocolo: insc.protocolo,
    edital: { slug: edital.slug, titulo: edital.titulo, ano: edital.ano, linkEdital: r.linkEdital, linkAnexos: r.linkAnexos },
    titulo: insc.ficha.titulo ?? '',
    categoria: insc.ficha.categoria ?? '',
    cota: insc.ficha.cota ?? '',
    situacao: insc.situacao,
    resultado: publicado || insc.situacao === 'concluida' ? insc.resultado : null,
    etapa: insc.etapa,
    selo: regras.selo(insc, edital),
    notaGeral: publicado && avaliacao ? Number(avaliacao.notaGeral) : null,
    etapas: regras.calcularEtapas(insc, edital),
    enviadaEm: insc.enviadaEm ?? null,
  };
}

function inscricaoCompleta(insc, edital, avaliacao, recurso, agora) {
  const publicado = Boolean(edital.resultadoPublicadoEm);
  return {
    ...inscricaoResumo(insc, edital, avaliacao),
    ficha: insc.ficha,
    avaliacao: publicado && avaliacao ? { notas: avaliacao.notas, notaGeral: avaliacao.notaGeral, parecer: avaliacao.parecer } : null,
    recurso: recursoPublico(recurso, insc.protocolo),
    recursoPermitido: regras.recursoPermitido({ inscricao: insc, edital, recurso, agora }),
    prazoRecursoAte: prazoDoEdital(edital),
    abas: regras.abasLiberadas(insc, edital),
  };
}

// ---------- Validações comuns ----------

function exigirDocumento(valor) {
  const d = regras.somenteDigitos(valor);
  if (!d) throw falha(400, 'documento_obrigatorio', MSG_DOC_VAZIO);
  const v = regras.validarDocumento(d);
  if (!v.valido) throw falha(400, 'documento_invalido', MSG_DOC_INVALIDO);
  return v.digitos;
}

function conferirSenhaNova(senha, confirmacao, campo = 'senha', campoConfirmacao = 'senhaConfirmacao') {
  const campos = [];
  const msg = regras.validarSenha(senha);
  if (msg) campos.push({ campo, mensagem: msg });
  if (confirmacao !== undefined && senha !== confirmacao) campos.push({ campo: campoConfirmacao, mensagem: 'A confirmação não confere com a senha.' });
  return campos;
}

function validarDadosConta(corpo, { exigirConfirmacao = false, documentoComoCampo = false } = {}) {
  const digitos = regras.somenteDigitos(corpo.documento);
  const campos = [];
  if (documentoComoCampo) {
    if (!regras.validarDocumento(digitos).valido) campos.push({ campo: 'documento', mensagem: MSG_DOC_INVALIDO });
  } else {
    exigirDocumento(digitos);
  }
  campos.push(...conferirSenhaNova(corpo.senha, exigirConfirmacao ? corpo.senhaConfirmacao : undefined));
  const nome = texto(corpo.nome, 120);
  const email = texto(corpo.email, 160).toLowerCase();
  if (!nome) campos.push({ campo: 'nome', mensagem: 'Campo obrigatório: Nome' });
  if (!EMAIL_RE.test(email)) campos.push({ campo: 'email', mensagem: 'Informe um e-mail válido.' });
  return { digitos, nome, email, campos };
}

function lerEndereco(bruto, campos) {
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto !== 'object' || Array.isArray(bruto)) {
    campos.push({ campo: 'endereco', mensagem: 'Endereço inválido.' });
    return null;
  }
  const e = {
    cep: regras.somenteDigitos(bruto.cep).slice(0, 8),
    logradouro: texto(bruto.logradouro, 160),
    numero: texto(bruto.numero, 20),
    complemento: texto(bruto.complemento, 80),
    bairro: texto(bruto.bairro, 80),
    cidade: texto(bruto.cidade, 80),
    uf: texto(bruto.uf, 2).toUpperCase(),
  };
  if (e.cep && e.cep.length !== 8) campos.push({ campo: 'cep', mensagem: 'O CEP precisa ter 8 dígitos.' });
  if (e.uf && !/^[A-Z]{2}$/.test(e.uf)) campos.push({ campo: 'uf', mensagem: 'UF inválida.' });
  return e;
}

function listaDeNomes(valor, campo, rotulo, campos) {
  const saida = [];
  if (valor !== undefined && !Array.isArray(valor)) { campos.push({ campo, mensagem: `${rotulo}: envie uma lista.` }); return saida; }
  (valor || []).slice(0, MAX_ITENS).forEach((v, linha) => {
    const t = texto(v, 120);
    if (!t) campos.push({ campo, mensagem: `${rotulo}: preencha o nome.`, linha });
    else if (saida.includes(t)) campos.push({ campo, mensagem: `${rotulo}: nome repetido.`, linha });
    else saida.push(t);
  });
  return saida;
}

function lerModeloEdital(c) {
  const campos = [];
  const numero = texto(c.numero, 60);
  const titulo = texto(c.titulo, 200);
  const descricao = texto(c.descricao, 5000);
  const inicio = texto(c.inicio, 10);
  const fim = texto(c.fim, 10);
  const teto = Number(c.teto);
  if (!numero) campos.push({ campo: 'numero', mensagem: 'Campo obrigatório: Número' });
  if (!titulo) campos.push({ campo: 'titulo', mensagem: 'Campo obrigatório: Título' });
  if (!regras.dataValida(inicio)) campos.push({ campo: 'inicio', mensagem: 'Campo obrigatório: Início' });
  if (!regras.dataValida(fim)) campos.push({ campo: 'fim', mensagem: 'Campo obrigatório: Fim' });
  else if (regras.dataValida(inicio) && fim < inicio) campos.push({ campo: 'fim', mensagem: 'O fim precisa ser depois do início.' });
  const erroTeto = regras.erroTeto(c.teto);
  if (erroTeto) campos.push({ campo: 'teto', mensagem: erroTeto });
  const categorias = listaDeNomes(c.categorias, 'categorias', 'Categoria', campos);
  const cotas = listaDeNomes(c.cotas, 'cotas', 'Cota', campos);

  const criterios = [];
  if (c.criterios !== undefined && !Array.isArray(c.criterios)) campos.push({ campo: 'criterios', mensagem: 'Critérios: envie uma lista.' });
  (Array.isArray(c.criterios) ? c.criterios : []).slice(0, MAX_ITENS).forEach((cr, linha) => {
    const nome = texto(cr?.nome, 120);
    const chave = regras.slug(nome);
    const maximo = Number(cr?.maximo);
    if (!nome || !chave) campos.push({ campo: 'criterios', mensagem: 'Critério: preencha o nome.', linha });
    else if (criterios.some(x => x.chave === chave)) campos.push({ campo: 'criterios', mensagem: 'Critério: nome repetido.', linha });
    if (!Number.isFinite(maximo) || maximo <= 0) campos.push({ campo: 'criterios', mensagem: 'Critério: o máximo precisa ser maior que zero.', linha });
    if (nome && chave && Number.isFinite(maximo) && maximo > 0) criterios.push({ chave, nome, maximo, bonus: cr?.bonus === true });
  });

  const camposExtras = [];
  if (c.camposExtras !== undefined && !Array.isArray(c.camposExtras)) campos.push({ campo: 'camposExtras', mensagem: 'Campos extras: envie uma lista.' });
  (Array.isArray(c.camposExtras) ? c.camposExtras : []).slice(0, MAX_ITENS).forEach((ce, linha) => {
    const rotulo = texto(ce?.rotulo, 160);
    const tipo = texto(ce?.tipo, 20);
    const chave = `extra-${regras.slug(rotulo)}`;
    if (!rotulo || chave === 'extra-') { campos.push({ campo: 'camposExtras', mensagem: 'Campo extra: preencha o rótulo.', linha }); return; }
    if (!regras.TIPOS_CAMPO.includes(tipo)) { campos.push({ campo: 'camposExtras', mensagem: 'Campo extra: tipo inválido.', linha }); return; }
    if (camposExtras.some(x => x.chave === chave)) { campos.push({ campo: 'camposExtras', mensagem: 'Campo extra: rótulo repetido.', linha }); return; }
    const item = { chave, rotulo, tipo, obrigatorio: ce?.obrigatorio === true };
    if (tipo === 'selecao') {
      const opcoes = listaDeNomes(ce?.opcoes, 'camposExtras', 'Opção', campos);
      if (!opcoes.length) campos.push({ campo: 'camposExtras', mensagem: 'Campo extra de seleção precisa de opções.', linha });
      item.opcoes = opcoes;
    }
    camposExtras.push(item);
  });

  if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
  return { numero, titulo, descricao, inicio, fim, teto, ano: Number(inicio.slice(0, 4)), categorias, cotas, criterios, camposExtras };
}

// Orçamento: valor unitário em centavos inteiros, guardado sem arredondar.
// Vazio vira null. Negativo, fracionado ou texto dá 400, como no servidor.
function lerOrcamento(bruto) {
  const campos = [];
  const linhas = lista(bruto).map((o, linha) => {
    const v = o?.valor;
    let valor = null;
    if (v !== null && v !== undefined && v !== '') {
      const erro = regras.erroValorItem(v);
      if (erro) campos.push({ campo: 'orc-valor', mensagem: erro, linha });
      else valor = Number(v);
    }
    return { descricao: texto(o?.descricao, 300), qtd: numeroOuNulo(o?.qtd), valor };
  });
  if (campos.length) throw falha(400, 'validacao', 'Confira os valores do orçamento.', campos);
  return linhas;
}

// Monta uma ficha só com os campos conhecidos. Anexos vêm sempre do registro guardado.
function limparFicha(bruta, edital, anexos) {
  const f = bruta && typeof bruta === 'object' && !Array.isArray(bruta) ? bruta : {};
  const extras = {};
  const brutos = f.extras && typeof f.extras === 'object' ? f.extras : {};
  for (const c of edital.camposExtras) {
    if (c.tipo === 'anexo' || !(c.chave in brutos)) continue;
    const v = brutos[c.chave];
    if (c.tipo === 'marcar') extras[c.chave] = v === true;
    else if (c.tipo === 'numero') extras[c.chave] = numeroOuNulo(v);
    else if (c.tipo === 'selecao') extras[c.chave] = (c.opcoes || []).includes(v) ? v : '';
    else extras[c.chave] = texto(v, c.tipo === 'texto-longo' ? 10000 : 500);
  }
  return {
    titulo: texto(f.titulo, 200),
    categoria: texto(f.categoria, 120),
    cota: texto(f.cota, 120),
    extras,
    metas: lista(f.metas).map(m => ({ etapa: texto(m?.etapa, 200), inicio: texto(m?.inicio, 10), fim: texto(m?.fim, 10), acao: texto(m?.acao, 1000) })),
    equipe: lista(f.equipe).map(p => ({ nome: texto(p?.nome, 160), funcao: texto(p?.funcao, 160), documento: regras.somenteDigitos(p?.documento).slice(0, 14) })),
    orcamento: lerOrcamento(f.orcamento),
    anexos: anexos || {},
    aceite: f.aceite === true,
  };
}

// ---------- Consultas no banco em memória, sempre por organização ----------

const proximoId = (db, nome) => { db.ids[nome] = (db.ids[nome] || 0) + 1; return db.ids[nome]; };
const editaisDaOrg = (db, orgId) => db.editais.filter(e => e.organizacaoId === orgId);
const editalPorSlug = (db, slug, orgId) => db.editais.find(e => e.slug === String(slug) && e.organizacaoId === orgId) || null;
const editalPorId = (db, id, orgId) => db.editais.find(e => e.id === id && e.organizacaoId === orgId) || null;
const avaliacaoDe = (db, insc) => db.avaliacoes.find(a => a.inscricaoId === insc.id && a.organizacaoId === insc.organizacaoId) || null;
const recursoDe = (db, insc) => db.recursos.find(r => r.inscricaoId === insc.id && r.organizacaoId === insc.organizacaoId) || null;
const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

function inscricaoDoDono(ctx, idOuProtocolo) {
  const { db, usuario } = ctx;
  const chave = String(idOuProtocolo);
  const insc = db.inscricoes.find(i => (i.id === chave || i.protocolo === chave) && i.usuarioId === usuario.id && i.organizacaoId === usuario.organizacaoId);
  if (!insc) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  const edital = editalPorId(db, insc.editalId, usuario.organizacaoId);
  if (!edital) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  return { insc, edital };
}

const completa = (ctx, insc, edital) => inscricaoCompleta(insc, edital, avaliacaoDe(ctx.db, insc), recursoDe(ctx.db, insc), ctx.agora);

function salvarFicha(ctx, insc, ficha) {
  insc.ficha = ficha;
  insc.atualizadoEm = ctx.agora.toISOString();
}

const congelada = () => falha(409, 'ficha_congelada', 'A inscrição já foi enviada e não pode mais ser alterada.');
const fechado = () => falha(409, 'edital_fechado', 'As inscrições deste edital não estão abertas.');

function editalDaOrgOu404(ctx, slug) {
  const ed = editalPorSlug(ctx.db, slug, ctx.usuario.organizacaoId);
  if (!ed) throw falha(404, 'nao_encontrado', 'Edital não encontrado.');
  return ed;
}

function inscricaoGestor(db, insc) {
  const edital = db.editais.find(e => e.id === insc.editalId && e.organizacaoId === insc.organizacaoId);
  const prop = db.usuarios.find(u => u.id === insc.usuarioId);
  const av = insc.avaliadorId == null ? null : db.usuarios.find(u => u.id === insc.avaliadorId && u.organizacaoId === insc.organizacaoId);
  const aval = avaliacaoDe(db, insc);
  const rec = recursoDe(db, insc);
  return {
    protocolo: insc.protocolo,
    edital: { slug: edital.slug, titulo: edital.titulo },
    titulo: insc.ficha.titulo ?? '',
    proponente: { nome: prop?.nome ?? '' },
    categoria: insc.ficha.categoria ?? '',
    cota: insc.ficha.cota ?? '',
    situacao: insc.situacao,
    resultado: insc.resultado ?? null,
    notaGeral: aval ? Number(aval.notaGeral) : null,
    avaliacaoEnviada: Boolean(aval),
    avaliador: av ? { id: av.id, nome: av.nome } : null,
    recurso: recursoPublico(rec, insc.protocolo),
  };
}

function inscricaoGestorPorProtocolo(ctx, protocolo) {
  const insc = ctx.db.inscricoes.find(i => i.organizacaoId === ctx.usuario.organizacaoId && ['enviada', 'concluida'].includes(i.situacao) && i.protocolo === String(protocolo));
  if (!insc) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  return insc;
}

function slugLivre(db, base, orgId) {
  const raiz = base || 'edital';
  for (let n = 1; n < 1000; n++) {
    const s = n === 1 ? raiz : `${raiz}-${n}`;
    if (!db.editais.some(e => e.organizacaoId === orgId && e.slug === s)) return s;
  }
  throw falha(409, 'slug_existente', 'Não foi possível gerar o endereço do edital.');
}

function atribuida(ctx, protocolo) {
  const u = ctx.usuario;
  const insc = ctx.db.inscricoes.find(i => i.protocolo === String(protocolo) && i.avaliadorId === u.id && i.organizacaoId === u.organizacaoId && ['enviada', 'concluida'].includes(i.situacao));
  if (!insc) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  const edital = editalPorId(ctx.db, insc.editalId, u.organizacaoId);
  if (!edital) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  return { insc, edital };
}

function fichaParaAvaliador(ficha) {
  const { proponente, ...resto } = ficha || {};
  return proponente ? { ...resto, proponente: { nome: proponente.nome, natureza: proponente.natureza } } : resto;
}

// ---------- Limite de login por documento ----------

function lerTentativa(db, chave, agora) {
  const t = db.tentativas[chave];
  if (!t) return { erros: 0, bloqueadoAte: null };
  const ms = agora.getTime();
  if (t.bloqueadoAte && new Date(t.bloqueadoAte).getTime() <= ms) return { erros: 0, bloqueadoAte: null };
  if (!t.bloqueadoAte && new Date(t.atualizadoEm).getTime() + BLOQUEIO_MS <= ms) return { erros: 0, bloqueadoAte: null };
  return { erros: Number(t.erros), bloqueadoAte: t.bloqueadoAte };
}

function registrarErroLogin(db, documento, agora) {
  const chave = `doc:${documento}`;
  const erros = lerTentativa(db, chave, agora).erros + 1;
  db.tentativas[chave] = {
    erros,
    bloqueadoAte: erros >= LIMITE_ERROS ? new Date(agora.getTime() + BLOQUEIO_MS).toISOString() : null,
    atualizadoEm: agora.toISOString(),
  };
}

// ---------- Rotas ----------

const rotasAcesso = [
  {
    metodo: 'GET', caminho: '/api/sessao', papel: 'logado',
    fn: async ctx => ({ corpo: { usuario: usuarioPublico(ctx.db, ctx.usuario) } }),
  },
  {
    metodo: 'GET', caminho: '/api/organizacoes', papel: 'publico',
    fn: async ctx => ({ corpo: { organizacoes: [...ctx.db.organizacoes].sort(porNome).map(o => ({ slug: o.slug, nome: o.nome })) } }),
  },
  {
    metodo: 'POST', caminho: '/api/acesso/documento', papel: 'publico',
    fn: async ctx => {
      const digitos = exigirDocumento(ctx.corpo.documento);
      return { corpo: { existe: ctx.db.usuarios.some(u => u.documento === digitos) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/entrar', papel: 'publico',
    fn: async ctx => {
      const { db, agora } = ctx;
      const digitos = exigirDocumento(ctx.corpo.documento);
      const senha = typeof ctx.corpo.senha === 'string' ? ctx.corpo.senha : '';
      if (lerTentativa(db, `doc:${digitos}`, agora).bloqueadoAte) throw falha(429, 'bloqueado', 'Muitas tentativas. Tente de novo em 15 minutos.');
      const usuario = db.usuarios.find(u => u.documento === digitos);
      const certa = usuario ? (await hashSenha(senha, usuario.sal)) === usuario.senhaHash : false;
      if (!certa) {
        registrarErroLogin(db, digitos, agora);
        throw falha(401, 'senha_incorreta', 'Senha incorreta.');
      }
      delete db.tentativas[`doc:${digitos}`];
      ctx.abrirSessao(usuario.id);
      return { corpo: { usuario: usuarioPublico(db, usuario) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/sair', papel: 'logado',
    fn: async ctx => {
      ctx.fecharSessao();
      return { status: 204 };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/criar-conta', papel: 'publico',
    fn: async ctx => {
      const { db } = ctx;
      const c = ctx.corpo;
      const { digitos, nome, email, campos } = validarDadosConta(c, { exigirConfirmacao: true });
      const natureza = texto(c.natureza, 40);
      const telefone = regras.somenteDigitos(c.telefone).slice(0, 15);
      const slugOrg = texto(c.organizacao, 80);
      if (!regras.NATUREZAS.includes(natureza)) campos.push({ campo: 'natureza', mensagem: 'Campo obrigatório: Natureza' });
      if (telefone.length < 10) campos.push({ campo: 'telefone', mensagem: 'Informe um telefone com DDD.' });
      if (!slugOrg) campos.push({ campo: 'organizacao', mensagem: 'Campo obrigatório: Organização' });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      const org = db.organizacoes.find(o => o.slug === slugOrg);
      if (!org) throw falha(404, 'organizacao_inexistente', 'Organização não encontrada.');
      if (db.usuarios.some(u => u.documento === digitos)) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
      const sal = gerarSal();
      const u = {
        id: proximoId(db, 'usuario'), organizacaoId: org.id, papel: 'proponente', nome, natureza, documento: digitos, email, telefone, endereco: null,
        sal, senhaHash: await hashSenha(c.senha, sal),
      };
      db.usuarios.push(u);
      ctx.abrirSessao(u.id);
      return { status: 201, corpo: { usuario: usuarioPublico(db, u) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/esqueci-senha', papel: 'publico',
    fn: async ctx => {
      const { db, agora } = ctx;
      const digitos = exigirDocumento(ctx.corpo.documento);
      const u = db.usuarios.find(x => x.documento === digitos);
      const corpo = { ok: true, mensagem: MSG_ESQUECI };
      if (u) {
        const token = gerarAleatorio(32);
        db.tokens = db.tokens.filter(t => t.usuarioId !== u.id || t.usadoEm);
        db.tokens.push({ hash: await hashSenha(token, 'redefinicao'), usuarioId: u.id, expiraEm: new Date(agora.getTime() + REDEFINICAO_MS).toISOString(), usadoEm: null });
        corpo.link = `#/redefinir?token=${encodeURIComponent(token)}`;
      }
      return { corpo };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/redefinir', papel: 'publico',
    fn: async ctx => {
      const { db, agora } = ctx;
      const c = ctx.corpo;
      const token = typeof c.token === 'string' ? c.token : '';
      const invalido = () => falha(400, 'token_invalido', 'Link inválido ou vencido. Peça um novo.');
      if (!token || token.length > 200) throw invalido();
      const campos = conferirSenhaNova(c.senha, c.senhaConfirmacao);
      const h = await hashSenha(token, 'redefinicao');
      const t = db.tokens.find(x => x.hash === h && !x.usadoEm && new Date(x.expiraEm).getTime() > agora.getTime());
      if (!t) throw invalido();
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      const u = db.usuarios.find(x => x.id === t.usuarioId);
      t.usadoEm = agora.toISOString();
      u.sal = gerarSal();
      u.senhaHash = await hashSenha(c.senha, u.sal);
      ctx.fecharSessaoDe(u.id);
      delete db.tentativas[`doc:${u.documento}`];
      return { status: 204 };
    },
  },
];

const rotasConta = [
  {
    metodo: 'GET', caminho: '/api/conta', papel: 'logado',
    fn: async ctx => ({ corpo: { usuario: usuarioPublico(ctx.db, ctx.usuario) } }),
  },
  {
    metodo: 'PUT', caminho: '/api/conta', papel: 'logado',
    fn: async ctx => {
      const c = ctx.corpo;
      if (c.documento !== undefined && regras.somenteDigitos(c.documento) !== ctx.usuario.documento) {
        throw falha(400, 'documento_inalteravel', 'O documento não pode ser alterado.');
      }
      const campos = [];
      const nome = texto(c.nome, 120);
      const email = texto(c.email, 160).toLowerCase();
      const telefone = regras.somenteDigitos(c.telefone).slice(0, 15);
      if (!nome) campos.push({ campo: 'nome', mensagem: 'Campo obrigatório: Nome' });
      if (!EMAIL_RE.test(email)) campos.push({ campo: 'email', mensagem: 'Informe um e-mail válido.' });
      if (telefone && telefone.length < 10) campos.push({ campo: 'telefone', mensagem: 'Informe um telefone com DDD.' });
      const endereco = lerEndereco(c.endereco, campos);
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      Object.assign(ctx.usuario, { nome, email, telefone: telefone || null, endereco });
      return { corpo: { usuario: usuarioPublico(ctx.db, ctx.usuario) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/conta/senha', papel: 'logado',
    fn: async ctx => {
      const c = ctx.corpo;
      const atual = typeof c.senhaAtual === 'string' ? c.senhaAtual : '';
      if ((await hashSenha(atual, ctx.usuario.sal)) !== ctx.usuario.senhaHash) throw falha(400, 'senha_atual_incorreta', 'A senha atual não confere.');
      const campos = conferirSenhaNova(c.novaSenha, c.novaSenhaConfirmacao, 'novaSenha', 'novaSenhaConfirmacao');
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      ctx.usuario.sal = gerarSal();
      ctx.usuario.senhaHash = await hashSenha(c.novaSenha, ctx.usuario.sal);
      return { status: 204 };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/conta/organizacao', papel: 'proponente',
    fn: async ctx => {
      const org = ctx.db.organizacoes.find(o => o.slug === texto(ctx.corpo.organizacao, 80));
      if (!org) throw falha(404, 'organizacao_inexistente', 'Organização não encontrada.');
      ctx.usuario.organizacaoId = org.id;
      return { corpo: { usuario: usuarioPublico(ctx.db, ctx.usuario) } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/cep/:cep', papel: 'logado',
    fn: async ctx => {
      const cep = regras.somenteDigitos(ctx.params.cep);
      if (cep.length !== 8 || cep !== ctx.params.cep.replace(/[.\-\s]/g, '')) throw falha(400, 'cep_invalido', 'O CEP precisa ter 8 dígitos.');
      let d;
      try {
        const opcoes = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(5000) } : {};
        const r = await ctx.buscarFetch(`https://viacep.com.br/ws/${cep}/json/`, opcoes);
        if (!r.ok) throw new Error(`ViaCEP respondeu ${r.status}`);
        d = await r.json();
      } catch {
        throw falha(502, 'cep_indisponivel', 'A busca de CEP está fora do ar. Preencha o endereço à mão.');
      }
      if (!d || d.erro) throw falha(404, 'cep_nao_encontrado', 'CEP não encontrado.');
      return { corpo: { cep: String(d.cep || cep).replace(/\D/g, '') || cep, logradouro: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade || '', uf: d.uf || '' } };
    },
  },
];

const rotasProponente = [
  {
    metodo: 'GET', caminho: '/api/proponente/painel', papel: 'proponente',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const orgId = usuario.organizacaoId;
      const editais = editaisDaOrg(db, orgId).sort((a, b) => comparar(b.inicio, a.inicio) || b.id - a.id);
      const porId = new Map(editais.map(e => [e.id, e]));
      const porSlug = Object.fromEntries(editais.map(e => [e.slug, e]));
      const meus = db.inscricoes.filter(i => i.usuarioId === usuario.id && i.organizacaoId === orgId && porId.has(i.editalId))
        .sort((a, b) => comparar(b.criadoEm, a.criadoEm) || comparar(b.protocolo ?? '', a.protocolo ?? ''));
      const inscricoes = meus.map(i => inscricaoResumo(i, porId.get(i.editalId), avaliacaoDe(db, i)));
      const anos = new Map();
      for (const e of editais.filter(x => x.situacao === 'encerrado')) {
        if (!anos.has(e.ano)) anos.set(e.ano, []);
        anos.get(e.ano).push(editalResumo(e));
      }
      const historico = [...anos.entries()].sort((a, b) => b[0] - a[0]).map(([ano, eds]) => ({ ano, editais: eds }));
      const aviso = db.avisos.filter(a => a.organizacaoId === orgId && a.ativo).sort((a, b) => comparar(b.criadoEm, a.criadoEm) || b.id - a.id)[0];
      return {
        corpo: {
          usuario: usuarioPublico(db, usuario),
          organizacoes: [...db.organizacoes].sort(porNome).map(o => ({ slug: o.slug, nome: o.nome })),
          contadores: regras.contadores(inscricoes, porSlug),
          editaisAbertos: editais.filter(e => regras.periodoAberto(e, agora)).map(editalResumo),
          inscricoes,
          historico,
          aviso: aviso ? { id: aviso.id, texto: aviso.texto } : null,
        },
      };
    },
  },
  {
    metodo: 'GET', caminho: '/api/editais/:slug', papel: 'logado',
    fn: async ctx => {
      const edital = ctx.usuario.organizacaoId == null ? null : editalPorSlug(ctx.db, ctx.params.slug, ctx.usuario.organizacaoId);
      if (!edital || (edital.situacao === 'rascunho' && ctx.usuario.papel !== 'gestor')) throw falha(404, 'nao_encontrado', 'Edital não encontrado.');
      return { corpo: { edital: editalPublico(edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes', papel: 'proponente',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const edital = editalPorSlug(db, texto(ctx.corpo.edital, 120), usuario.organizacaoId);
      if (!edital || edital.situacao === 'rascunho') throw falha(404, 'nao_encontrado', 'Edital não encontrado.');
      if (!regras.periodoAberto(edital, agora)) throw fechado();
      const quando = agora.toISOString();
      const insc = {
        id: gerarAleatorio(16), organizacaoId: usuario.organizacaoId, editalId: edital.id, usuarioId: usuario.id, protocolo: null,
        ficha: limparFicha(ctx.corpo.ficha, edital, {}), situacao: 'rascunho', resultado: null, etapa: 1, avaliadorId: null,
        enviadaEm: null, criadoEm: quando, atualizadoEm: quando,
      };
      db.inscricoes.push(insc);
      return { status: 201, corpo: { inscricao: completa(ctx, insc, edital) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/inscricoes/:id', papel: 'proponente',
    fn: async ctx => {
      const { insc, edital } = inscricaoDoDono(ctx, ctx.params.id);
      if (insc.situacao !== 'rascunho') throw congelada();
      salvarFicha(ctx, insc, limparFicha(ctx.corpo.ficha, edital, insc.ficha.anexos));
      return { corpo: { inscricao: completa(ctx, insc, edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes/:id/enviar', papel: 'proponente',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const { insc, edital } = inscricaoDoDono(ctx, ctx.params.id);
      if (insc.situacao !== 'rascunho') throw congelada();
      if (!regras.periodoAberto(edital, agora)) throw fechado();
      const ficha = limparFicha(ctx.corpo.ficha, edital, insc.ficha.anexos);
      const erros = regras.validarFicha(edital, ficha);
      if (erros.length) {
        salvarFicha(ctx, insc, ficha);
        throw falha(400, 'validacao', 'Preencha os campos obrigatórios.', erros);
      }
      const teto = regras.mensagemTeto(regras.totalOrcamento(ficha.orcamento), edital.teto);
      if (teto) {
        salvarFicha(ctx, insc, ficha);
        throw falha(400, 'acima_do_teto', teto, [{ campo: 'orcamento', mensagem: teto }]);
      }
      ficha.proponente = { nome: usuario.nome, documento: usuario.documento, natureza: usuario.natureza, email: usuario.email, telefone: usuario.telefone };
      const ano = anoBrasil(agora);
      const nome = `protocolo-${ano}`;
      db.sequencias[nome] = (db.sequencias[nome] || 0) + 1;
      insc.protocolo = regras.gerarProtocolo(ano, db.sequencias[nome]);
      insc.ficha = ficha;
      insc.situacao = 'enviada';
      insc.enviadaEm = agora.toISOString();
      insc.atualizadoEm = agora.toISOString();
      return { corpo: { inscricao: completa(ctx, insc, edital) } };
    },
  },
  {
    // No modo demonstração o corpo é { nome, tipo, tamanho }. Os bytes não são guardados.
    metodo: 'POST', caminho: '/api/inscricoes/:id/anexos/:chave', papel: 'proponente',
    fn: async ctx => {
      const { db } = ctx;
      const { insc, edital } = inscricaoDoDono(ctx, ctx.params.id);
      if (insc.situacao !== 'rascunho') throw congelada();
      const campo = edital.camposExtras.find(c => c.chave === ctx.params.chave && c.tipo === 'anexo');
      if (!campo) throw falha(404, 'nao_encontrado', 'Campo de anexo não encontrado neste edital.');
      const c = ctx.corpo;
      const tipo = typeof c.tipo === 'string' ? c.tipo.split(';')[0].trim().toLowerCase() : '';
      if (tipo !== 'application/pdf') throw falha(415, 'tipo_invalido', 'Envie um arquivo PDF.');
      const tamanho = Number(c.tamanho) || 0;
      const nome = String(c.nome ?? '').replace(/[\\/\u0000-\u001f"]/g, '_').trim().slice(0, 200);
      const msg = regras.validarArquivoPdf({ nome, tipo, tamanho });
      if (msg && tamanho > regras.LIMITE_ANEXO) throw falha(413, 'arquivo_grande', msg);
      if (msg && tamanho === 0) throw falha(400, 'validacao', msg, [{ campo: campo.chave, mensagem: msg }]);
      if (msg) throw falha(415, 'tipo_invalido', 'Envie um arquivo PDF.');
      const id = gerarAleatorio(16);
      db.anexos = db.anexos.filter(a => !(a.inscricaoId === insc.id && a.chave === campo.chave));
      db.anexos.push({ id, organizacaoId: insc.organizacaoId, inscricaoId: insc.id, chave: campo.chave, nome, tamanho });
      insc.ficha = { ...insc.ficha, anexos: { ...(insc.ficha.anexos || {}), [campo.chave]: { id, nome, tamanho } } };
      insc.atualizadoEm = ctx.agora.toISOString();
      return { status: 201, corpo: { anexo: { id, nome, tamanho } } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/anexos/:id', papel: ['proponente', 'gestor', 'avaliador'],
    fn: async () => { throw falha(404, 'anexo_nao_guardado', 'No modo demonstração o arquivo não é guardado.'); },
  },
  {
    metodo: 'GET', caminho: '/api/inscricoes/:protocoloOuId', papel: 'proponente',
    fn: async ctx => {
      const { insc, edital } = inscricaoDoDono(ctx, ctx.params.protocoloOuId);
      return { corpo: { inscricao: completa(ctx, insc, edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes/:protocolo/recurso', papel: 'proponente',
    fn: async ctx => {
      const { db, agora } = ctx;
      const { insc, edital } = inscricaoDoDono(ctx, ctx.params.protocolo);
      const justificativa = texto(ctx.corpo.justificativa, 5000);
      if (!justificativa) throw falha(400, 'validacao', 'Escreva a justificativa do recurso.', [{ campo: 'justificativa', mensagem: 'Campo obrigatório: Justificativa' }]);
      if (recursoDe(db, insc)) throw falha(409, 'recurso_existente', 'Esta inscrição já tem um recurso.');
      if (!regras.recursoPermitido({ inscricao: insc, edital, recurso: null, agora })) throw falha(400, 'fora_do_prazo', 'O prazo de recurso não está aberto.');
      const r = {
        id: gerarAleatorio(16), organizacaoId: insc.organizacaoId, inscricaoId: insc.id, justificativa, situacao: 'Em análise',
        parecer: null, criadoEm: agora.toISOString(), decididoEm: null, decididoPor: null,
      };
      db.recursos.push(r);
      return { status: 201, corpo: { recurso: recursoPublico(r, insc.protocolo) } };
    },
  },
];

const rotasGestor = [
  {
    metodo: 'GET', caminho: '/api/gestor/editais', papel: 'gestor',
    fn: async ctx => ({
      corpo: { editais: editaisDaOrg(ctx.db, ctx.usuario.organizacaoId).sort((a, b) => comparar(b.criadoEm, a.criadoEm) || b.id - a.id).map(editalResumo) },
    }),
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais', papel: 'gestor',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const m = lerModeloEdital(ctx.corpo);
      const slug = slugLivre(db, regras.slug(m.numero), usuario.organizacaoId);
      const ed = {
        id: proximoId(db, 'edital'), organizacaoId: usuario.organizacaoId, slug, numero: m.numero, titulo: m.titulo, descricao: m.descricao,
        inicio: m.inicio, fim: m.fim, teto: m.teto, ano: m.ano, situacao: 'rascunho', resultadoPublicadoEm: null,
        categorias: m.categorias, cotas: m.cotas, criterios: m.criterios, camposExtras: m.camposExtras, criadoEm: agora.toISOString(),
      };
      db.editais.push(ed);
      return { status: 201, corpo: { edital: editalPublico(ed) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/gestor/editais/:slug', papel: 'gestor',
    fn: async ctx => {
      const ed = editalDaOrgOu404(ctx, ctx.params.slug);
      if (ed.situacao === 'encerrado') throw falha(409, 'edital_encerrado', 'Edital encerrado não pode ser alterado.');
      const m = lerModeloEdital(ctx.corpo);
      Object.assign(ed, { numero: m.numero, titulo: m.titulo, descricao: m.descricao, inicio: m.inicio, fim: m.fim, teto: m.teto, ano: m.ano, categorias: m.categorias, cotas: m.cotas, criterios: m.criterios, camposExtras: m.camposExtras });
      return { corpo: { edital: editalPublico(ed) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais/:slug/abrir', papel: 'gestor',
    fn: async ctx => {
      const ed = editalDaOrgOu404(ctx, ctx.params.slug);
      if (ed.situacao !== 'rascunho') throw falha(409, 'situacao', 'Só um edital em rascunho pode ser aberto.');
      const motivos = regras.motivosParaNaoAbrir(ed, ctx.agora);
      if (motivos.length) throw falha(400, 'nao_pode_abrir', 'O edital ainda não pode ser aberto.', motivos.map(mensagem => ({ campo: 'edital', mensagem })));
      ed.situacao = 'aberto';
      return { corpo: { edital: editalPublico(ed) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais/:slug/encerrar', papel: 'gestor',
    fn: async ctx => {
      const ed = editalDaOrgOu404(ctx, ctx.params.slug);
      if (ed.situacao !== 'aberto') throw falha(409, 'situacao', 'Só um edital aberto pode ser encerrado.');
      ed.situacao = 'encerrado';
      return { corpo: { edital: editalPublico(ed) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais/:slug/publicar-resultado', papel: 'gestor',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const ed = editalDaOrgOu404(ctx, ctx.params.slug);
      if (ed.resultadoPublicadoEm) throw falha(409, 'ja_publicado', 'O resultado deste edital já foi publicado.');
      if (ed.situacao !== 'encerrado') throw falha(409, 'edital_nao_encerrado', 'Encerre as inscrições antes de publicar o resultado.');
      const doEdital = db.inscricoes.filter(i => i.editalId === ed.id && i.organizacaoId === usuario.organizacaoId);
      const pendentes = doEdital.filter(i => i.situacao === 'enviada' && !i.resultado).length;
      if (pendentes > 0) throw falha(409, 'resultado_incompleto', `Defina o resultado de todas as inscrições. Faltam ${pendentes}.`);
      ed.resultadoPublicadoEm = agora.toISOString();
      for (const i of doEdital) {
        if (i.situacao === 'enviada' && ['selecionado', 'suplente'].includes(i.resultado) && i.etapa < 4) { i.etapa = 4; i.atualizadoEm = agora.toISOString(); }
      }
      return { corpo: { edital: editalPublico(ed) } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/gestor/avisos', papel: 'gestor',
    fn: async ctx => ({
      corpo: {
        avisos: ctx.db.avisos.filter(a => a.organizacaoId === ctx.usuario.organizacaoId)
          .sort((a, b) => comparar(b.criadoEm, a.criadoEm) || b.id - a.id)
          .map(a => ({ id: a.id, texto: a.texto, ativo: Boolean(a.ativo), criadoEm: a.criadoEm })),
      },
    }),
  },
  {
    metodo: 'POST', caminho: '/api/gestor/avisos', papel: 'gestor',
    fn: async ctx => {
      const t = texto(ctx.corpo.texto, 500);
      if (!t) throw falha(400, 'validacao', 'Escreva o texto do aviso.', [{ campo: 'texto', mensagem: 'Campo obrigatório: Texto do aviso' }]);
      const ativo = ctx.corpo.ativo !== false;
      const aviso = { id: proximoId(ctx.db, 'aviso'), organizacaoId: ctx.usuario.organizacaoId, texto: t, ativo, criadoEm: ctx.agora.toISOString() };
      ctx.db.avisos.push(aviso);
      return { status: 201, corpo: { aviso: { id: aviso.id, texto: t, ativo, criadoEm: aviso.criadoEm } } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/gestor/avaliadores', papel: 'gestor',
    fn: async ctx => ({
      corpo: {
        avaliadores: ctx.db.usuarios.filter(u => u.organizacaoId === ctx.usuario.organizacaoId && u.papel === 'avaliador')
          .sort(porNome).map(a => ({ id: a.id, nome: a.nome })),
      },
    }),
  },
  {
    metodo: 'POST', caminho: '/api/gestor/avaliadores', papel: 'gestor',
    fn: async ctx => {
      const { db } = ctx;
      const { digitos, nome, email, campos } = validarDadosConta(ctx.corpo, { documentoComoCampo: true });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      if (db.usuarios.some(u => u.documento === digitos)) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
      const sal = gerarSal();
      const u = {
        id: proximoId(db, 'usuario'), organizacaoId: ctx.usuario.organizacaoId, papel: 'avaliador', nome, natureza: null, documento: digitos, email,
        telefone: null, endereco: null, sal, senhaHash: await hashSenha(ctx.corpo.senha, sal),
      };
      db.usuarios.push(u);
      return { status: 201, corpo: { avaliador: { id: u.id, nome } } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/gestor/inscricoes', papel: 'gestor',
    fn: async ctx => {
      const slugEdital = texto(ctx.query.get('edital'), 120);
      const filtro = FILTROS.includes(ctx.query.get('situacao')) ? ctx.query.get('situacao') : 'todas';
      const todas = ctx.db.inscricoes
        .filter(i => i.organizacaoId === ctx.usuario.organizacaoId && ['enviada', 'concluida'].includes(i.situacao))
        .filter(i => !slugEdital || ctx.db.editais.find(e => e.id === i.editalId)?.slug === slugEdital)
        .sort((a, b) => comparar(a.protocolo, b.protocolo))
        .map(i => inscricaoGestor(ctx.db, i));
      const passa = {
        todas: () => true,
        'aguardando-avaliacao': i => !i.avaliacaoEnviada,
        avaliada: i => i.avaliacaoEnviada,
        selecionado: i => i.resultado === 'selecionado',
        suplente: i => i.resultado === 'suplente',
        nao_selecionado: i => i.resultado === 'nao_selecionado',
        'com-recurso': i => Boolean(i.recurso),
      }[filtro];
      return { corpo: { inscricoes: todas.filter(passa) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/inscricoes/:protocolo/avaliador', papel: 'gestor',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const insc = inscricaoGestorPorProtocolo(ctx, ctx.params.protocolo);
      const avaliadorId = Number(ctx.corpo.avaliador);
      const av = db.usuarios.find(u => u.id === (Number.isInteger(avaliadorId) ? avaliadorId : -1) && u.organizacaoId === usuario.organizacaoId && u.papel === 'avaliador');
      if (!av) throw falha(404, 'nao_encontrado', 'Avaliador não encontrado.');
      if (avaliacaoDe(db, insc)) throw falha(409, 'avaliacao_enviada', 'A avaliação já foi enviada. Não dá para trocar o avaliador.');
      insc.avaliadorId = avaliadorId;
      insc.atualizadoEm = agora.toISOString();
      return { corpo: { inscricao: inscricaoGestor(db, insc) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/gestor/inscricoes/:protocolo/resultado', papel: 'gestor',
    fn: async ctx => {
      const { db, agora } = ctx;
      const insc = inscricaoGestorPorProtocolo(ctx, ctx.params.protocolo);
      const resultado = ctx.corpo.resultado;
      if (!regras.RESULTADOS.includes(resultado)) throw falha(400, 'validacao', 'Escolha um resultado válido.', [{ campo: 'resultado', mensagem: 'Escolha Selecionado, Suplente ou Não selecionado.' }]);
      const ed = editalPorId(db, insc.editalId, insc.organizacaoId);
      if (ed.resultadoPublicadoEm) throw falha(409, 'ja_publicado', 'O resultado deste edital já foi publicado.');
      if (insc.situacao !== 'enviada') throw falha(409, 'situacao', 'Esta inscrição não aceita resultado.');
      insc.resultado = resultado;
      insc.atualizadoEm = agora.toISOString();
      return { corpo: { inscricao: inscricaoGestor(db, insc) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/recursos/:id/decisao', papel: 'gestor',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const r = db.recursos.find(x => x.id === ctx.params.id && x.organizacaoId === usuario.organizacaoId);
      const insc = r && db.inscricoes.find(i => i.id === r.inscricaoId && i.organizacaoId === r.organizacaoId);
      if (!r || !insc) throw falha(404, 'nao_encontrado', 'Recurso não encontrado.');
      const decisao = ctx.corpo.decisao;
      const parecer = texto(ctx.corpo.parecer, 5000);
      const campos = [];
      if (decisao !== 'deferido' && decisao !== 'indeferido') campos.push({ campo: 'decisao', mensagem: 'Escolha deferir ou indeferir.' });
      if (!parecer) campos.push({ campo: 'parecer-recurso', mensagem: 'Campo obrigatório: Parecer' });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      if (r.situacao !== 'Em análise') throw falha(409, 'ja_decidido', 'Este recurso já foi decidido.');
      Object.assign(r, { situacao: decisao === 'deferido' ? 'Deferido' : 'Indeferido', parecer, decididoEm: agora.toISOString(), decididoPor: usuario.id });
      return { corpo: { recurso: recursoPublico(r, insc.protocolo) } };
    },
  },
];

const rotasAvaliador = [
  {
    metodo: 'GET', caminho: '/api/avaliador/inscricoes', papel: 'avaliador',
    fn: async ctx => {
      const { db, usuario } = ctx;
      const minhas = db.inscricoes
        .filter(i => i.avaliadorId === usuario.id && i.organizacaoId === usuario.organizacaoId && ['enviada', 'concluida'].includes(i.situacao))
        .sort((a, b) => comparar(a.protocolo, b.protocolo));
      return {
        corpo: {
          inscricoes: minhas.map(i => {
            const ed = editalPorId(db, i.editalId, i.organizacaoId);
            const aval = avaliacaoDe(db, i);
            return {
              protocolo: i.protocolo,
              edital: { slug: ed.slug, titulo: ed.titulo },
              titulo: i.ficha.titulo ?? '',
              avaliacaoEnviada: Boolean(aval),
              notaGeral: aval ? Number(aval.notaGeral) : null,
            };
          }),
        },
      };
    },
  },
  {
    metodo: 'GET', caminho: '/api/avaliador/inscricoes/:protocolo', papel: 'avaliador',
    fn: async ctx => {
      const { insc, edital } = atribuida(ctx, ctx.params.protocolo);
      return {
        corpo: {
          inscricao: {
            protocolo: insc.protocolo,
            edital: { slug: edital.slug, titulo: edital.titulo },
            titulo: insc.ficha.titulo ?? '',
            categoria: insc.ficha.categoria ?? '',
            cota: insc.ficha.cota ?? '',
            ficha: fichaParaAvaliador(insc.ficha),
            criterios: edital.criterios,
            avaliacao: avaliacaoPublica(avaliacaoDe(ctx.db, insc)),
          },
        },
      };
    },
  },
  {
    metodo: 'POST', caminho: '/api/avaliador/inscricoes/:protocolo/avaliacao', papel: 'avaliador',
    fn: async ctx => {
      const { db, usuario, agora } = ctx;
      const { insc, edital } = atribuida(ctx, ctx.params.protocolo);
      if (avaliacaoDe(db, insc)) throw falha(409, 'avaliacao_enviada', 'A avaliação desta inscrição já foi enviada.');
      const notasBrutas = ctx.corpo.notas && typeof ctx.corpo.notas === 'object' ? ctx.corpo.notas : {};
      const { erros, notaGeral } = regras.validarNotas(edital.criterios, notasBrutas);
      if (erros.length) throw falha(400, 'nota_invalida', 'Confira as notas.', erros);
      const parecer = texto(ctx.corpo.parecer, 10000);
      if (!parecer) throw falha(400, 'validacao', 'Escreva o parecer.', [{ campo: 'parecer', mensagem: 'Campo obrigatório: Parecer' }]);
      const notas = edital.criterios.map(c => ({
        chave: c.chave, nome: c.nome, maximo: c.maximo, bonus: c.bonus,
        nota: Number(String(notasBrutas[c.chave]).replace(',', '.')),
      }));
      const enviadaEm = agora.toISOString();
      db.avaliacoes.push({ inscricaoId: insc.id, organizacaoId: insc.organizacaoId, avaliadorId: usuario.id, notas, notaGeral, parecer, enviadaEm });
      return { status: 201, corpo: { avaliacao: { notas, notaGeral, parecer, enviadaEm } } };
    },
  },
];

const rotasPlataforma = [
  {
    metodo: 'GET', caminho: '/api/plataforma/organizacoes', papel: 'plataforma',
    fn: async ctx => ({
      corpo: {
        organizacoes: [...ctx.db.organizacoes].sort(porNome).map(o => ({
          slug: o.slug,
          nome: o.nome,
          totalEditais: ctx.db.editais.filter(e => e.organizacaoId === o.id).length,
          gestores: ctx.db.usuarios.filter(u => u.papel === 'gestor' && u.organizacaoId === o.id).sort(porNome).map(g => ({ nome: g.nome, email: g.email })),
        })),
      },
    }),
  },
  {
    metodo: 'POST', caminho: '/api/plataforma/organizacoes', papel: 'plataforma',
    fn: async ctx => {
      const { db } = ctx;
      const c = ctx.corpo;
      const g = c.gestor && typeof c.gestor === 'object' ? c.gestor : {};
      const nome = texto(c.nome, 160);
      const slug = texto(c.slug, 80);
      const dados = validarDadosConta(g, { documentoComoCampo: true });
      const campos = dados.campos.map(x => ({ ...x, campo: `gestor.${x.campo}` }));
      if (!nome) campos.push({ campo: 'nome', mensagem: 'Campo obrigatório: Nome da organização' });
      if (!SLUG_RE.test(slug)) campos.push({ campo: 'slug', mensagem: 'Use só letras minúsculas, números e hífen.' });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      if (db.organizacoes.some(o => o.slug === slug)) throw falha(409, 'slug_existente', 'Já existe uma organização com esse endereço.');
      if (db.usuarios.some(u => u.documento === dados.digitos)) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
      const org = { id: proximoId(db, 'organizacao'), slug, nome };
      db.organizacoes.push(org);
      const sal = gerarSal();
      const gestor = {
        id: proximoId(db, 'usuario'), organizacaoId: org.id, papel: 'gestor', nome: dados.nome, natureza: null, documento: dados.digitos, email: dados.email,
        telefone: null, endereco: null, sal, senhaHash: await hashSenha(g.senha, sal),
      };
      db.usuarios.push(gestor);
      return { status: 201, corpo: { organizacao: { slug, nome }, gestor: { id: gestor.id, nome: dados.nome } } };
    },
  },
];

const ROTAS = [...rotasAcesso, ...rotasConta, ...rotasProponente, ...rotasGestor, ...rotasAvaliador, ...rotasPlataforma]
  .map(r => ({ ...r, ...compilar(r.caminho) }));

// ---------- Servidor falso ----------

export function criarDemo({ armazenamento, agora = () => new Date(), fetch: buscarFetch = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!armazenamento) throw new Error('criarDemo precisa de armazenamento.');
  let cauda = Promise.resolve();
  const naFila = fn => {
    const r = cauda.then(fn);
    cauda = r.catch(() => {});
    return r;
  };

  async function carregar(momento) {
    const bruto = armazenamento.getItem(CHAVE_BANCO);
    if (bruto) {
      try {
        const db = JSON.parse(bruto);
        if (db && db.versao === 1) return db;
      } catch { /* banco corrompido: semeia de novo */ }
    }
    return semear(momento);
  }

  const gravar = db => armazenamento.setItem(CHAVE_BANCO, JSON.stringify(db));

  function lerSessao() {
    try { return JSON.parse(armazenamento.getItem(CHAVE_SESSAO) || 'null'); } catch { return null; }
  }

  function usuarioDaSessao(db, momento) {
    const s = lerSessao();
    if (!s || !s.expiraEm || new Date(s.expiraEm).getTime() <= momento.getTime()) return null;
    return db.usuarios.find(u => u.id === s.usuarioId) || null;
  }

  async function processar(metodo, caminho, corpo) {
    const momento = agora();
    const db = await carregar(momento);
    const gravarSempre = metodo !== 'GET' || !armazenamento.getItem(CHAVE_BANCO);
    try {
      const url = new URL(caminho, 'http://local');
      let params = null;
      const rota = ROTAS.find(r => {
        if (r.metodo !== metodo) return false;
        const m = r.re.exec(url.pathname);
        if (!m) return false;
        try { params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])])); } catch { return false; }
        return true;
      });
      if (!rota) throw falha(404, 'nao_encontrado', 'Endereço não encontrado.');

      const usuario = usuarioDaSessao(db, momento);
      if (rota.papel !== 'publico') {
        if (!usuario) throw falha(401, 'sem_sessao', 'Entre para continuar.');
        const papeis = rota.papel === 'logado' ? null : [].concat(rota.papel);
        if (papeis && !papeis.includes(usuario.papel)) throw falha(403, 'sem_permissao', 'Seu perfil não tem acesso a esta área.');
      }
      if ((metodo === 'POST' || metodo === 'PUT') && corpo !== undefined && corpo !== null && (typeof corpo !== 'object' || Array.isArray(corpo))) {
        throw falha(400, 'json_invalido', 'O corpo do pedido precisa ser um objeto.');
      }

      const ctx = {
        db, agora: momento, params, query: url.searchParams, usuario, buscarFetch,
        corpo: corpo && typeof corpo === 'object' ? corpo : {},
        abrirSessao(usuarioId) {
          armazenamento.setItem(CHAVE_SESSAO, JSON.stringify({ token: gerarAleatorio(32), usuarioId, expiraEm: new Date(momento.getTime() + SESSAO_MS).toISOString() }));
        },
        fecharSessao() { armazenamento.removeItem(CHAVE_SESSAO); },
        fecharSessaoDe(usuarioId) {
          if (lerSessao()?.usuarioId === usuarioId) armazenamento.removeItem(CHAVE_SESSAO);
        },
      };
      const r = await rota.fn(ctx);
      if (gravarSempre) gravar(db);
      const status = r?.status ?? 200;
      return { status, corpo: r?.corpo === undefined || status === 204 ? null : JSON.parse(JSON.stringify(r.corpo)) };
    } catch (e) {
      if (gravarSempre) gravar(db);
      if (e instanceof ErroHttp) {
        const c = { erro: e.erro, mensagem: e.message };
        if (e.campos) c.campos = e.campos;
        return { status: e.status, corpo: c };
      }
      return { status: 500, corpo: { erro: 'erro_interno', mensagem: 'Algo deu errado. Tente de novo.' } };
    }
  }

  return {
    modo: 'demonstracao',
    requisitar: (metodo, caminho, corpo) => naFila(() => processar(String(metodo).toUpperCase(), caminho, corpo)),
  };
}
