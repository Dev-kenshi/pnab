// Aplicação HTTP do Sistema Integrado TEB. Sem framework.
// criarApp devolve um handler (req, res). Tudo que muda entre produção e teste é injetável.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQL_USUARIO } from './banco.js';
import { registrar } from './auditoria.js';
import {
  COOKIE_SESSAO, ErroHttp, LIMITE_PDF, cabecalhosSeguranca, falha, hashToken, ipPadrao, lerCookies, lerCorpo, lerJson, origemConfiavel, tipoConteudo,
} from './seguranca.js';
import { emailDesligado } from './email.js';
import rotasAcesso from './rotas/acesso.js';
import rotasConta from './rotas/conta.js';
import rotasProponente from './rotas/proponente.js';
import rotasGestor from './rotas/gestor.js';
import rotasAvaliador from './rotas/avaliador.js';
import rotasPlataforma from './rotas/plataforma.js';

const RAIZ_PADRAO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Pastas do front servidas como arquivo. /servidor/, /js/testes/ e ocultos ficam de fora.
const PASTAS_PUBLICAS = ['/css/', '/js/', '/img/', '/exemplos/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

function compilar(caminho) {
  const nomes = [];
  const fonte = caminho.split('/').map(p => {
    if (p.startsWith(':')) { nomes.push(p.slice(1)); return '([^/]+)'; }
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { re: new RegExp(`^${fonte}$`), nomes };
}

function enviarJson(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (corpo === undefined || status === 204) { res.end(); return; }
  const texto = JSON.stringify(corpo);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(texto));
  res.end(texto);
}

async function cepViaCep(cep) {
  const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`ViaCEP respondeu ${r.status}`);
  const d = await r.json();
  if (d.erro) return null;
  return { cep: String(d.cep || cep).replace(/\D/g, ''), logradouro: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade || '', uf: d.uf || '' };
}


export function criarApp({
  banco,
  anexos,
  agora = () => new Date(),
  ipDe = ipPadrao({ confiarProxy: false }),
  // Padrão seguro: sem configuração, nada de link ou token no log. Veja servidor/email.js.
  enviarEmail = emailDesligado(),
  buscarCepRemoto = cepViaCep,
  https = false,
  urlPublica = '',
  // Recurso de teste: { usuario, documento } para entrar com apelido na conta da plataforma. null desliga.
  loginPlataforma = null,
  raizEstatica = RAIZ_PADRAO,
} = {}) {
  if (!banco) throw new Error('criarApp precisa de banco.');
  if (!anexos) throw new Error('criarApp precisa de anexos.');

  const rotas = [...rotasAcesso, ...rotasConta, ...rotasProponente, ...rotasGestor, ...rotasAvaliador, ...rotasPlataforma]
    .map(r => ({ ...r, ...compilar(r.caminho) }));
  const raiz = resolve(raizEstatica);

  async function carregarSessao(req, momento) {
    const token = lerCookies(req)[COOKIE_SESSAO];
    if (!token || token.length > 200) return null;
    const { linhas } = await banco.executar(
      `${SQL_USUARIO} JOIN sessoes s ON s.usuario_id = u.id WHERE s.token_hash = ? AND s.expira_em > ?`,
      [hashToken(token), momento.toISOString()],
    );
    return linhas[0] ? { usuario: linhas[0], tokenHash: hashToken(token) } : null;
  }

  async function servirEstatico(req, res, caminho) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let p;
    try { p = decodeURIComponent(caminho); } catch { return false; }
    if (p.includes('\0') || p.includes('\\') || p.split('/').some(s => s === '..' || s.startsWith('.'))) return false;
    if (p === '/') p = '/index.html';
    const permitido = p === '/index.html' || (PASTAS_PUBLICAS.some(d => p.startsWith(d)) && !p.startsWith('/js/testes/'));
    if (!permitido) return false;
    const alvo = resolve(raiz, `.${p}`);
    if (!alvo.startsWith(raiz + sep)) return false;
    let info;
    try { info = await stat(alvo); } catch { return false; }
    if (!info.isFile()) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(alvo).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') { res.end(); return true; }
    await new Promise((ok, erro) => {
      const fluxo = createReadStream(alvo);
      fluxo.on('error', erro);
      res.on('finish', ok);
      fluxo.pipe(res);
    });
    return true;
  }

  return async function handler(req, res) {
    cabecalhosSeguranca(res, { https });
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { enviarJson(res, 400, { erro: 'pedido_invalido', mensagem: 'Endereço inválido.' }); return; }
    const caminho = url.pathname;

    try {
      if (caminho === '/modo.json' && (req.method === 'GET' || req.method === 'HEAD')) {
        enviarJson(res, 200, { modo: 'servidor' });
        return;
      }

      if (caminho.startsWith('/api/')) {
        let params = null;
        const rota = rotas.find(r => {
          if (r.metodo !== req.method) return false;
          const m = r.re.exec(caminho);
          if (!m) return false;
          try {
            params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
          } catch { return false; }
          return true;
        });
        if (!rota) throw falha(404, 'nao_encontrado', 'Endereço não encontrado.');
        if (req.method !== 'GET' && req.method !== 'HEAD' && !origemConfiavel(req)) {
          throw falha(403, 'origem_invalida', 'Pedido vindo de outro site foi recusado.');
        }

        const momento = agora();
        const ip = ipDe(req);
        const sessao = rota.papel === 'publico' ? await carregarSessao(req, momento).catch(() => null) : await carregarSessao(req, momento);
        if (rota.papel !== 'publico') {
          if (!sessao) throw falha(401, 'sem_sessao', 'Entre para continuar.');
          const papeis = rota.papel === 'logado' ? null : [].concat(rota.papel);
          if (papeis && !papeis.includes(sessao.usuario.papel)) {
            await registrar(banco, {
              agora: momento, ip, usuarioId: sessao.usuario.id, organizacaoId: sessao.usuario.organizacao_id,
              acao: 'acesso_negado', alvo: `${req.method} ${caminho}`.slice(0, 200),
            });
            throw falha(403, 'sem_permissao', 'Seu perfil não tem acesso a esta área.');
          }
        }

        const ctx = {
          req, res, params, query: url.searchParams, agora: momento, ip, banco, anexos, enviarEmail, buscarCepRemoto, https, urlPublica, loginPlataforma,
          usuario: sessao?.usuario || null,
          sessaoHash: sessao?.tokenHash || null,
          corpo: {},
          async lerPdf() {
            if (tipoConteudo(req) !== 'application/pdf') throw falha(415, 'tipo_invalido', 'Envie um arquivo PDF.');
            return lerCorpo(req, LIMITE_PDF);
          },
          auditar(acao, dados = {}, alvoBanco = banco) {
            return registrar(alvoBanco, {
              agora: momento,
              ip,
              usuarioId: ctx.usuario?.id ?? null,
              organizacaoId: ctx.usuario?.organizacao_id ?? null,
              ...dados,
              acao,
            });
          },
        };

        if ((req.method === 'POST' || req.method === 'PUT') && rota.corpo !== 'pdf') ctx.corpo = await lerJson(req);

        const r = await rota.fn(ctx);
        if (res.writableEnded || res.headersSent) return;
        if (r?.cabecalhos) for (const [k, v] of Object.entries(r.cabecalhos)) res.setHeader(k, v);
        enviarJson(res, r?.status ?? 200, r?.corpo);
        return;
      }

      if (await servirEstatico(req, res, caminho)) return;
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Página não encontrada.');
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof ErroHttp) {
        const corpo = { erro: e.erro, mensagem: e.message };
        if (e.campos) corpo.campos = e.campos;
        enviarJson(res, e.status, corpo);
        return;
      }
      console.error('[erro]', e);
      enviarJson(res, 500, { erro: 'erro_interno', mensagem: 'Algo deu errado. Tente de novo.' });
    }
  };
}
