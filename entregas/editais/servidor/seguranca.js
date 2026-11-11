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
// Parâmetros da recomendação da OWASP para scrypt: N=2^14, r=8, p=5 (16 MiB de memória por cálculo).
// Hash com parâmetros antigos é refeito no próximo login certo (precisaRefazerHash).
const N = 16384, R = 8, P = 5, TAMANHO = 64;
const MAX_N = 1 << 17, MAX_R = 16, MAX_P = 16;

export async function hashSenha(senha) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(String(senha), sal, TAMANHO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarSenha(senha, armazenado) {
  const partes = String(armazenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, salB64, hashB64] = partes;
  const [nn, rr, pp] = [Number(n), Number(r), Number(p)];
  if (!(nn > 1 && nn <= MAX_N && rr >= 1 && rr <= MAX_R && pp >= 1 && pp <= MAX_P)) return false;
  const esperado = Buffer.from(hashB64, 'base64');
  if (esperado.length < 32) return false;
  const obtido = await scryptAsync(String(senha), Buffer.from(salB64, 'base64'), esperado.length, { N: nn, r: rr, p: pp, maxmem: 256 * MAX_N * MAX_R });
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

export function precisaRefazerHash(armazenado) {
  return !String(armazenado || '').startsWith(`scrypt$${N}$${R}$${P}$`);
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

// Trava em memória por chave. Pedidos com a mesma chave (documento, IP, usuário) rodam um de cada vez.
// Sem ela, vários logins em paralelo liam o contador antes de qualquer erro ser gravado e passavam do limite.
// Vale para um processo só (SQLite local). Com várias instâncias, use um limitador na frente (proxy).
const travas = new Map();
export async function comTrava(chaves, fn) {
  const ordenadas = [...new Set(chaves.map(String))].sort();
  const liberar = [];
  try {
    for (const chave of ordenadas) {
      const anterior = travas.get(chave) || Promise.resolve();
      let soltar;
      const atual = new Promise(ok => { soltar = ok; });
      const cadeia = anterior.then(() => atual);
      travas.set(chave, cadeia);
      await anterior;
      liberar.push(() => { soltar(); if (travas.get(chave) === cadeia) travas.delete(chave); });
    }
    return await fn();
  } finally {
    for (const l of liberar.reverse()) l();
  }
}

// Limite de uso por janela de tempo (documento, esqueci a senha, senha atual).
// Usa a mesma tabela do login com prefixos próprios. Aqui `bloqueado_ate` guarda o fim da janela.
export const LIMITES = {
  documentoPorIp: { prefixo: 'doc-ip', limite: 30, janelaMs: 15 * 60 * 1000 },
  esqueciPorIp: { prefixo: 'esq-ip', limite: 10, janelaMs: 60 * 60 * 1000 },
  esqueciPorDocumento: { prefixo: 'esq-doc', limite: 3, janelaMs: 60 * 60 * 1000 },
  senhaAtualPorUsuario: { prefixo: 'senha-atual', limite: 5, janelaMs: 15 * 60 * 1000 },
  criarContaPorIp: { prefixo: 'conta-ip', limite: 10, janelaMs: 60 * 60 * 1000 },
};

// Conta um uso. Devolve true se ainda está dentro do limite.
export async function contarUso(banco, regra, alvo, agora) {
  const chave = `${regra.prefixo}:${alvo}`;
  const ms = agora.getTime();
  return banco.transacao(async tx => {
    const { linhas } = await tx.executar('SELECT erros, bloqueado_ate FROM tentativas_login WHERE chave = ?', [chave]);
    const t = linhas[0];
    const nova = !t || !t.bloqueado_ate || new Date(t.bloqueado_ate).getTime() <= ms;
    const usos = nova ? 1 : Number(t.erros) + 1;
    const fim = nova ? new Date(ms + regra.janelaMs).toISOString() : t.bloqueado_ate;
    await tx.executar(
      `INSERT INTO tentativas_login (chave, erros, bloqueado_ate, atualizado_em) VALUES (?, ?, ?, ?)
       ON CONFLICT (chave) DO UPDATE SET erros = excluded.erros, bloqueado_ate = excluded.bloqueado_ate, atualizado_em = excluded.atualizado_em`,
      [chave, usos, fim, agora.toISOString()],
    );
    return usos <= regra.limite;
  });
}

// Só consulta, sem contar.
export async function dentroDoLimite(banco, regra, alvo, agora) {
  const { linhas } = await banco.executar('SELECT erros, bloqueado_ate FROM tentativas_login WHERE chave = ?', [`${regra.prefixo}:${alvo}`]);
  const t = linhas[0];
  if (!t || !t.bloqueado_ate || new Date(t.bloqueado_ate).getTime() <= agora.getTime()) return true;
  return Number(t.erros) < regra.limite;
}

export async function zerarUso(banco, regra, alvo) {
  await banco.executar('DELETE FROM tentativas_login WHERE chave = ?', [`${regra.prefixo}:${alvo}`]);
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

// IP do cliente. X-Forwarded-For só com proxy confiável, e só o ÚLTIMO item:
// é o que o proxy acrescentou. Os anteriores vêm do cliente e podem ser forjados.
export function ipPadrao({ confiarProxy }) {
  return req => {
    if (confiarProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).at(-1);
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

// Defesa extra contra CSRF, além do SameSite=Strict e do JSON obrigatório:
// pedido que muda dados e vem de outro site é recusado.
export function origemConfiavel(req) {
  if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') return false;
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    return new URL(origem).host === String(req.headers.host || '');
  } catch {
    return false;
  }
}

export function cabecalhosSeguranca(res, { https }) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
