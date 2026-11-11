// Rotas de acesso: sessão, documento, entrar, sair, criar conta, esqueci e redefinir senha, organizações.
import * as regras from '../../js/regras.js';
import { SQL_USUARIO, buscarUsuario, usuarioPublico } from '../banco.js';
import {
  LIMITES, REDEFINICAO_MS, SENHA_PROIBIDA, SESSAO_MS, contarUso, cookieExpirado, cookieSessao, documentoReservado, falha, gerarToken,
  hashSenha, hashToken, loginBloqueado, precisaRefazerHash, registrarErroLogin, verificarSenha, verificarSenhaFicticia, zerarErrosDocumento,
} from '../seguranca.js';

const MSG_LIMITE = 'Muitas tentativas. Tente de novo mais tarde.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MSG_DOC_VAZIO = 'Documento obrigatório.';
const MSG_DOC_INVALIDO = 'Documento inválido. Confira os números.';
const MSG_ESQUECI = 'Se o documento estiver cadastrado, enviaremos um link de redefinição.';

export const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function exigirDocumento(valor) {
  const d = regras.somenteDigitos(valor);
  if (!d) throw falha(400, 'documento_obrigatorio', MSG_DOC_VAZIO);
  const v = regras.validarDocumento(d);
  if (!v.valido) throw falha(400, 'documento_invalido', MSG_DOC_INVALIDO);
  return v.digitos;
}

// Regras comuns a toda criação de conta e troca de senha.
// contexto: { papel, documento, nome, email } da conta, para recusar senha com dados dela.
export function conferirSenhaNova(senha, confirmacao, campo = 'senha', campoConfirmacao = 'senhaConfirmacao', contexto = {}) {
  if (senha === SENHA_PROIBIDA) throw falha(400, 'senha_proibida', 'Essa senha é de demonstração e não vale aqui. Escolha outra.');
  const campos = [];
  const msg = regras.validarSenha(senha, contexto);
  if (msg) campos.push({ campo, mensagem: msg });
  if (confirmacao !== undefined && senha !== confirmacao) campos.push({ campo: campoConfirmacao, mensagem: 'A confirmação não confere com a senha.' });
  return campos;
}

// Valida nome, documento, e-mail e senha de uma conta nova. Lança erro com os campos.
export function validarDadosConta(corpo, { exigirConfirmacao = false, documentoComoCampo = false, papel = 'proponente' } = {}) {
  const digitos = regras.somenteDigitos(corpo.documento);
  const campos = [];
  if (documentoComoCampo) {
    if (!regras.validarDocumento(digitos).valido) campos.push({ campo: 'documento', mensagem: MSG_DOC_INVALIDO });
  } else {
    exigirDocumento(digitos);
  }
  if (documentoReservado(digitos)) throw falha(400, 'documento_reservado', 'Esse documento é reservado para demonstração.');
  const nome = texto(corpo.nome, 120);
  const email = texto(corpo.email, 160).toLowerCase();
  campos.push(...conferirSenhaNova(corpo.senha, exigirConfirmacao ? corpo.senhaConfirmacao : undefined, 'senha', 'senhaConfirmacao', { papel, documento: digitos, nome, email }));
  if (!nome) campos.push({ campo: 'nome', mensagem: 'Campo obrigatório: Nome' });
  if (!EMAIL_RE.test(email)) campos.push({ campo: 'email', mensagem: 'Informe um e-mail válido.' });
  return { digitos, nome, email, campos };
}

export async function documentoExiste(banco, digitos) {
  const { linhas } = await banco.executar('SELECT id FROM usuarios WHERE documento = ?', [digitos]);
  return linhas.length > 0;
}

export async function inserirUsuario(banco, { organizacaoId, papel, nome, natureza = null, documento, email, telefone = null, senha, agora }) {
  const senhaHash = await hashSenha(senha);
  try {
    const r = await banco.executar(
      `INSERT INTO usuarios (organizacao_id, papel, nome, natureza, documento, email, telefone, endereco, senha_hash, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [organizacaoId, papel, nome, natureza, documento, email, telefone, senhaHash, agora.toISOString()],
    );
    return r.ultimoId;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
    throw e;
  }
}

async function abrirSessao(ctx, usuarioId) {
  const token = gerarToken();
  await ctx.banco.executar('DELETE FROM sessoes WHERE expira_em <= ?', [ctx.agora.toISOString()]);
  await ctx.banco.executar('INSERT INTO sessoes (token_hash, usuario_id, expira_em, criado_em) VALUES (?, ?, ?, ?)', [
    hashToken(token), usuarioId, new Date(ctx.agora.getTime() + SESSAO_MS).toISOString(), ctx.agora.toISOString(),
  ]);
  return cookieSessao(token, { https: ctx.https });
}

export default [
  {
    // Pública: sem sessão responde 200 com usuario null, para o navegador não registrar erro.
    metodo: 'GET', caminho: '/api/sessao', papel: 'publico',
    fn: async ctx => ({ corpo: { usuario: ctx.usuario ? usuarioPublico(ctx.usuario) : null } }),
  },
  {
    metodo: 'GET', caminho: '/api/organizacoes', papel: 'publico',
    fn: async ctx => {
      const { linhas } = await ctx.banco.executar('SELECT slug, nome FROM organizacoes ORDER BY nome');
      return { corpo: { organizacoes: linhas.map(o => ({ slug: o.slug, nome: o.nome })) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/documento', papel: 'publico',
    fn: async ctx => {
      // Limite por IP: dificulta varrer CPFs para descobrir quem tem conta.
      if (!(await contarUso(ctx.banco, LIMITES.documentoPorIp, ctx.ip, ctx.agora))) {
        await ctx.auditar('limite_excedido', { alvo: 'documento' });
        throw falha(429, 'limite', MSG_LIMITE);
      }
      const digitos = exigirDocumento(ctx.corpo.documento);
      return { corpo: { existe: await documentoExiste(ctx.banco, digitos) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/entrar', papel: 'publico',
    fn: async ctx => {
      const { banco, agora, ip } = ctx;
      const digitos = exigirDocumento(ctx.corpo.documento);
      const senha = typeof ctx.corpo.senha === 'string' ? ctx.corpo.senha : '';
      if (await loginBloqueado(banco, { documento: digitos, ip, agora })) {
        await ctx.auditar('login_bloqueado', { alvo: digitos });
        throw falha(429, 'bloqueado', 'Muitas tentativas. Tente de novo em 15 minutos.');
      }
      const { linhas } = await banco.executar(`${SQL_USUARIO} WHERE u.documento = ?`, [digitos]);
      const usuario = linhas[0];
      const certa = usuario ? await verificarSenha(senha, usuario.senha_hash) : await verificarSenhaFicticia(senha);
      if (!certa) {
        await banco.transacao(tx => registrarErroLogin(tx, { documento: digitos, ip, agora }));
        await ctx.auditar('login_falha', { alvo: digitos, usuarioId: usuario?.id ?? null, organizacaoId: usuario?.organizacao_id ?? null });
        throw falha(401, 'senha_incorreta', 'Senha incorreta.');
      }
      await zerarErrosDocumento(banco, digitos);
      // Senha guardada com parâmetros antigos do scrypt é refeita agora, com a senha certa em mãos.
      if (precisaRefazerHash(usuario.senha_hash)) {
        await banco.executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [await hashSenha(senha), usuario.id]);
      }
      const cookie = await abrirSessao(ctx, usuario.id);
      await ctx.auditar('login', { usuarioId: usuario.id, organizacaoId: usuario.organizacao_id, alvo: digitos });
      return { corpo: { usuario: usuarioPublico(usuario) }, cabecalhos: { 'Set-Cookie': cookie } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/sair', papel: 'logado',
    fn: async ctx => {
      await ctx.banco.executar('DELETE FROM sessoes WHERE token_hash = ?', [ctx.sessaoHash]);
      return { status: 204, cabecalhos: { 'Set-Cookie': cookieExpirado({ https: ctx.https }) } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/criar-conta', papel: 'publico',
    fn: async ctx => {
      const c = ctx.corpo;
      const { digitos, nome, email, campos } = validarDadosConta(c, { exigirConfirmacao: true });
      const natureza = texto(c.natureza, 40);
      const telefone = regras.somenteDigitos(c.telefone).slice(0, 15);
      const slugOrg = texto(c.organizacao, 80);
      if (!regras.NATUREZAS.includes(natureza)) campos.push({ campo: 'natureza', mensagem: 'Campo obrigatório: Natureza' });
      if (telefone.length < 10) campos.push({ campo: 'telefone', mensagem: 'Informe um telefone com DDD.' });
      if (!slugOrg) campos.push({ campo: 'organizacao', mensagem: 'Campo obrigatório: Organização' });
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      const { linhas } = await ctx.banco.executar('SELECT id FROM organizacoes WHERE slug = ?', [slugOrg]);
      if (!linhas[0]) throw falha(404, 'organizacao_inexistente', 'Organização não encontrada.');
      if (await documentoExiste(ctx.banco, digitos)) throw falha(409, 'documento_existente', 'Já existe uma conta com esse documento.');
      const id = await inserirUsuario(ctx.banco, {
        organizacaoId: linhas[0].id, papel: 'proponente', nome, natureza, documento: digitos, email, telefone, senha: c.senha, agora: ctx.agora,
      });
      const cookie = await abrirSessao(ctx, id);
      await ctx.auditar('conta_criada', { usuarioId: id, organizacaoId: linhas[0].id, alvo: digitos, detalhe: { papel: 'proponente' } });
      const usuario = await buscarUsuario(ctx.banco, id);
      return { status: 201, corpo: { usuario: usuarioPublico(usuario) }, cabecalhos: { 'Set-Cookie': cookie } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/esqueci-senha', papel: 'publico',
    fn: async ctx => {
      if (!(await contarUso(ctx.banco, LIMITES.esqueciPorIp, ctx.ip, ctx.agora))) {
        await ctx.auditar('limite_excedido', { alvo: 'esqueci-senha' });
        throw falha(429, 'limite', MSG_LIMITE);
      }
      const digitos = exigirDocumento(ctx.corpo.documento);
      // Por documento, o limite é silencioso: a resposta é a mesma, para não revelar se a conta existe.
      const dentro = await contarUso(ctx.banco, LIMITES.esqueciPorDocumento, digitos, ctx.agora);
      const { linhas } = await ctx.banco.executar('SELECT id, email, nome FROM usuarios WHERE documento = ?', [digitos]);
      const u = dentro ? linhas[0] : null;
      if (u) {
        const token = gerarToken();
        await ctx.banco.executar('DELETE FROM tokens_redefinicao WHERE usuario_id = ? AND usado_em IS NULL', [u.id]);
        await ctx.banco.executar('INSERT INTO tokens_redefinicao (token_hash, usuario_id, expira_em, usado_em) VALUES (?, ?, ?, NULL)', [
          hashToken(token), u.id, new Date(ctx.agora.getTime() + REDEFINICAO_MS).toISOString(),
        ]);
        const link = `${ctx.urlPublica}/#/redefinir?token=${encodeURIComponent(token)}`;
        Promise.resolve()
          .then(() => ctx.enviarEmail({ para: u.email, assunto: 'Redefinição de senha', texto: `Use este link em até 1 hora: ${link}`, link, token }))
          .catch(e => console.error('[e-mail] falha no envio', e?.message));
        await ctx.auditar('redefinicao_pedida', { usuarioId: u.id, alvo: digitos });
      }
      return { corpo: { ok: true, mensagem: MSG_ESQUECI } };
    },
  },
  {
    metodo: 'POST', caminho: '/api/acesso/redefinir', papel: 'publico',
    fn: async ctx => {
      const c = ctx.corpo;
      const token = typeof c.token === 'string' ? c.token : '';
      const invalido = () => falha(400, 'token_invalido', 'Link inválido ou vencido. Peça um novo.');
      if (!token || token.length > 200) throw invalido();
      const h = hashToken(token);
      const { linhas } = await ctx.banco.executar(
        `SELECT t.usuario_id, u.documento, u.papel, u.nome, u.email FROM tokens_redefinicao t JOIN usuarios u ON u.id = t.usuario_id
         WHERE t.token_hash = ? AND t.usado_em IS NULL AND t.expira_em > ?`,
        [h, ctx.agora.toISOString()],
      );
      if (!linhas[0]) throw invalido();
      const campos = conferirSenhaNova(c.senha, c.senhaConfirmacao, 'senha', 'senhaConfirmacao', linhas[0]);
      if (campos.length) throw falha(400, 'validacao', 'Confira os campos destacados.', campos);
      const usuarioId = linhas[0].usuario_id;
      const senhaHash = await hashSenha(c.senha);
      await ctx.banco.transacao(async tx => {
        const r = await tx.executar('UPDATE tokens_redefinicao SET usado_em = ? WHERE token_hash = ? AND usado_em IS NULL', [ctx.agora.toISOString(), h]);
        if (r.alteradas !== 1) throw invalido();
        await tx.executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, usuarioId]);
        await tx.executar('DELETE FROM sessoes WHERE usuario_id = ?', [usuarioId]);
        await zerarErrosDocumento(tx, linhas[0].documento);
      });
      await ctx.auditar('senha_redefinida', { usuarioId, alvo: linhas[0].documento });
      return { status: 204 };
    },
  },
];
