// Visualizar inscrição: abas Ficha, Notas, Recursos, Habilitação e Termo.
import { el, fmt, dataBR, mensagemDoErro, novoId } from '../ui.js';
import { icone, secao, leitura, enderecoTexto } from './inscricao.js';

const COR_SELO = {
  'Rascunho': 'neutro', 'Enviado': 'azul', 'Selecionado': 'verde', 'Suplente': 'amarelo',
  'Não aprovado': 'vermelho', 'Concluído': 'verde',
};

const ABAS = [
  ['ficha', 'Ficha de inscrição', null],
  ['notas', 'Notas e avaliação', null],
  ['recursos', 'Recursos', null],
  ['habilitacao', 'Habilitação documental', 'habilitacao'],
  ['termo', 'Termo de execução', 'termo'],
];

const TEXTO_TRAVA = {
  habilitacao: 'Esta aba abre quando a sua proposta for selecionada e a etapa de Habilitação começar. Você verá aqui os documentos pedidos e o prazo.',
  termo: 'Esta aba abre depois da habilitação, quando o termo de execução estiver pronto para assinatura.',
};

function linhaDoTempo(etapas) {
  return el('ol', { class: 'linha-tempo', 'aria-label': 'Etapas da inscrição' }, etapas.map(e =>
    el('li', {
      class: `etapa etapa-${e.estado}`, 'data-etapa-tempo': e.numero, 'data-estado': e.estado,
      'aria-current': e.estado === 'atual' ? 'step' : false,
    },
      el('span', { class: 'etapa-bolha', 'aria-hidden': 'true' }, e.estado === 'passada' ? '✓' : String(e.numero)),
      el('span', { class: 'etapa-nome' }, e.nome),
      el('span', { class: 'so-leitor' }, e.estado === 'passada' ? ' (feita)' : e.estado === 'atual' ? ' (etapa atual)' : ' (a fazer)'))));
}

function tabelaLeitura(legenda, colunas, linhas, rodape) {
  return el('table', { class: 'tabela-leitura' },
    el('caption', { class: 'so-leitor' }, legenda),
    el('thead', {}, el('tr', {}, colunas.map(c => el('th', { scope: 'col' }, c)))),
    el('tbody', {}, linhas.map(l => el('tr', {}, l.map((v, i) => el('td', { 'data-rotulo': colunas[i] }, v === '' || v === null || v === undefined ? '-' : v))))),
    rodape || null);
}

function fichaLeitura(insc, edital) {
  const f = insc.ficha || {};
  const p = f.proponente || {};
  const extras = (edital?.camposExtras || []).filter(c => c.tipo !== 'anexo');
  const anexosDef = (edital?.camposExtras || []).filter(c => c.tipo === 'anexo');
  const valorExtra = c => {
    const v = f.extras?.[c.chave];
    if (c.tipo === 'marcar') return v === true ? 'Sim' : 'Não';
    if (c.tipo === 'data') return dataBR(v) || v;
    return v;
  };
  const teto = edital?.teto;
  const total = (f.orcamento || []).reduce((s, o) => s + Math.round((Number(o.qtd) || 0) * (Number(o.valor) || 0)), 0);
  const anexos = f.anexos || {};
  const chavesAnexo = Object.keys(anexos);

  return el('div', { class: 'ficha-conteudo' },
    secao('pessoa', 'Dados do proponente', leitura([
      ['Nome ou razão social', p.nome], ['Natureza', p.natureza],
      ['Documento', p.documento ? fmt.documento(p.documento) : ''], ['E-mail', p.email], ['Telefone', p.telefone],
    ])),
    secao('etiqueta', 'Modalidade', leitura([
      ['Título do projeto', f.titulo], ['Categoria', f.categoria], ['Cota', f.cota],
    ])),
    extras.length ? secao('pergunta', 'Perguntas do edital', leitura(extras.map(c => [c.rotulo, valorExtra(c)]))) : null,
    secao('bandeira', 'Metas', (f.metas || []).length
      ? tabelaLeitura('Metas', ['Etapa', 'Início', 'Fim', 'Ação'], f.metas.map(m => [m.etapa, dataBR(m.inicio), dataBR(m.fim), m.acao]))
      : el('p', { class: 'dica' }, 'Nenhuma meta informada.')),
    secao('equipe', 'Equipe', (f.equipe || []).length
      ? tabelaLeitura('Equipe', ['Nome', 'Função', 'Documento'], f.equipe.map(x => [x.nome, x.funcao, x.documento ? fmt.documento(x.documento) : '']))
      : el('p', { class: 'dica' }, 'Nenhuma pessoa informada.')),
    secao('moeda', 'Planilha orçamentária', (f.orcamento || []).length
      ? tabelaLeitura('Planilha orçamentária', ['Descrição do item', 'Quantidade', 'Valor unitário', 'Total do item'],
        f.orcamento.map(o => [o.descricao, String(o.qtd).replace('.', ','), fmt.moeda(Number(o.valor) || 0), fmt.moeda(Math.round((Number(o.qtd) || 0) * (Number(o.valor) || 0)))]))
      : el('p', { class: 'dica' }, 'Nenhum item informado.'),
    el('p', { class: 'orc-resumo' }, el('span', { class: 'rotulo-resumo' }, 'Total: '), el('strong', {}, fmt.moeda(total)),
      teto !== undefined ? ` (teto do edital ${fmt.moeda(teto)})` : '')),
    secao('clipe', 'Anexos', chavesAnexo.length
      ? leitura(chavesAnexo.map(k => [anexosDef.find(a => a.chave === k)?.rotulo || 'Anexo', `${anexos[k].nome} (${Math.max(1, Math.round(anexos[k].tamanho / 1024))} KB)`]))
      : el('p', { class: 'dica' }, 'Nenhum anexo enviado.')),
    secao('check', 'Aceite', leitura([['Declaração', f.aceite ? 'Aceite dado no envio.' : 'Sem aceite.']])));
}

function painelNotas(insc) {
  const a = insc.avaliacao;
  if (!a) {
    return el('div', {},
      el('p', { class: 'mensagem mensagem-info' }, 'As notas e o parecer aparecem aqui quando o resultado for publicado.'));
  }
  const notas = a.notas || [];
  return el('div', {},
    tabelaLeitura('Nota por critério', ['Critério', 'Máximo', 'Nota'], notas.map(n => [
      n.bonus ? `${n.nome} (bônus)` : n.nome, fmt.nota(n.maximo), fmt.nota(n.nota)]),
    el('tfoot', {}, el('tr', {}, el('th', { scope: 'row', colspan: 2 }, 'Nota geral'), el('td', { class: 'nota-geral', 'data-rotulo': 'Nota' }, fmt.nota(a.notaGeral))))),
    secao('doc', 'Parecer técnico', el('p', { class: 'parecer' }, a.parecer || 'Sem parecer escrito.')));
}

export async function renderInscricao(ctx) {
  const { raiz, api, segmentos, navegar } = ctx;
  const idOuProtocolo = segmentos[1];
  const { inscricao } = await api.obterInscricao(idOuProtocolo);
  const insc = inscricao;
  let edital = null;
  try { edital = (await api.obterEdital(insc.edital.slug)).edital; } catch { /* a ficha mostra a chave no lugar do rótulo */ }

  if (insc.situacao === 'rascunho') {
    raiz.replaceChildren(el('section', { class: 'pagina pagina-estreita' },
      el('h1', {}, 'Inscrição em rascunho'),
      el('p', { class: 'mensagem mensagem-info' }, 'Esta inscrição ainda não foi enviada.'),
      el('p', { class: 'acoes' },
        el('a', { class: 'botao botao-principal', href: `#/inscricao/novo?edital=${encodeURIComponent(insc.edital.slug)}` }, 'Continuar o preenchimento'),
        el('a', { class: 'botao botao-contorno', href: '#/painel' }, 'Voltar ao painel'))));
    return;
  }

  const estado = { recurso: insc.recurso, permitido: insc.recursoPermitido };
  const paineis = {};
  const botoes = {};
  const marcaContestada = el('p', { class: 'nota-contestada', hidden: !estado.recurso }, 'Nota contestada: há um recurso nesta inscrição.');

  // ---------- Recursos ----------
  const painelRecursos = el('div', { class: 'recursos-area' });
  function desenharRecursos() {
    const r = estado.recurso;
    if (r) {
      painelRecursos.replaceChildren(
        el('dl', { class: 'leitura' },
          el('div', { class: 'leitura-item' }, el('dt', {}, 'Situação do recurso'),
            el('dd', {}, el('span', { class: `selo selo-${r.situacao === 'Deferido' ? 'verde' : r.situacao === 'Indeferido' ? 'vermelho' : 'amarelo'}`, 'data-recurso-situacao': true, tabindex: '-1' }, r.situacao))),
          el('div', { class: 'leitura-item' }, el('dt', {}, 'Aberto em'), el('dd', {}, dataBR(r.criadoEm))),
          el('div', { class: 'leitura-item leitura-larga' }, el('dt', {}, 'Justificativa'), el('dd', {}, r.justificativa)),
          r.parecer ? el('div', { class: 'leitura-item leitura-larga' }, el('dt', {}, 'Parecer da comissão'), el('dd', {}, r.parecer)) : null));
      return;
    }
    if (estado.permitido) { painelRecursos.replaceChildren(formRecurso()); return; }
    let motivo = 'Esta inscrição não aceita recurso.';
    if (!insc.prazoRecursoAte || !insc.resultado) motivo = 'O recurso abre depois da publicação do resultado.';
    else if (new Date() > new Date(`${String(insc.prazoRecursoAte).slice(0, 10)}T23:59:59-03:00`)) motivo = `O prazo de recurso terminou em ${dataBR(insc.prazoRecursoAte)}.`;
    painelRecursos.replaceChildren(el('p', { class: 'mensagem mensagem-info', 'data-recurso-encerrado': true }, motivo));
  }

  function formRecurso() {
    const id = novoId('justificativa');
    const area = el('textarea', { id, rows: 6, 'data-campo': 'justificativa', name: 'justificativa', 'aria-describedby': `${id}-erro` });
    const erro = el('p', { class: 'erro', id: `${id}-erro`, 'data-erro': 'justificativa', role: 'alert', hidden: true });
    const msg = el('p', { class: 'mensagem mensagem-erro', role: 'alert', hidden: true });
    const enviar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'enviar-recurso' }, 'Enviar recurso');
    const form = el('form', { class: 'formulario', 'data-form': 'recurso', novalidate: true },
      el('p', {}, `Você pode contestar a nota até ${dataBR(insc.prazoRecursoAte)}. Cada inscrição tem direito a um recurso.`),
      el('div', { class: 'campo' }, el('label', { for: id }, 'Justificativa do recurso'), area, erro),
      msg,
      el('div', { class: 'acoes' }, enviar));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      erro.hidden = true; msg.hidden = true;
      area.removeAttribute('aria-invalid');
      if (!area.value.trim()) {
        erro.textContent = 'Campo obrigatório: justificativa do recurso.';
        erro.hidden = false; area.setAttribute('aria-invalid', 'true'); area.focus();
        return;
      }
      enviar.disabled = true;
      try {
        const r = await api.enviarRecurso(insc.protocolo, area.value.trim());
        estado.recurso = r.recurso;
        estado.permitido = false;
        marcaContestada.hidden = false;
        desenharRecursos();
        painelRecursos.querySelector('[data-recurso-situacao]')?.focus?.();
      } catch (err) {
        const c = err?.campos?.[0];
        if (c) { erro.textContent = c.mensagem; erro.hidden = false; area.setAttribute('aria-invalid', 'true'); }
        else { msg.textContent = mensagemDoErro(err); msg.hidden = false; }
        enviar.disabled = false;
      }
    });
    return form;
  }

  // ---------- Painéis ----------
  paineis.ficha = el('div', {}, fichaLeitura(insc, edital));
  paineis.notas = painelNotas(insc);
  paineis.recursos = painelRecursos;
  desenharRecursos();
  for (const nome of ['habilitacao', 'termo']) {
    paineis[nome] = insc.abas?.[nome]
      ? el('p', { class: 'mensagem mensagem-info' }, 'Em breve')
      : el('p', { class: 'mensagem mensagem-info' }, TEXTO_TRAVA[nome]);
  }

  const TITULOS_PAINEL = { ficha: ['doc', 'Ficha de inscrição'], notas: ['estrela', 'Notas e avaliação'], recursos: ['balao', 'Recursos'], habilitacao: ['doc', 'Habilitação documental'], termo: ['doc', 'Termo de execução'] };

  const lista = el('div', { class: 'abas-lista', role: 'tablist', 'aria-label': 'Seções da inscrição' });
  const caixa = el('div', { class: 'abas-caixa' });
  ABAS.forEach(([nome, rotulo, chaveTrava]) => {
    const travada = chaveTrava ? !insc.abas?.[chaveTrava] : false;
    const idAba = `aba-${nome}`;
    const idPainel = `painel-${nome}`;
    const b = el('button', {
      type: 'button', class: 'aba', role: 'tab', id: idAba, 'data-aba': nome,
      'aria-controls': idPainel, 'aria-selected': 'false', tabindex: '-1',
    }, rotulo, travada ? el('span', { class: 'aba-cadeado', 'data-cadeado': true }, icone('cadeado'), el('span', { class: 'so-leitor' }, ' (travada)')) : null);
    botoes[nome] = b;
    lista.append(b);
    const [ic, tit] = TITULOS_PAINEL[nome];
    const p = el('div', { class: 'aba-painel', role: 'tabpanel', id: idPainel, 'aria-labelledby': idAba, 'data-aba-painel': nome, 'data-travada': travada ? '' : false, tabindex: '0' },
      el('h2', { class: 'painel-titulo' }, icone(travada ? 'cadeado' : ic), el('span', {}, tit)),
      paineis[nome]);
    caixa.append(p);
    b.addEventListener('click', () => ativar(nome));
  });

  function ativar(nome, foco = false) {
    for (const [n, b] of Object.entries(botoes)) {
      const sel = n === nome;
      b.setAttribute('aria-selected', String(sel));
      b.tabIndex = sel ? 0 : -1;
      caixa.querySelector(`[data-aba-painel='${n}']`).classList.toggle('ativo', sel);
    }
    if (foco) botoes[nome].focus();
  }
  lista.addEventListener('keydown', e => {
    const nomes = ABAS.map(a => a[0]);
    const atual = nomes.indexOf(document.activeElement?.getAttribute?.('data-aba'));
    if (atual < 0) return;
    let prox = null;
    if (e.key === 'ArrowRight') prox = (atual + 1) % nomes.length;
    else if (e.key === 'ArrowLeft') prox = (atual - 1 + nomes.length) % nomes.length;
    else if (e.key === 'Home') prox = 0;
    else if (e.key === 'End') prox = nomes.length - 1;
    if (prox === null) return;
    e.preventDefault();
    ativar(nomes[prox], true);
  });

  // ---------- Página ----------
  const hoje = new Date().toLocaleDateString('pt-BR');
  raiz.replaceChildren(el('section', { class: 'pagina pagina-visualizar' },
    el('div', { class: 'so-impressao' },
      el('p', { class: 'impressao-marca' }, 'Sistema Integrado TEB'),
      el('p', {}, `Processo de inscrição impresso em ${hoje}.`)),
    el('header', { class: 'cabeca-visualizar' },
      el('div', { class: 'cabeca-texto' },
        el('p', { class: 'sobretitulo' }, 'Protocolo'),
        el('h1', {}, insc.protocolo || 'Inscrição'),
        el('p', { class: 'cabeca-projeto' }, insc.titulo || 'Sem título'),
        el('p', { class: 'cabeca-edital' }, insc.edital.titulo, ' ',
          el('span', { class: `selo selo-${COR_SELO[insc.selo] || 'neutro'}` }, insc.selo))),
      el('div', { class: 'acoes sem-impressao' },
        el('button', { type: 'button', class: 'botao botao-contorno', 'data-acao': 'imprimir', onclick: () => window.print() }, 'Imprimir'),
        el('a', { class: 'botao botao-contorno', href: '#/painel' }, 'Voltar'))),
    el('div', { class: 'cartao tempo-cartao' }, linhaDoTempo(insc.etapas), marcaContestada),
    lista,
    caixa));

  ativar('ficha');
}
