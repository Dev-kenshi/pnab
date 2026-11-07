// Sistema Integrado TEB: servidor de editais culturais.
// Emanuel Macêdo Luz, desenvolvedor do projeto.
//
// Uso:
//   node servidor/principal.js                    sobe o servidor
//   node servidor/principal.js criar-plataforma   cria a conta da plataforma
// Variáveis em .env.example. Nenhum segredo fica no código.
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as regras from '../js/regras.js';
import { criarApp } from './app.js';
import { registrar } from './auditoria.js';
import { abrirBanco } from './banco.js';
import { criarArmazemDisco, lerChave } from './anexos.js';
import { DOCUMENTOS_RESERVADOS, SENHA_PROIBIDA, ipPadrao } from './seguranca.js';
import { inserirUsuario } from './rotas/acesso.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arquivoEnv = resolve(RAIZ, '.env');
if (existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const env = process.env;
const caminho = v => resolve(RAIZ, v);

function sair(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

async function abrir() {
  return abrirBanco({
    caminho: caminho(env.TEB_BANCO || 'servidor/dados/teb.sqlite'),
    tursoUrl: env.TURSO_DATABASE_URL,
    tursoToken: env.TURSO_AUTH_TOKEN,
  });
}

async function criarPlataforma() {
  const documento = regras.somenteDigitos(env.TEB_PLATAFORMA_DOCUMENTO);
  const nome = String(env.TEB_PLATAFORMA_NOME || '').trim();
  const email = String(env.TEB_PLATAFORMA_EMAIL || '').trim().toLowerCase();
  const senha = env.TEB_PLATAFORMA_SENHA || '';
  if (!regras.validarDocumento(documento).valido) sair('TEB_PLATAFORMA_DOCUMENTO precisa ser um CPF ou CNPJ válido.');
  if (DOCUMENTOS_RESERVADOS.has(documento)) sair('Esse documento é reservado para o modo demonstração.');
  if (!nome || !email) sair('Preencha TEB_PLATAFORMA_NOME e TEB_PLATAFORMA_EMAIL.');
  if (senha === SENHA_PROIBIDA) sair('Essa senha é de demonstração. Escolha outra.');
  const msg = regras.validarSenha(senha);
  if (msg) sair(msg);
  const banco = await abrir();
  const agora = new Date();
  const id = await inserirUsuario(banco, { organizacaoId: null, papel: 'plataforma', nome, documento, email, senha, agora });
  await registrar(banco, { agora, usuarioId: id, acao: 'conta_criada', alvo: documento, detalhe: { papel: 'plataforma' }, ip: 'linha-de-comando' });
  await banco.fechar();
  console.log(`Conta da plataforma criada para ${nome}. Apague TEB_PLATAFORMA_SENHA do ambiente depois do primeiro acesso.`);
}

async function servir() {
  let chave;
  try { chave = lerChave(env.TEB_CHAVE_ANEXOS); } catch (e) { sair(e.message); }
  const banco = await abrir();
  const anexos = criarArmazemDisco({ pasta: caminho(env.TEB_ANEXOS || 'servidor/dados/anexos'), chave });
  const porta = Number(env.PORTA || 3000);
  const app = criarApp({
    banco,
    anexos,
    https: env.TEB_HTTPS === '1',
    ipDe: ipPadrao({ confiarProxy: env.TEB_CONFIAR_PROXY === '1' }),
    urlPublica: String(env.TEB_URL_PUBLICA || `http://localhost:${porta}`).replace(/\/+$/, ''),
  });
  const servidor = createServer({ requestTimeout: 60000, headersTimeout: 20000 }, app);
  servidor.listen(porta, () => console.log(`Sistema Integrado TEB no ar na porta ${porta}. Banco: ${banco.tipo}.`));
  const parar = () => servidor.close(async () => { await banco.fechar(); process.exit(0); });
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}

const comando = process.argv[2];
if (comando === 'criar-plataforma') await criarPlataforma().catch(e => sair(e.message));
else if (!comando) await servir();
else sair(`Comando desconhecido: ${comando}`);
