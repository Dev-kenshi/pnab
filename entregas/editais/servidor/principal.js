// Sistema Integrado TEB: servidor de editais culturais.
// Emanuel Macêdo Luz, desenvolvedor do projeto.
//
// Uso:
//   node servidor/principal.js                    sobe o servidor
//   node servidor/principal.js criar-plataforma   cria a conta da plataforma (se já existe, só avisa)
//   node servidor/principal.js garantir-plataforma  o mesmo, para rodar a cada subida (Replit)
//   node servidor/principal.js semear-exemplo     cria o exemplo de teste (TEB_EXEMPLO_SENHA), idempotente
//   node servidor/principal.js backup             faz o backup cifrado nos destinos configurados
//   node servidor/principal.js migrar-anexos      copia os anexos do disco para o Cloudflare R2
//   node servidor/principal.js criar-pasta-drive  cria a pasta do backup no Google Drive e mostra o ID
//   node servidor/principal.js restaurar <destino> [nome-do-backup]
//                                                 restaura num banco e numa pasta NOVOS (veja docs/backups.md)
// Variáveis em .env.example. Nenhum segredo fica no código.
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarApp } from './app.js';
import { emailDoAmbiente } from './email.js';
import { registrar } from './auditoria.js';
import { abrirBanco } from './banco.js';
import { randomBytes } from 'node:crypto';
import { armazemDoAmbiente, criarArmazemDisco, lerChave, migrarAnexos } from './anexos.js';
import { lerChaveBackup } from './backup/cifra.js';
import { destinosDoAmbiente, googleDrive } from './backup/destinos.js';
import { fazerBackup, listarBackups, restaurar } from './backup/rotina.js';
import { ipPadrao } from './seguranca.js';
import * as regras from '../js/regras.js';
import { garantirContaPlataforma, loginPlataformaDoAmbiente } from './conta-plataforma.js';
import { semearExemplo } from './exemplo.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arquivoEnv = resolve(RAIZ, '.env');
if (existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const env = process.env;
const caminho = v => resolve(RAIZ, v);

function sair(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

async function abrir() {
  return abrirBanco({
    caminho: caminho(env.TEB_BANCO || 'servidor/dados/teb.sqlite'),
    tursoUrl: env.TURSO_DATABASE_URL,
    tursoToken: env.TURSO_AUTH_TOKEN,
  });
}

// criar-plataforma e garantir-plataforma: idempotentes. Se a conta já existe, só avisa e sai com código 0.
async function criarPlataforma() {
  const banco = await abrir();
  try {
    const r = await garantirContaPlataforma(banco, env);
    console.log(r.criada ? `${r.mensagem} Guarde TEB_PLATAFORMA_SENHA só nos Secrets, nunca no código.` : r.mensagem);
  } finally {
    await banco.fechar();
  }
}

// Exemplo de teste. Imprime os CPFs criados, nunca a senha.
function logExemplo(r, prefixo = '') {
  console.log(`${prefixo}${r.criada ? 'Exemplo criado' : 'O exemplo já existe. Nada foi alterado'}: ${r.organizacao.nome} (${r.organizacao.slug}).`);
  for (const c of r.contas) console.log(`${prefixo}  ${c.papel}: CPF ${regras.formatarDocumento(c.documento)} (${c.nome})`);
  if (r.criada) console.log(`${prefixo}A senha das três contas é a de TEB_EXEMPLO_SENHA, guardada só nos Secrets.`);
}

async function semearExemploComando() {
  if (!env.TEB_EXEMPLO_SENHA) sair('Defina TEB_EXEMPLO_SENHA (nos Secrets ou no .env local) para criar o exemplo. Nada foi criado.');
  const banco = await abrir();
  try {
    logExemplo(await semearExemplo(banco, { senha: env.TEB_EXEMPLO_SENHA, agora: new Date(), ip: 'linha-de-comando' }));
  } finally {
    await banco.fechar();
  }
}

function configBackup() {
  const chaveAnexos = env.TEB_CHAVE_ANEXOS ? lerChave(env.TEB_CHAVE_ANEXOS) : null;
  const chave = lerChaveBackup(env.TEB_CHAVE_BACKUP, chaveAnexos);
  const reter = Number(env.TEB_BACKUP_RETER || 14);
  return {
    chave,
    reter,
    destinos: destinosDoAmbiente(env),
    // Os anexos vêm do armazém em uso (disco ou R2). O backup não decifra anexos: sem a chave dos anexos,
    // uma chave qualquer só satisfaz o construtor, porque o backup lê os bytes já cifrados.
    anexos: armazemDoAmbiente(env, { chave: chaveAnexos ?? randomBytes(32), pastaPadrao: caminho(env.TEB_ANEXOS || 'servidor/dados/anexos') }),
    pastaTemp: caminho(env.TEB_BACKUP_TEMP || 'servidor/dados/tmp-backup'),
  };
}

async function rodarBackup(banco) {
  const cfg = configBackup();
  const agora = new Date();
  const r = await fazerBackup({ banco, ...cfg, agora, log: m => console.log(`[backup] ${m}`) });
  await registrar(banco, {
    agora, usuarioId: null, acao: r.ok ? 'backup_ok' : 'backup_falhou', alvo: r.nomeBanco,
    detalhe: { destinos: r.destinos.map(d => ({ destino: d.destino, ok: d.ok, anexosEnviados: d.anexosEnviados })) }, ip: 'rotina',
  });
  return r;
}

async function backup() {
  const banco = await abrir();
  try {
    const r = await rodarBackup(banco);
    if (!r.ok) sair('Backup terminou com falha em pelo menos um destino. Veja as linhas [backup] acima.');
    console.log(`Backup concluído: ${r.nomeBanco} em ${r.destinos.length} destinos.`);
  } finally {
    await banco.fechar();
  }
}

async function restaurarComando(chaveDestino, nome) {
  const cfg = configBackup();
  const destino = cfg.destinos.find(d => d.chave === chaveDestino);
  if (!destino) sair(`Destino "${chaveDestino || ''}" não configurado. Use um destes: ${cfg.destinos.map(d => d.chave).join(', ') || 'nenhum configurado'}.`);
  if (nome === '--listar') {
    for (const n of await listarBackups(destino)) console.log(n);
    return;
  }
  const alvo = caminho(env.TEB_RESTAURAR_BANCO || 'servidor/dados/restaurado.sqlite');
  const pastaAnexos = caminho(env.TEB_RESTAURAR_ANEXOS || 'servidor/dados/anexos-restaurados');
  if (existsSync(alvo)) sair(`${alvo} já existe. A restauração nunca sobrescreve. Apague ou escolha outro TEB_RESTAURAR_BANCO.`);
  let r;
  try {
    r = await restaurar({
      destino, chave: cfg.chave, nome, pastaAnexos, pastaTemp: cfg.pastaTemp,
      abrirDestinoBanco: () => abrirBanco({ caminho: alvo }),
      log: m => console.log(`[restaurar] ${m}`),
    });
  } catch (e) {
    // Restauração pela metade não fica no disco: o banco novo é apagado para a próxima tentativa.
    for (const sufixo of ['', '-wal', '-shm']) await rm(`${alvo}${sufixo}`, { force: true });
    throw new Error(`${e.message} O banco restaurado pela metade foi apagado. Anexos já gravados em ${pastaAnexos} são reaproveitados na próxima tentativa.`);
  }
  console.log(`Restaurado ${r.backup} (criado em ${r.criadoEm}) em ${alvo}. Anexos em ${pastaAnexos}.`);
  console.log('Confira, depois aponte TEB_BANCO e TEB_ANEXOS para esses caminhos e suba o servidor.');
}

async function criarPastaDrive() {
  const faltam = ['TEB_GDRIVE_CLIENT_ID', 'TEB_GDRIVE_CLIENT_SECRET', 'TEB_GDRIVE_REFRESH_TOKEN'].filter(n => !env[n]);
  if (faltam.length) sair(`Preencha antes: ${faltam.join(', ')}.`);
  const drive = googleDrive({ clientId: env.TEB_GDRIVE_CLIENT_ID, clientSecret: env.TEB_GDRIVE_CLIENT_SECRET, refreshToken: env.TEB_GDRIVE_REFRESH_TOKEN, pastaId: '' });
  const id = await drive.criarPasta('Backup Sistema Integrado TEB');
  console.log(`Pasta criada. Coloque em TEB_GDRIVE_PASTA_ID: ${id}`);
}

async function servir() {
  let chave;
  try { chave = lerChave(env.TEB_CHAVE_ANEXOS); } catch (e) { sair(e.message); }
  let loginPlataforma;
  try { loginPlataforma = loginPlataformaDoAmbiente(env); } catch (e) { sair(e.message); }
  const banco = await abrir();
  // Com TEB_PLATAFORMA_SENHA no ambiente, a subida garante a conta. Se já existe, só avisa.
  // Configuração errada para a subida com a mensagem, para não ficar escondida.
  if (env.TEB_PLATAFORMA_SENHA) {
    try { console.log(`[plataforma] ${(await garantirContaPlataforma(banco, env, { ip: 'subida' })).mensagem}`); } catch (e) { await banco.fechar(); sair(`[plataforma] ${e.message}`); }
  }
  // Exemplo de teste opcional. O disco do Replit publicado pode ser zerado a cada reinício, por isso roda na subida.
  if (env.TEB_SEMEAR_EXEMPLO === '1') {
    if (!env.TEB_EXEMPLO_SENHA) { await banco.fechar(); sair('[exemplo] TEB_SEMEAR_EXEMPLO=1 exige TEB_EXEMPLO_SENHA nos Secrets. Defina a senha ou apague TEB_SEMEAR_EXEMPLO.'); }
    try { logExemplo(await semearExemplo(banco, { senha: env.TEB_EXEMPLO_SENHA, agora: new Date(), ip: 'subida' }), '[exemplo] '); } catch (e) { await banco.fechar(); sair(`[exemplo] ${e.message}`); }
  }
  if (loginPlataforma) console.log(`[plataforma] Login de teste ligado: usuário "${loginPlataforma.usuario}". Desligue apagando TEB_PLATAFORMA_LOGIN.`);
  let anexos;
  try { anexos = armazemDoAmbiente(env, { chave, pastaPadrao: caminho(env.TEB_ANEXOS || 'servidor/dados/anexos') }); } catch (e) { sair(e.message); }
  const porta = Number(env.PORTA || 3000);
  let enviarEmail;
  try { enviarEmail = emailDoAmbiente(env); } catch (e) { sair(e.message); }
  const app = criarApp({
    enviarEmail,
    banco,
    anexos,
    https: env.TEB_HTTPS === '1',
    ipDe: ipPadrao({ confiarProxy: env.TEB_CONFIAR_PROXY === '1' }),
    loginPlataforma,
    urlPublica: String(env.TEB_URL_PUBLICA || `http://localhost:${porta}`).replace(/\/+$/, ''),
  });
  const servidor = createServer({ requestTimeout: 60000, headersTimeout: 20000 }, app);
  servidor.listen(porta, () => console.log(`Sistema Integrado TEB no ar na porta ${porta}. Banco: ${banco.tipo}. Anexos: ${anexos.tipo}.`));
  // No Replit publicado, o disco é refeito a cada publicação: anexos em disco se perdem.
  if (env.REPL_ID && anexos.tipo === 'disco') {
    console.warn('[aviso] Replit com anexos em disco: eles somem a cada publicação. Configure TEB_R2_* (docs/backups.md) e rode migrar-anexos.');
  }
  // Backup automático opcional dentro do servidor. Em produção prefira um agendador externo.
  const horas = Number(env.TEB_BACKUP_INTERVALO_HORAS || 0);
  let relogioBackup = null;
  if (horas > 0) {
    try { configBackup(); } catch (e) { sair(`Backup automático: ${e.message}`); }
    relogioBackup = setInterval(() => rodarBackup(banco).catch(e => console.error(`[backup] erro: ${e.message}`)), horas * 60 * 60 * 1000);
    relogioBackup.unref();
    console.log(`Backup automático a cada ${horas} h.`);
  }
  const parar = () => servidor.close(async () => { clearInterval(relogioBackup); await banco.fechar(); process.exit(0); });
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}

// Copia os anexos do disco (TEB_ANEXOS) para o Cloudflare R2, sem decifrar. Pode rodar de novo: pula os que já foram.
async function migrarAnexosComando() {
  let chave;
  try { chave = lerChave(env.TEB_CHAVE_ANEXOS); } catch (e) { sair(e.message); }
  const pasta = caminho(env.TEB_ANEXOS || 'servidor/dados/anexos');
  const destino = armazemDoAmbiente(env, { chave, pastaPadrao: pasta });
  if (destino.tipo !== 'r2') sair('Preencha as variáveis TEB_R2_* antes de migrar. Veja docs/backups.md.');
  const origem = criarArmazemDisco({ pasta, chave });
  const r = await migrarAnexos(origem, destino, { log: m => console.log(`[migrar] ${m}`) });
  console.log(`Migração concluída: ${r.copiados} anexos copiados para o R2, ${r.pulados} já estavam lá.`);
  console.log(`Confira um download pelo sistema. Os arquivos em ${pasta} podem ser apagados depois.`);
}

const comando = process.argv[2];
if (comando === 'criar-plataforma' || comando === 'garantir-plataforma') await criarPlataforma().catch(e => sair(e.message));
else if (comando === 'semear-exemplo') await semearExemploComando().catch(e => sair(e.message));
else if (comando === 'backup') await backup().catch(e => sair(e.message));
else if (comando === 'migrar-anexos') await migrarAnexosComando().catch(e => sair(e.message));
else if (comando === 'criar-pasta-drive') await criarPastaDrive().catch(e => sair(e.message));
else if (comando === 'restaurar') await restaurarComando(process.argv[3], process.argv[4]).catch(e => sair(e.message));
else if (!comando) await servir();
else sair(`Comando desconhecido: ${comando}`);
