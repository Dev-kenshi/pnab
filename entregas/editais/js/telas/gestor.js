// Área do gestor: início, editais, formulário de edital e inscrições.
import { el, campo, novoId, fmt, dataBR, mensagemDoErro, definirMensagem, limparErros, mostrarErro, botao } from '../ui.js';
import { reaisParaCentavos, TIPOS_CAMPO } from '../regras.js';

const ROTULO_SITUACAO = { rascunho: 'Rascunho', aberto: 'Aberto', encerrado: 'Encerrado' };
const COR_SITUACAO = { rascunho: 'neutro', aberto: 'verde', encerrado: 'azul' };
const ROTULO_TIPO = {
  texto: 'Texto curto', 'texto-longo': 'Texto longo', numero: 'Número', data: 'Data',
  selecao: 'Seleção', marcar: 'Caixa de marcar', anexo: 'Anexo em PDF',
};
const FILTROS_SITUACAO = [
  ['todas', 'Todas'], ['aguardando-avaliacao', 'Aguardando avaliação'], ['avaliada', 'Avaliada'],
  ['selecionado', 'Selecionado'], ['suplente', 'Suplente'], ['nao_selecionado', 'Não selecionado'], ['com-recurso', 'Com recurso'],
];
const RESULTADOS = [['', 'Sem resultado'], ['selecionado', 'Selecionado'], ['suplente', 'Suplente'], ['nao_selecionado', 'Não selecionado']];

// Tabela que vira cartões abaixo de 600 px. Cada célula leva data-rotulo.
// linhas: [{ attrs, celulas: [nó ou texto] }]
export function tabela(legenda, colunas, linhas, attrsTabela = {}) {
  return el('table', { class: 'tabela', ...attrsTabela },
    el('caption', { class: 'so-leitor' }, legenda),
    el('thead', {}, el('tr', {}, colunas.map(c => el('th', { scope: 'col' }, c)))),
    el('tbody', {}, linhas.map(l => el('tr', l.attrs || {}, l.celulas.map((c, i) => el('td', { 'data-rotulo': colunas[i] }, c))))));
}

function caixa(rotulo, marcado, attrs = {}) {
  const id = novoId('caixa');
  const input = el('input', { type: 'checkbox', id, checked: marcado ? true : false, ...attrs });
  return { raiz: el('div', { class: 'caixa' }, input, el('label', { for: id }, rotulo)), input };
}

function selo(situacao) {
  return el('span', { class: `selo selo-${COR_SITUACAO[situacao] || 'neutro'}` }, ROTULO_SITUACAO[situacao] || situacao);
}

function centavosParaReais(c) {
  return (Number(c || 0) / 100).toFixed(2).replace('.', ',');
}

function cabecalho(titulo, texto, ...acoes) {
  return el('header', { class: 'cabeca-pagina' },
    el('div', {}, el('h1', {}, titulo), texto ? el('p', { class: 'lead' }, texto) : null),
    acoes.length ? el('div', { class: 'acoes acoes-topo' }, acoes) : null);
}

// ---------- Início ----------

export async function renderGestor(ctx) {
  const { raiz, api, usuario } = ctx;
  const [ed, av, avs] = await Promise.all([api.gestorEditais(), api.gestorAvisos(), api.gestorAvaliadores()]);
  const editais = ed.editais;
  const abertos = editais.filter(e => e.situacao === 'aberto').length;

  // Avisos
  const msgAviso = el('p', { hidden: true });
  const campoTexto = campo({ rotulo: 'Texto do aviso', nome: 'texto', tipo: 'textarea', linhas: 3, dica: 'O proponente vê este aviso em janela, uma vez por sessão.' });
  const ativo = caixa('Aviso ativo (aparece para os proponentes)', true, { 'data-campo': 'ativo' });
  const listaAvisos = el('ul', { class: 'lista-simples', 'data-lista': 'avisos' });
  const desenharAvisos = lista => {
    listaAvisos.replaceChildren(...(lista.length
      ? lista.map(a => el('li', {}, el('span', {}, a.texto), el('span', { class: `selo selo-${a.ativo ? 'verde' : 'neutro'}` }, a.ativo ? 'Ativo' : 'Inativo')))
      : [el('li', { class: 'vazio' }, 'Nenhum aviso criado.')]));
  };
  desenharAvisos(av.avisos);
  const btnAviso = botao('Publicar aviso', { 'data-acao': 'criar-aviso' });
  btnAviso.addEventListener('click', async () => {
    limparErros(formAviso);
    definirMensagem(msgAviso, 'ok', '');
    btnAviso.disabled = true;
    try {
      await api.criarAviso({ texto: campoTexto.input.value, ativo: ativo.input.checked });
      campoTexto.input.value = '';
      desenharAvisos((await api.gestorAvisos()).avisos);
      definirMensagem(msgAviso, 'ok', 'Aviso salvo.');
    } catch (e) {
      const c = e.campos?.find(x => x.campo === 'texto');
      if (c) { mostrarErro(campoTexto.erro, c.mensagem); campoTexto.input.setAttribute('aria-invalid', 'true'); }
      else definirMensagem(msgAviso, 'erro', mensagemDoErro(e));
    } finally { btnAviso.disabled = false; }
  });
  const formAviso = el('form', { class: 'formulario', 'data-form': 'aviso', novalidate: true, onsubmit: ev => ev.preventDefault() },
    campoTexto.raiz, ativo.raiz, msgAviso, el('div', { class: 'acoes' }, btnAviso));

  // Equipe
  const msgAval = el('p', { hidden: true });
  const cNome = campo({ rotulo: 'Nome', nome: 'nome', autocomplete: 'off' });
  const cDoc = campo({ rotulo: 'CPF', nome: 'documento', inputmode: 'numeric', autocomplete: 'off' });
  const cEmail = campo({ rotulo: 'E-mail', nome: 'email', tipo: 'email', autocomplete: 'off' });
  const cSenha = campo({ rotulo: 'Senha inicial', nome: 'senha', tipo: 'password', autocomplete: 'new-password', dica: 'Mínimo de 8 caracteres. A pessoa deve trocá-la no primeiro acesso.' });
  const mapa = { nome: cNome, documento: cDoc, email: cEmail, senha: cSenha };
  const listaAval = el('ul', { class: 'lista-simples', 'data-lista': 'avaliadores' });
  const desenharAval = lista => {
    listaAval.replaceChildren(...(lista.length
      ? lista.map(a => el('li', {}, el('span', {}, a.nome)))
      : [el('li', { class: 'vazio' }, 'Nenhum avaliador na equipe ainda.')]));
  };
  desenharAval(avs.avaliadores);
  const btnAval = botao('Criar avaliador', { 'data-acao': 'criar-avaliador' });
  btnAval.addEventListener('click', async () => {
    limparErros(formAval);
    definirMensagem(msgAval, 'ok', '');
    btnAval.disabled = true;
    try {
      await api.criarAvaliador({ nome: cNome.input.value, documento: cDoc.input.value, email: cEmail.input.value, senha: cSenha.input.value });
      for (const c of Object.values(mapa)) c.input.value = '';
      desenharAval((await api.gestorAvaliadores()).avaliadores);
      definirMensagem(msgAval, 'ok', 'Avaliador criado.');
    } catch (e) {
      let sobra = (e.campos || []).filter(c => { const a = mapa[c.campo]; if (a) { mostrarErro(a.erro, c.mensagem); a.input.setAttribute('aria-invalid', 'true'); } return !a; });
      if (!e.campos?.length || sobra.length) definirMensagem(msgAval, 'erro', mensagemDoErro(e));
    } finally { btnAval.disabled = false; }
  });
  const formAval = el('form', { class: 'formulario', 'data-form': 'avaliador', novalidate: true, onsubmit: ev => ev.preventDefault() },
    el('div', { class: 'grade-campos' }, cNome.raiz, cDoc.raiz, cEmail.raiz, cSenha.raiz), msgAval, el('div', { class: 'acoes' }, btnAval));

  raiz.replaceChildren(el('div', { class: 'pagina', 'data-painel': 'gestor' },
    cabecalho('Área do gestor', usuario.organizacao ? usuario.organizacao.nome : '',
      el('a', { class: 'botao botao-principal', href: '#/gestor/editais/novo', 'data-acao': 'novo-edital' }, 'Novo edital')),
    el('ul', { class: 'atalhos' },
      el('li', {}, el('a', { class: 'atalho', href: '#/gestor/editais' },
        el('strong', {}, String(editais.length)), el('span', {}, `editais cadastrados, ${abertos} aberto${abertos === 1 ? '' : 's'}`), el('em', {}, 'Ver editais'))),
      el('li', {}, el('a', { class: 'atalho', href: '#/gestor/inscricoes' },
        el('strong', {}, '→'), el('span', {}, 'Inscrições, avaliadores, resultado e recursos'), el('em', {}, 'Ver inscrições')))),
    el('div', { class: 'duas-colunas' },
      el('section', { class: 'bloco', 'aria-labelledby': 'sec-avisos' },
        el('h2', { id: 'sec-avisos' }, 'Avisos'),
        el('div', { class: 'cartao' }, formAviso), listaAvisos),
      el('section', { class: 'bloco', 'aria-labelledby': 'sec-equipe' },
        el('h2', { id: 'sec-equipe' }, 'Equipe de avaliação'),
        el('div', { class: 'cartao' }, formAval), listaAval))));
}

// ---------- Lista de editais ----------

export async function renderGestorEditais(ctx) {
  const { raiz, api } = ctx;
  const msg = el('p', { hidden: true });
  const area = el('div', {});

  async function carregar() {
    const { editais } = await api.gestorEditais();
    if (!editais.length) { area.replaceChildren(el('p', { class: 'vazio' }, 'Nenhum edital ainda. Crie o primeiro.')); return; }
    const linhas = editais.map(e => {
      const motivos = el('ul', { class: 'motivos', hidden: true, 'aria-live': 'polite' });
      const acoes = el('div', { class: 'acoes-linha' },
        e.situacao !== 'encerrado' ? el('a', { class: 'botao botao-contorno botao-pequeno', href: `#/gestor/editais/novo?editar=${encodeURIComponent(e.slug)}` }, 'Editar') : null,
        e.situacao === 'rascunho' ? botao('Abrir inscrições', { class: 'botao-principal botao-pequeno', 'data-acao': 'abrir-edital', 'data-edital': e.slug, onclick: ev => agir(ev.currentTarget, () => api.abrirEdital(e.slug), motivos) }) : null,
        e.situacao === 'aberto' ? botao('Encerrar', { class: 'botao-contorno botao-pequeno', 'data-acao': 'encerrar-edital', 'data-edital': e.slug, onclick: ev => agir(ev.currentTarget, () => api.encerrarEdital(e.slug), motivos) }) : null,
        e.situacao === 'encerrado' ? el('a', { class: 'botao botao-contorno botao-pequeno', href: `#/gestor/inscricoes?edital=${encodeURIComponent(e.slug)}` }, 'Ver inscrições') : null,
        motivos);
      return {
        attrs: { 'data-edital-linha': e.slug, 'data-situacao': e.situacao },
        celulas: [
          el('span', {}, el('strong', {}, e.titulo), el('br'), el('span', { class: 'discreto' }, e.numero)),
          `${dataBR(e.inicio)} a ${dataBR(e.fim)}`,
          fmt.moeda(e.teto),
          selo(e.situacao),
          acoes,
        ],
      };
    });
    area.replaceChildren(tabela('Editais da organização', ['Edital', 'Período', 'Teto', 'Situação', 'Ações'], linhas, { 'data-lista': 'editais' }));
  }

  async function agir(btn, fazer, motivos) {
    btn.disabled = true;
    definirMensagem(msg, 'ok', '');
    motivos.hidden = true;
    try {
      await fazer();
      await carregar();
    } catch (e) {
      btn.disabled = false;
      if (e.campos?.length) {
        motivos.replaceChildren(...e.campos.map(c => el('li', {}, c.mensagem)));
        motivos.hidden = false;
      } else definirMensagem(msg, 'erro', mensagemDoErro(e));
    }
  }

  raiz.replaceChildren(el('div', { class: 'pagina' },
    cabecalho('Editais', 'Crie, edite, abra e encerre as inscrições.',
      el('a', { class: 'botao botao-principal', href: '#/gestor/editais/novo', 'data-acao': 'novo-edital' }, 'Novo edital')),
    msg, area));
  await carregar();
}

// ---------- Formulário de edital ----------

function linhaTexto(rotulo, valor, onRemover, extra = {}) {
  const c = campo({ rotulo, nome: extra.nome || 'item', semDataCampo: true, valor });
  const rem = botao('Remover', { class: 'botao-contorno botao-pequeno', 'aria-label': `Remover ${rotulo.toLowerCase()}${valor ? ` ${valor}` : ''}`, onclick: onRemover });
  return { raiz: el('li', { class: 'linha-item' }, c.raiz, rem), input: c.input, erro: c.erro };
}

// Lista editável. fabrica(valor, remover) devolve { raiz, ler(), erro, input? }.
function listaEditavel({ titulo, dica, nomeErro, rotuloAdd, fabrica, iniciais, vazio }) {
  const ul = el('ul', { class: 'lista-linhas' });
  const itens = [];
  const erro = el('p', { class: 'erro', 'data-erro': nomeErro, role: 'alert', hidden: true });
  const aviso = el('p', { class: 'vazio', hidden: true }, vazio);
  const sincronizar = () => { aviso.hidden = itens.length > 0; };
  function adicionar(valor) {
    const item = fabrica(valor, () => {
      const i = itens.indexOf(item);
      if (i >= 0) itens.splice(i, 1);
      item.raiz.remove();
      sincronizar();
    });
    itens.push(item);
    ul.append(item.raiz);
    sincronizar();
    return item;
  }
  (iniciais || []).forEach(adicionar);
  sincronizar();
  const add = botao(rotuloAdd, { class: 'botao-contorno botao-pequeno', onclick: () => adicionar().input?.focus() });
  const raiz = el('fieldset', { class: 'conjunto' },
    el('legend', {}, titulo), dica ? el('p', { class: 'dica' }, dica) : null, aviso, ul, erro, el('div', { class: 'acoes' }, add));
  return { raiz, itens, erro, ler: () => itens.map(i => i.ler()) };
}

function fabricaCriterio(valor, remover) {
  const nome = campo({ rotulo: 'Nome do critério', nome: 'criterio-nome', semDataCampo: true, valor: valor?.nome ?? '' });
  const max = campo({ rotulo: 'Nota máxima', nome: 'criterio-maximo', semDataCampo: true, tipo: 'number', valor: valor?.maximo ?? '' });
  max.input.setAttribute('min', '0.1'); max.input.setAttribute('step', 'any'); max.input.setAttribute('inputmode', 'decimal');
  const bonus = caixa('Critério de bônus', valor?.bonus === true);
  const rem = botao('Remover', { class: 'botao-contorno botao-pequeno', 'aria-label': 'Remover critério', onclick: remover });
  const erro = el('p', { class: 'erro', role: 'alert', hidden: true });
  return {
    raiz: el('li', { class: 'linha-item linha-item-grade' }, nome.raiz, max.raiz, bonus.raiz, rem, erro),
    input: nome.input, erro,
    ler: () => ({ nome: nome.input.value.trim(), maximo: Number(String(max.input.value).replace(',', '.')) || 0, bonus: bonus.input.checked }),
  };
}

function fabricaExtra(valor, remover) {
  const rotulo = campo({ rotulo: 'Rótulo do campo', nome: 'extra-rotulo', semDataCampo: true, valor: valor?.rotulo ?? '' });
  const tipo = campo({ rotulo: 'Tipo', nome: 'extra-tipo', semDataCampo: true, tipo: 'select', opcoes: TIPOS_CAMPO.map(t => [t, ROTULO_TIPO[t] || t]), valor: valor?.tipo ?? 'texto' });
  const opcoes = campo({ rotulo: 'Opções (separadas por vírgula)', nome: 'extra-opcoes', semDataCampo: true, valor: (valor?.opcoes || []).join(', ') });
  const obrig = caixa('Obrigatório', valor?.obrigatorio === true);
  const rem = botao('Remover', { class: 'botao-contorno botao-pequeno', 'aria-label': 'Remover campo extra', onclick: remover });
  const erro = el('p', { class: 'erro', role: 'alert', hidden: true });
  const atualizar = () => { opcoes.raiz.hidden = tipo.input.value !== 'selecao'; };
  tipo.input.addEventListener('change', atualizar);
  atualizar();
  return {
    raiz: el('li', { class: 'linha-item linha-item-grade' }, rotulo.raiz, tipo.raiz, opcoes.raiz, obrig.raiz, rem, erro),
    input: rotulo.input, erro,
    ler: () => {
      const t = tipo.input.value;
      const item = { rotulo: rotulo.input.value.trim(), tipo: t, obrigatorio: obrig.input.checked };
      if (t === 'selecao') item.opcoes = opcoes.input.value.split(',').map(s => s.trim()).filter(Boolean);
      return item;
    },
  };
}

export async function renderGestorEditalForm(ctx) {
  const { raiz, api, params, navegar } = ctx;
  const slugEdicao = params.get('editar');
  let edital = null;
  if (slugEdicao) edital = (await api.obterEdital(slugEdicao)).edital;
  const novo = !edital;

  const cNumero = campo({ rotulo: 'Número do edital', nome: 'numero', valor: edital?.numero ?? '', obrigatorio: true });
  const cTitulo = campo({ rotulo: 'Título', nome: 'titulo', valor: edital?.titulo ?? '', obrigatorio: true });
  const cDescricao = campo({ rotulo: 'Descrição', nome: 'descricao', tipo: 'textarea', linhas: 4, valor: edital?.descricao ?? '' });
  const cInicio = campo({ rotulo: 'Início das inscrições', nome: 'inicio', tipo: 'date', valor: edital?.inicio ?? '', obrigatorio: true });
  const cFim = campo({ rotulo: 'Fim das inscrições', nome: 'fim', tipo: 'date', valor: edital?.fim ?? '', obrigatorio: true });
  const cTeto = campo({ rotulo: 'Teto do orçamento (R$)', nome: 'teto', inputmode: 'decimal', valor: edital ? centavosParaReais(edital.teto) : '', dica: 'Valor máximo que a planilha de cada inscrição pode somar.', obrigatorio: true });

  const categorias = listaEditavel({
    titulo: 'Categorias', nomeErro: 'categorias', rotuloAdd: 'Adicionar categoria', vazio: 'Nenhuma categoria. O edital precisa de ao menos uma para abrir.',
    iniciais: edital ? edital.categorias : ['Geral'],
    fabrica: (v, rem) => { const l = linhaTexto('Nome da categoria', v ?? '', rem, { nome: 'categoria-nome' }); return { ...l, ler: () => l.input.value.trim() }; },
  });
  const cotas = listaEditavel({
    titulo: 'Cotas', nomeErro: 'cotas', rotuloAdd: 'Adicionar cota', vazio: 'Nenhuma cota. O edital precisa de ao menos uma para abrir.',
    iniciais: edital ? edital.cotas : ['Ampla concorrência'],
    fabrica: (v, rem) => { const l = linhaTexto('Nome da cota', v ?? '', rem, { nome: 'cota-nome' }); return { ...l, ler: () => l.input.value.trim() }; },
  });
  const criterios = listaEditavel({
    titulo: 'Critérios de avaliação', nomeErro: 'criterios', rotuloAdd: 'Adicionar critério', vazio: 'Nenhum critério. O edital precisa de ao menos um para abrir.',
    dica: 'A nota geral é a soma das notas. Critério de bônus aceita nota zero.',
    iniciais: edital ? edital.criterios : [{ nome: 'Mérito', maximo: 10, bonus: false }],
    fabrica: fabricaCriterio,
  });
  const extras = listaEditavel({
    titulo: 'Campos extras do formulário', nomeErro: 'camposExtras', rotuloAdd: 'Adicionar campo extra', vazio: 'Nenhum campo extra.',
    dica: 'Perguntas a mais que o proponente responde na inscrição.',
    iniciais: edital ? edital.camposExtras : [],
    fabrica: fabricaExtra,
  });

  const mapa = { numero: cNumero, titulo: cTitulo, descricao: cDescricao, inicio: cInicio, fim: cFim, teto: cTeto };
  const listas = { categorias, cotas, criterios, camposExtras: extras };
  const msg = el('p', { hidden: true });
  const salvar = botao('Salvar edital', { 'data-acao': 'salvar-edital' });
  const encerrado = edital?.situacao === 'encerrado';
  if (encerrado) salvar.disabled = true;

  salvar.addEventListener('click', async () => {
    limparErros(form);
    definirMensagem(msg, 'ok', '');
    for (const l of Object.values(listas)) l.itens.forEach(i => { if (i.erro) { i.erro.textContent = ''; i.erro.hidden = true; } });
    const dados = {
      numero: cNumero.input.value.trim(), titulo: cTitulo.input.value.trim(), descricao: cDescricao.input.value.trim(),
      inicio: cInicio.input.value, fim: cFim.input.value, teto: cTeto.input.value.trim() === '' ? '' : reaisParaCentavos(cTeto.input.value),
      categorias: categorias.ler(), cotas: cotas.ler(), criterios: criterios.ler(), camposExtras: extras.ler(),
    };
    salvar.disabled = true;
    try {
      if (novo) await api.criarEdital(dados); else await api.salvarEdital(edital.slug, dados);
      navegar('#/gestor/editais');
    } catch (e) {
      salvar.disabled = false;
      const sobras = [];
      for (const c of e.campos || []) {
        if (mapa[c.campo]) { mostrarErro(mapa[c.campo].erro, c.mensagem); mapa[c.campo].input.setAttribute('aria-invalid', 'true'); continue; }
        const lista = listas[c.campo];
        if (lista) {
          const alvo = c.linha !== undefined ? lista.itens[c.linha]?.erro : null;
          mostrarErro(alvo || lista.erro, c.mensagem);
          if (alvo) alvo.parentElement?.querySelector('input')?.setAttribute('aria-invalid', 'true');
          continue;
        }
        sobras.push(c.mensagem);
      }
      definirMensagem(msg, 'erro', sobras.length || !e.campos?.length ? (sobras.join(' ') || mensagemDoErro(e)) : 'Confira os campos destacados.');
      form.querySelector('[aria-invalid="true"]')?.focus();
    }
  });

  const form = el('form', { class: 'formulario formulario-edital', 'data-form': 'edital', novalidate: true, onsubmit: ev => ev.preventDefault() },
    encerrado ? el('p', { class: 'mensagem mensagem-info' }, 'Edital encerrado não pode ser alterado.') : null,
    el('fieldset', { class: 'conjunto' }, el('legend', {}, 'Dados do edital'),
      el('div', { class: 'grade-campos' }, cNumero.raiz, cTitulo.raiz),
      cDescricao.raiz,
      el('div', { class: 'grade-campos' }, cInicio.raiz, cFim.raiz, cTeto.raiz)),
    categorias.raiz, cotas.raiz, criterios.raiz, extras.raiz, msg,
    el('div', { class: 'acoes' }, salvar, el('a', { class: 'botao botao-contorno', href: '#/gestor/editais' }, 'Cancelar')));

  raiz.replaceChildren(el('div', { class: 'pagina pagina-media' },
    cabecalho(novo ? 'Novo edital' : 'Editar edital', novo ? 'O edital nasce em rascunho. Abra as inscrições quando estiver pronto.' : edital.titulo),
    el('div', { class: 'cartao' }, form)));
}

// ---------- Inscrições ----------

export async function renderGestorInscricoes(ctx) {
  const { raiz, api, params } = ctx;
  const [{ editais }, { avaliadores }] = await Promise.all([api.gestorEditais(), api.gestorAvaliadores()]);
  const visiveis = editais.filter(e => e.situacao !== 'rascunho');

  const fEdital = campo({
    rotulo: 'Edital', nome: 'filtro-edital', semDataCampo: true, tipo: 'select',
    opcoes: [['', 'Todos os editais'], ...visiveis.map(e => [e.slug, e.titulo])], valor: params.get('edital') || '',
  });
  fEdital.input.setAttribute('data-filtro', 'edital');
  const fSituacao = campo({ rotulo: 'Situação', nome: 'filtro-situacao', semDataCampo: true, tipo: 'select', opcoes: FILTROS_SITUACAO, valor: 'todas' });
  fSituacao.input.setAttribute('data-filtro', 'situacao');

  const msg = el('p', { hidden: true });
  const barraPublicar = el('div', { class: 'barra-publicar', hidden: true });
  const lista = el('div', { 'data-lista': 'inscricoes' });
  const decisao = el('div', { class: 'decisao' });

  function dizer(tipo, texto) { definirMensagem(msg, tipo, texto); }

  function abrirDecisao(i) {
    const parecer = campo({ rotulo: 'Parecer da comissão', nome: 'parecer-recurso', tipo: 'textarea', linhas: 4 });
    const aviso = el('p', { hidden: true });
    const enviar = async d => {
      parecer.erro.hidden = true;
      definirMensagem(aviso, 'ok', '');
      try {
        await api.decidirRecurso(i.recurso.id, d, parecer.input.value);
        decisao.replaceChildren();
        dizer('ok', `Recurso ${i.protocolo} ${d === 'deferido' ? 'deferido' : 'indeferido'}.`);
        await carregar();
      } catch (e) {
        const c = e.campos?.find(x => x.campo === 'parecer-recurso');
        if (c) { mostrarErro(parecer.erro, c.mensagem); parecer.input.setAttribute('aria-invalid', 'true'); }
        else definirMensagem(aviso, 'erro', mensagemDoErro(e));
      }
    };
    decisao.replaceChildren(el('section', { class: 'cartao cartao-decisao', 'aria-labelledby': 'tit-decisao' },
      el('h2', { id: 'tit-decisao' }, `Decidir recurso de ${i.protocolo}`),
      el('p', {}, el('strong', {}, 'Justificativa do proponente: '), i.recurso.justificativa),
      parecer.raiz, aviso,
      el('div', { class: 'acoes' },
        botao('Deferir', { 'data-acao': 'deferir', onclick: () => enviar('deferido') }),
        botao('Indeferir', { class: 'botao-contorno', 'data-acao': 'indeferir', onclick: () => enviar('indeferido') }),
        botao('Cancelar', { class: 'botao-link', onclick: () => decisao.replaceChildren() }))));
    parecer.input.focus();
    decisao.scrollIntoView({ block: 'nearest' });
  }

  function linhaInscricao(i) {
    const bloqueada = i.avaliacaoEnviada;
    const selAval = campo({
      rotulo: `Avaliador de ${i.protocolo}`, nome: `avaliador-${i.protocolo}`, semDataCampo: true, tipo: 'select',
      opcoes: [['', 'Sem avaliador'], ...avaliadores.map(a => [String(a.id), a.nome])], valor: i.avaliador ? String(i.avaliador.id) : '',
      disabled: bloqueada,
    });
    selAval.input.setAttribute('data-avaliador', i.protocolo);
    selAval.rotulo.classList.add('so-leitor');
    const btnAtribuir = botao('Atribuir', {
      class: 'botao-contorno botao-pequeno', 'data-acao': 'atribuir-avaliador', 'data-inscricao': i.protocolo, disabled: bloqueada,
      'aria-label': `Atribuir avaliador a ${i.protocolo}`,
      onclick: async () => {
        if (!selAval.input.value) { dizer('erro', 'Escolha um avaliador para atribuir.'); return; }
        btnAtribuir.disabled = true;
        try { await api.atribuirAvaliador(i.protocolo, Number(selAval.input.value) || selAval.input.value); dizer('ok', `Avaliador atribuído a ${i.protocolo}.`); await carregar(); }
        catch (e) { btnAtribuir.disabled = false; dizer('erro', mensagemDoErro(e)); }
      },
    });
    const selRes = campo({
      rotulo: `Resultado de ${i.protocolo}`, nome: `resultado-${i.protocolo}`, semDataCampo: true, tipo: 'select', opcoes: RESULTADOS, valor: i.resultado || '',
    });
    selRes.input.setAttribute('data-resultado', i.protocolo);
    selRes.rotulo.classList.add('so-leitor');
    selRes.input.addEventListener('change', async () => {
      if (!selRes.input.value) return;
      try { await api.definirResultado(i.protocolo, selRes.input.value); dizer('ok', `Resultado de ${i.protocolo} definido.`); await carregar(); }
      catch (e) { dizer('erro', mensagemDoErro(e)); selRes.input.value = i.resultado || ''; }
    });
    const rec = i.recurso;
    const celRec = rec
      ? el('span', { class: 'recurso-cel' },
        el('span', { class: `selo selo-${rec.situacao === 'Em análise' ? 'amarelo' : rec.situacao === 'Deferido' ? 'verde' : 'vermelho'}` }, rec.situacao),
        rec.situacao === 'Em análise' ? botao('Decidir', { class: 'botao-contorno botao-pequeno', 'data-acao': 'decidir-recurso', 'data-inscricao': i.protocolo, 'aria-label': `Decidir recurso de ${i.protocolo}`, onclick: () => abrirDecisao(i) }) : null)
      : 'Sem recurso';
    return {
      attrs: { 'data-inscricao-linha': i.protocolo },
      celulas: [
        el('span', {}, el('strong', {}, i.protocolo), el('br'), el('span', { class: 'discreto' }, i.edital.titulo)),
        el('span', {}, i.titulo || 'Sem título', el('br'), el('span', { class: 'discreto' }, `${i.categoria || ''}${i.cota ? ` · ${i.cota}` : ''}`)),
        i.proponente.nome,
        i.notaGeral !== null && i.notaGeral !== undefined ? fmt.nota(i.notaGeral) : 'Sem nota',
        el('span', { class: 'junto' }, selAval.raiz, btnAtribuir),
        selRes.raiz,
        celRec,
      ],
    };
  }

  async function carregar() {
    const edital = fEdital.input.value;
    const { inscricoes } = await api.gestorInscricoes({ edital, situacao: fSituacao.input.value });
    const ed = visiveis.find(e => e.slug === edital);
    const resumo = ed ? (await api.gestorEditais()).editais.find(e => e.slug === ed.slug) : null;
    if (resumo && resumo.situacao === 'encerrado' && !resumo.resultadoPublicadoEm) {
      barraPublicar.hidden = false;
      barraPublicar.replaceChildren(
        el('p', {}, 'Todas as inscrições precisam de resultado antes de publicar. Depois da publicação, abre o prazo de 15 dias para recurso.'),
        botao('Publicar resultado', {
          'data-acao': 'publicar-resultado',
          onclick: async ev => {
            const b = ev.currentTarget;
            b.disabled = true;
            try { await api.publicarResultado(resumo.slug); dizer('ok', 'Resultado publicado.'); await carregar(); }
            catch (e) { b.disabled = false; dizer('erro', mensagemDoErro(e)); }
          },
        }));
    } else if (resumo && resumo.resultadoPublicadoEm) {
      barraPublicar.hidden = false;
      barraPublicar.replaceChildren(el('p', { class: 'mensagem mensagem-ok' }, `Resultado publicado em ${dataBR(resumo.resultadoPublicadoEm)}. Prazo de recurso até ${dataBR(resumo.prazoRecursoAte)}.`));
    } else { barraPublicar.hidden = true; barraPublicar.replaceChildren(); }
    lista.replaceChildren(inscricoes.length
      ? tabela('Inscrições enviadas', ['Protocolo', 'Projeto', 'Proponente', 'Nota', 'Avaliador', 'Resultado', 'Recurso'], inscricoes.map(linhaInscricao))
      : el('p', { class: 'vazio' }, 'Nenhuma inscrição com esses filtros.'));
  }

  const recarregar = async () => { dizer('ok', ''); decisao.replaceChildren(); try { await carregar(); } catch (e) { dizer('erro', mensagemDoErro(e)); } };
  fEdital.input.addEventListener('change', recarregar);
  fSituacao.input.addEventListener('change', recarregar);

  raiz.replaceChildren(el('div', { class: 'pagina' },
    cabecalho('Inscrições', 'Atribua avaliadores, defina resultados, publique e decida recursos.'),
    el('div', { class: 'barra-filtros cartao' }, fEdital.raiz, fSituacao.raiz),
    barraPublicar, msg, lista, decisao));
  await carregar();
}
