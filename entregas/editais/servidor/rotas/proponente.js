// Rotas do proponente: painel, edital, inscrição, anexos e recurso.
import * as regras from '../../js/regras.js';
import {
  buscarAvaliacao, buscarEditalPorId, buscarEditalPorSlug, buscarRecurso, editalDaLinha, editalPublico, editalResumo,
  inscricaoCompleta, inscricaoDaLinha, inscricaoResumo, recursoDaLinha, usuarioPublico,
} from '../banco.js';
import { falha, gerarId } from '../seguranca.js';
import { texto } from './acesso.js';

const MAX_LINHAS = 200;

const lista = (v, max = MAX_LINHAS) => (Array.isArray(v) ? v.slice(0, max) : []);
const numeroOuNulo = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Monta uma ficha só com os campos conhecidos. Anexos vêm sempre do servidor.
export function limparFicha(bruta, edital, anexos) {
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
    orcamento: lista(f.orcamento).map(o => {
      const valor = numeroOuNulo(o?.valor);
      return { descricao: texto(o?.descricao, 300), qtd: numeroOuNulo(o?.qtd), valor: valor === null ? null : Math.round(valor) };
    }),
    anexos: anexos || {},
    aceite: f.aceite === true,
  };
}

function anoBrasil(agora) {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).getUTCFullYear();
}

async function inscricaoDoDono(ctx, idOuProtocolo) {
  const { linhas } = await ctx.banco.executar(
    'SELECT * FROM inscricoes WHERE (id = ? OR protocolo = ?) AND usuario_id = ? AND organizacao_id = ?',
    [String(idOuProtocolo), String(idOuProtocolo), ctx.usuario.id, ctx.usuario.organizacao_id],
  );
  if (!linhas[0]) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  const insc = inscricaoDaLinha(linhas[0]);
  const edital = await buscarEditalPorId(ctx.banco, insc.editalId, ctx.usuario.organizacao_id);
  if (!edital) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  return { insc, edital };
}

async function completa(ctx, insc, edital) {
  const av = await buscarAvaliacao(ctx.banco, insc.id, insc.organizacaoId);
  const rec = await buscarRecurso(ctx.banco, insc.id, insc.organizacaoId);
  return inscricaoCompleta(insc, edital, av, rec, ctx.agora);
}

async function salvarFicha(ctx, insc, ficha) {
  await ctx.banco.executar('UPDATE inscricoes SET ficha = ?, atualizado_em = ? WHERE id = ? AND organizacao_id = ?', [
    JSON.stringify(ficha), ctx.agora.toISOString(), insc.id, insc.organizacaoId,
  ]);
  insc.ficha = ficha;
}

const congelada = () => falha(409, 'ficha_congelada', 'A inscrição já foi enviada e não pode mais ser alterada.');
const fechado = () => falha(409, 'edital_fechado', 'As inscrições deste edital não estão abertas.');

export default [
  {
    metodo: 'GET', caminho: '/api/proponente/painel', papel: 'proponente',
    fn: async ctx => {
      const { banco, usuario, agora } = ctx;
      const orgId = usuario.organizacao_id;
      const orgs = (await banco.executar('SELECT slug, nome FROM organizacoes ORDER BY nome')).linhas;
      const editais = (await banco.executar('SELECT * FROM editais WHERE organizacao_id = ? ORDER BY inicio DESC, id DESC', [orgId])).linhas.map(editalDaLinha);
      const porId = new Map(editais.map(e => [e.id, e]));
      const porSlug = Object.fromEntries(editais.map(e => [e.slug, e]));
      const linhas = (await banco.executar('SELECT * FROM inscricoes WHERE usuario_id = ? AND organizacao_id = ? ORDER BY criado_em DESC, protocolo DESC', [usuario.id, orgId])).linhas;
      const avaliacoes = new Map((await banco.executar(
        'SELECT a.* FROM avaliacoes a JOIN inscricoes i ON i.id = a.inscricao_id WHERE i.usuario_id = ? AND a.organizacao_id = ?', [usuario.id, orgId],
      )).linhas.map(a => [a.inscricao_id, a]));
      const inscricoes = linhas.map(inscricaoDaLinha).filter(i => porId.has(i.editalId))
        .map(i => inscricaoResumo(i, porId.get(i.editalId), avaliacoes.get(i.id)));
      const anos = new Map();
      for (const e of editais.filter(e => e.situacao === 'encerrado')) {
        if (!anos.has(e.ano)) anos.set(e.ano, []);
        anos.get(e.ano).push(editalResumo(e));
      }
      const historico = [...anos.entries()].sort((a, b) => b[0] - a[0]).map(([ano, lista]) => ({ ano, editais: lista }));
      const aviso = (await banco.executar('SELECT id, texto FROM avisos WHERE organizacao_id = ? AND ativo = 1 ORDER BY criado_em DESC, id DESC LIMIT 1', [orgId])).linhas[0];
      return {
        corpo: {
          usuario: usuarioPublico(usuario),
          organizacoes: orgs.map(o => ({ slug: o.slug, nome: o.nome })),
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
      const edital = ctx.usuario.organizacao_id == null ? null : await buscarEditalPorSlug(ctx.banco, ctx.params.slug, ctx.usuario.organizacao_id);
      if (!edital || (edital.situacao === 'rascunho' && ctx.usuario.papel !== 'gestor')) throw falha(404, 'nao_encontrado', 'Edital não encontrado.');
      return { corpo: { edital: editalPublico(edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes', papel: 'proponente',
    fn: async ctx => {
      const edital = await buscarEditalPorSlug(ctx.banco, texto(ctx.corpo.edital, 120), ctx.usuario.organizacao_id);
      if (!edital || edital.situacao === 'rascunho') throw falha(404, 'nao_encontrado', 'Edital não encontrado.');
      if (!regras.periodoAberto(edital, ctx.agora)) throw fechado();
      const ficha = limparFicha(ctx.corpo.ficha, edital, {});
      const id = gerarId();
      const quando = ctx.agora.toISOString();
      await ctx.banco.executar(
        `INSERT INTO inscricoes (id, organizacao_id, edital_id, usuario_id, protocolo, ficha, situacao, resultado, etapa, avaliador_id, enviada_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, NULL, ?, 'rascunho', NULL, 1, NULL, NULL, ?, ?)`,
        [id, ctx.usuario.organizacao_id, edital.id, ctx.usuario.id, JSON.stringify(ficha), quando, quando],
      );
      const { insc } = await inscricaoDoDono(ctx, id);
      return { status: 201, corpo: { inscricao: await completa(ctx, insc, edital) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/inscricoes/:id', papel: 'proponente',
    fn: async ctx => {
      const { insc, edital } = await inscricaoDoDono(ctx, ctx.params.id);
      if (insc.situacao !== 'rascunho') throw congelada();
      await salvarFicha(ctx, insc, limparFicha(ctx.corpo.ficha, edital, insc.ficha.anexos));
      return { corpo: { inscricao: await completa(ctx, insc, edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes/:id/enviar', papel: 'proponente',
    fn: async ctx => {
      const { insc, edital } = await inscricaoDoDono(ctx, ctx.params.id);
      if (insc.situacao !== 'rascunho') throw congelada();
      if (!regras.periodoAberto(edital, ctx.agora)) throw fechado();
      const ficha = limparFicha(ctx.corpo.ficha, edital, insc.ficha.anexos);
      const erros = regras.validarFicha(edital, ficha);
      if (erros.length) {
        await salvarFicha(ctx, insc, ficha);
        throw falha(400, 'validacao', 'Preencha os campos obrigatórios.', erros);
      }
      const teto = regras.mensagemTeto(regras.totalOrcamento(ficha.orcamento), edital.teto);
      if (teto) {
        await salvarFicha(ctx, insc, ficha);
        throw falha(400, 'acima_do_teto', teto, [{ campo: 'orcamento', mensagem: teto }]);
      }
      const u = ctx.usuario;
      ficha.proponente = { nome: u.nome, documento: u.documento, natureza: u.natureza, email: u.email, telefone: u.telefone };
      const ano = anoBrasil(ctx.agora);
      await ctx.banco.transacao(async tx => {
        const nome = `protocolo-${ano}`;
        await tx.executar('INSERT INTO sequencias (nome, valor) VALUES (?, 0) ON CONFLICT (nome) DO NOTHING', [nome]);
        await tx.executar('UPDATE sequencias SET valor = valor + 1 WHERE nome = ?', [nome]);
        const seq = (await tx.executar('SELECT valor FROM sequencias WHERE nome = ?', [nome])).linhas[0].valor;
        const protocolo = regras.gerarProtocolo(ano, seq);
        const r = await tx.executar(
          `UPDATE inscricoes SET ficha = ?, situacao = 'enviada', protocolo = ?, enviada_em = ?, atualizado_em = ?
           WHERE id = ? AND organizacao_id = ? AND situacao = 'rascunho'`,
          [JSON.stringify(ficha), protocolo, ctx.agora.toISOString(), ctx.agora.toISOString(), insc.id, insc.organizacaoId],
        );
        if (r.alteradas !== 1) throw congelada();
        await ctx.auditar('inscricao_enviada', { alvo: protocolo, detalhe: { edital: edital.slug } }, tx);
      });
      const atual = await inscricaoDoDono(ctx, insc.id);
      return { corpo: { inscricao: await completa(ctx, atual.insc, atual.edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes/:id/anexos/:chave', papel: 'proponente', corpo: 'pdf',
    fn: async ctx => {
      const { insc, edital } = await inscricaoDoDono(ctx, ctx.params.id);
      if (insc.situacao !== 'rascunho') throw congelada();
      const campo = edital.camposExtras.find(c => c.chave === ctx.params.chave && c.tipo === 'anexo');
      if (!campo) throw falha(404, 'nao_encontrado', 'Campo de anexo não encontrado neste edital.');
      const bytes = await ctx.lerPdf();
      let nome;
      try { nome = decodeURIComponent(String(ctx.req.headers['x-nome-arquivo'] || '')); } catch { nome = ''; }
      nome = nome.replace(/[\\/\u0000-\u001f"]/g, '_').trim().slice(0, 200);
      const msg = regras.validarArquivoPdf({ nome, tipo: 'application/pdf', tamanho: bytes.length });
      if (msg && bytes.length > regras.LIMITE_ANEXO) throw falha(413, 'arquivo_grande', msg);
      if (msg && bytes.length === 0) throw falha(400, 'validacao', msg, [{ campo: campo.chave, mensagem: msg }]);
      if (msg || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw falha(415, 'tipo_invalido', 'Envie um arquivo PDF.');
      const arquivoId = await ctx.anexos.gravar(bytes);
      const id = gerarId();
      const antigos = (await ctx.banco.executar('SELECT id, arquivo_id FROM anexos WHERE inscricao_id = ? AND chave = ? AND organizacao_id = ?', [insc.id, campo.chave, insc.organizacaoId])).linhas;
      await ctx.banco.transacao(async tx => {
        await tx.executar('INSERT INTO anexos (id, organizacao_id, inscricao_id, chave, nome, tamanho, arquivo_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          id, insc.organizacaoId, insc.id, campo.chave, nome, bytes.length, arquivoId, ctx.agora.toISOString(),
        ]);
        for (const a of antigos) await tx.executar('DELETE FROM anexos WHERE id = ?', [a.id]);
        const ficha = { ...insc.ficha, anexos: { ...(insc.ficha.anexos || {}), [campo.chave]: { id, nome, tamanho: bytes.length } } };
        await tx.executar('UPDATE inscricoes SET ficha = ?, atualizado_em = ? WHERE id = ? AND situacao = ?', [JSON.stringify(ficha), ctx.agora.toISOString(), insc.id, 'rascunho']);
      });
      for (const a of antigos) await ctx.anexos.apagar(a.arquivo_id).catch(() => {});
      return { status: 201, corpo: { anexo: { id, nome, tamanho: bytes.length } } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/anexos/:id', papel: ['proponente', 'gestor', 'avaliador'],
    fn: async ctx => {
      const u = ctx.usuario;
      const { linhas } = await ctx.banco.executar(
        `SELECT a.*, i.usuario_id AS dono_id, i.avaliador_id FROM anexos a JOIN inscricoes i ON i.id = a.inscricao_id
         WHERE a.id = ? AND a.organizacao_id = ? AND i.organizacao_id = ?`,
        [ctx.params.id, u.organizacao_id, u.organizacao_id],
      );
      const a = linhas[0];
      const pode = a && ((u.papel === 'proponente' && a.dono_id === u.id) || u.papel === 'gestor' || (u.papel === 'avaliador' && a.avaliador_id === u.id));
      if (!pode) throw falha(404, 'nao_encontrado', 'Anexo não encontrado.');
      let bytes;
      try { bytes = await ctx.anexos.ler(a.arquivo_id); } catch { throw falha(500, 'anexo_corrompido', 'Não foi possível abrir o anexo.'); }
      const res = ctx.res;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', bytes.length);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="anexo.pdf"; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
      res.end(bytes);
    },
  },
  {
    metodo: 'GET', caminho: '/api/inscricoes/:protocoloOuId', papel: 'proponente',
    fn: async ctx => {
      const { insc, edital } = await inscricaoDoDono(ctx, ctx.params.protocoloOuId);
      return { corpo: { inscricao: await completa(ctx, insc, edital) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/inscricoes/:protocolo/recurso', papel: 'proponente',
    fn: async ctx => {
      const { insc, edital } = await inscricaoDoDono(ctx, ctx.params.protocolo);
      const justificativa = texto(ctx.corpo.justificativa, 5000);
      if (!justificativa) throw falha(400, 'validacao', 'Escreva a justificativa do recurso.', [{ campo: 'justificativa', mensagem: 'Campo obrigatório: Justificativa' }]);
      if (await buscarRecurso(ctx.banco, insc.id, insc.organizacaoId)) throw falha(409, 'recurso_existente', 'Esta inscrição já tem um recurso.');
      if (!regras.recursoPermitido({ inscricao: insc, edital, recurso: null, agora: ctx.agora })) throw falha(400, 'fora_do_prazo', 'O prazo de recurso não está aberto.');
      const id = gerarId();
      try {
        await ctx.banco.executar(
          `INSERT INTO recursos (id, organizacao_id, inscricao_id, justificativa, situacao, parecer, criado_em, decidido_em, decidido_por)
           VALUES (?, ?, ?, ?, 'Em análise', NULL, ?, NULL, NULL)`,
          [id, insc.organizacaoId, insc.id, justificativa, ctx.agora.toISOString()],
        );
      } catch (e) {
        if (/UNIQUE/i.test(String(e.message))) throw falha(409, 'recurso_existente', 'Esta inscrição já tem um recurso.');
        throw e;
      }
      await ctx.auditar('recurso_enviado', { alvo: insc.protocolo });
      return { status: 201, corpo: { recurso: recursoDaLinha(await buscarRecurso(ctx.banco, insc.id, insc.organizacaoId), insc.protocolo) } };
    },
  },
];
