// Auxiliares de DOM e formatação usados por todas as telas.
import * as regras from './regras.js';

export const fmt = {
  moeda: regras.formatarMoeda,
  nota: regras.formatarNota,
  documento: regras.formatarDocumento,
};

// el('div', { class: 'x', 'data-a': '1', hidden: true, onclick: fn }, 'texto', outroNo)
export function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k === 'texto') n.textContent = v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  anexar(n, filhos);
  return n;
}

function anexar(n, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

let contadorId = 0;
export function novoId(prefixo = 'c') { contadorId += 1; return `${prefixo}-${contadorId}`; }

// Campo com rótulo real e área de erro. Devolve { raiz, input, erro }.
// opcoes: { rotulo, nome, tipo, valor, opcoes (select), obrigatorio, dica, autocomplete, readonly, disabled, linhas, inputmode, maxlength, semDataCampo }
export function campo(o) {
  const id = novoId(o.nome || 'campo');
  const tipo = o.tipo || 'text';
  let input;
  const comuns = {
    id,
    'data-campo': o.semDataCampo ? false : o.nome,
    name: o.nome,
    required: o.obrigatorio ? true : false,
    readonly: o.readonly,
    disabled: o.disabled,
    autocomplete: o.autocomplete,
    inputmode: o.inputmode,
    maxlength: o.maxlength,
    'aria-describedby': `${id}-erro${o.dica ? ` ${id}-dica` : ''}`,
  };
  if (tipo === 'select') {
    input = el('select', comuns, (o.opcoes || []).map(op => {
      const [valor, texto] = Array.isArray(op) ? op : [op, op];
      return el('option', { value: valor, selected: String(valor) === String(o.valor ?? '') }, texto);
    }));
  } else if (tipo === 'textarea') {
    input = el('textarea', { ...comuns, rows: o.linhas || 4 });
    input.value = o.valor ?? '';
  } else {
    input = el('input', { ...comuns, type: tipo });
    if (o.valor !== undefined && o.valor !== null) input.value = o.valor;
  }
  const rotulo = el('label', { for: id }, o.rotulo);
  const erro = el('p', { class: 'erro', id: `${id}-erro`, 'data-erro': o.nome, role: 'alert', hidden: true });
  const raiz = el('div', { class: 'campo' }, rotulo, o.dica ? el('p', { class: 'dica', id: `${id}-dica` }, o.dica) : null, input, erro);
  return { raiz, input, erro, rotulo };
}

export function mostrarErro(erro, mensagem) {
  if (!erro) return;
  erro.textContent = mensagem || '';
  erro.hidden = !mensagem;
}

export function limparErros(raiz) {
  raiz.querySelectorAll('[data-erro]').forEach(e => { e.textContent = ''; e.hidden = true; });
  raiz.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
}

// Mostra erros vindos da api ({ campo, mensagem }) junto aos campos pelo nome do mapa.
// mapa: { nomeNaApi: { erro: elemento, input: elemento } }. Devolve as mensagens sem destino.
export function mostrarErrosDaApi(campos, mapa) {
  const sobras = [];
  for (const c of campos || []) {
    const alvo = mapa[c.campo];
    if (alvo) { mostrarErro(alvo.erro, c.mensagem); alvo.input?.setAttribute('aria-invalid', 'true'); }
    else sobras.push(c.mensagem);
  }
  return sobras;
}

export function aviso(tipo, texto) {
  return el('p', { class: `aviso-linha aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, texto);
}

export function definirMensagem(destino, tipo, texto) {
  destino.replaceChildren();
  destino.hidden = !texto;
  destino.className = `mensagem mensagem-${tipo}`;
  if (texto) destino.textContent = texto;
}

export function botao(texto, attrs = {}) {
  return el('button', { type: 'button', ...attrs, class: `botao ${attrs.class || 'botao-principal'}` }, texto);
}

export function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Dias inteiros até o fim do período (data AAAA-MM-DD). Negativo se passou.
export function diasAte(fim, agora = new Date()) {
  const f = regras.fimDoPeriodo(fim);
  if (!f) return null;
  return Math.ceil((f.getTime() - agora.getTime()) / 86400000);
}

export function prazoTexto(fim, agora = new Date()) {
  const d = diasAte(fim, agora);
  if (d === null || d < 0) return '';
  if (d === 0) return 'Último dia';
  if (d === 1) return 'Falta 1 dia';
  return `Faltam ${d} dias`;
}

export function inicioDoPapel(papel) {
  return { proponente: '#/painel', gestor: '#/gestor', avaliador: '#/avaliador', plataforma: '#/plataforma' }[papel] || '#/login';
}

export function mensagemDoErro(e) {
  return e?.mensagem || e?.message || 'Algo deu errado. Tente de novo.';
}

export const AVISO_PENDENTE = 'teb-aviso-pendente';

// Esboço padrão de telas ainda em construção.
export function emConstrucao(ctx, titulo) {
  ctx.raiz.replaceChildren(
    el('section', { class: 'pagina pagina-estreita' },
      el('h1', {}, titulo),
      el('p', { class: 'cartao' }, 'Tela em construção'),
    ),
  );
}
