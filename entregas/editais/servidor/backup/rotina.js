// Rotina de backup e restauração.
// Banco: cópia completa a cada execução, compactada e cifrada, em banco/AAAA-MM-DDTHH-MM-SSZ.ndjson.gz.teb.
// Anexos: incrementais. Cada anexo nunca muda depois de gravado, então vai uma vez só, em anexos/<id>.bin.teb.
// Retenção: guarda os N backups de banco mais novos em cada destino. Anexos não são apagados.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abrirBanco } from '../banco.js';
import { cifrarArquivo, decifrarArquivo } from './cifra.js';
import { exportarBanco, importarBanco } from './exportar.js';

export const PREFIXO_BANCO = 'banco/';
export const PREFIXO_ANEXOS = 'anexos/';
const ANEXO_RE = /^([a-f0-9]{32})\.bin$/;
const NOME_BANCO_RE = /^banco\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?Z\.ndjson\.gz\.teb$/;
const NOME_ANEXO_RE = /^anexos\/([a-f0-9]{32})\.bin\.teb$/;

const DIA_MS = 24 * 60 * 60 * 1000;
const TRAVA_VALIDADE_MS = 6 * 60 * 60 * 1000;

// Data de um nome banco/AAAA-MM-DDTHH-MM-SS-mmmZ...
function dataDoNome(nome) {
  const m = /^banco\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z/.exec(nome);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] || '000'}Z`) : null;
}

// Uma execução por vez. Trava com mais de 6 horas é de um processo que morreu e é descartada.
// Sobras de execuções mortas (bkp-*, rest-*) podem ter o banco em claro: são apagadas ao começar.
async function travar(pastaTemp, agora) {
  await mkdir(pastaTemp, { recursive: true, mode: 0o700 });
  const trava = join(pastaTemp, 'backup.trava');
  try {
    await writeFile(trava, String(agora.toISOString()), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const { mtimeMs } = await stat(trava);
    const idade = Date.now() - mtimeMs;
    // Trava com data no futuro (relógio mexido) também é descartada.
    if (idade >= 0 && idade < TRAVA_VALIDADE_MS) {
      throw new Error(`Outro backup ou restauração está em andamento. Tente de novo mais tarde. Se nenhum estiver rodando, apague ${trava}.`);
    }
    await writeFile(trava, String(agora.toISOString()), { mode: 0o600 });
  }
  for (const n of await readdir(pastaTemp)) {
    if (/^(bkp|rest)-/.test(n)) await rm(join(pastaTemp, n), { recursive: true, force: true });
  }
  return () => rm(trava, { force: true });
}

// Confere que o arquivo exportado restaura de verdade, num SQLite temporário, antes de enviar.
async function conferirRestauravel(plano, tmp) {
  const caminho = join(tmp, 'conferencia.sqlite');
  const banco = await abrirBanco({ caminho });
  try {
    await importarBanco(banco, plano);
  } catch (e) {
    throw new Error(`O backup gerado não restaura e não foi enviado: ${e.message}`);
  } finally {
    await banco.fechar();
    for (const sufixo of ['', '-wal', '-shm']) await rm(`${caminho}${sufixo}`, { force: true });
  }
}

export const nomeBanco = agora => `${PREFIXO_BANCO}${agora.toISOString().replace(/:/g, '-').replace('.', '-')}.ndjson.gz.teb`;
// O nome autenticado do conteúdo é o nome do objeto sem a extensão .teb.
const conteudo = nome => nome.replace(/\.teb$/, '');

async function idsDeAnexos(pasta) {
  if (!pasta || !existsSync(pasta)) return [];
  return (await readdir(pasta)).map(n => ANEXO_RE.exec(n)?.[1]).filter(Boolean).sort();
}

// Faz o backup para todos os destinos. Um destino com erro não impede os outros.
export async function fazerBackup({ banco, pastaAnexos, chave, destinos, reter = 14, pastaTemp, agora = new Date(), log = () => {} }) {
  if (!destinos?.length) throw new Error('Nenhum destino de backup configurado. Veja docs/backups.md.');
  if (!Number.isInteger(reter) || reter < 1) throw new Error('A retenção precisa ser um número inteiro maior que zero.');
  const destravar = await travar(pastaTemp, agora);
  const tmp = await mkdtemp(join(pastaTemp, 'bkp-'));
  const relatorio = { nomeBanco: nomeBanco(agora), contagem: null, destinos: [] };
  try {
    const plano = join(tmp, 'banco.ndjson');
    relatorio.contagem = await exportarBanco(banco, plano, { agora });
    await conferirRestauravel(plano, tmp);
    const cifrado = join(tmp, 'banco.teb');
    await cifrarArquivo(plano, cifrado, { chave, nome: conteudo(relatorio.nomeBanco), gzip: true });
    await rm(plano);
    const bytesBanco = await readFile(cifrado);
    const ids = await idsDeAnexos(pastaAnexos);

    for (const d of destinos) {
      const r = { destino: d.nome, ok: false, banco: false, bancoPulado: false, anexosEnviados: 0, anexosJaExistiam: 0, apagados: 0, erro: null };
      relatorio.destinos.push(r);
      try {
        // Destino com intervalo (GitHub): só recebe o banco se o último backup dele já tem esse tempo.
        const ultimo = d.intervaloDias ? dataDoNome((await listarBackups(d))[0] || '') : null;
        if (ultimo && agora.getTime() - ultimo.getTime() < d.intervaloDias * DIA_MS && ultimo <= agora) {
          r.bancoPulado = true;
        } else {
          await d.enviar(relatorio.nomeBanco, bytesBanco);
          r.banco = true;
        }
        if (d.guardaAnexos && ids.length) {
          const existentes = new Set((await d.listar(PREFIXO_ANEXOS)).map(a => NOME_ANEXO_RE.exec(a.nome)?.[1]).filter(Boolean));
          for (const id of ids) {
            if (existentes.has(id)) { r.anexosJaExistiam++; continue; }
            const nome = `${PREFIXO_ANEXOS}${id}.bin.teb`;
            const saida = join(tmp, `${id}.teb`);
            await cifrarArquivo(join(pastaAnexos, `${id}.bin`), saida, { chave, nome: conteudo(nome) });
            await d.enviar(nome, await readFile(saida));
            await rm(saida);
            r.anexosEnviados++;
          }
        }
        // Nunca apaga o que acabou de enviar, mesmo com o relógio atrasado.
        const antigos = (await listarBackups(d)).filter(n => n !== relatorio.nomeBanco).slice(r.banco ? reter - 1 : reter);
        for (const nome of antigos) { await d.apagar(nome); r.apagados++; }
        r.ok = true;
        log(`${d.nome}: ${r.bancoPulado ? `banco pulado (intervalo de ${d.intervaloDias} dias)` : 'banco enviado'}, ${r.anexosEnviados} anexos novos, ${r.anexosJaExistiam} já existiam, ${r.apagados} backups antigos apagados.`);
      } catch (e) {
        r.erro = String(e?.message || e);
        log(`${d.nome}: FALHOU. ${r.erro}`);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await destravar();
  }
  relatorio.ok = relatorio.destinos.every(d => d.ok);
  return relatorio;
}

export async function listarBackups(destino) {
  return (await destino.listar(PREFIXO_BANCO)).map(a => a.nome).filter(n => NOME_BANCO_RE.test(n)).sort().reverse();
}

// Restaura de um destino para um banco NOVO e uma pasta de anexos. Nunca sobrescreve.
// `abrirDestinoBanco` recebe nada e devolve o banco vazio já aberto (SQLite novo ou Turso vazio).
export async function restaurar({ destino, chave, abrirDestinoBanco, pastaAnexos, nome, pastaTemp, log = () => {} }) {
  const lista = await listarBackups(destino);
  const escolhido = nome || lista[0];
  if (!escolhido) throw new Error(`${destino.nome}: nenhum backup do banco encontrado.`);
  if (!NOME_BANCO_RE.test(escolhido) || (nome && !lista.includes(nome))) throw new Error(`${destino.nome}: backup ${escolhido} não encontrado.`);
  const destravar = await travar(pastaTemp, new Date());
  const tmp = await mkdtemp(join(pastaTemp, 'rest-'));
  try {
    const cifrado = join(tmp, 'banco.teb');
    await writeFile(cifrado, await destino.baixar(escolhido), { mode: 0o600 });
    const plano = join(tmp, 'banco.ndjson');
    await decifrarArquivo(cifrado, plano, { chave, nome: conteudo(escolhido), gzip: true });
    const banco = await abrirDestinoBanco();
    let resultado;
    try {
      resultado = await importarBanco(banco, plano);
    } finally {
      await banco.fechar();
    }
    log(`Banco restaurado de ${escolhido}.`);
    let anexos = 0, anexosPulados = 0;
    if (destino.guardaAnexos && pastaAnexos) {
      await mkdir(pastaAnexos, { recursive: true });
      for (const a of await destino.listar(PREFIXO_ANEXOS)) {
        const id = NOME_ANEXO_RE.exec(a.nome)?.[1];
        if (!id) continue;
        const final = join(pastaAnexos, `${id}.bin`);
        if (existsSync(final)) { anexosPulados++; continue; }
        const baixado = join(tmp, `${id}.teb`);
        try {
          await writeFile(baixado, await destino.baixar(a.nome), { mode: 0o600 });
          await decifrarArquivo(baixado, final, { chave, nome: conteudo(a.nome) });
        } catch (e) {
          throw new Error(`Anexo ${id}: ${e.message} ${anexos} anexos já tinham sido restaurados.`);
        }
        await rm(baixado);
        anexos++;
      }
      log(`${anexos} anexos restaurados, ${anexosPulados} já existiam.`);
    }
    return { backup: escolhido, criadoEm: resultado.criadoEm, contagem: resultado.contagem, anexos, anexosPulados };
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await destravar();
  }
}
