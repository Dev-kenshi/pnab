// Acesso: login em 2 etapas, criar conta, esqueci a senha e redefinir.
import { validarDocumento, formatarDocumento, NATUREZAS, validarSenha } from '../regras.js';
import { el, campo, mostrarErro, limparErros, mostrarErrosDaApi, mensagemDoErro, inicioDoPapel, AVISO_PENDENTE, definirMensagem } from '../ui.js';

// Documento levado do login para criar conta (só em memória).
let documentoPendente = '';

function sufixoOrg(params) {
  const org = params.get('org');
  return org ? `?org=${encodeURIComponent(org)}` : '';
}

function contasDemo() {
  const linhas = [
    ['Proponente', '529.982.247-25'],
    ['Gestor', '111.444.777-35'],
    ['Avaliador', '390.533.447-05'],
    ['Plataforma', '168.995.350-09'],
  ];
  return el('details', { class: 'demo-contas' },
    el('summary', {}, 'Contas de demonstração'),
    el('p', {}, 'Todas fictícias, só neste modo. Senha de exemplo: Exemplo#2026'),
    el('table', {},
      el('caption', { class: 'so-leitor' }, 'Documentos de exemplo'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Papel'), el('th', { scope: 'col' }, 'CPF fictício'))),
      el('tbody', {}, linhas.map(([p, d]) => el('tr', {}, el('td', {}, p), el('td', {}, d))))));
}

export async function renderLogin(ctx) {
  const { raiz, api, params, navegar } = ctx;
  const doc = campo({ rotulo: 'CPF ou CNPJ', nome: 'documento', inputmode: 'numeric', autocomplete: 'username', dica: 'Pode digitar com ou sem pontos e traços.' });
  const senha = campo({ rotulo: 'Senha', nome: 'senha', tipo: 'password', autocomplete: 'current-password' });
  const etapaSenha = el('div', { 'data-etapa': 'senha', hidden: true }, senha.raiz);
  const avancar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'avancar' }, 'Avançar');
  const entrar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'entrar', hidden: true }, 'Entrar');
  const trocar = el('button', { type: 'button', class: 'botao botao-link', hidden: true }, 'Trocar documento');
  let etapa = 1;

  const voltarEtapa1 = () => {
    etapa = 1;
    etapaSenha.hidden = true; entrar.hidden = true; trocar.hidden = true; avancar.hidden = false;
    doc.input.readOnly = false; senha.input.value = '';
    limparErros(form);
    doc.input.focus();
  };
  trocar.addEventListener('click', voltarEtapa1);

  async function passo1() {
    limparErros(form);
    const texto = doc.input.value.trim();
    if (!texto) { mostrarErro(doc.erro, 'Documento obrigatório.'); doc.input.setAttribute('aria-invalid', 'true'); return; }
    const v = validarDocumento(texto);
    if (!v.valido) { mostrarErro(doc.erro, 'Documento inválido. Confira os números.'); doc.input.setAttribute('aria-invalid', 'true'); return; }
    avancar.disabled = true;
    try {
      const r = await api.verificarDocumento(v.digitos);
      if (!r.existe) {
        documentoPendente = v.digitos;
        navegar(`#/criar-conta${sufixoOrg(params)}`);
        return;
      }
      etapa = 2;
      doc.input.readOnly = true;
      etapaSenha.hidden = false; entrar.hidden = false; trocar.hidden = false; avancar.hidden = true;
      senha.input.focus();
    } catch (e) {
      if (e.campos?.length) mostrarErro(doc.erro, e.campos[0].mensagem);
      else mostrarErro(doc.erro, mensagemDoErro(e));
    } finally { avancar.disabled = false; }
  }

  async function passo2() {
    limparErros(form);
    if (!senha.input.value) { mostrarErro(senha.erro, 'Informe a senha.'); return; }
    entrar.disabled = true;
    try {
      const { usuario } = await api.entrar(validarDocumento(doc.input.value).digitos, senha.input.value);
      sessionStorage.setItem(AVISO_PENDENTE, '1');
      navegar(inicioDoPapel(usuario.papel));
    } catch (e) {
      mostrarErro(senha.erro, mensagemDoErro(e));
      senha.input.setAttribute('aria-invalid', 'true');
      senha.input.select();
    } finally { entrar.disabled = false; }
  }

  const form = el('form', { class: 'formulario', novalidate: true, onsubmit: ev => { ev.preventDefault(); return etapa === 1 ? passo1() : passo2(); } },
    doc.raiz, etapaSenha,
    el('div', { class: 'acoes' }, avancar, entrar, trocar),
    el('p', { class: 'links' }, el('a', { href: `#/esqueci-senha${sufixoOrg(params)}` }, 'Esqueci minha senha')),
  );

  raiz.replaceChildren(
    el('section', { class: 'pagina pagina-acesso' },
      el('div', { class: 'cartao cartao-acesso' },
        el('p', { class: 'sobretitulo' }, 'Editais culturais'),
        el('h1', {}, 'Entrar'),
        el('p', { class: 'lead' }, 'Informe seu CPF ou CNPJ. Se ainda não tem conta, criamos em seguida.'),
        form),
      api.modo === 'demonstracao' ? contasDemo() : null,
    ));
  doc.input.focus();
}

export async function renderCriarConta(ctx) {
  const { raiz, api, params, navegar } = ctx;
  const orgSlug = params.get('org');
  if (!documentoPendente) { navegar(`#/login${sufixoOrg(params)}`); return; }
  let orgs = [];
  try { orgs = (await api.listarOrganizacoes()).organizacoes; } catch { /* segue sem lista */ }
  const orgSelecionada = orgSlug ? orgs.find(o => o.slug === orgSlug) : null;

  const campos = {
    natureza: campo({ rotulo: 'Natureza da conta', nome: 'natureza', tipo: 'select', opcoes: NATUREZAS, valor: 'Pessoa Física' }),
    nome: campo({ rotulo: 'Nome completo ou razão social', nome: 'nome', autocomplete: 'name' }),
    documento: campo({ rotulo: 'CPF ou CNPJ', nome: 'documento', readonly: true, valor: formatarDocumento(documentoPendente) }),
    email: campo({ rotulo: 'E-mail', nome: 'email', tipo: 'email', autocomplete: 'email' }),
    telefone: campo({ rotulo: 'Telefone com DDD', nome: 'telefone', tipo: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
    senha: campo({ rotulo: 'Senha', nome: 'senha', tipo: 'password', autocomplete: 'new-password', dica: 'Pelo menos 8 caracteres.' }),
    confirmacao: campo({ rotulo: 'Confirmação da senha', nome: 'senha-confirmacao', tipo: 'password', autocomplete: 'new-password' }),
  };
  const organizacao = orgSelecionada ? null : campo({
    rotulo: 'Organização', nome: 'organizacao', tipo: 'select',
    opcoes: [['', 'Escolha a organização'], ...orgs.map(o => [o.slug, o.nome])],
  });
  const geral = el('p', { class: 'mensagem mensagem-erro', role: 'alert', hidden: true });
  const botaoCriar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'criar-conta' }, 'Criar conta');
  const mapa = {
    natureza: campos.natureza, nome: campos.nome, documento: campos.documento, email: campos.email,
    telefone: campos.telefone, senha: campos.senha, senhaConfirmacao: campos.confirmacao,
    ...(organizacao ? { organizacao } : {}),
  };

  async function enviar(ev) {
    ev.preventDefault();
    limparErros(form); geral.hidden = true;
    const falhas = [];
    if (organizacao && !organizacao.input.value) falhas.push({ campo: 'organizacao', mensagem: 'Escolha a organização.' });
    if (!campos.nome.input.value.trim()) falhas.push({ campo: 'nome', mensagem: 'Campo obrigatório: Nome' });
    if (!campos.email.input.value.trim()) falhas.push({ campo: 'email', mensagem: 'Campo obrigatório: E-mail' });
    const msgSenha = validarSenha(campos.senha.input.value);
    if (msgSenha) falhas.push({ campo: 'senha', mensagem: msgSenha });
    else if (campos.senha.input.value !== campos.confirmacao.input.value) falhas.push({ campo: 'senhaConfirmacao', mensagem: 'A confirmação não confere com a senha.' });
    if (falhas.length) { mostrarErrosDaApi(falhas, mapa); return; }
    botaoCriar.disabled = true;
    try {
      const { usuario } = await api.criarConta({
        organizacao: orgSelecionada ? orgSelecionada.slug : organizacao.input.value,
        natureza: campos.natureza.input.value,
        nome: campos.nome.input.value.trim(),
        documento: documentoPendente,
        email: campos.email.input.value.trim(),
        telefone: campos.telefone.input.value.trim(),
        senha: campos.senha.input.value,
        senhaConfirmacao: campos.confirmacao.input.value,
      });
      documentoPendente = '';
      sessionStorage.setItem(AVISO_PENDENTE, '1');
      navegar(inicioDoPapel(usuario.papel));
    } catch (e) {
      const sobras = mostrarErrosDaApi(e.campos, mapa);
      if (!e.campos?.length || sobras.length) definirMensagem(geral, 'erro', sobras[0] || mensagemDoErro(e));
    } finally { botaoCriar.disabled = false; }
  }

  const form = el('form', { class: 'formulario', novalidate: true, 'data-form': 'criar-conta', onsubmit: enviar },
    orgSelecionada ? el('p', { class: 'dica' }, `Organização: ${orgSelecionada.nome}`) : organizacao.raiz,
    campos.natureza.raiz, campos.nome.raiz, campos.documento.raiz, campos.email.raiz, campos.telefone.raiz,
    campos.senha.raiz, campos.confirmacao.raiz, geral,
    el('div', { class: 'acoes' }, botaoCriar,
      el('a', { class: 'botao botao-contorno', href: `#/login${sufixoOrg(params)}` }, 'Voltar')),
  );
  raiz.replaceChildren(
    el('section', { class: 'pagina pagina-acesso', 'data-tela': 'criar-conta' },
      el('div', { class: 'cartao cartao-acesso' },
        el('p', { class: 'sobretitulo' }, 'Primeiro acesso'),
        el('h1', {}, 'Criar conta'),
        el('p', { class: 'lead' }, 'Não encontramos esse documento. Preencha os dados para criar sua conta de proponente.'),
        form)));
  campos.nome.input.focus();
}

export async function renderEsqueciSenha(ctx) {
  const { raiz, api, params } = ctx;
  const doc = campo({ rotulo: 'CPF ou CNPJ', nome: 'documento', inputmode: 'numeric' });
  const resposta = el('div', { class: 'mensagem mensagem-ok', role: 'status', hidden: true });
  const enviar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'esqueci-senha' }, 'Gerar link de redefinição');
  const form = el('form', { class: 'formulario', novalidate: true, onsubmit: async ev => {
    ev.preventDefault();
    limparErros(form); resposta.hidden = true; resposta.replaceChildren();
    const v = validarDocumento(doc.input.value);
    if (!doc.input.value.trim()) { mostrarErro(doc.erro, 'Documento obrigatório.'); return; }
    if (!v.valido) { mostrarErro(doc.erro, 'Documento inválido. Confira os números.'); return; }
    enviar.disabled = true;
    try {
      const r = await api.esqueciSenha(v.digitos);
      resposta.hidden = false;
      resposta.append(el('p', {}, r.mensagem));
      if (r.link) {
        resposta.append(el('p', {}, 'Modo demonstração: o e-mail não é enviado. Use o link abaixo.'),
          el('p', {}, el('a', { href: r.link, 'data-link-redefinicao': true }, 'Redefinir minha senha')));
      }
    } catch (e) { mostrarErro(doc.erro, mensagemDoErro(e)); } finally { enviar.disabled = false; }
  } }, doc.raiz, el('div', { class: 'acoes' }, enviar, el('a', { class: 'botao botao-contorno', href: `#/login${sufixoOrg(params)}` }, 'Voltar')), resposta);
  raiz.replaceChildren(el('section', { class: 'pagina pagina-acesso' },
    el('div', { class: 'cartao cartao-acesso' },
      el('p', { class: 'sobretitulo' }, 'Acesso'),
      el('h1', {}, 'Esqueci minha senha'),
      el('p', { class: 'lead' }, 'Informe o documento da conta. Enviaremos um link de redefinição, válido por 1 hora e para um único uso.'),
      form)));
  doc.input.focus();
}

export async function renderRedefinir(ctx) {
  const { raiz, api, params } = ctx;
  const token = params.get('token') || '';
  const senha = campo({ rotulo: 'Nova senha', nome: 'senha', tipo: 'password', autocomplete: 'new-password', dica: 'Pelo menos 8 caracteres.' });
  const conf = campo({ rotulo: 'Confirmação da nova senha', nome: 'senha-confirmacao', tipo: 'password', autocomplete: 'new-password' });
  const msg = el('p', { class: 'mensagem', hidden: true });
  const enviar = el('button', { type: 'submit', class: 'botao botao-principal', 'data-acao': 'redefinir' }, 'Salvar nova senha');
  const form = el('form', { class: 'formulario', novalidate: true, onsubmit: async ev => {
    ev.preventDefault();
    limparErros(form); msg.hidden = true;
    if (!token) { definirMensagem(msg, 'erro', 'Link de redefinição incompleto. Peça um novo.'); return; }
    const m = validarSenha(senha.input.value);
    if (m) { mostrarErro(senha.erro, m); return; }
    if (senha.input.value !== conf.input.value) { mostrarErro(conf.erro, 'A confirmação não confere com a senha.'); return; }
    enviar.disabled = true;
    try {
      await api.redefinirSenha({ token, senha: senha.input.value, senhaConfirmacao: conf.input.value });
      form.replaceChildren(el('p', { class: 'mensagem mensagem-ok', role: 'status' }, 'Senha alterada. Agora você já pode entrar.'),
        el('p', {}, el('a', { class: 'botao botao-principal', href: '#/login' }, 'Ir para o login')));
    } catch (e) {
      const sobras = mostrarErrosDaApi(e.campos, { senha, senhaConfirmacao: conf });
      if (!e.campos?.length || sobras.length) definirMensagem(msg, 'erro', mensagemDoErro(e));
    } finally { enviar.disabled = false; }
  } }, senha.raiz, conf.raiz, msg, el('div', { class: 'acoes' }, enviar));
  raiz.replaceChildren(el('section', { class: 'pagina pagina-acesso' },
    el('div', { class: 'cartao cartao-acesso' },
      el('p', { class: 'sobretitulo' }, 'Acesso'),
      el('h1', {}, 'Redefinir senha'),
      el('p', { class: 'lead' }, 'Escolha uma senha nova para a sua conta.'),
      form)));
  senha.input.focus();
}
