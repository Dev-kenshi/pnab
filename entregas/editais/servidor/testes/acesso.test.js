// Acesso: S1, S2, S3, S4, S12 e S14.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SENHA, criarAmbiente, gerarCPF } from './ajuda.js';

let amb;
before(async () => { amb = await criarAmbiente(); });
after(async () => { await amb?.fechar(); });

const DEMO = ['52998224725', '11144477735', '39053344705', '16899535009'];

function contaNova(documento, extra = {}) {
  return {
    organizacao: 'org-a', natureza: 'MEI', nome: 'Pessoa de teste', documento, email: 'pessoa@teste.example',
    telefone: '71900000000', senha: 'Outra-senha-1', senhaConfirmacao: 'Outra-senha-1', ...extra,
  };
}

test('S1: documento inválido, vazio e válido na etapa 1', async () => {
  const c = amb.cliente();
  let r = await c.pedir('POST', '/api/acesso/documento', { documento: '111.111.111-11' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'documento_invalido');
  assert.match(r.corpo.mensagem, /inválido/);
  r = await c.pedir('POST', '/api/acesso/documento', { documento: '' });
  assert.equal(r.corpo.erro, 'documento_obrigatorio');
  assert.match(r.corpo.mensagem, /Documento/);
  r = await c.pedir('POST', '/api/acesso/documento', { documento: '00000000000000' });
  assert.equal(r.corpo.erro, 'documento_invalido');
  r = await c.pedir('POST', '/api/acesso/documento', { documento: amb.contas.a.proponente.documento });
  assert.deepEqual(r.corpo, { existe: true });
  r = await c.pedir('POST', '/api/acesso/documento', { documento: '935.411.347-80' });
  assert.deepEqual(r.corpo, { existe: false });
  r = await c.pedir('POST', '/api/acesso/criar-conta', contaNova('11.222.333/0001-80'));
  assert.equal(r.corpo.erro, 'documento_invalido');
});

test('S2: senha guardada com scrypt e sal único', async () => {
  const { linhas } = await amb.banco.executar('SELECT documento, senha_hash FROM usuarios WHERE papel = ?', ['gestor']);
  assert.equal(linhas.length, 2);
  for (const l of linhas) {
    assert.match(l.senha_hash, /^scrypt\$/);
    assert.ok(!l.senha_hash.includes(SENHA));
  }
  assert.notEqual(linhas[0].senha_hash, linhas[1].senha_hash);
  const sais = linhas.map(l => l.senha_hash.split('$')[4]);
  assert.notEqual(sais[0], sais[1]);
  assert.equal(Buffer.from(sais[0], 'base64').length, 16);
});

test('S3: cookie HttpOnly e SameSite=Strict, sem Secure em HTTP, e 401 sem cookie', async () => {
  const c = amb.cliente();
  const r = await c.pedir('POST', '/api/acesso/entrar', { documento: amb.contas.a.proponente.documento, senha: SENHA });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.usuario.papel, 'proponente');
  assert.equal(r.corpo.usuario.senha_hash, undefined);
  const cookie = r.setCookie.find(x => x.startsWith('teb_sessao='));
  assert.ok(cookie);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\//);
  assert.ok(!/Secure/.test(cookie));
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const { linhas } = await amb.banco.executar('SELECT token_hash FROM sessoes');
  assert.ok(linhas.every(l => l.token_hash !== token && /^[a-f0-9]{64}$/.test(l.token_hash)));

  assert.equal((await c.pedir('GET', '/api/sessao')).status, 200);
  const sem = amb.cliente();
  // F6: sem sessão, /api/sessao responde 200 com usuario null. As outras rotas protegidas seguem 401.
  const anonimo = await sem.pedir('GET', '/api/sessao');
  assert.equal(anonimo.status, 200);
  assert.deepEqual(anonimo.corpo, { usuario: null });
  for (const rota of ['/api/conta', '/api/proponente/painel', '/api/gestor/editais', '/api/avaliador/inscricoes']) {
    const x = await sem.pedir('GET', rota);
    assert.equal(x.status, 401, rota);
    assert.equal(x.corpo.erro, 'sem_sessao');
  }
  const falso = await sem.pedir('GET', '/api/sessao', undefined, { cabecalhos: { cookie: 'teb_sessao=inventado' } });
  assert.equal(falso.status, 200);
  assert.deepEqual(falso.corpo, { usuario: null });
  assert.equal((await sem.pedir('GET', '/api/conta', undefined, { cabecalhos: { cookie: 'teb_sessao=inventado' } })).status, 401);

  const s = await c.pedir('POST', '/api/acesso/sair', {});
  assert.equal(s.status, 204);
  assert.match(s.setCookie[0], /Max-Age=0/);
  const depois = await c.pedir('GET', '/api/sessao', undefined, { cabecalhos: { cookie: `teb_sessao=${token}` } });
  assert.equal(depois.status, 200);
  assert.equal(depois.corpo.usuario, null);
  assert.equal((await c.pedir('GET', '/api/conta', undefined, { cabecalhos: { cookie: `teb_sessao=${token}` } })).status, 401);
});

test('S3: com HTTPS o cookie leva Secure e a sessão vence em 8 horas', async () => {
  const seguro = await criarAmbiente({ https: true });
  try {
    const c = seguro.cliente();
    const r = await c.pedir('POST', '/api/acesso/entrar', { documento: seguro.contas.a.gestor.documento, senha: SENHA });
    assert.match(r.setCookie[0], /; Secure/);
    assert.equal(r.cabecalhos.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
    seguro.relogio.avancar(8 * 60 * 60 * 1000 + 1000);
    const vencida = await c.pedir('GET', '/api/sessao');
    assert.equal(vencida.status, 200);
    assert.equal(vencida.corpo.usuario, null);
    assert.equal((await c.pedir('GET', '/api/conta')).status, 401);
  } finally {
    await seguro.fechar();
  }
});

test('cabeçalhos de segurança em toda resposta', async () => {
  const r = await amb.cliente().pedir('GET', '/api/organizacoes');
  assert.equal(r.status, 200);
  assert.match(r.cabecalhos.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.cabecalhos.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.cabecalhos.get('x-content-type-options'), 'nosniff');
  assert.equal(r.cabecalhos.get('referrer-policy'), 'same-origin');
  const modo = await amb.cliente().pedir('GET', '/modo.json');
  assert.deepEqual(modo.corpo, { modo: 'servidor', loginUsuario: false });
  assert.equal(modo.cabecalhos.get('cache-control'), 'no-store');
  const texto = await amb.cliente().pedir('POST', '/api/acesso/documento', undefined, { bruto: 'documento=1', cabecalhos: { 'content-type': 'text/plain' } });
  assert.equal(texto.status, 415);
});

test('S4: 5 erros seguidos bloqueiam o documento por 15 minutos, mesmo com senha certa', async () => {
  const doc = amb.contas.b.proponente.documento;
  const ips = Array.from({ length: 7 }, () => amb.cliente());
  for (let i = 0; i < 5; i++) {
    const r = await ips[i].pedir('POST', '/api/acesso/entrar', { documento: doc, senha: 'errada-123' });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.mensagem, 'Senha incorreta.');
  }
  const bloqueado = await ips[5].pedir('POST', '/api/acesso/entrar', { documento: doc, senha: SENHA });
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.corpo.erro, 'bloqueado');
  amb.relogio.avancar(15 * 60 * 1000 + 1000);
  const liberado = await ips[6].pedir('POST', '/api/acesso/entrar', { documento: doc, senha: SENHA });
  assert.equal(liberado.status, 200);
});

test('S4: acerto zera o contador do documento', async () => {
  const doc = amb.contas.b.avaliador.documento;
  const c = amb.cliente();
  for (let i = 0; i < 4; i++) assert.equal((await c.pedir('POST', '/api/acesso/entrar', { documento: doc, senha: 'errada-123' })).status, 401);
  assert.equal((await c.pedir('POST', '/api/acesso/entrar', { documento: doc, senha: SENHA })).status, 200);
  const outro = amb.cliente();
  for (let i = 0; i < 4; i++) assert.equal((await outro.pedir('POST', '/api/acesso/entrar', { documento: doc, senha: 'errada-123' })).status, 401);
  assert.equal((await outro.pedir('POST', '/api/acesso/entrar', { documento: doc, senha: SENHA })).status, 200);
});

test('S4: 5 erros do mesmo IP com documentos diferentes bloqueiam o IP', async () => {
  const c = amb.cliente();
  for (let i = 0; i < 5; i++) {
    const r = await c.pedir('POST', '/api/acesso/entrar', { documento: gerarCPF(200000000 + i), senha: 'errada-123' });
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro, 'senha_incorreta');
  }
  const r = await c.pedir('POST', '/api/acesso/entrar', { documento: amb.contas.b.gestor.documento, senha: SENHA });
  assert.equal(r.status, 429);
  const outroIp = await amb.cliente().pedir('POST', '/api/acesso/entrar', { documento: amb.contas.b.gestor.documento, senha: SENHA });
  assert.equal(outroIp.status, 200);
  const { linhas } = await amb.banco.executar("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'login_bloqueado'");
  assert.ok(linhas[0].n >= 2);
});

test('S12: esqueci a senha responde igual para documento existente e inexistente', async () => {
  const c = amb.cliente();
  const antes = amb.emails.length;
  const existe = await c.pedir('POST', '/api/acesso/esqueci-senha', { documento: amb.contas.a.avaliador.documento });
  const naoExiste = await c.pedir('POST', '/api/acesso/esqueci-senha', { documento: '935.411.347-80' });
  assert.equal(existe.status, 200);
  assert.equal(naoExiste.status, 200);
  assert.deepEqual(existe.corpo, naoExiste.corpo);
  assert.equal(existe.corpo.link, undefined);
  await new Promise(ok => setImmediate(ok));
  assert.equal(amb.emails.length, antes + 1);
  assert.equal(amb.emails.at(-1).para, 'avaliador.a@teste.example');
  assert.match(amb.emails.at(-1).link, /^http:\/\/teste\.local\/#\/redefinir\?token=/);
  assert.equal((await c.pedir('POST', '/api/acesso/esqueci-senha', { documento: '123' })).corpo.erro, 'documento_invalido');
  const { linhas } = await amb.banco.executar('SELECT token_hash FROM tokens_redefinicao');
  assert.ok(linhas.every(l => l.token_hash !== amb.emails.at(-1).token));
});

test('S12: token vale uma vez e troca a senha', async () => {
  const conta = amb.contas.a.avaliador;
  const c = amb.cliente();
  await c.pedir('POST', '/api/acesso/esqueci-senha', { documento: conta.documento });
  await new Promise(ok => setImmediate(ok));
  const token = amb.emails.at(-1).token;
  assert.ok(Buffer.from(token, 'base64url').length >= 32);
  const proibida = await c.pedir('POST', '/api/acesso/redefinir', { token, senha: 'Exemplo#2026', senhaConfirmacao: 'Exemplo#2026' });
  assert.equal(proibida.corpo.erro, 'senha_proibida');
  const curta = await c.pedir('POST', '/api/acesso/redefinir', { token, senha: 'curta', senhaConfirmacao: 'curta' });
  assert.equal(curta.corpo.erro, 'validacao');
  const ok = await c.pedir('POST', '/api/acesso/redefinir', { token, senha: 'Nova-senha-123', senhaConfirmacao: 'Nova-senha-123' });
  assert.equal(ok.status, 204);
  const denovo = await c.pedir('POST', '/api/acesso/redefinir', { token, senha: 'Outra-senha-123', senhaConfirmacao: 'Outra-senha-123' });
  assert.equal(denovo.status, 400);
  assert.equal(denovo.corpo.erro, 'token_invalido');
  assert.equal((await c.pedir('POST', '/api/acesso/entrar', { documento: conta.documento, senha: 'Nova-senha-123' })).status, 200);
  assert.equal((await amb.cliente().pedir('POST', '/api/acesso/redefinir', { token: 'inventado', senha: 'Nova-senha-123', senhaConfirmacao: 'Nova-senha-123' })).corpo.erro, 'token_invalido');
});

test('S12: token vence depois de 1 hora', async () => {
  const c = amb.cliente();
  await c.pedir('POST', '/api/acesso/esqueci-senha', { documento: amb.contas.b.gestor.documento });
  await new Promise(ok => setImmediate(ok));
  const token = amb.emails.at(-1).token;
  amb.relogio.avancar(60 * 60 * 1000 + 1000);
  const r = await c.pedir('POST', '/api/acesso/redefinir', { token, senha: 'Nova-senha-123', senhaConfirmacao: 'Nova-senha-123' });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'token_invalido');
});

test('S14: banco novo não tem as contas de demonstração e o login com elas falha', async () => {
  const novo = await criarAmbiente();
  try {
    const { linhas } = await novo.banco.executar(`SELECT COUNT(*) AS n FROM usuarios WHERE documento IN (${DEMO.map(() => '?').join(',')})`, DEMO);
    assert.equal(linhas[0].n, 0);
    for (const doc of DEMO) {
      const r = await novo.cliente().pedir('POST', '/api/acesso/entrar', { documento: doc, senha: 'Exemplo#2026' });
      assert.equal(r.status, 401, doc);
    }
  } finally {
    await novo.fechar();
  }
});

test('S14: criar conta com CPF de demonstração ou com a senha de exemplo é recusado', async () => {
  const c = amb.cliente();
  for (const doc of DEMO) {
    const r = await c.pedir('POST', '/api/acesso/criar-conta', contaNova(doc));
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, 'documento_reservado');
  }
  const r = await c.pedir('POST', '/api/acesso/criar-conta', contaNova('93541134780', { senha: 'Exemplo#2026', senhaConfirmacao: 'Exemplo#2026' }));
  assert.equal(r.corpo.erro, 'senha_proibida');
  const g = await amb.entrar(amb.contas.a.gestor);
  const av = await g.pedir('POST', '/api/gestor/avaliadores', { nome: 'X', documento: DEMO[2], email: 'x@teste.example', senha: 'Senha-boa-1' });
  assert.equal(av.corpo.erro, 'documento_reservado');
  const p = await amb.entrar(amb.contas.a.proponente);
  const troca = await p.pedir('PUT', '/api/conta/senha', { senhaAtual: SENHA, novaSenha: 'Exemplo#2026', novaSenhaConfirmacao: 'Exemplo#2026' });
  assert.equal(troca.corpo.erro, 'senha_proibida');
});

test('criar conta entra direto e recusa documento repetido', async () => {
  const c = amb.cliente();
  const semOrg = await c.pedir('POST', '/api/acesso/criar-conta', contaNova('93541134780', { organizacao: 'nao-existe' }));
  assert.equal(semOrg.status, 404);
  assert.equal(semOrg.corpo.erro, 'organizacao_inexistente');
  const faltando = await c.pedir('POST', '/api/acesso/criar-conta', contaNova('93541134780', { nome: '', senhaConfirmacao: 'diferente-1' }));
  assert.equal(faltando.corpo.erro, 'validacao');
  assert.deepEqual(faltando.corpo.campos.map(x => x.campo).sort(), ['nome', 'senhaConfirmacao']);
  const r = await c.pedir('POST', '/api/acesso/criar-conta', contaNova('935.411.347-80'));
  assert.equal(r.status, 201);
  assert.equal(r.corpo.usuario.natureza, 'MEI');
  assert.deepEqual(r.corpo.usuario.organizacao, { slug: 'org-a', nome: 'Organização A de teste' });
  assert.equal((await c.pedir('GET', '/api/proponente/painel')).status, 200);
  const rep = await amb.cliente().pedir('POST', '/api/acesso/criar-conta', contaNova('93541134780'));
  assert.equal(rep.status, 409);
  assert.equal(rep.corpo.erro, 'documento_existente');
});

test('minha conta: documento inalterável, senha atual, CEP e troca de organização', async () => {
  const p = await amb.entrar(amb.contas.b.proponente);
  const doc = await p.pedir('PUT', '/api/conta', { nome: 'Novo nome', email: 'n@teste.example', telefone: '71911112222', documento: '93541134780', endereco: null });
  assert.equal(doc.corpo.erro, 'documento_inalteravel');
  const ok = await p.pedir('PUT', '/api/conta', {
    nome: 'Novo nome', email: 'n@teste.example', telefone: '71911112222',
    endereco: { cep: '40000-000', logradouro: 'Rua A', numero: '1', complemento: '', bairro: 'Centro', cidade: 'Cidade', uf: 'ba' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.usuario.nome, 'Novo nome');
  assert.equal(ok.corpo.usuario.endereco.uf, 'BA');
  assert.equal((await p.pedir('PUT', '/api/conta/senha', { senhaAtual: 'errada-123', novaSenha: 'Nova-senha-1', novaSenhaConfirmacao: 'Nova-senha-1' })).corpo.erro, 'senha_atual_incorreta');
  assert.equal((await p.pedir('GET', '/api/cep/40000000')).corpo.cidade, 'Cidade Teste');
  assert.equal((await p.pedir('GET', '/api/cep/123')).corpo.erro, 'cep_invalido');
  assert.equal((await p.pedir('GET', '/api/cep/99999999')).corpo.erro, 'cep_nao_encontrado');
  assert.equal((await p.pedir('GET', '/api/cep/00000000')).status, 502);
  const troca = await p.pedir('PUT', '/api/conta/organizacao', { organizacao: 'org-a' });
  assert.equal(troca.corpo.usuario.organizacao.slug, 'org-a');
  assert.equal((await p.pedir('PUT', '/api/conta/organizacao', { organizacao: 'nada' })).status, 404);
  await p.pedir('PUT', '/api/conta/organizacao', { organizacao: 'org-b' });
});
