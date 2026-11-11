// Ajuda dos testes do servidor. Não é arquivo de teste.
// Banco em arquivo temporário, anexos em pasta temporária, chave aleatória, relógio controlável.
// Duas organizações, cada uma com gestor, avaliador e proponente. Uma conta da plataforma.
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarApp } from '../app.js';
import { abrirBanco } from '../banco.js';
import { criarArmazemDisco } from '../anexos.js';
import { inserirUsuario } from '../rotas/acesso.js';

export const SENHA = 'Senha-de-teste-9';
export const INICIO_RELOGIO = '2026-06-15T15:00:00.000Z';
export const DIA = 24 * 60 * 60 * 1000;

// CPF válido a partir de um número de 9 dígitos.
export function gerarCPF(n) {
  const base = String(n).padStart(9, '0').slice(0, 9).split('').map(Number);
  for (const tam of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tam; i++) soma += base[i] * (tam + 1 - i);
    const r = (soma * 10) % 11;
    base.push(r === 10 ? 0 : r);
  }
  return base.join('');
}

export function pdfMinimo(texto = 'Arquivo de teste') {
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${texto}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

export function criarCliente(base, { ip } = {}) {
  let cookie = null;
  return {
    get cookie() { return cookie; },
    esquecerCookie() { cookie = null; },
    async pedir(metodo, caminho, corpo, { cabecalhos = {}, bruto } = {}) {
      const h = { ...cabecalhos };
      if (ip) h['x-ip-teste'] = ip;
      if (cookie) h.cookie = cookie;
      let body;
      if (bruto !== undefined) body = bruto;
      else if (corpo !== undefined) { body = JSON.stringify(corpo); h['content-type'] ??= 'application/json'; }
      const r = await fetch(base + caminho, { method: metodo, headers: h, body });
      const setCookie = r.headers.getSetCookie();
      for (const c of setCookie) {
        const par = c.split(';')[0];
        const i = par.indexOf('=');
        if (par.slice(0, i) === 'teb_sessao') cookie = par.slice(i + 1) ? par : null;
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      const tipo = r.headers.get('content-type') || '';
      const json = tipo.includes('application/json') && bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
      return { status: r.status, corpo: json, bytes, cabecalhos: r.headers, setCookie };
    },
  };
}

export function dataBrasil(relogio, dias = 0) {
  return new Date(relogio.agora().getTime() + dias * DIA - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function corpoEdital(relogio, extra = {}) {
  return {
    numero: `EX-${randomBytes(3).toString('hex')}/2026`,
    titulo: 'Edital de teste',
    descricao: 'Edital criado no teste.',
    inicio: dataBrasil(relogio, -1),
    fim: dataBrasil(relogio, 30),
    teto: 1000000,
    categorias: ['Teatro', 'Música'],
    cotas: ['Ampla concorrência', 'PcD'],
    criterios: [
      { nome: 'Qualidade', maximo: 10, bonus: false },
      { nome: 'Viabilidade', maximo: 10, bonus: false },
      { nome: 'Bônus regional', maximo: 2, bonus: true },
    ],
    camposExtras: [
      { rotulo: 'Resumo', tipo: 'texto-longo', obrigatorio: true },
      { rotulo: 'Portfólio', tipo: 'anexo', obrigatorio: false },
    ],
    ...extra,
  };
}

export function fichaValida(extra = {}) {
  return {
    titulo: 'Projeto de teste',
    categoria: 'Teatro',
    cota: 'Ampla concorrência',
    extras: { 'extra-resumo': 'Resumo do projeto de teste.' },
    metas: [{ etapa: 'Ensaios', inicio: '', fim: '', acao: 'Realizar ensaios' }],
    equipe: [],
    orcamento: [{ descricao: 'Cenário', qtd: 2, valor: 150000 }],
    aceite: true,
    ...extra,
  };
}

// loginPlataforma: texto do usuário de teste (ex.: 'admin'). Liga TEB_PLATAFORMA_LOGIN para a conta da plataforma.
export async function criarAmbiente({ https = false, loginPlataforma = null } = {}) {
  const pasta = await mkdtemp(join(tmpdir(), 'teb-teste-'));
  const banco = await abrirBanco({ caminho: join(pasta, 'teb.sqlite') });
  const pastaAnexos = join(pasta, 'anexos');
  const anexos = criarArmazemDisco({ pasta: pastaAnexos, chave: randomBytes(32) });
  let atual = new Date(INICIO_RELOGIO).getTime();
  const relogio = {
    agora: () => new Date(atual),
    avancar: ms => { atual += ms; },
  };
  const emails = [];
  // O documento é preenchido abaixo, quando a conta da plataforma é criada.
  const login = loginPlataforma ? { usuario: loginPlataforma.toLowerCase(), documento: '' } : null;
  const app = criarApp({
    loginPlataforma: login,
    banco,
    anexos,
    agora: relogio.agora,
    ipDe: req => String(req.headers['x-ip-teste'] || '10.0.0.1'),
    enviarEmail: m => { emails.push(m); },
    buscarCepRemoto: async cep => {
      if (cep === '00000000') throw new Error('sem rede');
      if (cep === '99999999') return null;
      return { cep, logradouro: 'Rua de Teste', bairro: 'Centro', cidade: 'Cidade Teste', uf: 'BA' };
    },
    https,
    urlPublica: 'http://teste.local',
  });
  const servidor = createServer(app);
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const agoraIso = relogio.agora().toISOString();
  const contas = {};
  let n = 100000000;
  for (const [letra, slug, nome] of [['a', 'org-a', 'Organização A de teste'], ['b', 'org-b', 'Organização B de teste']]) {
    const r = await banco.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', [slug, nome, agoraIso]);
    contas[letra] = { orgId: r.ultimoId, slug };
    for (const papel of ['gestor', 'avaliador', 'proponente']) {
      const documento = gerarCPF(n++);
      const id = await inserirUsuario(banco, {
        organizacaoId: r.ultimoId, papel, nome: `${papel} ${letra}`, natureza: papel === 'proponente' ? 'Pessoa Física' : null,
        documento, email: `${papel}.${letra}@teste.example`, telefone: '71900000000', senha: SENHA, agora: relogio.agora(),
      });
      contas[letra][papel] = { id, documento };
    }
  }
  const docPlataforma = gerarCPF(n++);
  contas.plataforma = {
    id: await inserirUsuario(banco, { organizacaoId: null, papel: 'plataforma', nome: 'Plataforma de teste', documento: docPlataforma, email: 'plataforma@teste.example', senha: SENHA, agora: relogio.agora() }),
    documento: docPlataforma,
  };
  if (login) login.documento = docPlataforma;

  let ipSeq = 1;
  const cliente = (opcoes = {}) => criarCliente(base, { ip: `10.1.0.${ipSeq++}`, ...opcoes });
  async function entrar(conta, opcoes) {
    const c = cliente(opcoes);
    const r = await c.pedir('POST', '/api/acesso/entrar', { documento: conta.documento, senha: SENHA });
    if (r.status !== 200) throw new Error(`Login falhou no teste: ${r.status} ${JSON.stringify(r.corpo)}`);
    return c;
  }

  // Cria e abre um edital pelo gestor. Devolve o slug.
  async function editalAberto(gestor, extra) {
    const r = await gestor.pedir('POST', '/api/gestor/editais', corpoEdital(relogio, extra));
    if (r.status !== 201) throw new Error(`Criar edital falhou: ${JSON.stringify(r.corpo)}`);
    const a = await gestor.pedir('POST', `/api/gestor/editais/${r.corpo.edital.slug}/abrir`, {});
    if (a.status !== 200) throw new Error(`Abrir edital falhou: ${JSON.stringify(a.corpo)}`);
    return r.corpo.edital.slug;
  }

  // Cria rascunho e envia. Devolve { id, protocolo }.
  async function inscricaoEnviada(proponente, slug, ficha = fichaValida()) {
    const c = await proponente.pedir('POST', '/api/inscricoes', { edital: slug, ficha: {} });
    if (c.status !== 201) throw new Error(`Criar inscrição falhou: ${JSON.stringify(c.corpo)}`);
    const e = await proponente.pedir('POST', `/api/inscricoes/${c.corpo.inscricao.id}/enviar`, { ficha });
    if (e.status !== 200) throw new Error(`Enviar inscrição falhou: ${JSON.stringify(e.corpo)}`);
    return { id: c.corpo.inscricao.id, protocolo: e.corpo.inscricao.protocolo };
  }

  async function fechar() {
    servidor.closeAllConnections();
    await new Promise(ok => servidor.close(ok));
    await banco.fechar();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  return { banco, anexos, pasta, pastaAnexos, relogio, emails, base, contas, cliente, entrar, editalAberto, inscricaoEnviada, fechar };
}
