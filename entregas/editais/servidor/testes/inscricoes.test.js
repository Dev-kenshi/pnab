// Inscrições: S7 (obrigatórios, protocolo, ficha congelada), S8 (teto) e S9 (anexos).
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { corpoEdital, criarAmbiente, fichaValida, pdfMinimo } from './ajuda.js';

let amb, gestor, prop, propB, slug;

function upload(cliente, id, bytes, { nome = 'portfolio.pdf', tipo = 'application/pdf', chave = 'extra-portfolio' } = {}) {
  return cliente.pedir('POST', `/api/inscricoes/${id}/anexos/${chave}`, undefined, {
    bruto: bytes, cabecalhos: { 'content-type': tipo, 'x-nome-arquivo': encodeURIComponent(nome) },
  });
}

async function rascunho(cliente = prop) {
  const r = await cliente.pedir('POST', '/api/inscricoes', { edital: slug, ficha: { titulo: 'Rascunho' } });
  assert.equal(r.status, 201);
  return r.corpo.inscricao.id;
}

before(async () => {
  amb = await criarAmbiente();
  gestor = await amb.entrar(amb.contas.a.gestor);
  prop = await amb.entrar(amb.contas.a.proponente);
  propB = await amb.entrar(amb.contas.b.proponente);
  slug = await amb.editalAberto(gestor);
});
after(async () => { await amb?.fechar(); });

test('S7: rascunho nasce sem protocolo e salva parcial', async () => {
  const id = await rascunho();
  const r = await prop.pedir('PUT', `/api/inscricoes/${id}`, { ficha: { titulo: 'Novo título', categoria: 'Teatro', campoEstranho: 'x' } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.inscricao.protocolo, null);
  assert.equal(r.corpo.inscricao.situacao, 'rascunho');
  assert.equal(r.corpo.inscricao.ficha.titulo, 'Novo título');
  assert.equal(r.corpo.inscricao.ficha.campoEstranho, undefined);
  assert.equal(r.corpo.inscricao.etapas[0].estado, 'atual');
});

test('S7: envio sem obrigatórios dá 400 com cada campo', async () => {
  const id = await rascunho();
  const r = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: {} });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'validacao');
  assert.deepEqual(r.corpo.campos.map(c => c.campo).sort(), ['aceite', 'categoria', 'cota', 'extra-resumo', 'titulo']);
  assert.ok(r.corpo.campos.every(c => c.mensagem.startsWith('Campo obrigatório: ')));
  const linha = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: fichaValida({ metas: [{ etapa: '', acao: '' }] }) });
  assert.deepEqual(linha.corpo.campos.map(c => [c.campo, c.linha]), [['meta-etapa', 0], ['meta-acao', 0]]);
  const ver = await prop.pedir('GET', `/api/inscricoes/${id}`);
  assert.equal(ver.corpo.inscricao.situacao, 'rascunho');
  assert.equal(ver.corpo.inscricao.protocolo, null);
});

test('S7: envio gera protocolos únicos no formato e congela a ficha', async () => {
  const protocolos = [];
  for (let i = 0; i < 3; i++) protocolos.push((await amb.inscricaoEnviada(prop, slug)).protocolo);
  for (const p of protocolos) assert.match(p, /^TEB-2026-\d{6}$/);
  assert.equal(new Set(protocolos).size, 3);
  const nums = protocolos.map(p => Number(p.slice(-6)));
  assert.deepEqual(nums, [nums[0], nums[0] + 1, nums[0] + 2]);

  const { id, protocolo } = await amb.inscricaoEnviada(prop, slug);
  const ver = await prop.pedir('GET', `/api/inscricoes/${protocolo}`);
  assert.equal(ver.status, 200);
  assert.equal(ver.corpo.inscricao.situacao, 'enviada');
  assert.equal(ver.corpo.inscricao.selo, 'Enviado');
  assert.equal(ver.corpo.inscricao.ficha.proponente.documento, amb.contas.a.proponente.documento);
  assert.equal(ver.corpo.inscricao.etapas[1].estado, 'atual');

  const put = await prop.pedir('PUT', `/api/inscricoes/${id}`, { ficha: fichaValida({ titulo: 'Mudado' }) });
  assert.equal(put.status, 409);
  assert.equal(put.corpo.erro, 'ficha_congelada');
  const reenvio = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: fichaValida() });
  assert.equal(reenvio.status, 409);
  assert.equal((await upload(prop, id, pdfMinimo())).corpo.erro, 'ficha_congelada');
  const depois = await prop.pedir('GET', `/api/inscricoes/${id}`);
  assert.equal(depois.corpo.inscricao.ficha.titulo, 'Projeto de teste');
});

test('S7: dono é o único que vê e altera a inscrição', async () => {
  const id = await rascunho();
  const outro = amb.cliente();
  await outro.pedir('POST', '/api/acesso/criar-conta', {
    organizacao: 'org-a', natureza: 'Coletivo', nome: 'Outro proponente', documento: '93541134780', email: 'o@teste.example',
    telefone: '71900000000', senha: 'Senha-boa-123', senhaConfirmacao: 'Senha-boa-123',
  });
  assert.equal((await outro.pedir('GET', `/api/inscricoes/${id}`)).status, 404);
  assert.equal((await outro.pedir('PUT', `/api/inscricoes/${id}`, { ficha: {} })).status, 404);
  assert.equal((await propB.pedir('GET', `/api/inscricoes/${id}`)).status, 404);
});

test('S8: orçamento acima do teto é recusado no envio', async () => {
  const id = await rascunho();
  const ficha = fichaValida({ orcamento: [{ descricao: 'Cenário', qtd: 10, valor: 150000 }] });
  const r = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'acima_do_teto');
  assert.equal(r.corpo.mensagem, 'Total R$ 15.000,00 passa do teto de R$ 10.000,00.');
  const ok = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: fichaValida({ orcamento: [{ descricao: 'Cenário', qtd: 10, valor: 100000 }] }) });
  assert.equal(ok.status, 200);
});

test('S9: anexo PDF é gravado cifrado, sem nome original e sem os bytes em claro', async () => {
  const id = await rascunho();
  const marca = 'CONTEUDO-SECRETO-DO-PDF';
  const bytes = pdfMinimo(marca);
  const r = await upload(prop, id, bytes, { nome: 'Meu portfólio secreto.pdf' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.anexo.nome, 'Meu portfólio secreto.pdf');
  assert.equal(r.corpo.anexo.tamanho, bytes.length);
  const { linhas } = await amb.banco.executar('SELECT arquivo_id FROM anexos WHERE id = ?', [r.corpo.anexo.id]);
  const arquivos = await readdir(amb.pastaAnexos);
  assert.ok(arquivos.includes(`${linhas[0].arquivo_id}.bin`));
  assert.ok(arquivos.every(a => !a.includes('portf')));
  const emDisco = await readFile(join(amb.pastaAnexos, `${linhas[0].arquivo_id}.bin`));
  assert.ok(!emDisco.includes(Buffer.from(marca)));
  assert.ok(!emDisco.includes(Buffer.from('%PDF-')));
  assert.equal(emDisco.length, bytes.length + 28);
  assert.deepEqual(await amb.anexos.ler(linhas[0].arquivo_id), bytes);
  const ficha = await prop.pedir('GET', `/api/inscricoes/${id}`);
  assert.deepEqual(ficha.corpo.inscricao.ficha.anexos['extra-portfolio'], r.corpo.anexo);
  const baixado = await prop.pedir('GET', `/api/anexos/${r.corpo.anexo.id}`);
  assert.deepEqual(baixado.bytes, bytes);
});

test('S9: arquivo adulterado falha na leitura', async () => {
  const id = await rascunho();
  const r = await upload(prop, id, pdfMinimo('adulterar'));
  const { linhas } = await amb.banco.executar('SELECT arquivo_id FROM anexos WHERE id = ?', [r.corpo.anexo.id]);
  const caminho = join(amb.pastaAnexos, `${linhas[0].arquivo_id}.bin`);
  const dados = await readFile(caminho);
  dados[dados.length - 1] ^= 0x01;
  await writeFile(caminho, dados);
  await assert.rejects(() => amb.anexos.ler(linhas[0].arquivo_id));
  const baixar = await prop.pedir('GET', `/api/anexos/${r.corpo.anexo.id}`);
  assert.equal(baixar.status, 500);
  assert.equal(baixar.corpo.erro, 'anexo_corrompido');
});

test('S9: só PDF é aceito', async () => {
  const id = await rascunho();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let r = await upload(prop, id, png, { nome: 'foto.png', tipo: 'image/png' });
  assert.equal(r.status, 415);
  assert.equal(r.corpo.erro, 'tipo_invalido');
  r = await upload(prop, id, png, { nome: 'falso.pdf' });
  assert.equal(r.status, 415);
  r = await upload(prop, id, pdfMinimo(), { nome: 'documento.exe' });
  assert.equal(r.status, 415);
  r = await upload(prop, id, pdfMinimo(), { chave: 'extra-resumo' });
  assert.equal(r.status, 404);
  r = await upload(prop, id, Buffer.alloc(0));
  assert.equal(r.status, 400);
});

test('S9: acima de 10 MB dá 413 e exatamente 10 MB passa', async () => {
  const id = await rascunho();
  const limite = 10 * 1024 * 1024;
  const grande = Buffer.alloc(limite + 1, 0x20);
  grande.write('%PDF-1.4\n', 0, 'latin1');
  const r = await upload(prop, id, grande);
  assert.equal(r.status, 413);
  assert.equal(r.corpo.erro, 'arquivo_grande');
  const certo = grande.subarray(0, limite);
  const ok = await upload(prop, id, certo);
  assert.equal(ok.status, 201);
  assert.equal(ok.corpo.anexo.tamanho, limite);
  const json = await prop.pedir('PUT', `/api/inscricoes/${id}`, undefined, {
    bruto: JSON.stringify({ ficha: { titulo: 'x'.repeat(1024 * 1024 + 10) } }), cabecalhos: { 'content-type': 'application/json' },
  });
  assert.equal(json.status, 413);
});

test('S9: anexo nunca sai por caminho público e o download exige sessão e acesso', async () => {
  const id = await rascunho();
  const r = await upload(prop, id, pdfMinimo('publico'));
  const anexoId = r.corpo.anexo.id;
  const { linhas } = await amb.banco.executar('SELECT arquivo_id FROM anexos WHERE id = ?', [anexoId]);
  const arquivo = `${linhas[0].arquivo_id}.bin`;
  const anon = amb.cliente();
  for (const caminho of [
    '/servidor/app.js', '/servidor/principal.js', `/servidor/dados/anexos/${arquivo}`, `/${arquivo}`, `/anexos/${arquivo}`,
    '/js/%2e%2e/servidor/app.js', '/js/..%2fservidor%2fapp.js', '/css/%2e%2e/package.json', '/package.json', '/.env', '/.gitignore',
    '/js/testes/regras.test.js', `/api/anexos/${arquivo}`,
  ]) {
    const x = await anon.pedir('GET', caminho);
    assert.ok(x.status === 404 || x.status === 401, `${caminho} deu ${x.status}`);
    assert.ok(!x.bytes.includes(Buffer.from('%PDF-')), caminho);
  }
  const js = await anon.pedir('GET', '/js/regras.js');
  assert.equal(js.status, 200);
  assert.match(js.cabecalhos.get('content-type'), /text\/javascript/);
  assert.equal((await anon.pedir('GET', `/api/anexos/${anexoId}`)).status, 401);
  assert.equal((await propB.pedir('GET', `/api/anexos/${anexoId}`)).status, 404);
  const avaliador = await amb.entrar(amb.contas.a.avaliador);
  assert.equal((await avaliador.pedir('GET', `/api/anexos/${anexoId}`)).status, 404);
  assert.equal((await gestor.pedir('GET', `/api/anexos/${anexoId}`)).status, 200);
});

test('F1: estáticos do front saem, inclusive /img/, e o resto continua bloqueado', async () => {
  const anon = amb.cliente();
  const logo = await anon.pedir('GET', '/img/logo.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.cabecalhos.get('content-type'), 'image/png');
  assert.ok(logo.bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  const head = await anon.pedir('HEAD', '/img/logo.png');
  assert.equal(head.status, 200);
  assert.equal(head.cabecalhos.get('content-type'), 'image/png');
  const pdf = await anon.pedir('GET', '/exemplos/edital-exemplo.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.cabecalhos.get('content-type'), 'application/pdf');
  for (const [caminho, tipo] of [['/', /text\/html/], ['/index.html', /text\/html/], ['/js/app.js', /text\/javascript/]]) {
    const x = await anon.pedir('GET', caminho);
    assert.equal(x.status, 200, caminho);
    assert.match(x.cabecalhos.get('content-type'), tipo, caminho);
  }
  const folhas = (await readdir(new URL('../../css/', import.meta.url))).filter(n => n.endsWith('.css'));
  const css = await anon.pedir('GET', `/css/${folhas[0]}`);
  assert.equal(css.status, 200);
  assert.match(css.cabecalhos.get('content-type'), /text\/css/);
  for (const caminho of [
    '/img/%2e%2e/servidor/app.js', '/img/..%2fservidor%2fapp.js', '/img/../package.json', '/img/.oculto', '/img/%2eoculto',
    '/img/', '/img', '/js/testes/regras.test.js', '/servidor/app.js', '/img/..%5cservidor%5capp.js',
  ]) {
    const x = await anon.pedir('GET', caminho);
    assert.equal(x.status, 404, `${caminho} deu ${x.status}`);
  }
});

test('F2: valor do item é guardado em centavos, sem arredondar', async () => {
  const id = await rascunho();
  const orcamento = [{ descricao: 'Lanche', qtd: 1, valor: 1050 }, { descricao: 'Bala', qtd: 3, valor: 10 }];
  const r = await prop.pedir('PUT', `/api/inscricoes/${id}`, { ficha: fichaValida({ orcamento }) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.inscricao.ficha.orcamento.map(o => o.valor), [1050, 10]);
  const ver = await prop.pedir('GET', `/api/inscricoes/${id}`);
  assert.deepEqual(ver.corpo.inscricao.ficha.orcamento.map(o => o.valor), [1050, 10]);
  const env = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: fichaValida({ orcamento }) });
  assert.equal(env.status, 200);
  const { linhas } = await amb.banco.executar('SELECT ficha FROM inscricoes WHERE id = ?', [id]);
  assert.deepEqual(JSON.parse(linhas[0].ficha).orcamento.map(o => o.valor), [1050, 10]);
});

test('F2: valor negativo, fracionado em centavos ou texto dá 400 validacao e não grava', async () => {
  const id = await rascunho();
  for (const [valor, mensagem] of [
    [-1, 'Valor do item não pode ser negativo'],
    [10.5, 'Valor do item inválido. Use no máximo dois decimais.'],
    [0.1, 'Valor do item inválido. Use no máximo dois decimais.'],
    ['abc', 'Valor do item inválido.'],
  ]) {
    const orcamento = [{ descricao: 'Ok', qtd: 1, valor: 500 }, { descricao: 'Ruim', qtd: 1, valor }];
    const r = await prop.pedir('PUT', `/api/inscricoes/${id}`, { ficha: fichaValida({ orcamento }) });
    assert.equal(r.status, 400, String(valor));
    assert.equal(r.corpo.erro, 'validacao');
    assert.deepEqual(r.corpo.campos, [{ campo: 'orc-valor', mensagem, linha: 1 }]);
    const env = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: fichaValida({ orcamento }) });
    assert.equal(env.status, 400);
    assert.equal(env.corpo.erro, 'validacao');
  }
  const ver = await prop.pedir('GET', `/api/inscricoes/${id}`);
  assert.equal(ver.corpo.inscricao.situacao, 'rascunho');
  assert.equal(ver.corpo.inscricao.ficha.titulo, 'Rascunho');
  const vazio = await prop.pedir('PUT', `/api/inscricoes/${id}`, { ficha: { titulo: 'Parcial', orcamento: [{ descricao: 'A definir', qtd: 1, valor: '' }] } });
  assert.equal(vazio.status, 200);
  assert.equal(vazio.corpo.inscricao.ficha.orcamento[0].valor, null);
});

test('F4: teto do edital recusado com mensagem em reais', async () => {
  for (const [teto, mensagem] of [
    ['', 'Campo obrigatório: Teto do orçamento (R$)'],
    [-500, 'O teto precisa ser maior que R$ 0,00.'],
    [0, 'O teto precisa ser maior que R$ 0,00.'],
    [10.5, 'Teto inválido. Informe o valor em reais, como 10.000,00.'],
  ]) {
    const r = await gestor.pedir('POST', '/api/gestor/editais', corpoEdital(amb.relogio, { numero: `TETO-${String(teto)}`, teto }));
    assert.equal(r.status, 400, String(teto));
    const campo = r.corpo.campos.find(c => c.campo === 'teto');
    assert.equal(campo.mensagem, mensagem);
    assert.ok(!/centavo/i.test(campo.mensagem));
  }
});

// Fica por último: encerra o edital usado pelos testes acima.
test('edital encerrado não aceita inscrição nem envio', async () => {
  const id = await rascunho();
  assert.equal((await gestor.pedir('POST', `/api/gestor/editais/${slug}/encerrar`, {})).status, 200);
  const criar = await prop.pedir('POST', '/api/inscricoes', { edital: slug, ficha: {} });
  assert.equal(criar.status, 409);
  assert.equal(criar.corpo.erro, 'edital_fechado');
  const enviar = await prop.pedir('POST', `/api/inscricoes/${id}/enviar`, { ficha: fichaValida() });
  assert.equal(enviar.corpo.erro, 'edital_fechado');
});

