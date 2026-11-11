// Sistema Integrado TEB: servidor de editais culturais.
// Emanuel Macêdo Luz, desenvolvedor do projeto.
//
// Uso:
//   node servidor/principal.js                    sobe o servidor
//   node servidor/principal.js criar-plataforma   cria a conta da plataforma
//   node servidor/principal.js backup             faz o backup cifrado nos destinos configurados
//   node servidor/principal.js criar-pasta-drive  cria a pasta do backup no Google Drive e mostra o ID
//   node servidor/principal.js restaurar <destino> [nome-do-backup]
//                                                 restaura num banco e numa pasta NOVOS (veja docs/backups.md)
// Variáveis em .env.example. Nenhum segredo fica no código.
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as regras from '../js/regras.js';
import { criarApp } from './app.js';
import { registrar } from './auditoria.js';
import { abrirBanco } from './banco.js';
import { criarArmazemDisco, lerChave } from './anexos.js';
import { lerChaveBackup } from './backup/cifra.js';
import { destinosDoAmbiente, googleDrive } from './backup/destinos.js';
import { fazerBackup, listarBackups, restaurar } from './backup/rotina.js';
import { DOCUMENTOS_RESERVADOS, SENHA_PROIBIDA, ipPadrao } from './seguranca.js';
import { inserirUsuario } from './rotas/acesso.js';

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

async function criarPlataforma() {
  const documento = regras.somenteDigitos(env.TEB_PLATAFORMA_DOCUMENTO);
  const nome = String(env.TEB_PLATAFORMA_NOME || '').trim();
  const email = String(env.TEB_PLATAFORMA_EMAIL || '').trim().toLowerCase();
  const senha = env.TEB_PLATAFORMA_SENHA || '';
  if (!regras.validarDocumento(documento).valido) sair('TEB_PLATAFORMA_DOCUMENTO precisa ser um CPF ou CNPJ válido.');
  if (DOCUMENTOS_RESERVADOS.has(documento)) sair('Esse documento é reservado para o modo demonstração.');
  if (!nome || !email) sair('Preencha TEB_PLATAFORMA_NOME e TEB_PLATAFORMA_EMAIL.');
  if (senha === SENHA_PROIBIDA) sair('Essa senha é de demonstração. Escolha outra.');
  const msg = regras.validarSenha(senha, { papel: 'plataforma', documento, nome, email });
  if (msg) sair(msg);
  const banco = await abrir();
  const agora = new Date();
  const id = await inserirUsuario(banco, { organizacaoId: null, papel: 'plataforma', nome, documento, email, senha, agora });
  await registrar(banco, { agora, usuarioId: id, acao: 'conta_criada', alvo: documento, detalhe: { papel: 'plataforma' }, ip: 'linha-de-comando' });
  await banco.fechar();
  console.log(`Conta da plataforma criada para ${nome}. Apague TEB_PLATAFORMA_SENHA do ambiente depois do primeiro acesso.`);
}

function configBackup() {
  const chaveAnexos = env.TEB_CHAVE_ANEXOS ? lerChave(env.TEB_CHAVE_ANEXOS) : null;
  const chave = lerChaveBackup(env.TEB_CHAVE_BACKUP, chaveAnexos);
  const reter = Number(env.TEB_BACKUP_RETER || 14);
  return {
    chave,
    reter,
    destinos: destinosDoAmbiente(env),
    pastaAnexos: caminho(env.TEB_ANEXOS || 'servidor/dados/anexos'),
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
  const banco = await abrir();
  const anexos = criarArmazemDisco({ pasta: caminho(env.TEB_ANEXOS || 'servidor/dados/anexos'), chave });
  const porta = Number(env.PORTA || 3000);
  const app = criarApp({
    banco,
    anexos,
    https: env.TEB_HTTPS === '1',
    ipDe: ipPadrao({ confiarProxy: env.TEB_CONFIAR_PROXY === '1' }),
    urlPublica: String(env.TEB_URL_PUBLICA || `http://localhost:${porta}`).replace(/\/+$/, ''),
  });
  const servidor = createServer({ requestTimeout: 60000, headersTimeout: 20000 }, app);
  servidor.listen(porta, () => console.log(`Sistema Integrado TEB no ar na porta ${porta}. Banco: ${banco.tipo}.`));
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

const comando = process.argv[2];
if (comando === 'criar-plataforma') await criarPlataforma().catch(e => sair(e.message));
else if (comando === 'backup') await backup().catch(e => sair(e.message));
else if (comando === 'criar-pasta-drive') await criarPastaDrive().catch(e => sair(e.message));
else if (comando === 'restaurar') await restaurarComando(process.argv[3], process.argv[4]).catch(e => sair(e.message));
else if (!comando) await servir();
else sair(`Comando desconhecido: ${comando}`);
