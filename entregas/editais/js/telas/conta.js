// Minha conta: dados, endereço com CEP e alterar senha.
import { somenteDigitos, formatarDocumento, validarSenha } from '../regras.js';
import { el, campo, mostrarErro, limparErros, mostrarErrosDaApi, mensagemDoErro, definirMensagem } from '../ui.js';

export async function renderConta(ctx) {
  const { raiz, api } = ctx;
  const { usuario } = await api.obterConta();
  const e = usuario.endereco || {};

  const c = {
    nome: campo({ rotulo: 'Nome', nome: 'nome', valor: usuario.nome, autocomplete: 'name' }),
    documento: campo({ rotulo: 'CPF ou CNPJ (não pode ser alterado)', nome: 'documento', valor: formatarDocumento(usuario.documento), disabled: true }),
    email: campo({ rotulo: 'E-mail', nome: 'email', tipo: 'email', valor: usuario.email, autocomplete: 'email' }),
    telefone: campo({ rotulo: 'Telefone com DDD', nome: 'telefone', tipo: 'tel', valor: usuario.telefone || '', autocomplete: 'tel', inputmode: 'tel' }),
    cep: campo({ rotulo: 'CEP', nome: 'cep', valor: e.cep || '', inputmode: 'numeric', autocomplete: 'postal-code', maxlength: 9 }),
    logradouro: campo({ rotulo: 'Rua, avenida ou praça', nome: 'logradouro', valor: e.logradouro || '', autocomplete: 'address-line1' }),
    numero: campo({ rotulo: 'Número', nome: 'numero', valor: e.numero || '' }),
    complemento: campo({ rotulo: 'Complemento', nome: 'complemento', valor: e.complemento || '' }),
    bairro: campo({ rotulo: 'Bairro', nome: 'bairro', valor: e.bairro || '' }),
    cidade: campo({ rotulo: 'Cidade', nome: 'cidade', valor: e.cidade || '' }),
    uf: campo({ rotulo: 'UF', nome: 'uf', valor: e.uf || '', maxlength: 2 }),
  };
  const mapa = { nome: c.nome, email: c.email, telefone: c.telefone, endereco: c.cep };

  const msgConta = el('p', { class: 'mensagem', hidden: true, role: 'status' });
  const msgCep = el('p', { class: 'mensagem', hidden: true, role: 'status' });
  const buscar = el('button', { type: 'button', class: 'botao botao-contorno', 'data-acao': 'buscar-cep' }, 'Buscar CEP');
  const salvar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'salvar-conta' }, 'Salvar dados');

  buscar.addEventListener('click', async () => {
    mostrarErro(c.cep.erro, '');
    const digitos = somenteDigitos(c.cep.input.value);
    if (digitos.length !== 8) { mostrarErro(c.cep.erro, 'CEP deve ter 8 números.'); return; }
    buscar.disabled = true;
    definirMensagem(msgCep, 'info', 'Buscando o CEP...');
    try {
      const r = await api.buscarCep(digitos);
      c.logradouro.input.value = r.logradouro || '';
      c.bairro.input.value = r.bairro || '';
      c.cidade.input.value = r.cidade || '';
      c.uf.input.value = r.uf || '';
      definirMensagem(msgCep, 'ok', 'Endereço preenchido. Confira e informe o número.');
      c.numero.input.focus();
    } catch (err) {
      definirMensagem(msgCep, 'erro', err.status === 404
        ? 'CEP não encontrado. Você pode preencher o endereço à mão.'
        : `${mensagemDoErro(err)} Você pode preencher o endereço à mão.`);
    } finally { buscar.disabled = false; }
  });

  const formConta = el('form', { class: 'formulario', novalidate: true, 'data-form': 'conta', onsubmit: async ev => {
    ev.preventDefault();
    limparErros(formConta); msgConta.hidden = true;
    const temEndereco = [c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf].some(x => x.input.value.trim());
    const endereco = temEndereco ? {
      cep: c.cep.input.value, logradouro: c.logradouro.input.value, numero: c.numero.input.value,
      complemento: c.complemento.input.value, bairro: c.bairro.input.value, cidade: c.cidade.input.value, uf: c.uf.input.value,
    } : null;
    salvar.disabled = true;
    try {
      await api.salvarConta({ nome: c.nome.input.value, email: c.email.input.value, telefone: c.telefone.input.value, endereco });
      definirMensagem(msgConta, 'ok', 'Dados salvos.');
    } catch (err) {
      const sobras = mostrarErrosDaApi(err.campos, mapa);
      definirMensagem(msgConta, 'erro', sobras[0] || (err.campos?.length ? 'Confira os campos destacados.' : mensagemDoErro(err)));
    } finally { salvar.disabled = false; }
  } },
    el('fieldset', {}, el('legend', {}, 'Dados pessoais'),
      c.nome.raiz, c.documento.raiz, c.email.raiz, c.telefone.raiz,
      el('p', { class: 'dica' }, `Natureza da conta: ${usuario.natureza || 'não se aplica'}.`)),
    el('fieldset', {}, el('legend', {}, 'Endereço'),
      el('div', { class: 'linha-cep' }, c.cep.raiz, buscar),
      msgCep,
      el('div', { class: 'grade-campos' }, c.logradouro.raiz, c.numero.raiz, c.complemento.raiz, c.bairro.raiz, c.cidade.raiz, c.uf.raiz)),
    msgConta,
    el('div', { class: 'acoes' }, salvar));

  const s = {
    atual: campo({ rotulo: 'Senha atual', nome: 'senha-atual', tipo: 'password', autocomplete: 'current-password' }),
    nova: campo({ rotulo: 'Nova senha', nome: 'nova-senha', tipo: 'password', autocomplete: 'new-password', dica: 'Pelo menos 8 caracteres.' }),
    conf: campo({ rotulo: 'Confirmação da nova senha', nome: 'nova-senha-confirmacao', tipo: 'password', autocomplete: 'new-password' }),
  };
  const msgSenha = el('p', { class: 'mensagem', hidden: true, role: 'status' });
  const alterar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'alterar-senha' }, 'Alterar senha');
  const formSenha = el('form', { class: 'formulario', novalidate: true, 'data-form': 'senha', onsubmit: async ev => {
    ev.preventDefault();
    limparErros(formSenha); msgSenha.hidden = true;
    if (!s.atual.input.value) { mostrarErro(s.atual.erro, 'Informe a senha atual.'); return; }
    const m = validarSenha(s.nova.input.value, usuario);
    if (m) { mostrarErro(s.nova.erro, m); return; }
    if (s.nova.input.value !== s.conf.input.value) { mostrarErro(s.conf.erro, 'A confirmação não confere com a nova senha.'); return; }
    alterar.disabled = true;
    try {
      await api.alterarSenha({ senhaAtual: s.atual.input.value, novaSenha: s.nova.input.value, novaSenhaConfirmacao: s.conf.input.value });
      formSenha.reset();
      definirMensagem(msgSenha, 'ok', 'Senha alterada.');
    } catch (err) {
      const sobras = mostrarErrosDaApi(err.campos, { novaSenha: s.nova, novaSenhaConfirmacao: s.conf });
      if (err.erro === 'senha_atual_incorreta') mostrarErro(s.atual.erro, mensagemDoErro(err));
      else definirMensagem(msgSenha, 'erro', sobras[0] || (err.campos?.length ? 'Confira os campos destacados.' : mensagemDoErro(err)));
    } finally { alterar.disabled = false; }
  } }, s.atual.raiz, s.nova.raiz, s.conf.raiz, msgSenha, el('div', { class: 'acoes' }, alterar));

  raiz.replaceChildren(el('section', { class: 'pagina pagina-conta' },
    el('h1', {}, 'Minha conta'),
    usuario.organizacao ? el('p', { class: 'lead' }, `Organização: ${usuario.organizacao.nome}`) : null,
    el('div', { class: 'cartao' }, formConta),
    el('div', { class: 'cartao' }, el('h2', {}, 'Alterar senha'), formSenha)));
}
