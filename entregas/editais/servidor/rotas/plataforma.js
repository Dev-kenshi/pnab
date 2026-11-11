// Rotas da plataforma: organizações contratantes e seus gestores. Nunca lê inscrições.
import { falha } from '../seguranca.js';
import { documentoExiste, inserirUsuario, texto, validarDadosConta } from './acesso.js';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default [
  {
    metodo: 'GET', caminho: '/api/plataforma/organizacoes', papel: 'plataforma',
    fn: async ctx => {
      const orgs = (await ctx.banco.executar(
        'SELECT o.id, o.slug, o.nome, (SELECT COUNT(*) FROM editais e WHERE e.organizacao_id = o.id) AS total FROM organizacoes o ORDER BY o.nome',
      )).linhas;
      const gestores = (await ctx.banco.executar("SELECT organizacao_id, nome, email FROM usuarios WHERE papel = 'gestor' ORDER BY nome")).linhas;
      return {
        corpo: {
          organizacoes: orgs.map(o => ({
            slug: o.slug,
            nome: o.nome,
            totalEditais: Number(o.total),
            gestores: gestores.filter(g => g.organizacao_id === o.id).map(g => ({ nome: g.nome, email: g.email })),
          })),
        },
      };
    },
  },
  {
    metodo: 'POST', caminho: '/api/plataforma/organizacoes', papel: 'plataforma',
    fn: async ctx => {
      const c = ctx.corpo;
      const g = c.gestor && typeof c.gestor === 'object' ? c.gestor : {};
      const nome = texto(c.nome, 160);
      const slug = texto(c.slug, 80);
      const dados = validarDadosConta(g, { documentoComoCampo: true, papel: 'gestor' });
      const campos = dados.campos.map(x => ({ ...x, campo: `gestor.${x.campo}` }));
      if (!nome) campos.push({ campo: 'nome', mensagem: 'Campo obrigatório: Nome da organização' });
      if (!SLUG_RE.test(slug)) campos.push({ campo: 'slug', mensagem: 'Use só letras minúsculas, números e hífen.' });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      if ((await ctx.banco.executar('SELECT 1 FROM organizacoes WHERE slug = ?', [slug])).linhas.length) throw falha(409, 'slug_existente', 'Já existe uma organização com esse endereço.');
      if (await documentoExiste(ctx.banco, dados.digitos)) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
      const resultado = await ctx.banco.transacao(async tx => {
        const r = await tx.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', [slug, nome, ctx.agora.toISOString()]);
        const gestorId = await inserirUsuario(tx, { organizacaoId: r.ultimoId, papel: 'gestor', nome: dados.nome, documento: dados.digitos, email: dados.email, senha: g.senha, agora: ctx.agora });
        await ctx.auditar('organizacao_criada', { alvo: slug }, tx);
        await ctx.auditar('conta_criada', { alvo: dados.digitos, organizacaoId: r.ultimoId, detalhe: { papel: 'gestor', novoUsuario: gestorId } }, tx);
        return { organizacao: { slug, nome }, gestor: { id: gestorId, nome: dados.nome } };
      });
      return { status: 201, corpo: resultado };
    },
  },
];
