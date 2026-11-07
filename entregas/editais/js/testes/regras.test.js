// Testes das regras compartilhadas entre front e servidor. Cobre S1 e parte de S7, S8 e S10.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as r from '../regras.js';

test('S1: CPF da spec é válido e com máscara também', () => {
  for (const cpf of ['529.982.247-25', '11144477735', '390.533.447-05', '168.995.350-09', '935.411.347-80']) {
    assert.equal(r.validarCPF(cpf), true, cpf);
  }
});

test('S1: CPF com dígito errado e sequências repetidas são inválidos', () => {
  assert.equal(r.validarCPF('111.111.111-11'), false);
  assert.equal(r.validarCPF('52998224724'), false);
  assert.equal(r.validarCPF('5299822472'), false);
  for (let d = 0; d <= 9; d++) assert.equal(r.validarCPF(String(d).repeat(11)), false);
});

test('S1: CNPJ por dígito verificador', () => {
  assert.equal(r.validarCNPJ('11.222.333/0001-81'), true);
  assert.equal(r.validarCNPJ('11222333000181'), true);
  assert.equal(r.validarCNPJ('11.222.333/0001-80'), false);
  for (let d = 0; d <= 9; d++) assert.equal(r.validarCNPJ(String(d).repeat(14)), false);
});

test('S1: validarDocumento identifica o tipo', () => {
  assert.deepEqual(r.validarDocumento('529.982.247-25'), { valido: true, tipo: 'cpf', digitos: '52998224725' });
  assert.deepEqual(r.validarDocumento('11.222.333/0001-81'), { valido: true, tipo: 'cnpj', digitos: '11222333000181' });
  assert.deepEqual(r.validarDocumento('123'), { valido: false, tipo: null, digitos: '123' });
  assert.equal(r.validarDocumento('').valido, false);
  assert.equal(r.formatarDocumento('52998224725'), '529.982.247-25');
  assert.equal(r.formatarDocumento('11222333000181'), '11.222.333/0001-81');
});

test('moeda e nota no formato pt-BR com espaço comum', () => {
  assert.equal(r.formatarMoeda(1500000), 'R$ 15.000,00');
  assert.equal(r.formatarMoeda(0), 'R$ 0,00');
  assert.equal(r.formatarMoeda(123456789), 'R$ 1.234.567,89');
  assert.equal(r.formatarMoeda(5), 'R$ 0,05');
  assert.ok(!r.formatarMoeda(100).includes(' '));
  assert.equal(r.formatarNota(15), '15,0');
  assert.equal(r.formatarNota(14.25), '14,3');
  assert.equal(r.formatarNota(0), '0,0');
});

test('reaisParaCentavos aceita número e texto com vírgula', () => {
  assert.equal(r.reaisParaCentavos(1500), 150000);
  assert.equal(r.reaisParaCentavos('1500'), 150000);
  assert.equal(r.reaisParaCentavos('1.500,50'), 150050);
  assert.equal(r.reaisParaCentavos('R$ 10,1'), 1010);
  assert.equal(r.reaisParaCentavos('0.1'), 10);
  assert.equal(r.reaisParaCentavos(''), 0);
  assert.equal(r.reaisParaCentavos('abc'), 0);
});

test('slug tira acento e troca o resto por hífen', () => {
  assert.equal(r.slug('Bônus regional'), 'bonus-regional');
  assert.equal(r.slug('EX-002/2026'), 'ex-002-2026');
  assert.equal(r.slug('  Ação & Música!  '), 'acao-musica');
});

test('S8: total da planilha e alerta de teto com o texto exato', () => {
  const linhas = [{ descricao: 'Cenário', qtd: 10, valor: r.reaisParaCentavos(1500) }];
  const total = r.totalOrcamento(linhas);
  assert.equal(total, 1500000);
  assert.equal(r.mensagemTeto(total, 1000000), 'Total R$ 15.000,00 passa do teto de R$ 10.000,00.');
  assert.equal(r.mensagemTeto(1000000, 1000000), null);
  assert.equal(r.totalOrcamento([]), 0);
});

const edital = {
  categorias: ['Teatro'],
  cotas: ['Ampla concorrência'],
  camposExtras: [
    { chave: 'extra-resumo', rotulo: 'Resumo do projeto', tipo: 'texto-longo', obrigatorio: true },
    { chave: 'anexo', rotulo: 'Portfólio em PDF', tipo: 'anexo', obrigatorio: false },
  ],
};

test('S7: validarFicha aponta cada obrigatório vazio', () => {
  const erros = r.validarFicha(edital, {});
  const campos = erros.map(e => e.campo).sort();
  assert.deepEqual(campos, ['aceite', 'categoria', 'cota', 'extra-resumo', 'titulo']);
  assert.ok(erros.every(e => e.mensagem.startsWith('Campo obrigatório: ')));
  assert.ok(erros.some(e => e.mensagem === 'Campo obrigatório: Resumo do projeto'));
});

test('S7: validarFicha aceita ficha completa e confere as linhas', () => {
  const ficha = {
    titulo: 'Oficina', categoria: 'Teatro', cota: 'Ampla concorrência', extras: { 'extra-resumo': 'Resumo' }, aceite: true,
    metas: [{ etapa: 'Ensaios', acao: 'Ensaiar' }], equipe: [], orcamento: [{ descricao: 'Cenário', qtd: 1, valor: 0 }],
  };
  assert.deepEqual(r.validarFicha(edital, ficha), []);
  const ruim = { ...ficha, metas: [{ etapa: '', acao: '' }], equipe: [{ nome: 'Ana', funcao: '' }], orcamento: [{ descricao: 'X', qtd: 0, valor: -1 }] };
  const erros = r.validarFicha(edital, ruim);
  assert.deepEqual(erros.map(e => `${e.campo}:${e.linha}`).sort(), ['equipe-funcao:0', 'meta-acao:0', 'meta-etapa:0', 'orc-qtd:0', 'orc-valor:0']);
});

test('F5: valor do item negativo tem mensagem própria, vazio continua obrigatório', () => {
  assert.equal(r.erroValorItem(-1), 'Valor do item não pode ser negativo');
  assert.equal(r.erroValorItem(-500), 'Valor do item não pode ser negativo');
  assert.equal(r.erroValorItem(''), 'Campo obrigatório: Valor do item');
  assert.equal(r.erroValorItem(null), 'Campo obrigatório: Valor do item');
  assert.equal(r.erroValorItem(10.5), 'Valor do item inválido. Use no máximo dois decimais.');
  assert.equal(r.erroValorItem('abc'), 'Valor do item inválido.');
  assert.equal(r.erroValorItem(true), 'Valor do item inválido.');
  assert.equal(r.erroValorItem(0), null);
  assert.equal(r.erroValorItem(1050), null);
  assert.equal(r.erroValorItem(r.reaisParaCentavos('10,50')), null);
  assert.equal(r.erroValorItem(r.reaisParaCentavos('0,10')), null);
  const base = { titulo: 'T', categoria: 'Teatro', cota: 'Ampla concorrência', extras: { 'extra-resumo': 'R' }, aceite: true, metas: [], equipe: [] };
  const neg = r.validarFicha(edital, { ...base, orcamento: [{ descricao: 'X', qtd: 3, valor: -500 }] });
  assert.deepEqual(neg, [{ campo: 'orc-valor', mensagem: 'Valor do item não pode ser negativo', linha: 0 }]);
  const vaz = r.validarFicha(edital, { ...base, orcamento: [{ descricao: 'X', qtd: 3, valor: null }] });
  assert.deepEqual(vaz, [{ campo: 'orc-valor', mensagem: 'Campo obrigatório: Valor do item', linha: 0 }]);
  const cent = r.validarFicha(edital, { ...base, orcamento: [{ descricao: 'X', qtd: 1, valor: 1050 }, { descricao: 'Y', qtd: 1, valor: 10 }] });
  assert.deepEqual(cent, []);
  assert.equal(r.totalOrcamento([{ qtd: 1, valor: 1050 }, { qtd: 1, valor: 10 }]), 1060);
});

test('F4: mensagem do teto fala em reais, não em centavos', () => {
  assert.equal(r.erroTeto(''), 'Campo obrigatório: Teto do orçamento (R$)');
  assert.equal(r.erroTeto(null), 'Campo obrigatório: Teto do orçamento (R$)');
  assert.equal(r.erroTeto(-500), 'O teto precisa ser maior que R$ 0,00.');
  assert.equal(r.erroTeto(0), 'O teto precisa ser maior que R$ 0,00.');
  assert.equal(r.erroTeto(10.5), 'Teto inválido. Informe o valor em reais, como 10.000,00.');
  assert.equal(r.erroTeto(1000000), null);
  for (const v of ['', -1, 0, 1.5, 'x']) assert.ok(!/centavo/i.test(r.erroTeto(v)));
});

const criterios = [
  { chave: 'qualidade', nome: 'Qualidade', maximo: 10, bonus: false },
  { chave: 'viabilidade', nome: 'Viabilidade', maximo: 10, bonus: false },
  { chave: 'bonus-regional', nome: 'Bônus regional', maximo: 2, bonus: true },
];

test('S10: notas 8, 7 e 0 dão nota geral 15', () => {
  const v = r.validarNotas(criterios, { qualidade: 8, viabilidade: 7, 'bonus-regional': 0 });
  assert.deepEqual(v.erros, []);
  assert.equal(v.notaGeral, 15);
  assert.equal(r.formatarNota(v.notaGeral), '15,0');
});

test('S10: nota vazia, acima do máximo e negativa são recusadas', () => {
  const v = r.validarNotas(criterios, { qualidade: '', viabilidade: 11, 'bonus-regional': -1 });
  assert.deepEqual(v.erros.map(e => e.campo), ['qualidade', 'viabilidade', 'bonus-regional']);
  assert.equal(r.validarNotas(criterios, { qualidade: 8, viabilidade: 7 }).erros[0].campo, 'bonus-regional');
  assert.equal(r.validarNotas(criterios, { qualidade: 'x', viabilidade: 7, 'bonus-regional': 0 }).erros[0].campo, 'qualidade');
});

test('etapas: 7 itens com atual conforme a situação', () => {
  const pub = { resultadoPublicadoEm: '2026-06-01T00:00:00Z' };
  const atual = e => e.findIndex(x => x.estado === 'atual') + 1;
  assert.equal(r.calcularEtapas({ situacao: 'rascunho' }, {}).length, 7);
  assert.equal(atual(r.calcularEtapas({ situacao: 'rascunho' }, {})), 1);
  assert.equal(atual(r.calcularEtapas({ situacao: 'enviada' }, {})), 2);
  assert.equal(atual(r.calcularEtapas({ situacao: 'enviada', resultado: 'nao_selecionado' }, pub)), 3);
  const sel = r.calcularEtapas({ situacao: 'enviada', resultado: 'selecionado', etapa: 5 }, pub);
  assert.equal(atual(sel), 5);
  assert.equal(sel[4].nome, 'Habilitação');
  assert.deepEqual(sel.map(e => e.estado), ['passada', 'passada', 'passada', 'passada', 'atual', 'futura', 'futura']);
  assert.equal(r.calcularEtapas({ situacao: 'enviada', resultado: 'suplente', etapa: 4 }, pub)[3].nome, 'Suplente');
  assert.ok(r.calcularEtapas({ situacao: 'concluida' }, pub).every(e => e.estado === 'passada'));
  assert.equal(r.ETAPAS[6], 'Execução');
});

test('contadores e selo seguem a spec: 4, 2, 1 e 1', () => {
  const editais = {
    'ed-000': { resultadoPublicadoEm: '2026-06-01T00:00:00Z' },
    'ed-002': { resultadoPublicadoEm: null },
    'ed-2025': { resultadoPublicadoEm: '2025-06-01T00:00:00Z' },
  };
  const inscricoes = [
    { edital: 'ed-000', situacao: 'enviada', resultado: 'selecionado', etapa: 5 },
    { edital: { slug: 'ed-000' }, situacao: 'enviada', resultado: 'nao_selecionado' },
    { edital: 'ed-002', situacao: 'enviada', resultado: null },
    { edital: 'ed-2025', situacao: 'concluida', resultado: 'selecionado' },
    { edital: 'ed-002', situacao: 'rascunho' },
  ];
  assert.deepEqual(r.contadores(inscricoes, editais), { enviados: 4, andamento: 2, concluidos: 1, naoAprovados: 1 });
  assert.equal(r.selo(inscricoes[1], editais['ed-000']), 'Não aprovado');
  assert.equal(r.selo(inscricoes[2], editais['ed-002']), 'Enviado');
  assert.equal(r.selo(inscricoes[3], editais['ed-2025']), 'Concluído');
  assert.equal(r.selo({ situacao: 'enviada', resultado: 'selecionado' }, editais['ed-002']), 'Enviado');
});

test('período, abertura, prazo de recurso e abas', () => {
  const agora = new Date('2026-06-15T12:00:00Z');
  assert.equal(r.fimDoPeriodo('2026-06-15').toISOString(), '2026-06-16T02:59:59.000Z');
  const ed = { situacao: 'aberto', inicio: '2026-06-01', fim: '2026-06-30', categorias: ['A'], cotas: ['B'], criterios: [{}] };
  assert.equal(r.periodoAberto(ed, agora), true);
  assert.equal(r.periodoAberto({ ...ed, situacao: 'encerrado' }, agora), false);
  assert.equal(r.periodoAberto({ ...ed, fim: '2026-06-14' }, agora), false);
  assert.deepEqual(r.motivosParaNaoAbrir(ed, agora), []);
  assert.equal(r.motivosParaNaoAbrir({ ...ed, fim: '2026-06-01', categorias: [], cotas: [], criterios: [] }, agora).length, 4);
  const pub = '2026-06-01T12:00:00.000Z';
  assert.equal(r.prazoRecurso(pub).toISOString(), '2026-06-16T12:00:00.000Z');
  const insc = { situacao: 'enviada', resultado: 'nao_selecionado' };
  assert.equal(r.recursoPermitido({ inscricao: insc, edital: { resultadoPublicadoEm: pub }, recurso: null, agora }), true);
  assert.equal(r.recursoPermitido({ inscricao: insc, edital: { resultadoPublicadoEm: pub }, recurso: {}, agora }), false);
  assert.equal(r.recursoPermitido({ inscricao: insc, edital: { resultadoPublicadoEm: pub }, recurso: null, agora: new Date('2026-06-17T00:00:00Z') }), false);
  assert.equal(r.recursoPermitido({ inscricao: insc, edital: {}, recurso: null, agora }), false);
  assert.deepEqual(r.abasLiberadas({ situacao: 'enviada', resultado: 'selecionado', etapa: 5 }, { resultadoPublicadoEm: pub }), { habilitacao: true, termo: false });
  assert.deepEqual(r.abasLiberadas({ situacao: 'enviada', etapa: 1 }, {}), { habilitacao: false, termo: false });
  assert.deepEqual(r.abasLiberadas({ situacao: 'concluida' }, {}), { habilitacao: true, termo: true });
});

test('protocolo, senha e arquivo PDF', () => {
  assert.equal(r.gerarProtocolo(2026, 105), 'TEB-2026-000105');
  assert.match(r.gerarProtocolo(2026, 1), /^TEB-\d{4}-\d{6}$/);
  assert.equal(r.validarSenha('curta'), 'A senha precisa ter ao menos 8 caracteres.');
  assert.equal(r.validarSenha('suficiente'), null);
  assert.equal(r.validarArquivoPdf({ nome: 'a.pdf', tipo: 'application/pdf', tamanho: 100 }), null);
  assert.ok(r.validarArquivoPdf({ nome: 'a.png', tipo: 'image/png', tamanho: 100 }));
  assert.ok(r.validarArquivoPdf({ nome: 'a.pdf', tipo: 'application/pdf', tamanho: r.LIMITE_ANEXO + 1 }));
  assert.equal(r.validarArquivoPdf({ nome: 'a.pdf', tipo: 'application/pdf', tamanho: r.LIMITE_ANEXO }), null);
});
