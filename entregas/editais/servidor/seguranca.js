// Segurança do servidor: senha, tokens, limite de login, cookie, corpo do pedido e cabeçalhos.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const COOKIE_SESSAO = 'teb_sessao';
export const SESSAO_MS = 8 * 60 * 60 * 1000;
export const REDEFINICAO_MS = 60 * 60 * 1000;
export const LIMITE_ERROS = 5;
export const BLOQUEIO_MS = 15 * 60 * 1000;
export const LIMITE_JSON = 1024 * 1024;
export const LIMITE_PDF = 10 * 1024 * 1024;

// Senha e documentos das contas do modo demonstração. O servidor real recusa todos.
export const SENHA_PROIBIDA = 'Exemplo#2026';
export const DOCUMENTOS_RESERVADOS = new Set(['52998224725', '11144477735', '39053344705', '16899535009']);

export class ErroHttp extends Error {
  constructor(status, erro, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.erro = erro;
    this.campos = campos;
  }
}

export const falha = (status, erro, mensagem, campos) => new ErroHttp(status, erro, mensagem, campos);

// Senha com scrypt. Sal aleatório de 16 bytes por senha.
const N = 16384, R = 8, P = 1, TAMANHO = 64;

export async function hashSenha(senha) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(String(senha), sal, TAMANHO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarSenha(senha, armazenado) {
  const partes = String(armazenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtido = await scryptAsync(String(senha), Buffer.from(salB64, 'base64'), esperado.length, { N: Number(n), r: Number(r), p: Number(p) });
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

// Hash fixo para gastar o mesmo tempo quando o documento não tem conta.
let hashFicticio = null;
export async function verificarSenhaFicticia(senha) {
  hashFicticio ??= await hashSenha(randomBytes(16).toString('hex'));
  await verificarSenha(senha, hashFicticio);
  return false;
}

export const gerarToken = () => randomBytes(32).toString('base64url');
export const gerarId = () => randomBytes(16).toString('base64url');
export const hashToken = token => createHash('sha256').update(String(token)).digest('hex');

export function documentoReservado(digitos) {
  return DOCUMENTOS_RESERVADOS.has(String(digitos));
}

// Limite de login: 5 erros seguidos por documento e por IP bloqueiam por 15 minutos.
async function lerTentativa(banco, chave, agora) {
  const { linhas } = await banco.executar('SELECT * FROM tentativas_login WHERE chave = ?', [chave]);
  const t = linhas[0];
  if (!t) return { erros: 0, bloqueadoAte: null };
  const ms = agora.getTime();
  if (t.bloqueado_ate && new Date(t.bloqueado_ate).getTime() <= ms) return { erros: 0, bloqueadoAte: null };
  if (!t.bloqueado_ate && new Date(t.atualizado_em).getTime() + BLOQUEIO_MS <= ms) return { erros: 0, bloqueadoAte: null };
  return { erros: Number(t.erros), bloqueadoAte: t.bloqueado_ate };
}

export async function loginBloqueado(banco, { documento, ip, agora }) {
  for (const chave of [`doc:${documento}`, `ip:${ip}`]) {
    const t = await lerTentativa(banco, chave, agora);
    if (t.bloqueadoAte) return true;
  }
  return false;
}

export async function registrarErroLogin(banco, { documento, ip, agora }) {
  for (const chave of [`doc:${documento}`, `ip:${ip}`]) {
    const t = await lerTentativa(banco, chave, agora);
    const erros = t.erros + 1;
    const bloqueadoAte = erros >= LIMITE_ERROS ? new Date(agora.getTime() + BLOQUEIO_MS).toISOString() : null;
    await banco.executar(
      `INSERT INTO tentativas_login (chave, erros, bloqueado_ate, atualizado_em) VALUES (?, ?, ?, ?)
       ON CONFLICT (chave) DO UPDATE SET erros = excluded.erros, bloqueado_ate = excluded.bloqueado_ate, atualizado_em = excluded.atualizado_em`,
      [chave, erros, bloqueadoAte, agora.toISOString()],
    );
  }
}

export async function zerarErrosDocumento(banco, documento) {
  await banco.executar('DELETE FROM tentativas_login WHERE chave = ?', [`doc:${documento}`]);
}

// Cookie de sessão.
export function lerCookies(req) {
  const saida = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 1) continue;
    const nome = parte.slice(0, i).trim();
    if (!(nome in saida)) saida[nome] = parte.slice(i + 1).trim();
  }
  return saida;
}

export function cookieSessao(token, { https }) {
  const attrs = [`${COOKIE_SESSAO}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSAO_MS / 1000}`];
  if (https) attrs.push('Secure');
  return attrs.join('; ');
}

export function cookieExpirado({ https }) {
  const attrs = [`${COOKIE_SESSAO}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (https) attrs.push('Secure');
  return attrs.join('; ');
}

// IP do cliente. X-Forwarded-For só com proxy confiável.
export function ipPadrao({ confiarProxy }) {
  return req => {
    if (confiarProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xff) return xff;
    }
    return req.socket?.remoteAddress || 'desconhecido';
  };
}

// Corpo do pedido com limite. Acima do limite responde 413 e descarta o resto sem guardar.
export function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const declarado = Number(req.headers['content-length']);
    const grande = () => falha(413, 'arquivo_grande', limite === LIMITE_PDF ? 'O arquivo passa de 10 MB.' : 'O pedido é grande demais.');
    const descartar = () => {
      let descartado = 0;
      req.removeAllListeners('data');
      req.on('data', c => { descartado += c.length; if (descartado > limite * 4) req.destroy(); });
      req.resume();
    };
    if (Number.isFinite(declarado) && declarado > limite) { descartar(); reject(grande()); return; }
    const partes = [];
    let total = 0, estourou = false;
    req.on('data', c => {
      if (estourou) return;
      total += c.length;
      if (total > limite) { estourou = true; partes.length = 0; descartar(); reject(grande()); return; }
      partes.push(c);
    });
    req.on('end', () => { if (!estourou) resolve(Buffer.concat(partes)); });
    req.on('error', e => { if (!estourou) reject(e); });
  });
}

export function tipoConteudo(req) {
  return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

export async function lerJson(req) {
  if (tipoConteudo(req) !== 'application/json') throw falha(415, 'tipo_invalido', 'Envie o pedido em JSON.');
  const bytes = await lerCorpo(req, LIMITE_JSON);
  if (bytes.length === 0) return {};
  let corpo;
  try { corpo = JSON.parse(bytes.toString('utf8')); } catch { throw falha(400, 'json_invalido', 'O corpo do pedido não é um JSON válido.'); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw falha(400, 'json_invalido', 'O corpo do pedido precisa ser um objeto.');
  return corpo;
}

export const CSP = "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";

export function cabecalhosSeguranca(res, { https }) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
