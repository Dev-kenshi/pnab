// Conta da plataforma: criação idempotente e o apelido de login opcional (recurso de teste).
// Nada aqui guarda senha. Tudo vem do ambiente (.env ou Secrets do Replit).
import * as regras from '../js/regras.js';
import { registrar } from './auditoria.js';
import { DOCUMENTOS_RESERVADOS, SENHA_PROIBIDA } from './seguranca.js';
import { inserirUsuario } from './rotas/acesso.js';

// Lê TEB_PLATAFORMA_LOGIN. Sem a variável devolve null e nada muda no login.
// Com ela, exige TEB_PLATAFORMA_DOCUMENTO válido. Lança Error com mensagem clara se faltar algo.
export function loginPlataformaDoAmbiente(env) {
  const usuario = String(env.TEB_PLATAFORMA_LOGIN || '').trim().toLowerCase();
  if (!usuario) return null;
  if (!/^[a-z][a-z0-9._-]{2,39}$/.test(usuario)) {
    throw new Error('TEB_PLATAFORMA_LOGIN precisa começar com letra e ter de 3 a 40 letras, números, ponto, hífen ou sublinhado.');
  }
  const documento = regras.somenteDigitos(env.TEB_PLATAFORMA_DOCUMENTO);
  if (!regras.validarDocumento(documento).valido) throw new Error('TEB_PLATAFORMA_LOGIN exige TEB_PLATAFORMA_DOCUMENTO com CPF ou CNPJ válido.');
  if (DOCUMENTOS_RESERVADOS.has(documento)) throw new Error('TEB_PLATAFORMA_DOCUMENTO é reservado para o modo demonstração.');
  return { usuario, documento };
}

// Cria a conta da plataforma se faltar. Se já existir com esse documento, só avisa.
// Devolve { criada, mensagem }. Lança Error se a configuração estiver errada.
export async function garantirContaPlataforma(banco, env, { agora = new Date(), ip = 'linha-de-comando' } = {}) {
  const documento = regras.somenteDigitos(env.TEB_PLATAFORMA_DOCUMENTO);
  const nome = String(env.TEB_PLATAFORMA_NOME || '').trim();
  const email = String(env.TEB_PLATAFORMA_EMAIL || '').trim().toLowerCase();
  const senha = env.TEB_PLATAFORMA_SENHA || '';
  if (!regras.validarDocumento(documento).valido) throw new Error('TEB_PLATAFORMA_DOCUMENTO precisa ser um CPF ou CNPJ válido.');
  if (DOCUMENTOS_RESERVADOS.has(documento)) throw new Error('Esse documento é reservado para o modo demonstração.');

  const { linhas } = await banco.executar('SELECT id, papel FROM usuarios WHERE documento = ?', [documento]);
  if (linhas[0]) {
    if (linhas[0].papel !== 'plataforma') throw new Error('Já existe uma conta com esse documento, mas ela não é da plataforma.');
    return { criada: false, mensagem: 'A conta da plataforma já existe. Nada foi alterado. A senha não muda pelo ambiente.' };
  }

  if (!nome || !email) throw new Error('Preencha TEB_PLATAFORMA_NOME e TEB_PLATAFORMA_EMAIL.');
  if (senha === SENHA_PROIBIDA) throw new Error('Essa senha é de demonstração. Escolha outra.');
  const msg = regras.validarSenha(senha, { papel: 'plataforma', documento, nome, email });
  if (msg) throw new Error(msg);
  let id;
  try {
    id = await inserirUsuario(banco, { organizacaoId: null, papel: 'plataforma', nome, documento, email, senha, agora });
  } catch (e) {
    // Duas subidas ao mesmo tempo: a outra criou primeiro. Também está garantido.
    if (e?.erro === 'documento_existente') return { criada: false, mensagem: 'A conta da plataforma já existe. Nada foi alterado.' };
    throw e;
  }
  await registrar(banco, { agora, usuarioId: id, acao: 'conta_criada', alvo: documento, detalhe: { papel: 'plataforma' }, ip });
  return { criada: true, mensagem: `Conta da plataforma criada para ${nome}.` };
}
