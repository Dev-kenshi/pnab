// Rotina de backup e restauração.
// Banco: cópia completa a cada execução, compactada e cifrada, em banco/AAAA-MM-DDTHH-MM-SSZ.ndjson.gz.teb.
// Anexos: incrementais. Cada anexo nunca muda depois de gravado, então vai uma vez só, em anexos/<id>.bin.teb.
// Retenção: guarda os N backups de banco mais novos em cada destino. Anexos não são apagados.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cifrarArquivo, decifrarArquivo } from './cifra.js';
import { exportarBanco, importarBanco } from './exportar.js';

export const PREFIXO_BANCO = 'banco/';
export const PREFIXO_ANEXOS = 'anexos/';
const ANEXO_RE = /^([a-f0-9]{32})\.bin$/;
const NOME_BANCO_RE = /^banco\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?Z\.ndjson\.gz\.teb$/;
const NOME_ANEXO_RE = /^anexos\/([a-f0-9]{32})\.bin\.teb$/;

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
  await mkdir(pastaTemp, { recursive: true });
  const tmp = await mkdtemp(join(pastaTemp, 'bkp-'));
  const relatorio = { nomeBanco: nomeBanco(agora), contagem: null, destinos: [] };
  try {
    const plano = join(tmp, 'banco.ndjson');
    relatorio.contagem = await exportarBanco(banco, plano, { agora });
    const cifrado = join(tmp, 'banco.teb');
    await cifrarArquivo(plano, cifrado, { chave, nome: conteudo(relatorio.nomeBanco), gzip: true });
    await rm(plano);
    const bytesBanco = await readFile(cifrado);
    const ids = await idsDeAnexos(pastaAnexos);

    for (const d of destinos) {
      const r = { destino: d.nome, ok: false, banco: false, anexosEnviados: 0, anexosJaExistiam: 0, apagados: 0, erro: null };
      relatorio.destinos.push(r);
      try {
        await d.enviar(relatorio.nomeBanco, bytesBanco);
        r.banco = true;
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
        const antigos = (await d.listar(PREFIXO_BANCO)).map(a => a.nome).filter(n => NOME_BANCO_RE.test(n)).sort().reverse().slice(reter);
        for (const nome of antigos) { await d.apagar(nome); r.apagados++; }
        r.ok = true;
        log(`${d.nome}: banco enviado, ${r.anexosEnviados} anexos novos, ${r.anexosJaExistiam} já existiam, ${r.apagados} backups antigos apagados.`);
      } catch (e) {
        r.erro = String(e?.message || e);
        log(`${d.nome}: FALHOU. ${r.erro}`);
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
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
  await mkdir(pastaTemp, { recursive: true });
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
        await writeFile(baixado, await destino.baixar(a.nome), { mode: 0o600 });
        await decifrarArquivo(baixado, final, { chave, nome: conteudo(a.nome) });
        await rm(baixado);
        anexos++;
      }
      log(`${anexos} anexos restaurados, ${anexosPulados} já existiam.`);
    }
    return { backup: escolhido, criadoEm: resultado.criadoEm, contagem: resultado.contagem, anexos, anexosPulados };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
