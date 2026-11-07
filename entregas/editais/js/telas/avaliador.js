// Área do avaliador: lista atribuída e ficha de avaliação.
import { el, campo, fmt, mensagemDoErro, definirMensagem, limparErros, mostrarErro, botao } from '../ui.js';
import { tabela } from './gestor.js';

function lerNumero(texto) {
  const t = String(texto ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function valorLegivel(v) {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  if (v === null || v === undefined || v === '') return 'Não informado';
  return String(v);
}

function resumoFicha(ins, rotulosExtras) {
  const f = ins.ficha || {};
  const extras = Object.entries(f.extras || {});
  const metas = f.metas || [];
  const equipe = f.equipe || [];
  const orc = f.orcamento || [];
  return el('section', { class: 'cartao ficha-resumo', 'aria-labelledby': 'tit-ficha' },
    el('h2', { id: 'tit-ficha' }, 'Resumo da ficha'),
    el('p', { class: 'dica' }, 'Documentos e contato do proponente não aparecem na avaliação.'),
    el('dl', { class: 'dados' },
      el('div', {}, el('dt', {}, 'Edital'), el('dd', {}, ins.edital.titulo)),
      el('div', {}, el('dt', {}, 'Projeto'), el('dd', {}, ins.titulo || 'Sem título')),
      el('div', {}, el('dt', {}, 'Categoria'), el('dd', {}, ins.categoria || 'Não informada')),
      el('div', {}, el('dt', {}, 'Cota'), el('dd', {}, ins.cota || 'Não informada'))),
    extras.length ? el('div', {}, extras.map(([k, v]) =>
      el('div', { class: 'bloco-texto' }, el('h3', {}, rotulosExtras[k] || k), el('p', {}, valorLegivel(v))))) : null,
    metas.length ? el('div', { class: 'bloco-texto' }, el('h3', {}, 'Metas'),
      el('ul', { class: 'lista-simples' }, metas.map(m => el('li', {}, `${m.etapa}: ${m.acao}`)))) : null,
    equipe.length ? el('div', { class: 'bloco-texto' }, el('h3', {}, 'Equipe'),
      el('ul', { class: 'lista-simples' }, equipe.map(m => el('li', {}, `${m.nome}, ${m.funcao}`)))) : null,
    orc.length ? el('div', { class: 'bloco-texto' }, el('h3', {}, 'Orçamento'),
      el('ul', { class: 'lista-simples' }, orc.map(o => el('li', {}, `${o.descricao}: ${o.qtd} x ${fmt.moeda(o.valor)} = ${fmt.moeda(o.qtd * o.valor)}`)))) : null);
}

function leituraAvaliacao(av) {
  return el('section', { class: 'cartao', 'aria-labelledby': 'tit-aval' },
    el('h2', { id: 'tit-aval' }, 'Avaliação enviada'),
    el('p', { class: 'mensagem mensagem-ok', 'data-avaliacao-enviada': true }, `Avaliação enviada. Nota geral: ${fmt.nota(av.notaGeral)}`),
    tabela('Notas por critério', ['Critério', 'Máximo', 'Nota'], av.notas.map(n => ({
      celulas: [`${n.nome}${n.bonus ? ' (bônus)' : ''}`, fmt.nota(n.maximo), fmt.nota(n.nota)],
    }))),
    el('h3', {}, 'Parecer'), el('p', { class: 'parecer-texto' }, av.parecer));
}

async function telaAvaliar(ctx, protocolo) {
  const { raiz, api } = ctx;
  const { inscricao: ins } = await api.avaliadorInscricao(protocolo);
  let rotulos = {};
  try {
    const { edital } = await api.obterEdital(ins.edital.slug);
    rotulos = Object.fromEntries(edital.camposExtras.map(c => [c.chave, c.rotulo]));
  } catch { /* sem rótulos, usa a chave */ }

  const cabeca = el('header', { class: 'cabeca-pagina' },
    el('div', {}, el('h1', {}, `Avaliar ${ins.protocolo}`), el('p', { class: 'lead' }, ins.titulo || ins.edital.titulo)),
    el('div', { class: 'acoes acoes-topo' }, el('a', { class: 'botao botao-contorno', href: '#/avaliador' }, 'Voltar à lista')));
  const topo = [cabeca, resumoFicha(ins, rotulos)];

  if (ins.avaliacao) {
    raiz.replaceChildren(el('div', { class: 'pagina', 'data-painel': 'avaliador' }, ...topo, leituraAvaliacao(ins.avaliacao)));
    return;
  }

  const geral = el('output', { class: 'nota-geral-valor', 'data-nota-geral': true, 'aria-live': 'polite' }, fmt.nota(0));
  const campos = {};
  const blocos = ins.criterios.map(c => {
    const f = campo({
      rotulo: `${c.nome} (máximo ${fmt.nota(c.maximo)})${c.bonus ? ', bônus' : ''}`, nome: `nota-${c.chave}`, semDataCampo: true, tipo: 'number',
      dica: c.bonus ? 'Critério de bônus. Zero é aceito e não desclassifica.' : undefined,
    });
    f.input.setAttribute('data-nota', c.chave);
    f.input.setAttribute('min', '0'); f.input.setAttribute('max', String(c.maximo)); f.input.setAttribute('step', 'any'); f.input.setAttribute('inputmode', 'decimal');
    f.input.addEventListener('input', somar);
    campos[c.chave] = f;
    return f.raiz;
  });
  function somar() {
    const soma = Object.values(campos).reduce((s, f) => s + (lerNumero(f.input.value) || 0), 0);
    geral.textContent = fmt.nota(soma);
  }
  const parecer = campo({ rotulo: 'Parecer técnico', nome: 'parecer', tipo: 'textarea', linhas: 6, dica: 'Justifique as notas.' });
  const msg = el('p', { hidden: true });
  const enviar = botao('Enviar avaliação', { 'data-acao': 'enviar-avaliacao' });
  const form = el('form', { class: 'formulario', 'data-form': 'avaliacao', novalidate: true, onsubmit: ev => ev.preventDefault() },
    el('fieldset', { class: 'conjunto' }, el('legend', {}, 'Notas por critério'),
      el('div', { class: 'grade-campos' }, blocos),
      el('p', { class: 'nota-geral' }, el('span', {}, 'Nota geral (soma): '), geral)),
    parecer.raiz, msg,
    el('p', { class: 'dica' }, 'Depois de enviada, a avaliação não pode ser alterada.'),
    el('div', { class: 'acoes' }, enviar));
  const area = el('section', { class: 'cartao', 'aria-labelledby': 'tit-notas' }, el('h2', { id: 'tit-notas' }, 'Sua avaliação'), form);

  enviar.addEventListener('click', async () => {
    limparErros(form);
    definirMensagem(msg, 'ok', '');
    const notas = {};
    const faltando = [];
    for (const c of ins.criterios) {
      const v = lerNumero(campos[c.chave].input.value);
      notas[c.chave] = v;
      if (v === null) faltando.push(c.chave);
    }
    enviar.disabled = true;
    try {
      const { avaliacao } = await api.enviarAvaliacao(protocolo, notas, parecer.input.value);
      area.replaceChildren(leituraAvaliacao({ ...avaliacao, notas: avaliacao.notas }));
      area.querySelector('[data-avaliacao-enviada]')?.setAttribute('tabindex', '-1');
      area.querySelector('[data-avaliacao-enviada]')?.focus();
    } catch (e) {
      enviar.disabled = false;
      const sobras = [];
      for (const c of e.campos || []) {
        const alvo = c.campo === 'parecer' ? parecer : campos[c.campo];
        if (alvo) { mostrarErro(alvo.erro, c.mensagem); alvo.input.setAttribute('aria-invalid', 'true'); } else sobras.push(c.mensagem);
      }
      definirMensagem(msg, 'erro', e.campos?.length && !sobras.length ? 'Confira os campos destacados.' : (sobras.join(' ') || mensagemDoErro(e)));
      form.querySelector('[aria-invalid="true"]')?.focus();
    }
  });

  raiz.replaceChildren(el('div', { class: 'pagina', 'data-painel': 'avaliador' }, ...topo, area));
}

export async function renderAvaliador(ctx) {
  const { raiz, api, params } = ctx;
  const protocolo = params.get('inscricao');
  if (protocolo) { await telaAvaliar(ctx, protocolo); return; }

  const { inscricoes } = await api.avaliadorInscricoes();
  const pendentes = inscricoes.filter(i => !i.avaliacaoEnviada).length;
  const linhas = inscricoes.map(i => ({
    attrs: { 'data-inscricao-linha': i.protocolo },
    celulas: [
      el('strong', {}, i.protocolo),
      el('span', {}, i.titulo || 'Sem título', el('br'), el('span', { class: 'discreto' }, i.edital.titulo)),
      el('span', { class: `selo selo-${i.avaliacaoEnviada ? 'verde' : 'amarelo'}` }, i.avaliacaoEnviada ? 'Enviada' : 'Pendente'),
      i.avaliacaoEnviada && i.notaGeral !== null && i.notaGeral !== undefined ? fmt.nota(i.notaGeral) : 'Sem nota',
      el('a', {
        class: 'botao botao-pequeno ' + (i.avaliacaoEnviada ? 'botao-contorno' : 'botao-principal'),
        href: `#/avaliador?inscricao=${encodeURIComponent(i.protocolo)}`, 'data-acao': 'avaliar', 'data-inscricao': i.protocolo,
        'aria-label': `${i.avaliacaoEnviada ? 'Ver' : 'Avaliar'} ${i.protocolo}`,
      }, i.avaliacaoEnviada ? 'Ver avaliação' : 'Avaliar'),
    ],
  }));
  raiz.replaceChildren(el('div', { class: 'pagina', 'data-painel': 'avaliador' },
    el('header', { class: 'cabeca-pagina' }, el('div', {},
      el('h1', {}, 'Minhas avaliações'),
      el('p', { class: 'lead' }, inscricoes.length ? `${pendentes} pendente${pendentes === 1 ? '' : 's'} de ${inscricoes.length}.` : 'Nenhuma inscrição atribuída a você.'))),
    inscricoes.length
      ? tabela('Inscrições atribuídas', ['Protocolo', 'Projeto', 'Situação', 'Nota', 'Ação'], linhas)
      : el('p', { class: 'vazio' }, 'Quando o gestor atribuir inscrições, elas aparecem aqui.')));
}
