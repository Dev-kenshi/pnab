// Rotas do gestor: editais, avisos, avaliadores, inscrições, resultado e recursos.
// Toda consulta filtra pela organização do gestor.
import * as regras from '../../js/regras.js';
import { buscarEditalPorSlug, editalDaLinha, editalPublico, editalResumo } from '../banco.js';
import { falha } from '../seguranca.js';
import { documentoExiste, inserirUsuario, texto, validarDadosConta } from './acesso.js';

const FILTROS = ['todas', 'aguardando-avaliacao', 'avaliada', 'selecionado', 'suplente', 'nao_selecionado', 'com-recurso'];
const MAX_ITENS = 50;

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

export function lerModeloEdital(c) {
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
  if (c.teto === null || c.teto === undefined || c.teto === '' || !Number.isInteger(teto) || teto <= 0) {
    campos.push({ campo: 'teto', mensagem: 'Campo obrigatório: Teto, em centavos e maior que zero' });
  }
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
  return { numero, titulo, descricao, inicio, fim, teto, ano: Number(inicio.slice(0, 4)), modelo: { categorias, cotas, criterios, camposExtras } };
}

async function editalDaOrg(ctx, slug) {
  const ed = await buscarEditalPorSlug(ctx.banco, slug, ctx.usuario.organizacao_id);
  if (!ed) throw falha(404, 'nao_encontrado', 'Edital não encontrado.');
  return ed;
}

const SQL_INSCRICAO_GESTOR = `SELECT i.protocolo, i.ficha, i.situacao, i.resultado, i.id,
    e.slug AS ed_slug, e.titulo AS ed_titulo,
    p.nome AS prop_nome, av.id AS av_id, av.nome AS av_nome,
    a.nota_geral, a.id AS aval_id,
    r.id AS rec_id, r.justificativa AS rec_just, r.situacao AS rec_sit, r.parecer AS rec_par, r.criado_em AS rec_criado, r.decidido_em AS rec_dec
  FROM inscricoes i
  JOIN editais e ON e.id = i.edital_id AND e.organizacao_id = i.organizacao_id
  JOIN usuarios p ON p.id = i.usuario_id
  LEFT JOIN usuarios av ON av.id = i.avaliador_id AND av.organizacao_id = i.organizacao_id
  LEFT JOIN avaliacoes a ON a.inscricao_id = i.id AND a.organizacao_id = i.organizacao_id
  LEFT JOIN recursos r ON r.inscricao_id = i.id AND r.organizacao_id = i.organizacao_id
  WHERE i.organizacao_id = ? AND i.situacao IN ('enviada', 'concluida')`;

function inscricaoGestor(l) {
  let ficha = {};
  try { ficha = JSON.parse(l.ficha); } catch {}
  return {
    protocolo: l.protocolo,
    edital: { slug: l.ed_slug, titulo: l.ed_titulo },
    titulo: ficha.titulo ?? '',
    proponente: { nome: l.prop_nome },
    categoria: ficha.categoria ?? '',
    cota: ficha.cota ?? '',
    situacao: l.situacao,
    resultado: l.resultado ?? null,
    notaGeral: l.aval_id ? Number(l.nota_geral) : null,
    avaliacaoEnviada: Boolean(l.aval_id),
    avaliador: l.av_id ? { id: l.av_id, nome: l.av_nome } : null,
    recurso: l.rec_id ? {
      id: l.rec_id, protocolo: l.protocolo, justificativa: l.rec_just, situacao: l.rec_sit, parecer: l.rec_par ?? null, criadoEm: l.rec_criado, decididoEm: l.rec_dec ?? null,
    } : null,
  };
}

async function inscricaoGestorPorProtocolo(ctx, protocolo) {
  const { linhas } = await ctx.banco.executar(`${SQL_INSCRICAO_GESTOR} AND i.protocolo = ?`, [ctx.usuario.organizacao_id, String(protocolo)]);
  if (!linhas[0]) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  return linhas[0];
}

async function slugLivre(banco, base, orgId) {
  const raiz = base || 'edital';
  for (let n = 1; n < 1000; n++) {
    const s = n === 1 ? raiz : `${raiz}-${n}`;
    const { linhas } = await banco.executar('SELECT 1 FROM editais WHERE organizacao_id = ? AND slug = ?', [orgId, s]);
    if (!linhas.length) return s;
  }
  throw falha(409, 'slug_existente', 'Não foi possível gerar o endereço do edital.');
}

export default [
  {
    metodo: 'GET', caminho: '/api/gestor/editais', papel: 'gestor',
    fn: async ctx => {
      const { linhas } = await ctx.banco.executar('SELECT * FROM editais WHERE organizacao_id = ? ORDER BY criado_em DESC, id DESC', [ctx.usuario.organizacao_id]);
      return { corpo: { editais: linhas.map(editalDaLinha).map(editalResumo) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais', papel: 'gestor',
    fn: async ctx => {
      const m = lerModeloEdital(ctx.corpo);
      const orgId = ctx.usuario.organizacao_id;
      const slug = await ctx.banco.transacao(async tx => {
        const s = await slugLivre(tx, regras.slug(m.numero), orgId);
        await tx.executar(
          `INSERT INTO editais (organizacao_id, slug, numero, titulo, descricao, inicio, fim, teto, ano, situacao, resultado_publicado_em, modelo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', NULL, ?, ?)`,
          [orgId, s, m.numero, m.titulo, m.descricao, m.inicio, m.fim, m.teto, m.ano, JSON.stringify(m.modelo), ctx.agora.toISOString()],
        );
        await ctx.auditar('edital_criado', { alvo: s, detalhe: { numero: m.numero, titulo: m.titulo } }, tx);
        return s;
      });
      return { status: 201, corpo: { edital: editalPublico(await editalDaOrg(ctx, slug)) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/gestor/editais/:slug', papel: 'gestor',
    fn: async ctx => {
      const ed = await editalDaOrg(ctx, ctx.params.slug);
      if (ed.situacao === 'encerrado') throw falha(409, 'edital_encerrado', 'Edital encerrado não pode ser alterado.');
      const m = lerModeloEdital(ctx.corpo);
      await ctx.banco.executar(
        `UPDATE editais SET numero = ?, titulo = ?, descricao = ?, inicio = ?, fim = ?, teto = ?, ano = ?, modelo = ?
         WHERE id = ? AND organizacao_id = ?`,
        [m.numero, m.titulo, m.descricao, m.inicio, m.fim, m.teto, m.ano, JSON.stringify(m.modelo), ed.id, ctx.usuario.organizacao_id],
      );
      await ctx.auditar('edital_alterado', { alvo: ed.slug, detalhe: { numero: m.numero, titulo: m.titulo } });
      return { corpo: { edital: editalPublico(await editalDaOrg(ctx, ed.slug)) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais/:slug/abrir', papel: 'gestor',
    fn: async ctx => {
      const ed = await editalDaOrg(ctx, ctx.params.slug);
      if (ed.situacao !== 'rascunho') throw falha(409, 'situacao', 'Só um edital em rascunho pode ser aberto.');
      const motivos = regras.motivosParaNaoAbrir(ed, ctx.agora);
      if (motivos.length) throw falha(400, 'nao_pode_abrir', 'O edital ainda não pode ser aberto.', motivos.map(mensagem => ({ campo: 'edital', mensagem })));
      await ctx.banco.executar("UPDATE editais SET situacao = 'aberto' WHERE id = ? AND organizacao_id = ? AND situacao = 'rascunho'", [ed.id, ctx.usuario.organizacao_id]);
      await ctx.auditar('edital_aberto', { alvo: ed.slug });
      return { corpo: { edital: editalPublico(await editalDaOrg(ctx, ed.slug)) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais/:slug/encerrar', papel: 'gestor',
    fn: async ctx => {
      const ed = await editalDaOrg(ctx, ctx.params.slug);
      if (ed.situacao !== 'aberto') throw falha(409, 'situacao', 'Só um edital aberto pode ser encerrado.');
      await ctx.banco.executar("UPDATE editais SET situacao = 'encerrado' WHERE id = ? AND organizacao_id = ? AND situacao = 'aberto'", [ed.id, ctx.usuario.organizacao_id]);
      await ctx.auditar('edital_encerrado', { alvo: ed.slug });
      return { corpo: { edital: editalPublico(await editalDaOrg(ctx, ed.slug)) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/editais/:slug/publicar-resultado', papel: 'gestor',
    fn: async ctx => {
      const ed = await editalDaOrg(ctx, ctx.params.slug);
      const orgId = ctx.usuario.organizacao_id;
      if (ed.resultadoPublicadoEm) throw falha(409, 'ja_publicado', 'O resultado deste edital já foi publicado.');
      if (ed.situacao !== 'encerrado') throw falha(409, 'edital_nao_encerrado', 'Encerre as inscrições antes de publicar o resultado.');
      const pendentes = (await ctx.banco.executar(
        "SELECT COUNT(*) AS n FROM inscricoes WHERE edital_id = ? AND organizacao_id = ? AND situacao = 'enviada' AND resultado IS NULL", [ed.id, orgId],
      )).linhas[0].n;
      if (Number(pendentes) > 0) throw falha(409, 'resultado_incompleto', `Defina o resultado de todas as inscrições. Faltam ${pendentes}.`);
      await ctx.banco.transacao(async tx => {
        await tx.executar('UPDATE editais SET resultado_publicado_em = ? WHERE id = ? AND organizacao_id = ? AND resultado_publicado_em IS NULL', [ctx.agora.toISOString(), ed.id, orgId]);
        await tx.executar(
          "UPDATE inscricoes SET etapa = 4, atualizado_em = ? WHERE edital_id = ? AND organizacao_id = ? AND situacao = 'enviada' AND resultado IN ('selecionado', 'suplente') AND etapa < 4",
          [ctx.agora.toISOString(), ed.id, orgId],
        );
        await ctx.auditar('resultado_publicado', { alvo: ed.slug }, tx);
      });
      return { corpo: { edital: editalPublico(await editalDaOrg(ctx, ed.slug)) } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/gestor/avisos', papel: 'gestor',
    fn: async ctx => {
      const { linhas } = await ctx.banco.executar('SELECT id, texto, ativo, criado_em FROM avisos WHERE organizacao_id = ? ORDER BY criado_em DESC, id DESC', [ctx.usuario.organizacao_id]);
      return { corpo: { avisos: linhas.map(a => ({ id: a.id, texto: a.texto, ativo: Boolean(a.ativo), criadoEm: a.criado_em })) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/avisos', papel: 'gestor',
    fn: async ctx => {
      const t = texto(ctx.corpo.texto, 500);
      if (!t) throw falha(400, 'validacao', 'Escreva o texto do aviso.', [{ campo: 'texto', mensagem: 'Campo obrigatório: Texto do aviso' }]);
      const ativo = ctx.corpo.ativo !== false;
      const r = await ctx.banco.executar('INSERT INTO avisos (organizacao_id, texto, ativo, criado_em) VALUES (?, ?, ?, ?)', [ctx.usuario.organizacao_id, t, ativo ? 1 : 0, ctx.agora.toISOString()]);
      await ctx.auditar('aviso_criado', { alvo: String(r.ultimoId) });
      return { status: 201, corpo: { aviso: { id: r.ultimoId, texto: t, ativo, criadoEm: ctx.agora.toISOString() } } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/gestor/avaliadores', papel: 'gestor',
    fn: async ctx => {
      const { linhas } = await ctx.banco.executar("SELECT id, nome FROM usuarios WHERE organizacao_id = ? AND papel = 'avaliador' ORDER BY nome", [ctx.usuario.organizacao_id]);
      return { corpo: { avaliadores: linhas.map(a => ({ id: a.id, nome: a.nome })) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/avaliadores', papel: 'gestor',
    fn: async ctx => {
      const { digitos, nome, email, campos } = validarDadosConta(ctx.corpo, { documentoComoCampo: true });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      if (await documentoExiste(ctx.banco, digitos)) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
      const id = await inserirUsuario(ctx.banco, { organizacaoId: ctx.usuario.organizacao_id, papel: 'avaliador', nome, documento: digitos, email, senha: ctx.corpo.senha, agora: ctx.agora });
      await ctx.auditar('conta_criada', { alvo: digitos, detalhe: { papel: 'avaliador', novoUsuario: id } });
      return { status: 201, corpo: { avaliador: { id, nome } } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/gestor/inscricoes', papel: 'gestor',
    fn: async ctx => {
      const slugEdital = texto(ctx.query.get('edital'), 120);
      const filtro = FILTROS.includes(ctx.query.get('situacao')) ? ctx.query.get('situacao') : 'todas';
      const params = [ctx.usuario.organizacao_id];
      let sql = SQL_INSCRICAO_GESTOR;
      if (slugEdital) { sql += ' AND e.slug = ?'; params.push(slugEdital); }
      sql += ' ORDER BY i.protocolo';
      const todas = (await ctx.banco.executar(sql, params)).linhas.map(inscricaoGestor);
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
      const orgId = ctx.usuario.organizacao_id;
      const l = await inscricaoGestorPorProtocolo(ctx, ctx.params.protocolo);
      const avaliadorId = Number(ctx.corpo.avaliador);
      const { linhas } = await ctx.banco.executar("SELECT id FROM usuarios WHERE id = ? AND organizacao_id = ? AND papel = 'avaliador'", [Number.isInteger(avaliadorId) ? avaliadorId : -1, orgId]);
      if (!linhas[0]) throw falha(404, 'nao_encontrado', 'Avaliador não encontrado.');
      if (l.aval_id) throw falha(409, 'avaliacao_enviada', 'A avaliação já foi enviada. Não dá para trocar o avaliador.');
      await ctx.banco.executar('UPDATE inscricoes SET avaliador_id = ?, atualizado_em = ? WHERE id = ? AND organizacao_id = ?', [avaliadorId, ctx.agora.toISOString(), l.id, orgId]);
      await ctx.auditar('avaliador_atribuido', { alvo: l.protocolo, detalhe: { avaliador: avaliadorId } });
      return { corpo: { inscricao: inscricaoGestor(await inscricaoGestorPorProtocolo(ctx, l.protocolo)) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/gestor/inscricoes/:protocolo/resultado', papel: 'gestor',
    fn: async ctx => {
      const orgId = ctx.usuario.organizacao_id;
      const l = await inscricaoGestorPorProtocolo(ctx, ctx.params.protocolo);
      const resultado = ctx.corpo.resultado;
      if (!regras.RESULTADOS.includes(resultado)) throw falha(400, 'validacao', 'Escolha um resultado válido.', [{ campo: 'resultado', mensagem: 'Escolha Selecionado, Suplente ou Não selecionado.' }]);
      const ed = await editalDaOrg(ctx, l.ed_slug);
      if (ed.resultadoPublicadoEm) throw falha(409, 'ja_publicado', 'O resultado deste edital já foi publicado.');
      if (l.situacao !== 'enviada') throw falha(409, 'situacao', 'Esta inscrição não aceita resultado.');
      await ctx.banco.executar('UPDATE inscricoes SET resultado = ?, atualizado_em = ? WHERE id = ? AND organizacao_id = ?', [resultado, ctx.agora.toISOString(), l.id, orgId]);
      await ctx.auditar('resultado_definido', { alvo: l.protocolo, detalhe: { resultado } });
      return { corpo: { inscricao: inscricaoGestor(await inscricaoGestorPorProtocolo(ctx, l.protocolo)) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/gestor/recursos/:id/decisao', papel: 'gestor',
    fn: async ctx => {
      const orgId = ctx.usuario.organizacao_id;
      const { linhas } = await ctx.banco.executar(
        'SELECT r.*, i.protocolo FROM recursos r JOIN inscricoes i ON i.id = r.inscricao_id AND i.organizacao_id = r.organizacao_id WHERE r.id = ? AND r.organizacao_id = ?',
        [ctx.params.id, orgId],
      );
      const r = linhas[0];
      if (!r) throw falha(404, 'nao_encontrado', 'Recurso não encontrado.');
      const decisao = ctx.corpo.decisao;
      const parecer = texto(ctx.corpo.parecer, 5000);
      const campos = [];
      if (decisao !== 'deferido' && decisao !== 'indeferido') campos.push({ campo: 'decisao', mensagem: 'Escolha deferir ou indeferir.' });
      if (!parecer) campos.push({ campo: 'parecer-recurso', mensagem: 'Campo obrigatório: Parecer' });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      if (r.situacao !== 'Em análise') throw falha(409, 'ja_decidido', 'Este recurso já foi decidido.');
      const situacao = decisao === 'deferido' ? 'Deferido' : 'Indeferido';
      const upd = await ctx.banco.executar(
        "UPDATE recursos SET situacao = ?, parecer = ?, decidido_em = ?, decidido_por = ? WHERE id = ? AND organizacao_id = ? AND situacao = 'Em análise'",
        [situacao, parecer, ctx.agora.toISOString(), ctx.usuario.id, r.id, orgId],
      );
      if (upd.alteradas !== 1) throw falha(409, 'ja_decidido', 'Este recurso já foi decidido.');
      await ctx.auditar('recurso_decidido', { alvo: r.protocolo, detalhe: { decisao: situacao } });
      return {
        corpo: { recurso: { id: r.id, protocolo: r.protocolo, justificativa: r.justificativa, situacao, parecer, criadoEm: r.criado_em, decididoEm: ctx.agora.toISOString() } },
      };
    },
  },
];
