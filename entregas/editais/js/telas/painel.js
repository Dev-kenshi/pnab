// Painel do proponente.
import { el, campo, fmt, dataBR, prazoTexto, AVISO_PENDENTE, mensagemDoErro, definirMensagem } from '../ui.js';

const CONTADORES = [
  ['enviados', 'enviados', 'Enviados', 'azul'],
  ['andamento', 'andamento', 'Em andamento', 'amarelo'],
  ['concluidos', 'concluidos', 'Concluídos', 'verde'],
  ['naoAprovados', 'nao-aprovados', 'Não aprovados', 'vermelho'],
];

const COR_SELO = {
  'Rascunho': 'neutro', 'Enviado': 'azul', 'Selecionado': 'verde', 'Suplente': 'amarelo',
  'Não aprovado': 'vermelho', 'Concluído': 'verde',
};

function contador(chave, valor, rotulo, cor) {
  return el('li', { class: `contador contador-${cor}`, 'data-contador': chave },
    el('span', { class: 'contador-rotulo' }, rotulo),
    el('strong', { class: 'contador-numero' }, String(valor)));
}

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

function itemInscricao(i) {
  const nota = i.notaGeral !== null && i.notaGeral !== undefined ? fmt.nota(i.notaGeral) : 'ainda sem nota';
  return el('details', { class: 'sanfona', open: true, 'data-inscricao': i.protocolo },
    el('summary', {},
      el('span', { class: 'sanfona-titulo' }, i.protocolo),
      el('span', { class: `selo selo-${COR_SELO[i.selo] || 'neutro'}` }, i.selo)),
    el('div', { class: 'sanfona-corpo' },
      el('dl', { class: 'dados' },
        el('div', {}, el('dt', {}, 'Edital'), el('dd', {}, i.edital.titulo)),
        el('div', {}, el('dt', {}, 'Cota'), el('dd', {}, i.cota || 'Não informada')),
        el('div', {}, el('dt', {}, 'Projeto'), el('dd', {}, i.titulo || 'Sem título')),
        el('div', {}, el('dt', {}, 'Nota'), el('dd', {}, nota))),
      linhaDoTempo(i.etapas),
      el('p', { class: 'acoes' },
        el('a', { class: 'botao botao-contorno', href: `#/inscricao/${encodeURIComponent(i.protocolo)}`, 'data-acao': 'visualizar', 'data-inscricao': i.protocolo }, 'Visualizar inscrição'))));
}

function cartaoEdital(e) {
  const prazo = prazoTexto(e.fim);
  return el('article', { class: 'cartao cartao-edital', 'data-edital-aberto': e.slug },
    el('p', { class: 'selo selo-verde' }, 'Inscrições abertas'),
    el('h3', {}, e.titulo),
    e.descricao ? el('p', { class: 'resumo' }, e.descricao) : null,
    el('dl', { class: 'dados dados-linha' },
      el('div', {}, el('dt', {}, 'Até'), el('dd', {}, `${dataBR(e.fim)}${prazo ? ` (${prazo.toLowerCase()})` : ''}`)),
      el('div', {}, el('dt', {}, 'Teto'), el('dd', {}, fmt.moeda(e.teto)))),
    el('div', { class: 'acoes' },
      el('a', { class: 'botao botao-principal', href: `#/inscricao/novo?edital=${encodeURIComponent(e.slug)}`, 'data-acao': 'inscrever', 'data-edital': e.slug }, 'Inscrever-se'),
      e.linkEdital ? el('a', { class: 'link', href: e.linkEdital, target: '_blank', rel: 'noopener' }, 'Ler o edital (PDF)') : null));
}

function janelaAviso(aviso) {
  const fechar = el('button', { type: 'button', class: 'botao botao-principal', 'data-aviso-fechar': true }, 'Ciente, fechar');
  const janela = el('dialog', { class: 'janela-aviso', 'data-aviso': aviso.id, 'aria-labelledby': 'aviso-titulo' },
    el('div', { class: 'faixa-listrada', 'aria-hidden': 'true' }),
    el('div', { class: 'janela-cabeca' }, el('h2', { id: 'aviso-titulo' }, 'Aviso da organização')),
    el('div', { class: 'janela-corpo' }, el('p', {}, aviso.texto)),
    el('div', { class: 'janela-pe' }, fechar));
  const encerrar = () => { sessionStorage.removeItem(AVISO_PENDENTE); };
  fechar.addEventListener('click', () => { encerrar(); janela.close(); janela.remove(); });
  janela.addEventListener('cancel', encerrar);
  return janela;
}

export async function renderPainel(ctx) {
  const { raiz, api, navegar } = ctx;
  const dados = await api.painelProponente();
  const { usuario } = dados;

  const seletor = campo({
    rotulo: 'Organização', nome: 'org-seletor', semDataCampo: true, tipo: 'select',
    opcoes: dados.organizacoes.map(o => [o.slug, o.nome]), valor: usuario.organizacao?.slug,
  });
  seletor.input.setAttribute('data-org-seletor', '');
  const avisoTroca = el('p', { class: 'mensagem', hidden: true });
  seletor.input.addEventListener('change', async () => {
    seletor.input.disabled = true;
    try { await api.trocarOrganizacao(seletor.input.value); navegar('#/painel'); }
    catch (e) { definirMensagem(avisoTroca, 'erro', mensagemDoErro(e)); seletor.input.disabled = false; }
  });

  const abertos = dados.editaisAbertos;
  const historico = dados.historico;

  const pagina = el('div', { class: 'pagina', 'data-painel': 'proponente' },
    el('header', { class: 'saudacao' },
      el('div', {},
        el('h1', {}, `Olá, ${usuario.nome}`),
        el('p', { class: 'natureza' }, el('span', { class: 'natureza-rotulo' }, 'Natureza da conta: '), usuario.natureza || 'Não informada')),
      el('div', { class: 'seletor-org' }, seletor.raiz, avisoTroca)),

    el('ul', { class: 'contadores', 'aria-label': 'Resumo das inscrições' },
      CONTADORES.map(([k, attr, rotulo, cor]) => contador(attr, dados.contadores[k] ?? 0, rotulo, cor))),

    el('section', { class: 'bloco', 'aria-labelledby': 'sec-abertos' },
      el('h2', { id: 'sec-abertos' }, 'Editais abertos'),
      abertos.length
        ? el('div', { class: 'grade-editais' }, abertos.map(cartaoEdital))
        : el('p', { class: 'vazio' }, 'Nenhum edital aberto agora.')),

    el('section', { class: 'bloco', 'aria-labelledby': 'sec-inscricoes' },
      el('h2', { id: 'sec-inscricoes' }, 'Minhas inscrições'),
      dados.inscricoes.length
        ? el('div', { class: 'lista-sanfonas' }, dados.inscricoes.map(itemInscricao))
        : el('p', { class: 'vazio' }, 'Você ainda não tem inscrições. Escolha um edital aberto para começar.')),

    el('section', { class: 'bloco', 'aria-labelledby': 'sec-historico' },
      el('h2', { id: 'sec-historico' }, 'Histórico de editais encerrados'),
      historico.length
        ? historico.map(h => el('div', { class: 'historico-ano', 'data-historico-ano': h.ano },
          el('h3', {}, String(h.ano)),
          el('ul', { class: 'lista-links' }, h.editais.map(e =>
            el('li', {},
              el('span', { class: 'lista-links-titulo' }, e.titulo),
              el('span', { class: 'lista-links-acoes' },
                el('a', { href: e.linkEdital, target: '_blank', rel: 'noopener', 'data-link-edital': e.slug }, 'Edital'),
                el('a', { href: e.linkAnexos, target: '_blank', rel: 'noopener', 'data-link-anexos': e.slug }, 'Anexos')))))))
        : el('p', { class: 'vazio' }, 'Nenhum edital encerrado ainda.')));

  raiz.replaceChildren(pagina);

  if (dados.aviso && sessionStorage.getItem(AVISO_PENDENTE)) {
    const janela = janelaAviso(dados.aviso);
    raiz.append(janela);
    if (typeof janela.showModal === 'function') janela.showModal(); else janela.setAttribute('open', '');
    janela.querySelector('[data-aviso-fechar]').focus();
  }
}
