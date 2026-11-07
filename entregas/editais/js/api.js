// Camada api do front. Dois modos com o mesmo contrato:
//  - servidor: fetch para /api/... com cookie de sessão.
//  - demonstracao: roteador falso em api-demo.js, com localStorage e dados fictícios.
// Cada função devolve o JSON de sucesso (ou null em 204) ou lança ErroApi { status, erro, mensagem, campos }.
//
// Assinaturas (as outras telas dependem delas):
//  sessao(), listarOrganizacoes(), verificarDocumento(documento), entrar(documento, senha), sair(),
//  criarConta(dados), esqueciSenha(documento), redefinirSenha({ token, senha, senhaConfirmacao }),
//  obterConta(), salvarConta(dados), alterarSenha({ senhaAtual, novaSenha, novaSenhaConfirmacao }),
//  trocarOrganizacao(slug), buscarCep(cep), painelProponente(), obterEdital(slug),
//  criarInscricao(edital, ficha), salvarRascunho(id, ficha), enviarInscricao(id, ficha),
//  enviarAnexo(id, chave, arquivo), baixarAnexo(id), obterInscricao(idOuProtocolo),
//  enviarRecurso(protocolo, justificativa),
//  gestorEditais(), criarEdital(dados), salvarEdital(slug, dados), abrirEdital(slug), encerrarEdital(slug),
//  publicarResultado(slug), gestorAvisos(), criarAviso({ texto, ativo }), gestorAvaliadores(), criarAvaliador(dados),
//  gestorInscricoes({ edital, situacao }), atribuirAvaliador(protocolo, avaliadorId),
//  definirResultado(protocolo, resultado), decidirRecurso(id, decisao, parecer),
//  avaliadorInscricoes(), avaliadorInscricao(protocolo), enviarAvaliacao(protocolo, notas, parecer),
//  plataformaOrganizacoes(), criarOrganizacao(dados).
import { criarDemo } from './api-demo.js';

export class ErroApi extends Error {
  constructor({ status = 0, erro = 'erro', mensagem = 'Algo deu errado.', campos } = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.erro = erro;
    this.mensagem = mensagem;
    this.campos = campos;
  }
}

const enc = encodeURIComponent;

function transporteServidor(fetchFn) {
  async function lerCorpo(r) {
    const tipo = r.headers.get('content-type') || '';
    if (r.status === 204 || !tipo.includes('application/json')) return null;
    try { return await r.json(); } catch { return null; }
  }
  return {
    async requisitar(metodo, caminho, corpo) {
      const init = { method: metodo, credentials: 'same-origin', headers: {} };
      if (metodo === 'POST' || metodo === 'PUT') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(corpo ?? {});
      }
      let r;
      try { r = await fetchFn(caminho, init); } catch {
        throw new ErroApi({ status: 0, erro: 'sem_rede', mensagem: 'Não foi possível falar com o servidor. Confira a conexão.' });
      }
      return { status: r.status, corpo: await lerCorpo(r) };
    },
    async enviarArquivo(caminho, arquivo) {
      let r;
      try {
        r = await fetchFn(caminho, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': arquivo.type || 'application/octet-stream', 'X-Nome-Arquivo': enc(arquivo.name || '') },
          body: arquivo,
        });
      } catch {
        throw new ErroApi({ status: 0, erro: 'sem_rede', mensagem: 'Não foi possível falar com o servidor. Confira a conexão.' });
      }
      return { status: r.status, corpo: await lerCorpo(r) };
    },
    async baixar(caminho) {
      let r;
      try { r = await fetchFn(caminho, { credentials: 'same-origin' }); } catch {
        throw new ErroApi({ status: 0, erro: 'sem_rede', mensagem: 'Não foi possível falar com o servidor. Confira a conexão.' });
      }
      if (!r.ok) return { status: r.status, corpo: await lerCorpo(r) };
      return { status: 200, corpo: await r.blob() };
    },
  };
}

export function criarApi({ modo = 'demonstracao', fetch: fetchFn = globalThis.fetch?.bind(globalThis), armazenamento = globalThis.localStorage, agora = () => new Date() } = {}) {
  let transporte;
  if (modo === 'servidor') {
    transporte = transporteServidor(fetchFn);
  } else {
    const demo = criarDemo({ armazenamento, agora, fetch: fetchFn });
    transporte = {
      requisitar: (m, c, b) => demo.requisitar(m, c, b),
      enviarArquivo: (c, arquivo) => demo.requisitar('POST', c, { nome: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size }),
      baixar: c => demo.requisitar('GET', c),
    };
  }

  const verificar = r => {
    if (r.status >= 400) {
      const c = r.corpo || {};
      throw new ErroApi({ status: r.status, erro: c.erro || 'erro', mensagem: c.mensagem || 'Algo deu errado.', campos: c.campos });
    }
    return r.corpo ?? null;
  };
  const pedir = async (metodo, caminho, corpo) => verificar(await transporte.requisitar(metodo, caminho, corpo));
  const consulta = params => {
    const q = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    return q ? `?${q}` : '';
  };

  return {
    modo,
    sessao: () => pedir('GET', '/api/sessao'),
    listarOrganizacoes: () => pedir('GET', '/api/organizacoes'),
    verificarDocumento: documento => pedir('POST', '/api/acesso/documento', { documento }),
    entrar: (documento, senha) => {
      const d = documento && typeof documento === 'object' ? documento : { documento, senha };
      return pedir('POST', '/api/acesso/entrar', { documento: d.documento, senha: d.senha });
    },
    sair: () => pedir('POST', '/api/acesso/sair', {}),
    criarConta: dados => pedir('POST', '/api/acesso/criar-conta', dados),
    esqueciSenha: documento => pedir('POST', '/api/acesso/esqueci-senha', { documento }),
    redefinirSenha: dados => pedir('POST', '/api/acesso/redefinir', dados),
    obterConta: () => pedir('GET', '/api/conta'),
    salvarConta: dados => pedir('PUT', '/api/conta', dados),
    alterarSenha: dados => pedir('PUT', '/api/conta/senha', dados),
    trocarOrganizacao: slug => pedir('PUT', '/api/conta/organizacao', { organizacao: slug }),
    buscarCep: cep => pedir('GET', `/api/cep/${enc(String(cep))}`),
    painelProponente: () => pedir('GET', '/api/proponente/painel'),
    obterEdital: slug => pedir('GET', `/api/editais/${enc(slug)}`),
    criarInscricao: (edital, ficha) => pedir('POST', '/api/inscricoes', { edital, ficha }),
    salvarRascunho: (id, ficha) => pedir('PUT', `/api/inscricoes/${enc(id)}`, { ficha }),
    enviarInscricao: (id, ficha) => pedir('POST', `/api/inscricoes/${enc(id)}/enviar`, { ficha }),
    enviarAnexo: async (id, chave, arquivo) => verificar(await transporte.enviarArquivo(`/api/inscricoes/${enc(id)}/anexos/${enc(chave)}`, arquivo)),
    baixarAnexo: async id => verificar(await transporte.baixar(`/api/anexos/${enc(id)}`)),
    obterInscricao: idOuProtocolo => pedir('GET', `/api/inscricoes/${enc(idOuProtocolo)}`),
    enviarRecurso: (protocolo, justificativa) => pedir('POST', `/api/inscricoes/${enc(protocolo)}/recurso`, { justificativa }),
    gestorEditais: () => pedir('GET', '/api/gestor/editais'),
    criarEdital: dados => pedir('POST', '/api/gestor/editais', dados),
    salvarEdital: (slug, dados) => pedir('PUT', `/api/gestor/editais/${enc(slug)}`, dados),
    abrirEdital: slug => pedir('POST', `/api/gestor/editais/${enc(slug)}/abrir`, {}),
    encerrarEdital: slug => pedir('POST', `/api/gestor/editais/${enc(slug)}/encerrar`, {}),
    publicarResultado: slug => pedir('POST', `/api/gestor/editais/${enc(slug)}/publicar-resultado`, {}),
    gestorAvisos: () => pedir('GET', '/api/gestor/avisos'),
    criarAviso: dados => pedir('POST', '/api/gestor/avisos', dados),
    gestorAvaliadores: () => pedir('GET', '/api/gestor/avaliadores'),
    criarAvaliador: dados => pedir('POST', '/api/gestor/avaliadores', dados),
    gestorInscricoes: ({ edital, situacao } = {}) => pedir('GET', `/api/gestor/inscricoes${consulta({ edital, situacao })}`),
    atribuirAvaliador: (protocolo, avaliador) => pedir('POST', `/api/gestor/inscricoes/${enc(protocolo)}/avaliador`, { avaliador }),
    definirResultado: (protocolo, resultado) => pedir('PUT', `/api/gestor/inscricoes/${enc(protocolo)}/resultado`, { resultado }),
    decidirRecurso: (id, decisao, parecer) => pedir('POST', `/api/gestor/recursos/${enc(id)}/decisao`, { decisao, parecer }),
    avaliadorInscricoes: () => pedir('GET', '/api/avaliador/inscricoes'),
    avaliadorInscricao: protocolo => pedir('GET', `/api/avaliador/inscricoes/${enc(protocolo)}`),
    enviarAvaliacao: (protocolo, notas, parecer) => pedir('POST', `/api/avaliador/inscricoes/${enc(protocolo)}/avaliacao`, { notas, parecer }),
    plataformaOrganizacoes: () => pedir('GET', '/api/plataforma/organizacoes'),
    criarOrganizacao: dados => pedir('POST', '/api/plataforma/organizacoes', dados),
  };
}

// Lê modo.json uma vez e guarda a api pronta. Se a leitura falhar, usa demonstração.
// Nunca sonda /api: no modo estático isso daria 404.
let apiPronta = null;

export function obterApi() {
  apiPronta ??= (async () => {
    let modo = 'demonstracao';
    try {
      const r = await fetch(new URL('../modo.json', import.meta.url), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.modo === 'servidor') modo = 'servidor';
      }
    } catch { /* sem modo.json legível: demonstração */ }
    return criarApi({ modo });
  })();
  return apiPronta;
}
