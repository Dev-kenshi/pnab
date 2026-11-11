// Anexos em disco cifrados com AES-256-GCM.
// Arquivo = IV de 12 bytes, tag de 16 bytes e texto cifrado. O id entra como dado autenticado.
// Interface { gravar, ler, apagar } para permitir um adaptador R2 depois.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[a-f0-9]{32}$/;

export function lerChave(base64) {
  if (!base64) throw new Error('Defina TEB_CHAVE_ANEXOS com 32 bytes em base64.');
  const chave = Buffer.from(String(base64), 'base64');
  if (chave.length !== 32) throw new Error('TEB_CHAVE_ANEXOS precisa ter exatamente 32 bytes em base64.');
  return chave;
}

export function criarArmazemDisco({ pasta, chave }) {
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('A chave dos anexos precisa ter 32 bytes.');
  const caminho = id => {
    if (!ID_RE.test(String(id))) throw new Error('Id de anexo inválido.');
    return join(pasta, `${id}.bin`);
  };
  return {
    async gravar(bytes) {
      await mkdir(pasta, { recursive: true });
      const id = randomBytes(16).toString('hex');
      const iv = randomBytes(12);
      const cifra = createCipheriv('aes-256-gcm', chave, iv);
      cifra.setAAD(Buffer.from(id));
      const cifrado = Buffer.concat([cifra.update(bytes), cifra.final()]);
      await writeFile(caminho(id), Buffer.concat([iv, cifra.getAuthTag(), cifrado]), { flag: 'wx', mode: 0o600 });
      return id;
    },
    async ler(id) {
      const dados = await readFile(caminho(id));
      if (dados.length < 28) throw new Error('Anexo corrompido.');
      const decifra = createDecipheriv('aes-256-gcm', chave, dados.subarray(0, 12));
      decifra.setAAD(Buffer.from(id));
      decifra.setAuthTag(dados.subarray(12, 28));
      return Buffer.concat([decifra.update(dados.subarray(28)), decifra.final()]);
    },
    async apagar(id) {
      await rm(caminho(id), { force: true });
    },
    caminho,
  };
}
