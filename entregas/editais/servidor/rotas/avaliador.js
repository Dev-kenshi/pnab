// Rotas do avaliador. Ele só enxerga as inscrições atribuídas a ele, na própria organização.
import * as regras from '../../js/regras.js';
import { avaliacaoDaLinha, buscarAvaliacao, buscarEditalPorId, inscricaoDaLinha } from '../banco.js';
import { falha } from '../seguranca.js';
import { texto } from './acesso.js';

async function atribuida(ctx, protocolo) {
  const u = ctx.usuario;
  const { linhas } = await ctx.banco.executar(
    "SELECT * FROM inscricoes WHERE protocolo = ? AND avaliador_id = ? AND organizacao_id = ? AND situacao IN ('enviada', 'concluida')",
    [String(protocolo), u.id, u.organizacao_id],
  );
  if (!linhas[0]) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  const insc = inscricaoDaLinha(linhas[0]);
  const edital = await buscarEditalPorId(ctx.banco, insc.editalId, u.organizacao_id);
  if (!edital) throw falha(404, 'nao_encontrado', 'Inscrição não encontrada.');
  return { insc, edital };
}

function fichaParaAvaliador(ficha) {
  const { proponente, ...resto } = ficha || {};
  return proponente ? { ...resto, proponente: { nome: proponente.nome, natureza: proponente.natureza } } : resto;
}

export default [
  {
    metodo: 'GET', caminho: '/api/avaliador/inscricoes', papel: 'avaliador',
    fn: async ctx => {
      const u = ctx.usuario;
      const { linhas } = await ctx.banco.executar(
        `SELECT i.protocolo, i.ficha, e.slug AS ed_slug, e.titulo AS ed_titulo, a.id AS aval_id, a.nota_geral
         FROM inscricoes i
         JOIN editais e ON e.id = i.edital_id AND e.organizacao_id = i.organizacao_id
         LEFT JOIN avaliacoes a ON a.inscricao_id = i.id AND a.organizacao_id = i.organizacao_id
         WHERE i.avaliador_id = ? AND i.organizacao_id = ? AND i.situacao IN ('enviada', 'concluida')
         ORDER BY i.protocolo`,
        [u.id, u.organizacao_id],
      );
      return {
        corpo: {
          inscricoes: linhas.map(l => {
            let ficha = {};
            try { ficha = JSON.parse(l.ficha); } catch {}
            return {
              protocolo: l.protocolo,
              edital: { slug: l.ed_slug, titulo: l.ed_titulo },
              titulo: ficha.titulo ?? '',
              avaliacaoEnviada: Boolean(l.aval_id),
              notaGeral: l.aval_id ? Number(l.nota_geral) : null,
            };
          }),
        },
      };
    },
  },
  {
    metodo: 'GET', caminho: '/api/avaliador/inscricoes/:protocolo', papel: 'avaliador',
    fn: async ctx => {
      const { insc, edital } = await atribuida(ctx, ctx.params.protocolo);
      const av = avaliacaoDaLinha(await buscarAvaliacao(ctx.banco, insc.id, insc.organizacaoId));
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
            avaliacao: av,
          },
        },
      };
    },
  },
  {
    metodo: 'POST', caminho: '/api/avaliador/inscricoes/:protocolo/avaliacao', papel: 'avaliador',
    fn: async ctx => {
      const { insc, edital } = await atribuida(ctx, ctx.params.protocolo);
      if (await buscarAvaliacao(ctx.banco, insc.id, insc.organizacaoId)) throw falha(409, 'avaliacao_enviada', 'A avaliação desta inscrição já foi enviada.');
      const notasBrutas = ctx.corpo.notas && typeof ctx.corpo.notas === 'object' ? ctx.corpo.notas : {};
      const { erros, notaGeral } = regras.validarNotas(edital.criterios, notasBrutas);
      if (erros.length) throw falha(400, 'nota_invalida', 'Confira as notas.', erros);
      const parecer = texto(ctx.corpo.parecer, 10000);
      if (!parecer) throw falha(400, 'validacao', 'Escreva o parecer.', [{ campo: 'parecer', mensagem: 'Campo obrigatório: Parecer' }]);
      const notas = edital.criterios.map(c => ({
        chave: c.chave, nome: c.nome, maximo: c.maximo, bonus: c.bonus,
        nota: Number(String(notasBrutas[c.chave]).replace(',', '.')),
      }));
      const enviadaEm = ctx.agora.toISOString();
      try {
        await ctx.banco.transacao(async tx => {
          await tx.executar(
            'INSERT INTO avaliacoes (organizacao_id, inscricao_id, avaliador_id, notas, nota_geral, parecer, enviada_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [insc.organizacaoId, insc.id, ctx.usuario.id, JSON.stringify(notas), notaGeral, parecer, enviadaEm],
          );
          await ctx.auditar('avaliacao_enviada', { alvo: insc.protocolo, detalhe: { notaGeral } }, tx);
        });
      } catch (e) {
        if (/UNIQUE/i.test(String(e.message))) throw falha(409, 'avaliacao_enviada', 'A avaliação desta inscrição já foi enviada.');
        throw e;
      }
      return { status: 201, corpo: { avaliacao: { notas, notaGeral, parecer, enviadaEm } } };
    },
  },
];
