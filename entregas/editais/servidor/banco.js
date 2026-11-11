// Banco do Sistema Integrado TEB.
// Interface async: executar(sql, params) e transacao(fn). SQL sempre com parâmetros.
// Implementações: node:sqlite local e Turso pela API HTTP v2.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as regras from '../js/regras.js';

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS organizacoes (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    organizacao_id INTEGER REFERENCES organizacoes(id),
    papel TEXT NOT NULL CHECK (papel IN ('plataforma','gestor','avaliador','proponente')),
    nome TEXT NOT NULL,
    natureza TEXT,
    documento TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    telefone TEXT,
    endereco TEXT,
    senha_hash TEXT NOT NULL,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    expira_em TEXT NOT NULL,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tentativas_login (
    chave TEXT PRIMARY KEY,
    erros INTEGER NOT NULL,
    bloqueado_ate TEXT,
    atualizado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tokens_redefinicao (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    expira_em TEXT NOT NULL,
    usado_em TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS editais (
    id INTEGER PRIMARY KEY,
    organizacao_id INTEGER NOT NULL REFERENCES organizacoes(id),
    slug TEXT NOT NULL,
    numero TEXT NOT NULL,
    titulo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fim TEXT NOT NULL,
    teto INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    situacao TEXT NOT NULL CHECK (situacao IN ('rascunho','aberto','encerrado')),
    resultado_publicado_em TEXT,
    modelo TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    UNIQUE (organizacao_id, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS avisos (
    id INTEGER PRIMARY KEY,
    organizacao_id INTEGER NOT NULL REFERENCES organizacoes(id),
    texto TEXT NOT NULL,
    ativo INTEGER NOT NULL,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inscricoes (
    id TEXT PRIMARY KEY,
    organizacao_id INTEGER NOT NULL REFERENCES organizacoes(id),
    edital_id INTEGER NOT NULL REFERENCES editais(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    protocolo TEXT UNIQUE,
    ficha TEXT NOT NULL,
    situacao TEXT NOT NULL CHECK (situacao IN ('rascunho','enviada','concluida')),
    resultado TEXT,
    etapa INTEGER NOT NULL,
    avaliador_id INTEGER REFERENCES usuarios(id),
    enviada_em TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS avaliacoes (
    id INTEGER PRIMARY KEY,
    organizacao_id INTEGER NOT NULL REFERENCES organizacoes(id),
    inscricao_id TEXT NOT NULL UNIQUE REFERENCES inscricoes(id),
    avaliador_id INTEGER NOT NULL REFERENCES usuarios(id),
    notas TEXT NOT NULL,
    nota_geral REAL NOT NULL,
    parecer TEXT NOT NULL,
    enviada_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recursos (
    id TEXT PRIMARY KEY,
    organizacao_id INTEGER NOT NULL REFERENCES organizacoes(id),
    inscricao_id TEXT NOT NULL UNIQUE REFERENCES inscricoes(id),
    justificativa TEXT NOT NULL,
    situacao TEXT NOT NULL,
    parecer TEXT,
    criado_em TEXT NOT NULL,
    decidido_em TEXT,
    decidido_por INTEGER REFERENCES usuarios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS anexos (
    id TEXT PRIMARY KEY,
    organizacao_id INTEGER NOT NULL REFERENCES organizacoes(id),
    inscricao_id TEXT NOT NULL REFERENCES inscricoes(id),
    chave TEXT NOT NULL,
    nome TEXT NOT NULL,
    tamanho INTEGER NOT NULL,
    arquivo_id TEXT NOT NULL,
    criado_em TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY,
    quando TEXT NOT NULL,
    usuario_id INTEGER,
    organizacao_id INTEGER,
    acao TEXT NOT NULL,
    alvo TEXT,
    detalhe TEXT,
    ip TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sequencias (
    nome TEXT PRIMARY KEY,
    valor INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_inscricoes_org ON inscricoes (organizacao_id, edital_id)',
  'CREATE INDEX IF NOT EXISTS idx_inscricoes_usuario ON inscricoes (usuario_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes (usuario_id)',
  'CREATE INDEX IF NOT EXISTS idx_auditoria_quando ON auditoria (quando)',
];

const devolveLinhas = sql => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

function normalizarParametro(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function criarFila() {
  let fila = Promise.resolve();
  return fn => {
    const p = fila.then(fn);
    fila = p.catch(() => {});
    return p;
  };
}

// node:sqlite. Uma fila garante que uma transação não se mistura com outro pedido.
export function abrirSqlite(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON');
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  for (const sql of ESQUEMA) db.exec(sql);

  const direto = (sql, params = []) => {
    const st = db.prepare(sql);
    const p = params.map(normalizarParametro);
    if (devolveLinhas(sql)) return { linhas: st.all(...p).map(l => ({ ...l })), alteradas: 0, ultimoId: null };
    const r = st.run(...p);
    return { linhas: [], alteradas: Number(r.changes), ultimoId: Number(r.lastInsertRowid) };
  };
  const naFila = criarFila();
  const tx = { executar: async (sql, params) => direto(sql, params) };

  return {
    tipo: 'sqlite',
    executar: (sql, params) => naFila(() => direto(sql, params)),
    transacao: fn => naFila(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn(tx);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }),
    fechar: async () => naFila(() => db.close()),
  };
}

// Turso pela API HTTP v2. Sem SDK, só fetch. Testado com um Turso simulado em servidor/testes/turso.test.js.
export async function abrirTurso({ url, token, fetch: f = globalThis.fetch }) {
  const base = String(url).replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
  const arg = v => {
    v = normalizarParametro(v);
    if (v === null) return { type: 'null' };
    if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
    return { type: 'text', value: String(v) };
  };
  const valor = c => {
    if (!c || c.type === 'null') return null;
    if (c.type === 'integer') return Number(c.value);
    if (c.type === 'float') return Number(c.value);
    return c.value;
  };
  const pipeline = async (requests, baton) => {
    const r = await f(`${base}/v2/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baton ? { baton, requests } : { requests }),
    });
    if (!r.ok) throw new Error(`Turso respondeu ${r.status}`);
    const corpo = await r.json();
    for (const item of corpo.results) {
      if (item.type === 'error') {
        // O Turso troca o baton a cada resposta, mesmo com erro. Sem o novo, o ROLLBACK seria recusado.
        const erro = new Error(item.error?.message || 'Erro no Turso');
        erro.baton = corpo.baton;
        throw erro;
      }
    }
    return corpo;
  };
  const converter = res => {
    const cols = res.cols.map(c => c.name);
    return {
      linhas: res.rows.map(row => Object.fromEntries(row.map((c, i) => [cols[i], valor(c)]))),
      alteradas: Number(res.affected_row_count || 0),
      ultimoId: res.last_insert_rowid == null ? null : Number(res.last_insert_rowid),
    };
  };
  const stmt = (sql, params = []) => ({ type: 'execute', stmt: { sql, args: params.map(arg) } });
  const naFila = criarFila();
  const executar = (sql, params) => naFila(async () => {
    const r = await pipeline([stmt(sql, params), { type: 'close' }]);
    return converter(r.results[0].response.result);
  });
  const transacao = fn => naFila(async () => {
    let baton = (await pipeline([stmt('BEGIN IMMEDIATE')])).baton;
    const tx = {
      executar: async (sql, params) => {
        let r;
        try {
          r = await pipeline([stmt(sql, params)], baton);
        } catch (e) {
          if (e.baton) baton = e.baton;
          throw e;
        }
        baton = r.baton;
        return converter(r.results[0].response.result);
      },
    };
    try {
      const r = await fn(tx);
      await pipeline([stmt('COMMIT'), { type: 'close' }], baton);
      return r;
    } catch (e) {
      await pipeline([stmt('ROLLBACK'), { type: 'close' }], baton).catch(() => {});
      throw e;
    }
  });
  const banco = { tipo: 'turso', executar, transacao, fechar: async () => {} };
  for (const sql of ESQUEMA) await executar(sql);
  return banco;
}

export async function abrirBanco({ caminho, tursoUrl, tursoToken, fetch } = {}) {
  if (tursoUrl && tursoToken) return abrirTurso({ url: tursoUrl, token: tursoToken, fetch });
  return abrirSqlite(caminho || ':memory:');
}

// Conversões de linha do banco para os objetos do contrato da api.

const LINK_EDITAL = 'exemplos/edital-exemplo.pdf';
const LINK_ANEXOS = 'exemplos/anexos-exemplo.pdf';

const json = (texto, padrao) => {
  if (texto == null) return padrao;
  try { return JSON.parse(texto); } catch { return padrao; }
};

export function usuarioPublico(linha) {
  return {
    id: linha.id,
    papel: linha.papel,
    nome: linha.nome,
    natureza: linha.natureza ?? null,
    documento: linha.documento,
    email: linha.email,
    telefone: linha.telefone ?? null,
    endereco: json(linha.endereco, null),
    organizacao: linha.org_slug ? { slug: linha.org_slug, nome: linha.org_nome } : null,
  };
}

export const SQL_USUARIO = `SELECT u.*, o.slug AS org_slug, o.nome AS org_nome
  FROM usuarios u LEFT JOIN organizacoes o ON o.id = u.organizacao_id`;

export async function buscarUsuario(banco, id) {
  const { linhas } = await banco.executar(`${SQL_USUARIO} WHERE u.id = ?`, [id]);
  return linhas[0] || null;
}

export function editalDaLinha(linha) {
  const modelo = json(linha.modelo, {});
  const resultadoPublicadoEm = linha.resultado_publicado_em ?? null;
  return {
    id: linha.id,
    organizacaoId: linha.organizacao_id,
    slug: linha.slug,
    numero: linha.numero,
    titulo: linha.titulo,
    descricao: linha.descricao,
    inicio: linha.inicio,
    fim: linha.fim,
    teto: Number(linha.teto),
    ano: Number(linha.ano),
    situacao: linha.situacao,
    resultadoPublicadoEm,
    prazoRecursoAte: resultadoPublicadoEm ? regras.prazoRecurso(resultadoPublicadoEm).toISOString() : null,
    linkEdital: LINK_EDITAL,
    linkAnexos: LINK_ANEXOS,
    categorias: modelo.categorias || [],
    cotas: modelo.cotas || [],
    criterios: modelo.criterios || [],
    camposExtras: modelo.camposExtras || [],
  };
}

export function editalResumo(ed) {
  const { slug, numero, titulo, descricao, inicio, fim, teto, ano, situacao, resultadoPublicadoEm, prazoRecursoAte, linkEdital, linkAnexos } = ed;
  return { slug, numero, titulo, descricao, inicio, fim, teto, ano, situacao, resultadoPublicadoEm, prazoRecursoAte, linkEdital, linkAnexos };
}

export function editalPublico(ed) {
  return { ...editalResumo(ed), categorias: ed.categorias, cotas: ed.cotas, criterios: ed.criterios, camposExtras: ed.camposExtras };
}

export async function buscarEditalPorId(banco, id, organizacaoId) {
  const { linhas } = await banco.executar('SELECT * FROM editais WHERE id = ? AND organizacao_id = ?', [id, organizacaoId]);
  return linhas[0] ? editalDaLinha(linhas[0]) : null;
}

export async function buscarEditalPorSlug(banco, slug, organizacaoId) {
  const { linhas } = await banco.executar('SELECT * FROM editais WHERE slug = ? AND organizacao_id = ?', [String(slug), organizacaoId]);
  return linhas[0] ? editalDaLinha(linhas[0]) : null;
}

export function inscricaoDaLinha(linha) {
  return {
    id: linha.id,
    organizacaoId: linha.organizacao_id,
    editalId: linha.edital_id,
    usuarioId: linha.usuario_id,
    protocolo: linha.protocolo ?? null,
    ficha: json(linha.ficha, {}),
    situacao: linha.situacao,
    resultado: linha.resultado ?? null,
    etapa: Number(linha.etapa),
    avaliadorId: linha.avaliador_id ?? null,
    enviadaEm: linha.enviada_em ?? null,
  };
}

export function avaliacaoDaLinha(linha) {
  if (!linha) return null;
  return {
    notas: json(linha.notas, []),
    notaGeral: Number(linha.nota_geral),
    parecer: linha.parecer,
    enviadaEm: linha.enviada_em,
  };
}

export function recursoDaLinha(linha, protocolo) {
  if (!linha) return null;
  return {
    id: linha.id,
    protocolo: protocolo ?? null,
    justificativa: linha.justificativa,
    situacao: linha.situacao,
    parecer: linha.parecer ?? null,
    criadoEm: linha.criado_em,
    decididoEm: linha.decidido_em ?? null,
  };
}

export async function buscarAvaliacao(banco, inscricaoId, organizacaoId) {
  const { linhas } = await banco.executar('SELECT * FROM avaliacoes WHERE inscricao_id = ? AND organizacao_id = ?', [inscricaoId, organizacaoId]);
  return linhas[0] || null;
}

export async function buscarRecurso(banco, inscricaoId, organizacaoId) {
  const { linhas } = await banco.executar('SELECT * FROM recursos WHERE inscricao_id = ? AND organizacao_id = ?', [inscricaoId, organizacaoId]);
  return linhas[0] || null;
}

export function inscricaoResumo(insc, edital, avaliacaoLinha) {
  const publicado = Boolean(edital.resultadoPublicadoEm);
  return {
    id: insc.id,
    protocolo: insc.protocolo,
    edital: { slug: edital.slug, titulo: edital.titulo, ano: edital.ano, linkEdital: edital.linkEdital, linkAnexos: edital.linkAnexos },
    titulo: insc.ficha.titulo ?? '',
    categoria: insc.ficha.categoria ?? '',
    cota: insc.ficha.cota ?? '',
    situacao: insc.situacao,
    resultado: publicado || insc.situacao === 'concluida' ? insc.resultado : null,
    etapa: insc.etapa,
    selo: regras.selo(insc, edital),
    notaGeral: publicado && avaliacaoLinha ? Number(avaliacaoLinha.nota_geral) : null,
    etapas: regras.calcularEtapas(insc, edital),
    enviadaEm: insc.enviadaEm,
  };
}

export function inscricaoCompleta(insc, edital, avaliacaoLinha, recursoLinha, agora) {
  const publicado = Boolean(edital.resultadoPublicadoEm);
  const recurso = recursoDaLinha(recursoLinha, insc.protocolo);
  const avaliacao = publicado && avaliacaoLinha ? avaliacaoDaLinha(avaliacaoLinha) : null;
  return {
    ...inscricaoResumo(insc, edital, avaliacaoLinha),
    ficha: insc.ficha,
    avaliacao: avaliacao ? { notas: avaliacao.notas, notaGeral: avaliacao.notaGeral, parecer: avaliacao.parecer } : null,
    recurso,
    recursoPermitido: regras.recursoPermitido({ inscricao: insc, edital, recurso, agora }),
    prazoRecursoAte: edital.prazoRecursoAte,
    abas: regras.abasLiberadas(insc, edital),
  };
}
