// Cifra dos backups: AES-256-GCM em fluxo, sem carregar o arquivo inteiro na memória.
// Formato: "TEBB" (4 bytes), versão (1 byte), IV (12 bytes), texto cifrado, tag (16 bytes).
// O nome do objeto entra como dado autenticado: trocar um arquivo de lugar faz a leitura falhar.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const MAGICO = Buffer.from('TEBB');
const VERSAO = 1;
const CABECALHO = MAGICO.length + 1 + 12;
const TAG = 16;

export function lerChaveBackup(base64, chaveAnexos) {
  if (!base64) throw new Error('Defina TEB_CHAVE_BACKUP com 32 bytes em base64.');
  const chave = Buffer.from(String(base64), 'base64');
  if (chave.length !== 32) throw new Error('TEB_CHAVE_BACKUP precisa ter exatamente 32 bytes em base64.');
  if (chaveAnexos && chaveAnexos.length === chave.length && timingSafeEqual(chaveAnexos, chave)) {
    throw new Error('TEB_CHAVE_BACKUP precisa ser diferente de TEB_CHAVE_ANEXOS.');
  }
  return chave;
}

const aad = nome => Buffer.concat([MAGICO, Buffer.from([VERSAO]), Buffer.from(String(nome), 'utf8')]);

function conferirChave(chave) {
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('A chave do backup precisa ter 32 bytes.');
}

// Cifra `origem` em `destino`. Com gzip, compacta antes de cifrar.
export async function cifrarArquivo(origem, destino, { chave, nome, gzip = false }) {
  conferirChave(chave);
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(aad(nome));
  const etapas = [createReadStream(origem)];
  if (gzip) etapas.push(createGzip({ level: 6 }));
  etapas.push(async function* (fonte) {
    yield Buffer.concat([MAGICO, Buffer.from([VERSAO]), iv]);
    for await (const pedaco of fonte) yield cifra.update(pedaco);
    yield cifra.final();
    yield cifra.getAuthTag();
  });
  etapas.push(createWriteStream(destino, { mode: 0o600 }));
  await pipeline(etapas);
}

// Decifra `origem` em `destino`. Escreve num arquivo temporário e só renomeia depois que a tag confere.
export async function decifrarArquivo(origem, destino, { chave, nome, gzip = false }) {
  conferirChave(chave);
  const { size } = await stat(origem);
  if (size < CABECALHO + TAG) throw new Error('Backup corrompido: arquivo curto demais.');
  const fh = await open(origem, 'r');
  const cab = Buffer.alloc(CABECALHO);
  const tag = Buffer.alloc(TAG);
  try {
    await fh.read(cab, 0, CABECALHO, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  if (!cab.subarray(0, 4).equals(MAGICO)) throw new Error('Backup corrompido: não é um arquivo do Sistema Integrado TEB.');
  if (cab[4] !== VERSAO) throw new Error(`Versão de backup desconhecida: ${cab[4]}.`);
  const decifra = createDecipheriv('aes-256-gcm', chave, cab.subarray(5));
  decifra.setAAD(aad(nome));
  decifra.setAuthTag(tag);
  const temporario = `${destino}.parcial`;
  const etapas = [createReadStream(origem, { start: CABECALHO, end: size - TAG - 1 }), decifra];
  if (gzip) etapas.push(createGunzip());
  etapas.push(createWriteStream(temporario, { mode: 0o600 }));
  try {
    await pipeline(size - TAG - CABECALHO === 0 ? [vazio(), decifra, ...etapas.slice(2)] : etapas);
  } catch (e) {
    await rm(temporario, { force: true });
    if (/auth|unsupported state/i.test(String(e?.message))) throw new Error('Backup adulterado ou chave errada: a verificação AES-GCM falhou.');
    throw e;
  }
  await rename(temporario, destino);
}

async function* vazio() {}
