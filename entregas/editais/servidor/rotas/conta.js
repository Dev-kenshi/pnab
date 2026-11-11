// Rotas da conta: dados, senha, organização do proponente e busca de CEP.
import * as regras from '../../js/regras.js';
import { buscarUsuario, usuarioPublico } from '../banco.js';
import { LIMITES, contarUso, dentroDoLimite, falha, hashSenha, verificarSenha, zerarUso } from '../seguranca.js';
import { conferirSenhaNova, texto } from './acesso.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default [
  {
    metodo: 'GET', caminho: '/api/conta', papel: 'logado',
    fn: async ctx => ({ corpo: { usuario: usuarioPublico(ctx.usuario) } }),
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
      await ctx.banco.executar('UPDATE usuarios SET nome = ?, email = ?, telefone = ?, endereco = ? WHERE id = ?', [
        nome, email, telefone || null, endereco ? JSON.stringify(endereco) : null, ctx.usuario.id,
      ]);
      return { corpo: { usuario: usuarioPublico(await buscarUsuario(ctx.banco, ctx.usuario.id)) } };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/conta/senha', papel: 'logado',
    fn: async ctx => {
      const c = ctx.corpo;
      // Quem pegou uma sessão aberta não pode testar senhas à vontade: 5 erros em 15 minutos bloqueiam.
      const regra = LIMITES.senhaAtualPorUsuario;
      if (!(await dentroDoLimite(ctx.banco, regra, ctx.usuario.id, ctx.agora))) {
        await ctx.auditar('limite_excedido', { alvo: 'senha-atual' });
        throw falha(429, 'limite', 'Muitas tentativas com a senha atual. Tente de novo em 15 minutos.');
      }
      if (!(await verificarSenha(typeof c.senhaAtual === 'string' ? c.senhaAtual : '', ctx.usuario.senha_hash))) {
        await contarUso(ctx.banco, regra, ctx.usuario.id, ctx.agora);
        throw falha(400, 'senha_atual_incorreta', 'A senha atual não confere.');
      }
      await zerarUso(ctx.banco, regra, ctx.usuario.id);
      const campos = conferirSenhaNova(c.novaSenha, c.novaSenhaConfirmacao, 'novaSenha', 'novaSenhaConfirmacao', ctx.usuario);
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      const senhaHash = await hashSenha(c.novaSenha);
      await ctx.banco.executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, ctx.usuario.id]);
      await ctx.banco.executar('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?', [ctx.usuario.id, ctx.sessaoHash]);
      await ctx.auditar('senha_alterada', { alvo: ctx.usuario.documento });
      return { status: 204 };
    },
  },
  {
    metodo: 'PUT', caminho: '/api/conta/organizacao', papel: 'proponente',
    fn: async ctx => {
      const slugOrg = texto(ctx.corpo.organizacao, 80);
      const { linhas } = await ctx.banco.executar('SELECT id FROM organizacoes WHERE slug = ?', [slugOrg]);
      if (!linhas[0]) throw falha(404, 'organizacao_inexistente', 'Organização não encontrada.');
      await ctx.banco.executar('UPDATE usuarios SET organizacao_id = ? WHERE id = ?', [linhas[0].id, ctx.usuario.id]);
      return { corpo: { usuario: usuarioPublico(await buscarUsuario(ctx.banco, ctx.usuario.id)) } };
    },
  },
  {
    metodo: 'GET', caminho: '/api/cep/:cep', papel: 'logado',
    fn: async ctx => {
      const cep = regras.somenteDigitos(ctx.params.cep);
      if (cep.length !== 8 || cep !== ctx.params.cep.replace(/[.\-\s]/g, '')) throw falha(400, 'cep_invalido', 'O CEP precisa ter 8 dígitos.');
      let r;
      try { r = await ctx.buscarCepRemoto(cep); } catch { throw falha(502, 'cep_indisponivel', 'A busca de CEP está fora do ar. Preencha o endereço à mão.'); }
      if (!r) throw falha(404, 'cep_nao_encontrado', 'CEP não encontrado.');
      return { corpo: { cep: r.cep || cep, logradouro: r.logradouro || '', bairro: r.bairro || '', cidade: r.cidade || '', uf: r.uf || '' } };
    },
  },
];
