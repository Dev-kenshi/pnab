// Exportação e importação lógica do banco em NDJSON (uma linha JSON por registro).
// Funciona com o SQLite local e com o Turso, porque usa só a interface executar(sql, params).
// Sessões, tentativas de login e tokens de redefinição ficam de fora: são temporários e sensíveis.
// Depois de restaurar, todo mundo entra de novo e links de redefinição antigos não valem.
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

export const TABELAS_FORA = new Set(['sessoes', 'tentativas_login', 'tokens_redefinicao']);
const NOME_OK = /^[a-z_][a-z0-9_]*$/;
const LOTE = 500;

async function tabelasDo(banco) {
  const { linhas } = await banco.executar(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
  );
  return linhas.map(l => l.name).filter(n => NOME_OK.test(n));
}

function codificar(linha) {
  const saida = {};
  for (const [k, v] of Object.entries(linha)) {
    saida[k] = v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : typeof v === 'bigint' ? Number(v) : v;
  }
  return saida;
}

function decodificar(v) {
  return v && typeof v === 'object' && typeof v.$b64 === 'string' ? Buffer.from(v.$b64, 'base64') : v;
}

async function escrever(fluxo, obj) {
  if (!fluxo.write(`${JSON.stringify(obj)}\n`)) await once(fluxo, 'drain');
}

// Grava o banco em `caminho`. Devolve a contagem de linhas por tabela.
export async function exportarBanco(banco, caminho, { agora = new Date() } = {}) {
  const fluxo = createWriteStream(caminho, { mode: 0o600 });
  const contagem = {};
  try {
    await escrever(fluxo, { teb: 'backup-banco', versao: 1, criadoEm: agora.toISOString(), origem: banco.tipo });
    for (const tabela of await tabelasDo(banco)) {
      if (TABELAS_FORA.has(tabela)) continue;
      contagem[tabela] = 0;
      await escrever(fluxo, { tabela });
      for (let ultimo = -Infinity; ;) {
        const { linhas } = await banco.executar(
          `SELECT rowid AS __rowid, * FROM ${tabela} WHERE rowid > ? ORDER BY rowid LIMIT ${LOTE}`,
          [ultimo === -Infinity ? -9007199254740991 : ultimo],
        );
        for (const l of linhas) {
          ultimo = Number(l.__rowid);
          delete l.__rowid;
          await escrever(fluxo, { l: codificar(l) });
          contagem[tabela]++;
        }
        if (linhas.length < LOTE) break;
      }
    }
    await escrever(fluxo, { fim: true, contagem });
  } finally {
    fluxo.end();
    await once(fluxo, 'close');
  }
  return contagem;
}

// Carrega o NDJSON num banco vazio. Recusa banco com usuários, para nunca sobrescrever dados.
export async function importarBanco(banco, caminho) {
  const { linhas: [{ n }] } = await banco.executar('SELECT COUNT(*) AS n FROM usuarios');
  if (Number(n) > 0) throw new Error('O banco de destino já tem dados. Restaure num banco novo e vazio.');
  const permitidas = new Set(await tabelasDo(banco));
  const leitor = createInterface({ input: createReadStream(caminho), crlfDelay: Infinity });
  const contagem = {};
  let cabecalho = null, fim = null, tabela = null;
  await banco.transacao(async tx => {
    for await (const texto of leitor) {
      if (!texto) continue;
      const item = JSON.parse(texto);
      if (!cabecalho) {
        if (item.teb !== 'backup-banco' || item.versao !== 1) throw new Error('Arquivo de backup do banco inválido.');
        cabecalho = item;
        continue;
      }
      if (item.fim) { fim = item; break; }
      if (typeof item.tabela === 'string') {
        if (!permitidas.has(item.tabela) || TABELAS_FORA.has(item.tabela)) throw new Error(`Tabela desconhecida no backup: ${item.tabela}`);
        tabela = item.tabela;
        contagem[tabela] = 0;
        continue;
      }
      if (!tabela || !item.l) throw new Error('Linha de backup fora de uma tabela.');
      const colunas = Object.keys(item.l);
      if (!colunas.length || !colunas.every(c => NOME_OK.test(c))) throw new Error('Coluna inválida no backup.');
      await tx.executar(
        `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
        colunas.map(c => decodificar(item.l[c])),
      );
      contagem[tabela]++;
    }
    if (!fim) throw new Error('Backup do banco incompleto: falta o marcador de fim.');
    for (const [t, qtd] of Object.entries(fim.contagem || {})) {
      if (contagem[t] !== qtd) throw new Error(`Backup do banco incompleto na tabela ${t}.`);
    }
  });
  return { criadoEm: cabecalho.criadoEm, contagem };
}
