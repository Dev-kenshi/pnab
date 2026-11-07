// Roteador por hash, guarda de papel e estrutura fixa da página.
import { obterApi } from './api.js';
import * as ui from './ui.js';
import * as acesso from './telas/acesso.js';
import * as painel from './telas/painel.js';
import * as conta from './telas/conta.js';
import * as inscricao from './telas/inscricao.js';
import * as visualizar from './telas/visualizar.js';
import * as gestor from './telas/gestor.js';
import * as avaliador from './telas/avaliador.js';
import * as plataforma from './telas/plataforma.js';

const TODOS = ['proponente', 'gestor', 'avaliador', 'plataforma'];

// Tabela de rotas. chave = segmentos juntos. papeis null = pública.
const ROTAS = {
  'login': { fn: acesso.renderLogin, publica: true },
  'criar-conta': { fn: acesso.renderCriarConta, publica: true },
  'esqueci-senha': { fn: acesso.renderEsqueciSenha, publica: true },
  'redefinir': { fn: acesso.renderRedefinir, publica: true },
  'painel': { fn: painel.renderPainel, papeis: ['proponente'] },
  'conta': { fn: conta.renderConta, papeis: TODOS },
  'inscricao/novo': { fn: inscricao.renderNovaInscricao, papeis: ['proponente'] },
  'inscricao/*': { fn: visualizar.renderInscricao, papeis: ['proponente'] },
  'gestor': { fn: gestor.renderGestor, papeis: ['gestor'] },
  'gestor/editais': { fn: gestor.renderGestorEditais, papeis: ['gestor'] },
  'gestor/editais/novo': { fn: gestor.renderGestorEditalForm, papeis: ['gestor'] },
  'gestor/inscricoes': { fn: gestor.renderGestorInscricoes, papeis: ['gestor'] },
  'avaliador': { fn: avaliador.renderAvaliador, papeis: ['avaliador'] },
  'plataforma': { fn: plataforma.renderPlataforma, papeis: ['plataforma'] },
};

const MENUS = {
  proponente: [['#/painel', 'Painel'], ['#/conta', 'Minha conta']],
  gestor: [['#/gestor', 'Início'], ['#/gestor/editais', 'Editais'], ['#/gestor/inscricoes', 'Inscrições'], ['#/conta', 'Minha conta']],
  avaliador: [['#/avaliador', 'Avaliações'], ['#/conta', 'Minha conta']],
  plataforma: [['#/plataforma', 'Organizações'], ['#/conta', 'Minha conta']],
};

const raiz = document.getElementById('conteudo');
const faixaModo = document.querySelector('[data-modo="demonstracao"]');
const nav = document.querySelector('[data-nav]');
const blocoUsuario = document.querySelector('[data-usuario]');
const nomeUsuario = document.querySelector('[data-usuario-nome]');
const marca = document.querySelector('[data-marca]');
let api;
let ordem = 0;

function lerHash() {
  const bruto = location.hash.replace(/^#\/?/, '');
  const [caminho, consulta = ''] = bruto.split('?');
  const segmentos = caminho.split('/').filter(Boolean).map(decodeURIComponent);
  return { segmentos, params: new URLSearchParams(consulta) };
}

function acharRota(segmentos) {
  const chave = segmentos.join('/');
  if (ROTAS[chave]) return ROTAS[chave];
  if (segmentos[0] === 'inscricao' && segmentos.length === 2) return ROTAS['inscricao/*'];
  return null;
}

function navegar(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

function desenharTopo(usuario) {
  nav.replaceChildren();
  nav.hidden = !usuario;
  blocoUsuario.hidden = !usuario;
  marca.setAttribute('href', usuario ? ui.inicioDoPapel(usuario.papel) : '#/login');
  if (!usuario) return;
  nomeUsuario.textContent = usuario.organizacao ? `${usuario.nome} · ${usuario.organizacao.nome}` : usuario.nome;
  for (const [href, texto] of MENUS[usuario.papel] || []) {
    const a = ui.el('a', { href }, texto);
    if (location.hash.split('?')[0] === href) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
}

async function usuarioAtual() {
  // A API responde { usuario: null } quando não há sessão.
  try { return (await api.sessao())?.usuario ?? null; } catch { return null; }
}

async function rotear() {
  const minha = ++ordem;
  if (!location.hash || location.hash === '#' || location.hash === '#/') { location.replace('#/login'); return; }
  api ??= await obterApi();
  faixaModo.hidden = api.modo !== 'demonstracao';
  const { segmentos, params } = lerHash();
  const rota = acharRota(segmentos);
  const usuario = await usuarioAtual();
  if (minha !== ordem) return;
  desenharTopo(usuario);
  if (!rota) { navegar(usuario ? ui.inicioDoPapel(usuario.papel) : '#/login'); return; }
  if (rota.publica && usuario && segmentos[0] !== 'redefinir') { navegar(ui.inicioDoPapel(usuario.papel)); return; }
  if (!rota.publica) {
    if (!usuario) { navegar('#/login'); return; }
    if (!rota.papeis.includes(usuario.papel)) { navegar(ui.inicioDoPapel(usuario.papel)); return; }
  }
  const ctx = { raiz, api, usuario, params, segmentos, navegar, ui };
  raiz.replaceChildren();
  try {
    await rota.fn(ctx);
  } catch (e) {
    if (minha !== ordem) return;
    if (e?.status === 401 && !rota.publica) { navegar('#/login'); return; }
    raiz.replaceChildren(ui.el('section', { class: 'pagina pagina-estreita' },
      ui.el('h1', {}, 'Algo deu errado'),
      ui.el('p', { class: 'mensagem mensagem-erro', role: 'alert' }, ui.mensagemDoErro(e)),
      ui.el('p', {}, ui.el('a', { class: 'botao botao-contorno', href: usuario ? ui.inicioDoPapel(usuario.papel) : '#/login' }, 'Voltar ao início'))));
  }
  if (minha !== ordem) return;
  const h1 = raiz.querySelector('h1');
  document.title = h1 ? `${h1.textContent} · Sistema Integrado TEB` : 'Sistema Integrado TEB';
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

document.querySelector('[data-acao="sair"]').addEventListener('click', async () => {
  api ??= await obterApi();
  try { await api.sair(); } catch { /* sessão já encerrada */ }
  sessionStorage.removeItem(ui.AVISO_PENDENTE);
  navegar('#/login');
});

document.querySelector('[data-pular]').addEventListener('click', e => {
  e.preventDefault();
  raiz.focus();
});

window.addEventListener('hashchange', rotear);
rotear();
