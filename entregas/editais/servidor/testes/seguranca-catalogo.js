// Catálogo das 100 validações de segurança. Não é arquivo de teste: seguranca-100.test.js roda cada item.
// Cada item liga a validação a uma seção do manual (repositório danieldonda/Cybersecurity101, README,
// "Fundamentos de Cibersegurança" e "Frameworks e Melhores Práticas") e a uma subcategoria do NIST CSF 2.0.
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gerarCPF, pdfMinimo, SENHA } from './ajuda.js';
import { hashToken, ipPadrao, verificarSenha } from '../seguranca.js';
import { lerChave } from '../anexos.js';
import { cifrarArquivo, decifrarArquivo, lerChaveBackup } from '../backup/cifra.js';
import { exportarBanco } from '../backup/exportar.js';
import { emailDesligado } from '../email.js';

export const MANUAL = {
  CIA: 'Fundamentos > Conceitos de Segurança (triângulo CIA)',
  CRIPTO: 'Fundamentos > Criptografia',
  IAM: 'Fundamentos > Gestão de Identidade e Acesso (AAA, RBAC)',
  DEV: 'Fundamentos > Desenvolvimento Seguro (OWASP Top 10)',
  INCIDENTE: 'Fundamentos > Resposta a Incidentes',
  LGPD: 'Fundamentos > Legislação e Ética (LGPD)',
  REDES: 'Fundamentos > Redes e Monitoramento',
  FRAMEWORKS: 'Frameworks e Melhores Práticas (NIST, OWASP, CIS)',
};

let seq = 400000000;
const novoCPF = () => gerarCPF(seq++);
const SENHA_FORTE = 'Lua-cheia-sobre-o-rio-7';

// Cria uma conta de proponente pela API e devolve o cliente já logado.
async function novaConta(c, extra = {}) {
  const cli = c.amb.cliente();
  const documento = novoCPF();
  const r = await cli.pedir('POST', '/api/acesso/criar-conta', {
    organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'Conta Teste Seguranca', documento, email: `s${documento}@teste.example`,
    telefone: '71900000000', senha: SENHA_FORTE, senhaConfirmacao: SENHA_FORTE, ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  return { cli, documento, usuario: r.corpo.usuario };
}

const upload = (cli, id, bytes, { nome = 'portfolio.pdf', tipo = 'application/pdf' } = {}) =>
  cli.pedir('POST', `/api/inscricoes/${id}/anexos/extra-portfolio`, undefined, { bruto: bytes, cabecalhos: { 'content-type': tipo, 'x-nome-arquivo': encodeURIComponent(nome) } });

const naoOk = (r, msg) => assert.ok(r.status === 403 || r.status === 404, `${msg}: ${r.status}`);
const acoes = async c => (await c.amb.banco.executar('SELECT acao FROM auditoria')).linhas.map(l => l.acao);

export const CATALOGO = [
  // Gestão de Identidade e Acesso: senhas
  { id: 'SEG-001', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Senha guardada com scrypt nos parâmetros da OWASP (N=2^14, r=8, p=5)', fn: async c => {
    const { linhas } = await c.amb.banco.executar('SELECT senha_hash FROM usuarios WHERE documento = ?', [c.amb.contas.a.proponente.documento]);
    assert.ok(linhas[0].senha_hash.startsWith('scrypt$16384$8$5$'));
  } },
  { id: 'SEG-002', manual: MANUAL.CRIPTO, csf: 'PR.AA-01', titulo: 'Sal único: mesma senha gera hashes diferentes', fn: async c => {
    const { linhas } = await c.amb.banco.executar('SELECT senha_hash FROM usuarios');
    assert.equal(new Set(linhas.map(l => l.senha_hash)).size, linhas.length);
  } },
  { id: 'SEG-003', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'Nenhuma senha em texto no banco', fn: async c => {
    const { linhas } = await c.amb.banco.executar('SELECT * FROM usuarios');
    assert.ok(!JSON.stringify(linhas).includes(SENHA));
  } },
  { id: 'SEG-004', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Senha errada e documento sem conta dão a mesma resposta e o mesmo tempo', fn: async c => {
    const { documento } = await novaConta(c);
    const medir = async doc => {
      const t = performance.now();
      const r = await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: doc, senha: 'Errada-mas-longa-1' });
      return { r, ms: performance.now() - t };
    };
    const comConta = [], semConta = [];
    for (let i = 0; i < 3; i++) { comConta.push(await medir(documento)); semConta.push(await medir(novoCPF())); }
    assert.equal(comConta[0].r.status, 401);
    assert.deepEqual(comConta[0].r.corpo, semConta[0].r.corpo);
    // Sem conta, o servidor também calcula um scrypt: o tempo não denuncia quem tem cadastro.
    const menor = l => Math.min(...l.map(x => x.ms));
    assert.ok(menor(semConta) >= menor(comConta) * 0.5, `sem conta ${menor(semConta)} ms, com conta ${menor(comConta)} ms`);
  } },
  { id: 'SEG-005', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Cinco erros no mesmo documento bloqueiam o login por 15 minutos', fn: async c => {
    const { documento } = await novaConta(c);
    for (let i = 0; i < 5; i++) assert.equal((await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento, senha: 'Errada-mas-longa-1' })).status, 401);
    assert.equal((await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento, senha: SENHA_FORTE })).status, 429);
    // Em paralelo: 30 tentativas ao mesmo tempo, com a senha certa no fim, não passam do limite.
    const outra = (await novaConta(c)).documento;
    const tentativas = Array.from({ length: 30 }, (_, i) => c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: outra, senha: i === 29 ? SENHA_FORTE : `Errada-mas-longa-${i}` }));
    const status = (await Promise.all(tentativas)).map(r => r.status);
    assert.equal(status.filter(x => x === 401).length, 5, status.join(','));
    assert.equal(status.filter(x => x === 200).length, 0, status.join(','));
  } },
  { id: 'SEG-006', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Cinco erros do mesmo IP em documentos diferentes bloqueiam o IP', fn: async c => {
    const cli = c.amb.cliente();
    for (let i = 0; i < 5; i++) await cli.pedir('POST', '/api/acesso/entrar', { documento: novoCPF(), senha: 'Errada-mas-longa-1' });
    assert.equal((await cli.pedir('POST', '/api/acesso/entrar', { documento: c.amb.contas.a.proponente.documento, senha: SENHA })).status, 429);
    // Atrás de proxy, o IP é o último item de X-Forwarded-For; os anteriores podem ser forjados.
    const ip = ipPadrao({ confiarProxy: true });
    assert.equal(ip({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, socket: {} }), '203.0.113.9');
    assert.equal(ipPadrao({ confiarProxy: false })({ headers: { 'x-forwarded-for': '6.6.6.6' }, socket: { remoteAddress: '10.0.0.5' } }), '10.0.0.5');
  } },
  { id: 'SEG-007', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Hash malformado nunca confere e não lança erro', fn: async () => {
    for (const h of ['', 'texto', 'scrypt$x$y$z$a$b', 'bcrypt$1$2$3$4$5', null]) assert.equal(await verificarSenha('qualquer', h), false);
  } },
  { id: 'SEG-008', manual: MANUAL.CIA, csf: 'PR.AA-01', titulo: 'Hash com custo absurdo é recusado sem travar o servidor', fn: async () => {
    const t = Date.now();
    assert.equal(await verificarSenha('x', `scrypt$1073741824$8$1$${randomBytes(16).toString('base64')}$${randomBytes(64).toString('base64')}`), false);
    assert.ok(Date.now() - t < 1000);
  } },
  { id: 'SEG-009', manual: MANUAL.CRIPTO, csf: 'PR.AA-01', titulo: 'Senha com parâmetros antigos é refeita no próximo login', fn: async c => {
    const { documento, cli } = await novaConta(c);
    const sal = randomBytes(16);
    const antigo = `scrypt$16384$8$1$${sal.toString('base64')}$${scryptSync(SENHA_FORTE, sal, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
    await c.amb.banco.executar('UPDATE usuarios SET senha_hash = ? WHERE documento = ?', [antigo, documento]);
    assert.equal((await cli.pedir('POST', '/api/acesso/entrar', { documento, senha: SENHA_FORTE })).status, 200);
    const { linhas } = await c.amb.banco.executar('SELECT senha_hash FROM usuarios WHERE documento = ?', [documento]);
    assert.ok(linhas[0].senha_hash.startsWith('scrypt$16384$8$5$'));
  } },
  { id: 'SEG-010', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Senha com menos de 10 caracteres é recusada', fn: async c => {
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/criar-conta', { organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'X Teste', documento: novoCPF(), email: 'x@teste.example', telefone: '71900000000', senha: 'Curta-12', senhaConfirmacao: 'Curta-12' });
    assert.equal(r.status, 400);
    assert.match(r.corpo.campos.find(x => x.campo === 'senha').mensagem, /10 caracteres/);
  } },
  { id: 'SEG-011', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Senha comum de vazamentos é recusada', fn: async c => {
    for (const senha of ['Senha12345', 'flamengo2026', '1234567890', 'qwertyuiop']) {
      const r = await c.amb.cliente().pedir('POST', '/api/acesso/criar-conta', { organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'X Teste', documento: novoCPF(), email: 'x@teste.example', telefone: '71900000000', senha, senhaConfirmacao: senha });
      assert.equal(r.status, 400, senha);
    }
  } },
  { id: 'SEG-012', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Senha com o próprio CPF é recusada', fn: async c => {
    const documento = novoCPF();
    const senha = `doc${documento}x`;
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/criar-conta', { organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'X Teste', documento, email: 'x@teste.example', telefone: '71900000000', senha, senhaConfirmacao: senha });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.corpo), /CPF ou CNPJ/);
  } },
  { id: 'SEG-013', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Conta da equipe exige 12 caracteres', fn: async c => {
    const r = await c.gA.pedir('POST', '/api/gestor/avaliadores', { nome: 'Banca Nova', documento: novoCPF(), email: 'b@teste.example', senha: 'Onze-chars1' });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.corpo), /12 caracteres/);
  } },
  { id: 'SEG-014', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Senha de demonstração não vale no servidor real', fn: async c => {
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/criar-conta', { organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'X Teste', documento: novoCPF(), email: 'x@teste.example', telefone: '71900000000', senha: 'Exemplo#2026', senhaConfirmacao: 'Exemplo#2026' });
    assert.equal(r.corpo.erro, 'senha_proibida');
  } },
  { id: 'SEG-015', manual: MANUAL.IAM, csf: 'PR.AA-01', titulo: 'Contas de demonstração não existem no servidor real', fn: async c => {
    assert.equal((await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: '52998224725', senha: 'Exemplo#2026' })).status, 401);
  } },
  { id: 'SEG-016', manual: MANUAL.IAM, csf: 'PR.AA-02', titulo: 'Documentos reservados da demonstração não criam conta', fn: async c => {
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/criar-conta', { organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'X Teste', documento: '11144477735', email: 'x@teste.example', telefone: '71900000000', senha: SENHA_FORTE, senhaConfirmacao: SENHA_FORTE });
    assert.equal(r.corpo.erro, 'documento_reservado');
  } },

  // Gestão de Identidade e Acesso: sessão
  { id: 'SEG-017', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Cookie de sessão é HttpOnly', fn: async c => assert.match(c.cookieLogin, /HttpOnly/) },
  { id: 'SEG-018', manual: MANUAL.DEV, csf: 'PR.AA-03', titulo: 'Cookie de sessão é SameSite=Strict', fn: async c => assert.match(c.cookieLogin, /SameSite=Strict/) },
  { id: 'SEG-019', manual: MANUAL.CRIPTO, csf: 'PR.DS-02', titulo: 'Com HTTPS o cookie leva Secure', fn: async c => {
    const r = await c.https.cliente().pedir('POST', '/api/acesso/entrar', { documento: c.https.contas.a.proponente.documento, senha: SENHA });
    assert.match(r.setCookie[0], /; Secure/);
  } },
  { id: 'SEG-020', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Sessão dura no máximo 8 horas', fn: async c => assert.match(c.cookieLogin, /Max-Age=28800/) },
  { id: 'SEG-021', manual: MANUAL.CRIPTO, csf: 'PR.AA-03', titulo: 'Token de sessão tem 256 bits aleatórios', fn: async c => {
    const token = c.cookieLogin.split(';')[0].split('=')[1];
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token));
  } },
  { id: 'SEG-022', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'Banco guarda só o hash do token de sessão', fn: async c => {
    const token = c.cookieLogin.split(';')[0].split('=')[1];
    const { linhas } = await c.amb.banco.executar('SELECT token_hash FROM sessoes');
    assert.ok(linhas.some(l => l.token_hash === hashToken(token)));
    assert.ok(!linhas.some(l => l.token_hash === token));
  } },
  { id: 'SEG-023', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Cada login gera um token novo (sem fixação de sessão)', fn: async c => {
    const ent = () => c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: c.amb.contas.b.avaliador.documento, senha: SENHA });
    assert.notEqual((await ent()).setCookie[0], (await ent()).setCookie[0]);
  } },
  { id: 'SEG-024', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Sair apaga a sessão no servidor', fn: async c => {
    const { cli } = await novaConta(c);
    const cookie = cli.cookie;
    assert.equal((await cli.pedir('POST', '/api/acesso/sair', {})).status, 204);
    assert.equal((await c.amb.cliente().pedir('GET', '/api/conta', undefined, { cabecalhos: { cookie } })).status, 401);
  } },
  { id: 'SEG-025', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Sessão vencida não vale', fn: async c => {
    const cli = await c.https.entrar(c.https.contas.b.proponente);
    c.https.relogio.avancar(8 * 60 * 60 * 1000 + 1000);
    assert.equal((await cli.pedir('GET', '/api/conta')).status, 401);
  } },
  { id: 'SEG-026', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Trocar a senha encerra as outras sessões', fn: async c => {
    const { cli, documento } = await novaConta(c);
    const outra = c.amb.cliente();
    await outra.pedir('POST', '/api/acesso/entrar', { documento, senha: SENHA_FORTE });
    const nova = 'Outra-frase-bem-longa-9';
    assert.equal((await cli.pedir('PUT', '/api/conta/senha', { senhaAtual: SENHA_FORTE, novaSenha: nova, novaSenhaConfirmacao: nova })).status, 204);
    assert.equal((await outra.pedir('GET', '/api/conta')).status, 401);
    assert.equal((await cli.pedir('GET', '/api/conta')).status, 200);
  } },
  { id: 'SEG-027', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Senha atual errada 5 vezes bloqueia a troca de senha', fn: async c => {
    const { cli } = await novaConta(c);
    const pedido = senhaAtual => cli.pedir('PUT', '/api/conta/senha', { senhaAtual, novaSenha: 'Outra-frase-bem-longa-9', novaSenhaConfirmacao: 'Outra-frase-bem-longa-9' });
    for (let i = 0; i < 5; i++) assert.equal((await pedido('Errada-mas-longa-1')).status, 400);
    assert.equal((await pedido(SENHA_FORTE)).status, 429);
    // Em paralelo também: 20 senhas atuais erradas ao mesmo tempo, só 5 são avaliadas.
    const { cli: outro } = await novaConta(c);
    const status = (await Promise.all(Array.from({ length: 20 }, (_, i) => outro.pedir('PUT', '/api/conta/senha', { senhaAtual: `Errada-mas-longa-${i}`, novaSenha: 'Outra-frase-bem-longa-9', novaSenhaConfirmacao: 'Outra-frase-bem-longa-9' })))).map(r => r.status);
    assert.equal(status.filter(x => x === 400).length, 5, status.join(','));
  } },
  { id: 'SEG-028', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Esqueci a senha responde igual para documento com e sem conta', fn: async c => {
    const a = await c.amb.cliente().pedir('POST', '/api/acesso/esqueci-senha', { documento: c.amb.contas.b.gestor.documento });
    const b = await c.amb.cliente().pedir('POST', '/api/acesso/esqueci-senha', { documento: novoCPF() });
    assert.equal(a.status, b.status);
    assert.deepEqual(a.corpo, b.corpo);
  } },
  { id: 'SEG-029', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Link de redefinição vale uma vez só e encerra as sessões', fn: async c => {
    const { cli, documento } = await novaConta(c);
    await c.amb.cliente().pedir('POST', '/api/acesso/esqueci-senha', { documento });
    await new Promise(ok => setTimeout(ok, 20));
    const { token } = c.amb.emails.at(-1);
    const nova = 'Frase-nova-de-acesso-3';
    assert.equal((await c.amb.cliente().pedir('POST', '/api/acesso/redefinir', { token, senha: nova, senhaConfirmacao: nova })).status, 204);
    assert.equal((await c.amb.cliente().pedir('POST', '/api/acesso/redefinir', { token, senha: nova, senhaConfirmacao: nova })).status, 400);
    assert.equal((await cli.pedir('GET', '/api/conta')).status, 401);
  } },
  { id: 'SEG-030', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Link de redefinição vence em 1 hora', fn: async c => {
    await c.https.cliente().pedir('POST', '/api/acesso/esqueci-senha', { documento: c.https.contas.a.avaliador.documento });
    await new Promise(ok => setTimeout(ok, 20));
    const { token } = c.https.emails.at(-1);
    c.https.relogio.avancar(61 * 60 * 1000);
    assert.equal((await c.https.cliente().pedir('POST', '/api/acesso/redefinir', { token, senha: 'Frase-nova-de-acesso-3', senhaConfirmacao: 'Frase-nova-de-acesso-3' })).status, 400);
  } },
  { id: 'SEG-031', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'Token de redefinição guardado só como hash', fn: async c => {
    const { token } = c.amb.emails.at(-1);
    const { linhas } = await c.amb.banco.executar('SELECT token_hash FROM tokens_redefinicao');
    assert.ok(!linhas.some(l => l.token_hash === token));
  } },
  { id: 'SEG-032', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Esqueci a senha: 10 pedidos por hora por IP', fn: async c => {
    const cli = c.amb.cliente();
    for (let i = 0; i < 10; i++) assert.equal((await cli.pedir('POST', '/api/acesso/esqueci-senha', { documento: novoCPF() })).status, 200);
    assert.equal((await cli.pedir('POST', '/api/acesso/esqueci-senha', { documento: novoCPF() })).status, 429);
  } },
  { id: 'SEG-033', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Esqueci a senha: 3 e-mails por hora por documento, com resposta igual', fn: async c => {
    const { documento, usuario } = await novaConta(c);
    const antes = c.amb.emails.filter(e => e.para === usuario.email).length;
    const respostas = [];
    for (let i = 0; i < 5; i++) respostas.push((await c.amb.cliente().pedir('POST', '/api/acesso/esqueci-senha', { documento })).corpo);
    await new Promise(ok => setTimeout(ok, 20));
    assert.equal(c.amb.emails.filter(e => e.para === usuario.email).length - antes, 3);
    assert.ok(respostas.every(r => JSON.stringify(r) === JSON.stringify(respostas[0])));
  } },
  { id: 'SEG-034', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Consulta de documento: 30 por 15 minutos por IP', fn: async c => {
    const cli = c.amb.cliente();
    for (let i = 0; i < 30; i++) assert.equal((await cli.pedir('POST', '/api/acesso/documento', { documento: novoCPF() })).status, 200);
    assert.equal((await cli.pedir('POST', '/api/acesso/documento', { documento: novoCPF() })).status, 429);
    // A criação de conta também revela se o documento existe: entra no mesmo limite.
    const r = await cli.pedir('POST', '/api/acesso/criar-conta', { organizacao: 'org-a', natureza: 'Pessoa Física', nome: 'X Teste', documento: c.amb.contas.a.gestor.documento, email: 'x@teste.example', telefone: '71900000000', senha: SENHA_FORTE, senhaConfirmacao: SENHA_FORTE });
    assert.equal(r.status, 429);
  } },
  { id: 'SEG-035', manual: MANUAL.IAM, csf: 'PR.AA-03', titulo: 'Cookie com token gigante é ignorado', fn: async c => {
    assert.equal((await c.amb.cliente().pedir('GET', '/api/conta', undefined, { cabecalhos: { cookie: `teb_sessao=${'a'.repeat(300)}` } })).status, 401);
  } },

  // Gestão de Identidade e Acesso: papéis e isolamento (RBAC, menor privilégio)
  { id: 'SEG-036', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Anônimo recebe 401 nas rotas protegidas', fn: async c => {
    for (const p of ['/api/conta', '/api/gestor/editais', '/api/avaliador/inscricoes', '/api/plataforma/organizacoes', '/api/proponente/painel']) {
      assert.equal((await c.amb.cliente().pedir('GET', p)).status, 401, p);
    }
  } },
  { id: 'SEG-037', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Proponente não entra em rota de gestor', fn: async c => assert.equal((await c.pA.pedir('GET', '/api/gestor/editais')).status, 403) },
  { id: 'SEG-038', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Avaliador não entra em rota de gestor', fn: async c => assert.equal((await c.avA.pedir('GET', '/api/gestor/inscricoes')).status, 403) },
  { id: 'SEG-039', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Gestor não entra em rota da plataforma', fn: async c => assert.equal((await c.gA.pedir('GET', '/api/plataforma/organizacoes')).status, 403) },
  { id: 'SEG-040', manual: MANUAL.LGPD, csf: 'PR.AA-05', titulo: 'Plataforma não lê inscrições de proponentes', fn: async c => {
    assert.equal((await c.plat.pedir('GET', '/api/gestor/inscricoes')).status, 403);
    assert.ok(!JSON.stringify((await c.plat.pedir('GET', '/api/plataforma/organizacoes')).corpo).includes(c.inscA.protocolo));
  } },
  { id: 'SEG-041', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Avaliador só vê inscrições atribuídas a ele', fn: async c => {
    assert.ok(!JSON.stringify((await c.avA.pedir('GET', '/api/avaliador/inscricoes')).corpo).includes(c.inscA.protocolo));
    naoOk(await c.avA.pedir('GET', `/api/avaliador/inscricoes/${c.inscA.protocolo}`), 'avaliador sem atribuição');
  } },
  { id: 'SEG-042', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Proponente não vê inscrição de outro proponente, nem da mesma organização', fn: async c => {
    naoOk(await c.pB.pedir('GET', `/api/inscricoes/${c.inscA.protocolo}`), 'proponente de outra organização');
    const { cli } = await novaConta(c);
    naoOk(await cli.pedir('GET', `/api/inscricoes/${c.inscA.protocolo}`), 'proponente da mesma organização');
    naoOk(await cli.pedir('PUT', `/api/inscricoes/${c.rascunhoA}`, { ficha: { titulo: 'Invadido' } }), 'alterar rascunho alheio');
  } },
  { id: 'SEG-043', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Gestor de outra organização não vê a inscrição', fn: async c => {
    assert.ok(!JSON.stringify((await c.gB.pedir('GET', '/api/gestor/inscricoes')).corpo).includes(c.inscA.protocolo));
    naoOk(await c.gB.pedir('PUT', `/api/gestor/inscricoes/${c.inscA.protocolo}/resultado`, { resultado: 'selecionado' }), 'gestor B resultado');
  } },
  { id: 'SEG-044', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Gestor de outra organização não altera o edital', fn: async c => naoOk(await c.gB.pedir('POST', `/api/gestor/editais/${c.slugA}/encerrar`, {}), 'gestor B encerra') },
  { id: 'SEG-045', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Avaliador de outra organização não avalia', fn: async c => {
    naoOk(await c.avB.pedir('POST', `/api/avaliador/inscricoes/${c.inscA.protocolo}/avaliacao`, { notas: { qualidade: 1, viabilidade: 1, 'bonus-regional': 0 }, parecer: 'x' }), 'avaliador B');
  } },
  { id: 'SEG-046', manual: MANUAL.LGPD, csf: 'PR.AA-05', titulo: 'Proponente não baixa anexo de outro, nem da mesma organização', fn: async c => {
    naoOk(await c.pB.pedir('GET', `/api/anexos/${c.anexoA.id}`), 'outra organização');
    const { cli } = await novaConta(c);
    naoOk(await cli.pedir('GET', `/api/anexos/${c.anexoA.id}`), 'mesma organização');
    assert.equal((await c.pA.pedir('GET', `/api/anexos/${c.anexoA.id}`)).status, 200);
  } },
  { id: 'SEG-047', manual: MANUAL.INCIDENTE, csf: 'DE.CM-03', titulo: 'Acesso negado (403) entra na auditoria', fn: async c => {
    await c.pA.pedir('GET', '/api/gestor/editais');
    assert.ok((await acoes(c)).includes('acesso_negado'));
  } },
  { id: 'SEG-048', manual: MANUAL.IAM, csf: 'PR.AA-02', titulo: 'Documento da conta não pode ser trocado', fn: async c => {
    const r = await c.pA.pedir('PUT', '/api/conta', { nome: 'Novo', email: 'n@teste.example', documento: novoCPF() });
    assert.equal(r.corpo.erro, 'documento_inalteravel');
  } },
  { id: 'SEG-049', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Criar conta com papel de gestor no corpo gera só proponente', fn: async c => {
    const { usuario } = await novaConta(c, { papel: 'gestor' });
    assert.equal(usuario.papel, 'proponente');
  } },
  { id: 'SEG-050', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Trocar para organização inexistente é recusado', fn: async c => assert.equal((await c.pA.pedir('PUT', '/api/conta/organizacao', { organizacao: 'nao-existe' })).status, 404) },

  // Desenvolvimento Seguro (OWASP Top 10)
  { id: 'SEG-051', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Injeção SQL no documento do login é recusada', fn: async c => {
    assert.equal((await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: "1' OR '1'='1", senha: 'x' })).status, 400);
  } },
  { id: 'SEG-052', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Injeção SQL no endereço do edital não acha nada nem quebra a tabela', fn: async c => {
    naoOk(await c.pA.pedir('GET', `/api/editais/${encodeURIComponent("x' OR 1=1; DROP TABLE editais; --")}`), 'injeção');
    assert.ok((await c.amb.banco.executar('SELECT COUNT(*) AS n FROM editais')).linhas[0].n > 0);
  } },
  { id: 'SEG-053', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Texto com <script> é guardado como texto e servido como JSON', fn: async c => {
    const { cli } = await novaConta(c, { nome: '<script>alert(1)</script>' });
    const r = await cli.pedir('GET', '/api/conta');
    assert.match(r.cabecalhos.get('content-type'), /application\/json/);
    assert.equal(r.corpo.usuario.nome, '<script>alert(1)</script>');
  } },
  { id: 'SEG-054', manual: MANUAL.DEV, csf: 'PR.PS-01', titulo: 'CSP restringe tudo à própria origem e proíbe moldura', fn: async c => {
    const csp = c.cab.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  } },
  { id: 'SEG-055', manual: MANUAL.DEV, csf: 'PR.PS-01', titulo: 'X-Content-Type-Options: nosniff', fn: async c => assert.equal(c.cab.get('x-content-type-options'), 'nosniff') },
  { id: 'SEG-056', manual: MANUAL.DEV, csf: 'PR.PS-01', titulo: 'X-Frame-Options: DENY', fn: async c => assert.equal(c.cab.get('x-frame-options'), 'DENY') },
  { id: 'SEG-057', manual: MANUAL.LGPD, csf: 'PR.PS-01', titulo: 'Referrer-Policy não vaza endereço para outros sites', fn: async c => assert.equal(c.cab.get('referrer-policy'), 'same-origin') },
  { id: 'SEG-058', manual: MANUAL.DEV, csf: 'PR.PS-01', titulo: 'Permissions-Policy desliga câmera, microfone e localização', fn: async c => assert.match(c.cab.get('permissions-policy'), /camera=\(\).*microphone=\(\).*geolocation=\(\)/) },
  { id: 'SEG-059', manual: MANUAL.DEV, csf: 'PR.PS-01', titulo: 'Cross-Origin-Opener-Policy e Resource-Policy na própria origem', fn: async c => {
    assert.equal(c.cab.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(c.cab.get('cross-origin-resource-policy'), 'same-origin');
  } },
  { id: 'SEG-060', manual: MANUAL.CRIPTO, csf: 'PR.DS-02', titulo: 'Com HTTPS vai HSTS de 1 ano com subdomínios', fn: async c => {
    const r = await c.https.cliente().pedir('GET', '/api/sessao');
    assert.equal(r.cabecalhos.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  } },
  { id: 'SEG-061', manual: MANUAL.LGPD, csf: 'PR.DS-10', titulo: 'Respostas da API não ficam em cache', fn: async c => assert.equal(c.cab.get('cache-control'), 'no-store') },
  { id: 'SEG-062', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'JSON inválido dá 400 sem expor detalhes internos', fn: async c => {
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/entrar', undefined, { bruto: '{"documento":', cabecalhos: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400);
    assert.ok(!/SyntaxError|at |\.js/.test(r.bytes.toString()));
  } },
  { id: 'SEG-063', manual: MANUAL.CIA, csf: 'PR.IR-04', titulo: 'Corpo JSON acima de 1 MB dá 413', fn: async c => {
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: 'x'.repeat(1100000) });
    assert.equal(r.status, 413);
  } },
  { id: 'SEG-064', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Pedido que não é JSON dá 415', fn: async c => {
    const r = await c.amb.cliente().pedir('POST', '/api/acesso/entrar', undefined, { bruto: 'documento=1', cabecalhos: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(r.status, 415);
  } },
  { id: 'SEG-065', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'CSRF: pedido com Origin de outro site é recusado', fn: async c => {
    const r = await c.pA.pedir('PUT', '/api/conta/organizacao', { organizacao: 'org-a' }, { cabecalhos: { origin: 'https://malicioso.example' } });
    assert.equal(r.status, 403);
    assert.equal(r.corpo.erro, 'origem_invalida');
    const porta = new URL(c.amb.base);
    for (const origin of ['null', `http://${porta.hostname}:1`, 'file://']) {
      assert.equal((await c.pA.pedir('PUT', '/api/conta/organizacao', { organizacao: 'org-a' }, { cabecalhos: { origin } })).status, 403, origin);
    }
  } },
  { id: 'SEG-066', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'CSRF: Sec-Fetch-Site cross-site é recusado', fn: async c => {
    assert.equal((await c.pA.pedir('PUT', '/api/conta/organizacao', { organizacao: 'org-a' }, { cabecalhos: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  } },
  { id: 'SEG-067', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Pedido da própria origem continua aceito', fn: async c => {
    assert.equal((await c.pA.pedir('PUT', '/api/conta/organizacao', { organizacao: 'org-a' }, { cabecalhos: { origin: c.amb.base, 'sec-fetch-site': 'same-origin' } })).status, 200);
  } },
  { id: 'SEG-068', manual: MANUAL.DEV, csf: 'PR.DS-01', titulo: 'Caminho com ../ não sai da pasta pública', fn: async c => {
    for (const p of ['/..%2fpackage.json', '/img/..%2f..%2fservidor%2fapp.js', '/css/%2e%2e/servidor/banco.js']) assert.equal((await fetch(c.amb.base + p)).status, 404, p);
  } },
  { id: 'SEG-069', manual: MANUAL.DEV, csf: 'PR.DS-01', titulo: 'Código do servidor não é servido', fn: async c => {
    for (const p of ['/servidor/app.js', '/servidor/seguranca.js', '/package.json']) assert.equal((await fetch(c.amb.base + p)).status, 404, p);
  } },
  { id: 'SEG-070', manual: MANUAL.DEV, csf: 'PR.DS-01', titulo: 'Arquivos ocultos como .env não são servidos', fn: async c => {
    for (const p of ['/.env', '/.env.example', '/.gitignore']) assert.equal((await fetch(c.amb.base + p)).status, 404, p);
  } },
  { id: 'SEG-071', manual: MANUAL.DEV, csf: 'PR.DS-01', titulo: 'Testes do front não são servidos', fn: async c => assert.equal((await fetch(`${c.amb.base}/js/testes/regras.test.js`)).status, 404) },
  { id: 'SEG-072', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Anexo que não é PDF de verdade é recusado', fn: async c => {
    const r = await upload(c.pA, c.rascunhoA, Buffer.from('texto qualquer'), { nome: 'falso.pdf' });
    assert.equal(r.status, 415);
  } },
  { id: 'SEG-073', manual: MANUAL.CIA, csf: 'PR.IR-04', titulo: 'Anexo acima de 10 MB dá 413', fn: async c => {
    const r = await upload(c.pA, c.rascunhoA, Buffer.concat([pdfMinimo(), Buffer.alloc(10 * 1024 * 1024)]));
    assert.equal(r.status, 413);
  } },
  { id: 'SEG-074', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'Anexo fica cifrado no disco', fn: async c => {
    for (const n of await readdir(c.amb.pastaAnexos)) assert.ok(!(await readFile(join(c.amb.pastaAnexos, n))).includes(Buffer.from('%PDF')), n);
  } },
  { id: 'SEG-075', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'Anexo adulterado no disco não é entregue', fn: async c => {
    const r0 = await upload(c.pA, c.rascunhoA, pdfMinimo('para adulterar'));
    const { linhas } = await c.amb.banco.executar('SELECT arquivo_id FROM anexos WHERE id = ?', [r0.corpo.anexo.id]);
    const arq = join(c.amb.pastaAnexos, `${linhas[0].arquivo_id}.bin`);
    const bytes = await readFile(arq); bytes[40] ^= 1; await writeFile(arq, bytes);
    const r = await c.pA.pedir('GET', `/api/anexos/${r0.corpo.anexo.id}`);
    assert.notEqual(r.status, 200);
    assert.ok(!r.bytes.includes(Buffer.from('para adulterar')));
  } },
  { id: 'SEG-076', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Nome de anexo com ../ e quebra de linha é limpo', fn: async c => {
    const r = await upload(c.pA, c.rascunhoA, pdfMinimo(), { nome: '../../etc/pass\nwd.pdf' });
    assert.equal(r.status, 201);
    assert.ok(!/[/\\\n]/.test(r.corpo.anexo.nome));
  } },
  { id: 'SEG-077', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Teto absurdo do edital dá 400, nunca 500 (F7)', fn: async c => {
    assert.equal((await c.gA.pedir('POST', '/api/gestor/editais', { numero: 'S77', titulo: 't', descricao: 'd', inicio: '2026-06-01', fim: '2026-07-01', teto: 1e16 })).status, 400);
  } },
  { id: 'SEG-078', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Teto que não é número nem texto é recusado', fn: async c => {
    assert.equal((await c.gA.pedir('POST', '/api/gestor/editais', { numero: 'S78', titulo: 't', descricao: 'd', inicio: '2026-06-01', fim: '2026-07-01', teto: [5] })).status, 400);
  } },
  { id: 'SEG-079', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Nota acima do máximo é recusada', fn: async c => {
    await c.gA.pedir('POST', `/api/gestor/inscricoes/${c.inscA.protocolo}/avaliador`, { avaliador: c.amb.contas.a.avaliador.id });
    const r = await c.avA.pedir('POST', `/api/avaliador/inscricoes/${c.inscA.protocolo}/avaliacao`, { notas: { qualidade: 11, viabilidade: 5, 'bonus-regional': 0 }, parecer: 'x' });
    assert.equal(r.status, 400);
  } },
  { id: 'SEG-080', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Valor negativo no orçamento é recusado', fn: async c => {
    assert.equal((await c.pA.pedir('PUT', `/api/inscricoes/${c.rascunhoA}`, { ficha: { orcamento: [{ descricao: 'x', qtd: 1, valor: -1 }] } })).status, 400);
  } },
  { id: 'SEG-081', manual: MANUAL.CIA, csf: 'PR.IR-04', titulo: 'Tabela com mais de 200 linhas é recusada', fn: async c => {
    const metas = Array.from({ length: 201 }, () => ({ etapa: 'e', acao: 'a' }));
    assert.equal((await c.pA.pedir('PUT', `/api/inscricoes/${c.rascunhoA}`, { ficha: { metas } })).corpo.erro, 'linhas_demais');
  } },
  { id: 'SEG-082', manual: MANUAL.CIA, csf: 'PR.DS-01', titulo: 'Envio duplo simultâneo gera um protocolo só', fn: async c => {
    const r = await c.pA.pedir('POST', '/api/inscricoes', { edital: c.slugA, ficha: {} });
    const { fichaValida } = await import('./ajuda.js');
    const envios = await Promise.all([1, 2, 3].map(() => c.pA.pedir('POST', `/api/inscricoes/${r.corpo.inscricao.id}/enviar`, { ficha: fichaValida() })));
    assert.equal(envios.filter(e => e.status === 200).length, 1);
  } },
  { id: 'SEG-083', manual: MANUAL.CIA, csf: 'PR.DS-01', titulo: 'Ficha enviada não pode ser alterada', fn: async c => {
    const r = await c.pA.pedir('PUT', `/api/inscricoes/${c.inscA.id}`, { ficha: { titulo: 'Mudado depois' } });
    assert.ok(r.status >= 400);
    assert.notEqual((await c.pA.pedir('GET', `/api/inscricoes/${c.inscA.protocolo}`)).corpo.inscricao.titulo, 'Mudado depois');
  } },
  { id: 'SEG-084', manual: MANUAL.IAM, csf: 'PR.AA-05', titulo: 'Edital em rascunho é invisível para o proponente', fn: async c => {
    const { corpoEdital } = await import('./ajuda.js');
    const r = await c.gA.pedir('POST', '/api/gestor/editais', corpoEdital(c.amb.relogio));
    naoOk(await c.pA.pedir('GET', `/api/editais/${r.corpo.edital.slug}`), 'rascunho');
  } },
  { id: 'SEG-085', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'JSON com __proto__ não contamina objetos do servidor', fn: async c => {
    await c.amb.cliente().pedir('POST', '/api/acesso/entrar', undefined, { bruto: '{"__proto__":{"poluido":"sim"},"documento":"1"}', cabecalhos: { 'content-type': 'application/json' } });
    assert.equal({}.poluido, undefined);
  } },
  { id: 'SEG-086', manual: MANUAL.DEV, csf: 'PR.PS-06', titulo: 'Método e endereço estranhos dão 4xx, nunca 500', fn: async c => {
    for (const [m, p] of [['PATCH', '/api/conta'], ['DELETE', '/api/conta'], ['GET', '/api/editais/%E0%A4%A'], ['GET', '/api/%00']]) {
      const r = await c.pA.pedir(m, p);
      assert.ok(r.status >= 400 && r.status < 500, `${m} ${p}: ${r.status}`);
    }
  } },

  // Criptografia e recuperação (backups)
  { id: 'SEG-087', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'Chave dos anexos exige 32 bytes (AES-256)', fn: async () => {
    assert.throws(() => lerChave(randomBytes(16).toString('base64')), /32 bytes/);
    assert.throws(() => lerChave(''), /TEB_CHAVE_ANEXOS/);
  } },
  { id: 'SEG-088', manual: MANUAL.CRIPTO, csf: 'PR.DS-11', titulo: 'Backup cifrado com AES-256-GCM, sem dado pessoal em claro', fn: async c => {
    const plano = join(c.amb.pasta, 'seg-bkp.ndjson');
    await exportarBanco(c.amb.banco, plano);
    await cifrarArquivo(plano, `${plano}.teb`, { chave: c.chaveBackup, nome: 'banco/seg', gzip: true });
    const b = await readFile(`${plano}.teb`);
    assert.ok(!b.includes(Buffer.from('teste.example')) && !b.includes(Buffer.from('scrypt$')));
  } },
  { id: 'SEG-089', manual: MANUAL.CRIPTO, csf: 'RC.RP-03', titulo: 'Backup adulterado é recusado na restauração', fn: async c => {
    const arq = join(c.amb.pasta, 'seg-bkp.ndjson.teb');
    const b = await readFile(arq); b[30] ^= 1; await writeFile(`${arq}.ad`, b);
    await assert.rejects(decifrarArquivo(`${arq}.ad`, join(c.amb.pasta, 'seg-volta'), { chave: c.chaveBackup, nome: 'banco/seg', gzip: true }), /adulterado/);
  } },
  { id: 'SEG-090', manual: MANUAL.CRIPTO, csf: 'PR.DS-11', titulo: 'Chave do backup precisa ser diferente da chave dos anexos', fn: async () => {
    const k = randomBytes(32);
    assert.throws(() => lerChaveBackup(k.toString('base64'), k), /diferente/);
  } },
  { id: 'SEG-091', manual: MANUAL.CRIPTO, csf: 'PR.DS-01', titulo: 'IV aleatório: cifrar duas vezes dá resultados diferentes', fn: async c => {
    const plano = join(c.amb.pasta, 'seg-bkp.ndjson');
    await cifrarArquivo(plano, `${plano}.1`, { chave: c.chaveBackup, nome: 'x' });
    await cifrarArquivo(plano, `${plano}.2`, { chave: c.chaveBackup, nome: 'x' });
    assert.ok(!(await readFile(`${plano}.1`)).equals(await readFile(`${plano}.2`)));
  } },
  { id: 'SEG-092', manual: MANUAL.LGPD, csf: 'PR.DS-11', titulo: 'Backup não leva sessões nem tokens de redefinição', fn: async c => {
    const texto = await readFile(join(c.amb.pasta, 'seg-bkp.ndjson'), 'utf8');
    assert.ok(!/"tabela":"(sessoes|tokens_redefinicao|tentativas_login)"/.test(texto));
  } },

  // Resposta a Incidentes e monitoramento (auditoria)
  { id: 'SEG-093', manual: MANUAL.INCIDENTE, csf: 'DE.CM-03', titulo: 'Login com falha entra na auditoria', fn: async c => assert.ok((await acoes(c)).includes('login_falha')) },
  { id: 'SEG-094', manual: MANUAL.INCIDENTE, csf: 'DE.CM-03', titulo: 'Login bloqueado entra na auditoria', fn: async c => assert.ok((await acoes(c)).includes('login_bloqueado')) },
  { id: 'SEG-095', manual: MANUAL.INCIDENTE, csf: 'DE.AE-02', titulo: 'Limite excedido entra na auditoria', fn: async c => assert.ok((await acoes(c)).includes('limite_excedido')) },
  { id: 'SEG-096', manual: MANUAL.INCIDENTE, csf: 'DE.CM-03', titulo: 'Pedido de redefinição de senha entra na auditoria', fn: async c => assert.ok((await acoes(c)).includes('redefinicao_pedida')) },
  { id: 'SEG-097', manual: MANUAL.INCIDENTE, csf: 'PR.PS-04', titulo: 'Auditoria nunca guarda senha nem token', fn: async c => {
    const { linhas } = await c.amb.banco.executar('SELECT * FROM auditoria');
    const texto = JSON.stringify(linhas);
    assert.ok(!texto.includes(SENHA) && !texto.includes(SENHA_FORTE));
    for (const e of c.amb.emails) assert.ok(!texto.includes(e.token));
  } },
  { id: 'SEG-098', manual: MANUAL.INCIDENTE, csf: 'PR.PS-04', titulo: 'Auditoria registra IP e horário', fn: async c => {
    const { linhas } = await c.amb.banco.executar("SELECT quando, ip FROM auditoria WHERE acao = 'login_falha' LIMIT 1");
    assert.ok(linhas[0].ip && !Number.isNaN(Date.parse(linhas[0].quando)));
  } },

  // Legislação e Ética (LGPD)
  { id: 'SEG-099', manual: MANUAL.LGPD, csf: 'PR.DS-10', titulo: 'Sem e-mail configurado, o log do servidor não traz link, token nem e-mail completo', fn: async c => {
    const linhas = [];
    const log = { log: m => linhas.push(m), warn: m => linhas.push(m) };
    await emailDesligado({ log })({ para: 'pessoa.real@exemplo.example', assunto: 'Redefinição de senha', texto: 'link https://x/#/redefinir?token=SEGREDO', link: 'https://x/#/redefinir?token=SEGREDO', token: 'SEGREDO' });
    assert.ok(!linhas.join('\n').includes('SEGREDO') && !linhas.join('\n').includes('pessoa.real@'));
    // O servidor de verdade, com o e-mail padrão: captura o console durante um esqueci-senha.
    const { criarApp } = await import('../app.js');
    const { createServer } = await import('node:http');
    const app = criarApp({ banco: c.amb.banco, anexos: c.amb.anexos, ipDe: () => '10.9.9.9' });
    const servidor = createServer(app);
    await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
    const capturado = [];
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(orig)) console[k] = (...a) => capturado.push(a.join(' '));
    try {
      const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/acesso/esqueci-senha`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documento: c.amb.contas.a.gestor.documento }) });
      assert.equal(r.status, 200);
      await new Promise(ok => setTimeout(ok, 50));
    } finally {
      Object.assign(console, orig);
      servidor.closeAllConnections();
      await new Promise(ok => servidor.close(ok));
    }
    const texto = capturado.join('\n');
    assert.ok(capturado.length > 0, 'o pedido deveria gerar um aviso no log');
    assert.ok(!/token=|redefinir\?/.test(texto) && !texto.includes('gestor.a@teste.example'), texto);
  } },
  { id: 'SEG-100', manual: MANUAL.LGPD, csf: 'PR.AA-05', titulo: 'Avaliador não recebe e-mail nem telefone do proponente', fn: async c => {
    const r = await c.avA.pedir('GET', `/api/avaliador/inscricoes/${c.inscA.protocolo}`);
    assert.equal(r.status, 200);
    const texto = JSON.stringify(r.corpo);
    assert.ok(!texto.includes('proponente.a@teste.example') && !texto.includes('71900000000'));
  } },
];
