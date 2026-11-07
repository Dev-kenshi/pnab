// Formulário de inscrição gerado pelo modelo do edital.
import * as regras from '../regras.js';
import { el, fmt, dataBR, prazoTexto, mensagemDoErro, novoId } from '../ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONES = {
  pessoa: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 20a8 8 0 0 1 16 0',
  etiqueta: 'M3 12V4h8l10 10-8 8L3 12Z M7.5 8.5h.01',
  pergunta: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8 M12 16.5h.01',
  bandeira: 'M5 21V4 M5 4h12l-2 4 2 4H5',
  equipe: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M3 20a6 6 0 0 1 12 0 M16 5a3 3 0 0 1 0 6 M18 14a6 6 0 0 1 3 6',
  moeda: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.5-2.5-1.5 M12 6.5V8 M12 16v1.5',
  clipe: 'M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8 12l3 3 5-6',
  cadeado: 'M6 11h12v9H6Z M8 11V8a4 4 0 0 1 8 0v3',
  estrela: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z',
  balao: 'M4 5h16v11H9l-5 4Z',
  doc: 'M6 3h9l4 4v14H6Z M14 3v5h5',
};

export function icone(nome) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icone');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONES[nome] || ICONES.doc);
  svg.append(p);
  return svg;
}

// Seção da ficha: título com ícone à esquerda e linha separadora.
export function secao(nomeIcone, titulo, ...filhos) {
  const id = novoId('sec');
  return el('section', { class: 'ficha-secao', 'aria-labelledby': id },
    el('h2', { class: 'ficha-secao-titulo', id }, icone(nomeIcone), el('span', {}, titulo)),
    ...filhos);
}

// Lista de campos somente leitura: rótulo em negrito, valor em caixa cinza.
export function leitura(itens) {
  return el('dl', { class: 'leitura' }, itens.map(([rotulo, valor]) =>
    el('div', { class: 'leitura-item' },
      el('dt', {}, rotulo),
      el('dd', {}, valor === null || valor === undefined || valor === '' ? 'Não informado' : valor))));
}

export function enderecoTexto(e) {
  if (!e) return '';
  const l1 = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const l2 = [e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
  return [l1, e.complemento, l2, e.cep].filter(Boolean).join(' - ');
}

const COLUNAS = {
  metas: [
    ['meta-etapa', 'Etapa', 'text', 'etapa'],
    ['meta-inicio', 'Início', 'date', 'inicio'],
    ['meta-fim', 'Fim', 'date', 'fim'],
    ['meta-acao', 'Ação', 'text', 'acao'],
  ],
  equipe: [
    ['equipe-nome', 'Nome', 'text', 'nome'],
    ['equipe-funcao', 'Função', 'text', 'funcao'],
    ['equipe-documento', 'Documento (CPF ou CNPJ)', 'text', 'documento'],
  ],
  orcamento: [
    ['orc-descricao', 'Descrição do item', 'text', 'descricao'],
    ['orc-qtd', 'Quantidade', 'number', 'qtd'],
    ['orc-valor', 'Valor unitário (R$)', 'number', 'valor'],
  ],
};

const chaveRascunho = (ctx, slug) => `teb-rascunho:${ctx.usuario.id}:${slug}`;
const lerLocal = chave => { try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; } };
const gravarLocal = (chave, v) => { try { localStorage.setItem(chave, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
const apagarLocal = chave => { try { localStorage.removeItem(chave); } catch { /* sem armazenamento */ } };

function cabecalho(titulo, subtitulo) {
  return [el('h1', {}, titulo), subtitulo ? el('p', { class: 'lead' }, subtitulo) : null];
}

function paginaAviso(ctx, titulo, texto) {
  ctx.raiz.replaceChildren(el('section', { class: 'pagina pagina-estreita' },
    ...cabecalho(titulo),
    el('p', { class: 'mensagem mensagem-info' }, texto),
    el('p', { class: 'acoes' }, el('a', { class: 'botao botao-contorno', href: '#/painel' }, 'Voltar ao painel'))));
}

export async function renderNovaInscricao(ctx) {
  const { raiz, api, usuario, params, navegar } = ctx;
  const slug = params.get('edital');
  if (!slug) { paginaAviso(ctx, 'Nova inscrição', 'Escolha um edital aberto no painel para começar.'); return; }
  const { edital } = await api.obterEdital(slug);
  if (edital.situacao !== 'aberto' || !regras.periodoAberto(edital, new Date())) {
    paginaAviso(ctx, 'Nova inscrição', 'Este edital não está recebendo inscrições.');
    return;
  }

  const chaveLocal = chaveRascunho(ctx, slug);
  const guardado = lerLocal(chaveLocal);
  const estado = { id: guardado?.id || null, anexos: guardado?.ficha?.anexos || {}, pendentes: new Map(), ocupado: false };
  const inicial = guardado?.ficha || {};
  const extrasTexto = edital.camposExtras.filter(c => c.tipo !== 'anexo');
  const extrasAnexo = edital.camposExtras.filter(c => c.tipo === 'anexo');

  // ---------- campos ----------
  function criarCampo(o) {
    const id = novoId(o.nome);
    const comum = {
      id, 'data-campo': o.nome, name: o.nome, required: false,
      'aria-describedby': `${id}-erro${o.dica ? ` ${id}-dica` : ''}`, ...(o.attrs || {}),
    };
    let input;
    if (o.tipo === 'select') {
      input = el('select', comum,
        el('option', { value: '' }, 'Selecione'),
        (o.opcoes || []).map(op => el('option', { value: op }, op)));
      input.value = o.valor || '';
    } else if (o.tipo === 'textarea') {
      input = el('textarea', { ...comum, rows: o.linhas || 5 });
      input.value = o.valor ?? '';
    } else {
      input = el('input', { ...comum, type: o.tipo || 'text' });
      if (o.valor !== undefined && o.valor !== null) input.value = o.valor;
    }
    const rotulo = el('label', { for: id }, o.rotulo, o.obrigatorio ? el('span', { class: 'obrig' }, ' (obrigatório)') : null);
    const raizCampo = el('div', { class: 'campo' }, rotulo,
      o.dica ? el('p', { class: 'dica', id: `${id}-dica` }, o.dica) : null,
      input, el('div', { class: 'erro-lugar', id: `${id}-erro` }));
    return { raiz: raizCampo, input };
  }

  function campoDoExtra(c) {
    const valor = inicial.extras?.[c.chave];
    if (c.tipo === 'marcar') {
      const id = novoId(c.chave);
      const input = el('input', { id, type: 'checkbox', 'data-campo': c.chave, name: c.chave, 'aria-describedby': `${id}-erro` });
      input.checked = valor === true;
      return el('div', { class: 'campo campo-marcar' },
        el('div', { class: 'marcar-linha' }, input, el('label', { for: id }, c.rotulo, c.obrigatorio ? el('span', { class: 'obrig' }, ' (obrigatório)') : null)),
        el('div', { class: 'erro-lugar', id: `${id}-erro` }));
    }
    const tipos = { texto: 'text', numero: 'number', data: 'date' };
    return criarCampo({
      nome: c.chave, rotulo: c.rotulo, obrigatorio: c.obrigatorio, valor,
      tipo: c.tipo === 'texto-longo' ? 'textarea' : c.tipo === 'selecao' ? 'select' : tipos[c.tipo] || 'text',
      opcoes: c.opcoes, attrs: c.tipo === 'numero' ? { step: 'any' } : null,
    }).raiz;
  }

  const fTitulo = criarCampo({ nome: 'titulo', rotulo: 'Título do projeto', obrigatorio: true, valor: inicial.titulo, attrs: { maxlength: 200, autocomplete: 'off' } });
  const fCategoria = criarCampo({ nome: 'categoria', rotulo: 'Categoria', obrigatorio: true, tipo: 'select', opcoes: edital.categorias, valor: inicial.categoria });
  const fCota = criarCampo({ nome: 'cota', rotulo: 'Cota', obrigatorio: true, tipo: 'select', opcoes: edital.cotas, valor: inicial.cota });

  // ---------- tabelas repetíveis ----------
  function criarTabela(tipo, legenda, textoBotao, acao, extraCabeca, extraCelula) {
    const cols = COLUNAS[tipo];
    const corpo = el('tbody', {});
    const tabela = el('table', { class: `tabela-linhas tabela-${tipo}` },
      el('caption', { class: 'so-leitor' }, legenda),
      el('thead', {}, el('tr', {},
        cols.map(c => el('th', { scope: 'col' }, c[1])),
        extraCabeca ? el('th', { scope: 'col' }, extraCabeca) : null,
        el('th', { scope: 'col' }, el('span', { class: 'so-leitor' }, 'Ações')))),
      corpo);
    const vazio = el('p', { class: 'vazio vazio-tabela' }, 'Nenhuma linha ainda.');
    const botaoAdd = el('button', { type: 'button', class: 'botao botao-contorno', 'data-acao': acao }, textoBotao);

    function renumerar() {
      [...corpo.children].forEach((tr, i) => {
        tr.querySelector('.remover-numero').textContent = ` linha ${i + 1}`;
      });
      vazio.hidden = corpo.children.length > 0;
      tabela.hidden = corpo.children.length === 0;
    }

    function adicionar(valores = {}) {
      const tds = cols.map(([nome, rotulo, tipoInput, chave]) => {
        const id = novoId(nome);
        const input = el('input', {
          id, type: tipoInput, 'data-campo': nome, name: nome, 'aria-describedby': `${id}-erro`,
          min: tipoInput === 'number' ? 0 : false, step: tipoInput === 'number' ? 'any' : false,
          inputmode: nome === 'orc-valor' || nome === 'orc-qtd' ? 'decimal' : false, autocomplete: 'off',
        });
        let v = valores[chave];
        if (nome === 'orc-valor' && v !== null && v !== undefined && v !== '') v = Number(v) / 100;
        if (v !== null && v !== undefined) input.value = String(v);
        return el('td', {}, el('label', { for: id, class: 'rotulo-linha' }, rotulo), input, el('div', { class: 'erro-lugar', id: `${id}-erro` }));
      });
      const celulas = [...tds];
      if (extraCelula) celulas.push(extraCelula());
      const remover = el('button', { type: 'button', class: 'botao botao-link remover' },
        'Remover', el('span', { class: 'remover-numero so-leitor' }));
      const tr = el('tr', { [`data-${{ metas: 'meta', equipe: 'equipe', orcamento: 'orcamento' }[tipo]}-linha`]: true }, celulas, el('td', { class: 'celula-acao' }, remover));
      remover.addEventListener('click', () => {
        const proxima = tr.nextElementSibling || tr.previousElementSibling;
        tr.remove();
        renumerar();
        (proxima?.querySelector('input') || botaoAdd).focus();
        aoMudar();
      });
      corpo.append(tr);
      renumerar();
      return tr;
    }
    botaoAdd.addEventListener('click', () => { const tr = adicionar(); tr.querySelector('input').focus(); aoMudar(); });
    return { tabela, corpo, vazio, botaoAdd, adicionar, renumerar };
  }

  const tMetas = criarTabela('metas', 'Metas do projeto', 'Adicionar meta', 'add-meta');
  const tEquipe = criarTabela('equipe', 'Equipe do projeto', 'Adicionar pessoa', 'add-equipe');
  const tOrc = criarTabela('orcamento', 'Itens da planilha orçamentária', 'Adicionar item', 'add-orcamento', 'Total do item', () =>
    el('td', { class: 'celula-total' },
      el('span', { class: 'rotulo-fixo' }, 'Total do item'),
      el('span', { class: 'valor-linha' }, fmt.moeda(0))));

  const totalEl = el('strong', { 'data-orcamento-total': true }, fmt.moeda(0));
  const alertaLugar = el('div', { class: 'orc-alerta-lugar' });
  const resumoOrc = el('div', { class: 'orc-resumo' },
    el('p', {}, el('span', { class: 'rotulo-resumo' }, 'Total da planilha: '), totalEl),
    el('p', {}, el('span', { class: 'rotulo-resumo' }, 'Teto do edital: '), fmt.moeda(edital.teto)));

  function lerOrcamento() {
    return [...tOrc.corpo.children].map(tr => {
      const q = tr.querySelector("[data-campo='orc-qtd']").value;
      const v = tr.querySelector("[data-campo='orc-valor']").value;
      return {
        descricao: tr.querySelector("[data-campo='orc-descricao']").value,
        qtd: q === '' ? null : Number(q),
        valor: v === '' ? null : regras.reaisParaCentavos(v),
      };
    });
  }

  function atualizarOrcamento() {
    const linhas = lerOrcamento();
    [...tOrc.corpo.children].forEach((tr, i) => {
      const inputValor = tr.querySelector("[data-campo='orc-valor']");
      tr.querySelectorAll("[data-erro='negativo']").forEach(e => e.remove());
      if (Number(linhas[i].valor) < 0) {
        colocarErro(inputValor, 'negativo', regras.erroValorItem(linhas[i].valor), 'orc-valor');
        linhas[i].valor = 0;
      } else if (inputValor.getAttribute('aria-invalid') && !tr.querySelector('.erro-dinamico')) {
        inputValor.removeAttribute('aria-invalid');
      }
      const total = Math.max(0, Math.round((Number(linhas[i].qtd) || 0) * (Number(linhas[i].valor) || 0)));
      tr.querySelector('.valor-linha').textContent = fmt.moeda(total);
    });
    const total = Math.max(0, regras.totalOrcamento(linhas));
    totalEl.textContent = fmt.moeda(total);
    const msg = regras.mensagemTeto(total, edital.teto);
    const atual = alertaLugar.firstElementChild;
    if (!msg) { atual?.remove(); return; }
    if (atual) atual.textContent = msg;
    else alertaLugar.append(el('p', { class: 'mensagem mensagem-erro', 'data-orcamento-alerta': true, role: 'alert' }, msg));
  }

  // ---------- anexos ----------
  const blocosAnexo = extrasAnexo.map(c => {
    const id = novoId(c.chave);
    const input = el('input', { id, type: 'file', accept: 'application/pdf,.pdf', 'data-campo': c.chave, name: c.chave, 'aria-describedby': `${id}-estado ${id}-erro` });
    const estadoEl = el('p', { class: 'anexo-estado', id: `${id}-estado` });
    const mostrarEstado = () => {
      const ja = estado.anexos[c.chave];
      const pend = estado.pendentes.get(c.chave);
      estadoEl.textContent = pend ? `Pronto para enviar: ${pend.name}` : ja ? `Arquivo enviado: ${ja.nome}` : 'Nenhum arquivo escolhido.';
    };
    input.addEventListener('change', () => {
      limparErrosDe(input);
      const f = input.files?.[0];
      if (!f) { estado.pendentes.delete(c.chave); mostrarEstado(); return; }
      const msg = regras.validarArquivoPdf({ nome: f.name, tipo: f.type, tamanho: f.size });
      if (msg) {
        input.value = '';
        estado.pendentes.delete(c.chave);
        colocarErro(input, 'anexo', msg);
      } else estado.pendentes.set(c.chave, f);
      mostrarEstado();
      aoMudar();
    });
    mostrarEstado();
    return el('div', { class: 'campo' },
      el('label', { for: id }, c.rotulo, c.obrigatorio ? el('span', { class: 'obrig' }, ' (obrigatório)') : null),
      el('p', { class: 'dica' }, 'Somente PDF, até 10 MB.'),
      input, estadoEl, el('div', { class: 'erro-lugar', id: `${id}-erro` }));
  });

  // ---------- aceite ----------
  const idAceite = novoId('aceite');
  const aceite = el('input', { id: idAceite, type: 'checkbox', 'data-campo': 'aceite', name: 'aceite', 'aria-describedby': `${idAceite}-erro` });
  aceite.checked = inicial.aceite === true;

  // ---------- erros ----------
  function limparErrosDe(raizBusca) {
    const escopo = raizBusca.closest?.('.campo, td') || raizBusca;
    escopo.querySelectorAll('.erro-dinamico').forEach(e => e.remove());
    raizBusca.removeAttribute?.('aria-invalid');
  }
  function colocarErro(input, tipo, mensagem, campo) {
    const lugar = input.closest('.campo, td').querySelector('.erro-lugar');
    lugar.append(el('p', { class: 'erro erro-dinamico', 'data-erro': tipo, 'data-erro-campo': campo || input.getAttribute('data-campo') }, mensagem));
    input.setAttribute('aria-invalid', 'true');
  }
  function limparTudo() {
    form.querySelectorAll('.erro-dinamico').forEach(e => e.remove());
    form.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
    resumoErros.replaceChildren();
    resumoErros.hidden = true;
  }
  function acharInput(campo, linha) {
    const tab = campo.startsWith('meta-') ? tMetas : campo.startsWith('equipe-') ? tEquipe : campo.startsWith('orc-') ? tOrc : null;
    if (tab && linha !== undefined) return tab.corpo.children[linha]?.querySelector(`[data-campo='${campo}']`) || null;
    return form.querySelector(`[data-campo='${campo}']`);
  }
  function mostrarErros(lista) {
    limparTudo();
    let primeiro = null;
    const sobras = [];
    for (const e of lista) {
      const input = acharInput(e.campo, e.linha);
      if (input) { colocarErro(input, 'obrigatorio', e.mensagem, e.campo); primeiro ??= input; } else sobras.push(e.mensagem);
    }
    const total = lista.length;
    resumoErros.hidden = false;
    resumoErros.className = 'mensagem mensagem-erro';
    resumoErros.append(el('p', {}, total === 1 ? 'Há 1 ponto para corrigir antes de enviar.' : `Há ${total} pontos para corrigir antes de enviar.`));
    if (sobras.length) resumoErros.append(el('ul', {}, sobras.map(s => el('li', {}, s))));
    resumoErros.setAttribute('tabindex', '-1');
    (primeiro || resumoErros).focus();
    resumoErros.scrollIntoView?.({ block: 'nearest' });
  }

  // ---------- coleta ----------
  function lerLinhas(tab, tipo) {
    return [...tab.corpo.children].map(tr => {
      const o = {};
      for (const [nome, , , chave] of COLUNAS[tipo]) o[chave] = tr.querySelector(`[data-campo='${nome}']`).value;
      return o;
    });
  }
  function coletar() {
    const extras = {};
    for (const c of extrasTexto) {
      const inp = form.querySelector(`[data-campo='${c.chave}']`);
      if (c.tipo === 'marcar') extras[c.chave] = inp.checked;
      else if (c.tipo === 'numero') extras[c.chave] = inp.value === '' ? null : Number(inp.value);
      else extras[c.chave] = inp.value;
    }
    return {
      titulo: fTitulo.input.value, categoria: fCategoria.input.value, cota: fCota.input.value,
      extras,
      metas: lerLinhas(tMetas, 'metas'),
      equipe: lerLinhas(tEquipe, 'equipe'),
      orcamento: lerOrcamento(),
      anexos: { ...estado.anexos },
      aceite: aceite.checked,
    };
  }

  // ---------- rascunho ----------
  const avisoSalvo = el('p', { class: 'mensagem mensagem-ok', 'data-aviso-salvo': true, role: 'status', hidden: true });
  const autoSalvo = el('p', { class: 'dica auto-salvo', role: 'status' });
  let temporizador = null;
  function aoMudar() {
    atualizarOrcamento();
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      gravarLocal(chaveLocal, { id: estado.id, ficha: coletar() });
      autoSalvo.textContent = `Rascunho automático guardado neste navegador às ${new Date().toTimeString().slice(0, 5)}.`;
    }, 700);
  }

  async function garantirRascunho(ficha) {
    if (estado.id) {
      try { await api.salvarRascunho(estado.id, ficha); return; } catch (e) {
        if (e?.status !== 404) throw e;
        estado.id = null;
      }
    }
    const r = await api.criarInscricao(edital.slug, ficha);
    estado.id = r.inscricao.id;
  }
  async function subirAnexos() {
    for (const [chave, arquivo] of [...estado.pendentes]) {
      const r = await api.enviarAnexo(estado.id, chave, arquivo);
      estado.anexos[chave] = r.anexo;
      estado.pendentes.delete(chave);
      const campoArq = form.querySelector(`[data-campo='${chave}']`);
      if (campoArq) { campoArq.value = ''; campoArq.closest('.campo').querySelector('.anexo-estado').textContent = `Arquivo enviado: ${r.anexo.nome}`; }
    }
  }
  function ocupar(sim) {
    estado.ocupado = sim;
    form.querySelectorAll('button[data-acao]').forEach(b => { b.disabled = sim; });
  }

  async function salvarRascunho() {
    if (estado.ocupado) return;
    limparTudo();
    ocupar(true);
    avisoSalvo.hidden = true;
    try {
      const ficha = coletar();
      await garantirRascunho(ficha);
      await subirAnexos();
      gravarLocal(chaveLocal, { id: estado.id, ficha: coletar() });
      avisoSalvo.className = 'mensagem mensagem-ok';
      avisoSalvo.textContent = `Rascunho salvo às ${new Date().toTimeString().slice(0, 5)}. Você pode voltar e continuar depois.`;
      avisoSalvo.hidden = false;
    } catch (e) {
      avisoSalvo.className = 'mensagem mensagem-erro';
      avisoSalvo.textContent = mensagemDoErro(e);
      avisoSalvo.hidden = false;
    } finally { ocupar(false); }
  }

  async function enviar() {
    if (estado.ocupado) return;
    limparTudo();
    avisoSalvo.hidden = true;
    const ficha = coletar();
    const paraValidar = { ...ficha, anexos: { ...ficha.anexos } };
    for (const [chave, f] of estado.pendentes) paraValidar.anexos[chave] = { nome: f.name, tamanho: f.size };
    const erros = regras.validarFicha(edital, paraValidar);
    if (erros.length) { mostrarErros(erros); return; }
    const teto = regras.mensagemTeto(regras.totalOrcamento(ficha.orcamento), edital.teto);
    if (teto) { mostrarErros([{ campo: 'orcamento', mensagem: teto }]); return; }
    ocupar(true);
    try {
      await garantirRascunho(ficha);
      await subirAnexos();
      const r = await api.enviarInscricao(estado.id, coletar());
      apagarLocal(chaveLocal);
      confirmar(r.inscricao);
    } catch (e) {
      if (e?.campos?.length) mostrarErros(e.campos.map(c => ({ ...c, campo: c.campo === 'orcamento' ? 'orc-valor' : c.campo })));
      else mostrarErros([{ campo: '', mensagem: mensagemDoErro(e) }]);
    } finally { if (form.isConnected) ocupar(false); }
  }

  function confirmar(insc) {
    raiz.replaceChildren(el('section', { class: 'pagina pagina-estreita confirmacao' },
      el('h1', {}, 'Inscrição enviada'),
      el('div', { class: 'ficha-folha' },
        el('p', {}, 'Guarde o número do seu protocolo:'),
        el('p', { class: 'protocolo', 'data-protocolo': insc.protocolo }, insc.protocolo),
        el('p', { class: 'lead' }, `Edital: ${edital.titulo}. A ficha foi congelada e não pode mais ser alterada.`),
        el('div', { class: 'acoes' },
          el('a', { class: 'botao botao-principal', href: `#/inscricao/${encodeURIComponent(insc.protocolo)}` }, 'Ver minha inscrição'),
          el('a', { class: 'botao botao-contorno', href: '#/painel' }, 'Voltar ao painel')))));
    raiz.querySelector('h1').focus();
  }

  // ---------- montagem ----------
  const resumoErros = el('div', { class: 'mensagem mensagem-erro', role: 'alert', hidden: true });
  const prazo = prazoTexto(edital.fim);
  const proponenteItens = [
    ['Nome ou razão social', usuario.nome],
    ['Natureza', usuario.natureza],
    ['Documento', usuario.documento ? fmt.documento(usuario.documento) : ''],
    ['E-mail', usuario.email],
    ['Telefone', usuario.telefone],
    ['Endereço', enderecoTexto(usuario.endereco)],
  ];

  const form = el('form', { class: 'formulario ficha-folha', 'data-form': 'inscricao', novalidate: true, 'aria-label': 'Formulário de inscrição' },
    secao('pessoa', 'Dados do proponente',
      el('p', { class: 'dica' }, 'Copiados da sua conta. Para mudar, use Minha conta antes de enviar.'),
      leitura(proponenteItens)),
    secao('etiqueta', 'Modalidade',
      el('div', { class: 'grade-campos' }, fTitulo.raiz, fCategoria.raiz, fCota.raiz)),
    secao('pergunta', 'Perguntas do edital',
      extrasTexto.length ? extrasTexto.map(campoDoExtra) : el('p', { class: 'dica' }, 'Este edital não tem perguntas extras.')),
    secao('bandeira', 'Metas',
      el('p', { class: 'dica' }, 'Etapas e ações do projeto. Início e fim são opcionais.'),
      tMetas.vazio, tMetas.tabela, el('div', { class: 'acoes' }, tMetas.botaoAdd)),
    secao('equipe', 'Equipe',
      tEquipe.vazio, tEquipe.tabela, el('div', { class: 'acoes' }, tEquipe.botaoAdd)),
    secao('moeda', 'Planilha orçamentária',
      el('p', { class: 'dica' }, 'Informe quantidade e valor unitário em reais. A soma é automática.'),
      tOrc.vazio, tOrc.tabela, el('div', { class: 'acoes' }, tOrc.botaoAdd), resumoOrc, alertaLugar),
    secao('clipe', 'Anexos',
      extrasAnexo.length ? blocosAnexo : el('p', { class: 'dica' }, 'Este edital não pede anexos.')),
    secao('check', 'Aceite',
      el('div', { class: 'campo campo-marcar' },
        el('div', { class: 'marcar-linha' }, aceite,
          el('label', { for: idAceite }, 'Li o edital e declaro que as informações são verdadeiras.', el('span', { class: 'obrig' }, ' (obrigatório)'))),
        el('div', { class: 'erro-lugar', id: `${idAceite}-erro` }))),
    resumoErros,
    avisoSalvo,
    el('div', { class: 'acoes barra-envio' },
      el('button', { type: 'button', class: 'botao botao-contorno', 'data-acao': 'salvar-rascunho' }, 'Salvar rascunho'),
      el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'enviar-inscricao' }, 'Enviar inscrição'),
      autoSalvo));

  const recuperado = Boolean(guardado && (guardado.ficha?.titulo || guardado.id));
  raiz.replaceChildren(el('section', { class: 'pagina pagina-inscricao' },
    el('header', { class: 'cabeca-inscricao' },
      el('h1', {}, 'Nova inscrição'),
      el('p', { class: 'lead' }, `${edital.titulo}. Teto de ${fmt.moeda(edital.teto)}. Inscrições até ${dataBR(edital.fim)}${prazo ? ` (${prazo.toLowerCase()})` : ''}.`),
      recuperado ? el('p', { class: 'mensagem mensagem-info' }, 'Recuperamos o rascunho que você começou neste navegador.') : null),
    form,
    el('p', { class: 'acoes' }, el('a', { class: 'link', href: '#/painel' }, 'Voltar ao painel'))));

  for (const m of inicial.metas || []) tMetas.adicionar(m);
  for (const p of inicial.equipe || []) tEquipe.adicionar(p);
  for (const o of inicial.orcamento || []) tOrc.adicionar(o);
  tMetas.renumerar(); tEquipe.renumerar(); tOrc.renumerar();
  atualizarOrcamento();

  form.addEventListener('input', aoMudar);
  form.addEventListener('change', e => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') aoMudar(); });
  form.addEventListener('input', e => { if (e.target.matches?.('[aria-invalid]')) limparErrosDe(e.target); });
  form.addEventListener('submit', e => { e.preventDefault(); enviar(); });
  form.querySelector("[data-acao='salvar-rascunho']").addEventListener('click', salvarRascunho);
}
