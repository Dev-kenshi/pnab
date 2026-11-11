// Área da plataforma: organizações contratantes e seus gestores. Sem dados de inscrição.
import { el, campo, mensagemDoErro, definirMensagem, limparErros, mostrarErro, botao } from '../ui.js';
import { slug as gerarSlug } from '../regras.js';
import { tabela } from './gestor.js';

export async function renderPlataforma(ctx) {
  const { raiz, api } = ctx;
  const area = el('div', {});
  const msg = el('p', { hidden: true });
  const espaco = el('div', {});

  async function carregar() {
    const { organizacoes } = await api.plataformaOrganizacoes();
    area.replaceChildren(organizacoes.length
      ? tabela('Organizações contratantes', ['Organização', 'Endereço', 'Editais', 'Gestores'], organizacoes.map(o => ({
        attrs: { 'data-organizacao': o.slug },
        celulas: [
          el('strong', {}, o.nome),
          el('code', {}, o.slug),
          String(o.totalEditais),
          o.gestores.length ? el('span', {}, o.gestores.map((g, i) => [i ? el('br') : null, `${g.nome} (${g.email})`])) : 'Sem gestor',
        ],
      })), { 'data-lista': 'organizacoes' })
      : el('p', { class: 'vazio' }, 'Nenhuma organização ainda.'));
  }

  function abrirForm() {
    const cNome = campo({ rotulo: 'Nome da organização', nome: 'nome', obrigatorio: true, autocomplete: 'off' });
    const cSlug = campo({ rotulo: 'Endereço (slug)', nome: 'slug', obrigatorio: true, autocomplete: 'off', dica: 'Letras minúsculas, números e hífen. Vira ?org=endereço.' });
    const cGNome = campo({ rotulo: 'Nome do gestor', nome: 'gestor-nome', obrigatorio: true, autocomplete: 'off' });
    const cGDoc = campo({ rotulo: 'CPF do gestor', nome: 'gestor-documento', inputmode: 'numeric', obrigatorio: true, autocomplete: 'off' });
    const cGEmail = campo({ rotulo: 'E-mail do gestor', nome: 'gestor-email', tipo: 'email', obrigatorio: true, autocomplete: 'off' });
    const cGSenha = campo({ rotulo: 'Senha inicial do gestor', nome: 'gestor-senha', tipo: 'password', obrigatorio: true, autocomplete: 'new-password', dica: 'Mínimo de 12 caracteres, sem o nome, o CPF ou o e-mail do gestor.' });
    const mapa = {
      nome: cNome, slug: cSlug, 'gestor.nome': cGNome, 'gestor.documento': cGDoc, 'gestor.email': cGEmail, 'gestor.senha': cGSenha,
    };
    let slugTocado = false;
    cSlug.input.addEventListener('input', () => { slugTocado = true; });
    cNome.input.addEventListener('input', () => { if (!slugTocado) cSlug.input.value = gerarSlug(cNome.input.value); });
    const aviso = el('p', { hidden: true });
    const salvar = botao('Criar organização', { 'data-acao': 'salvar-organizacao' });
    const form = el('form', { class: 'formulario', 'data-form': 'organizacao', novalidate: true, onsubmit: ev => ev.preventDefault() },
      el('fieldset', { class: 'conjunto' }, el('legend', {}, 'Organização'), el('div', { class: 'grade-campos' }, cNome.raiz, cSlug.raiz)),
      el('fieldset', { class: 'conjunto' }, el('legend', {}, 'Gestor da organização'),
        el('div', { class: 'grade-campos' }, cGNome.raiz, cGDoc.raiz, cGEmail.raiz, cGSenha.raiz)),
      aviso,
      el('div', { class: 'acoes' }, salvar, botao('Cancelar', { class: 'botao-link', onclick: () => espaco.replaceChildren() })));
    salvar.addEventListener('click', async () => {
      limparErros(form);
      definirMensagem(aviso, 'ok', '');
      salvar.disabled = true;
      try {
        const { organizacao } = await api.criarOrganizacao({
          nome: cNome.input.value.trim(), slug: cSlug.input.value.trim(),
          gestor: { nome: cGNome.input.value.trim(), documento: cGDoc.input.value, email: cGEmail.input.value.trim(), senha: cGSenha.input.value },
        });
        espaco.replaceChildren();
        definirMensagem(msg, 'ok', `Organização ${organizacao.nome} criada.`);
        await carregar();
      } catch (e) {
        salvar.disabled = false;
        const sobras = [];
        for (const c of e.campos || []) {
          const alvo = mapa[c.campo];
          if (alvo) { mostrarErro(alvo.erro, c.mensagem); alvo.input.setAttribute('aria-invalid', 'true'); } else sobras.push(c.mensagem);
        }
        definirMensagem(aviso, 'erro', e.campos?.length && !sobras.length ? 'Confira os campos destacados.' : (sobras.join(' ') || mensagemDoErro(e)));
        form.querySelector('[aria-invalid="true"]')?.focus();
      }
    });
    espaco.replaceChildren(el('section', { class: 'cartao', 'aria-labelledby': 'tit-nova-org' }, el('h2', { id: 'tit-nova-org' }, 'Nova organização'), form));
    cNome.input.focus();
  }

  raiz.replaceChildren(el('div', { class: 'pagina', 'data-painel': 'plataforma' },
    el('header', { class: 'cabeca-pagina' },
      el('div', {}, el('h1', {}, 'Organizações contratantes'), el('p', { class: 'lead' }, 'Cada organização tem seus editais, avisos e equipe. Esta área não mostra inscrições.')),
      el('div', { class: 'acoes acoes-topo' }, botao('Nova organização', { 'data-acao': 'nova-organizacao', onclick: abrirForm }))),
    msg, espaco, area));
  await carregar();
}
