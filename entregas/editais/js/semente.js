// Dados semeados do modo demonstração. Tudo aqui é fictício.
// Só o front importa este arquivo. O servidor real nunca o importa.
// Senha de exemplo e CPFs de exemplo valem apenas no modo demonstração.
import { calcularEtapas } from './regras.js';

export const SENHA_EXEMPLO = 'Exemplo#2026';
export const DIA_MS = 24 * 60 * 60 * 1000;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

export function gerarAleatorio(tamanho = 16) {
  const b = new Uint8Array(tamanho);
  globalThis.crypto.getRandomValues(b);
  return hex(b);
}

export const gerarSal = () => gerarAleatorio(16);

// Senha guardada como SHA-256 com sal. Nunca em texto.
export async function hashSenha(senha, sal) {
  const dados = new TextEncoder().encode(`${sal}:${senha}`);
  return hex(await globalThis.crypto.subtle.digest('SHA-256', dados));
}

// Data AAAA-MM-DD no fuso -03:00, com deslocamento em dias a partir de agora.
export function dataRelativa(agora, dias) {
  return new Date(agora.getTime() + dias * DIA_MS - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const instanteRelativo = (agora, dias) => new Date(agora.getTime() + dias * DIA_MS).toISOString();

const CRITERIOS = [
  { chave: 'qualidade', nome: 'Qualidade', maximo: 10, bonus: false },
  { chave: 'viabilidade', nome: 'Viabilidade', maximo: 10, bonus: false },
  { chave: 'bonus-regional', nome: 'Bônus regional', maximo: 2, bonus: true },
];

const CAMPOS_EXTRAS = [
  { chave: 'extra-resumo', rotulo: 'Resumo do projeto', tipo: 'texto-longo', obrigatorio: true },
  { chave: 'anexo', rotulo: 'Portfólio em PDF', tipo: 'anexo', obrigatorio: false },
];

const CATEGORIAS = ['Teatro', 'Música', 'Artes Visuais'];
const COTAS = ['Ampla concorrência', 'Pessoas negras', 'Indígenas', 'PcD'];

function edital(base) {
  return {
    descricao: 'Edital de exemplo fictício, criado para demonstração.',
    teto: 1000000,
    resultadoPublicadoEm: null,
    categorias: [...CATEGORIAS],
    cotas: [...COTAS],
    criterios: CRITERIOS.map(c => ({ ...c })),
    camposExtras: CAMPOS_EXTRAS.map(c => ({ ...c })),
    ...base,
  };
}

function notas(valores) {
  return CRITERIOS.map((c, i) => ({ ...c, nota: valores[i] }));
}

async function conta(id, organizacaoId, papel, nome, natureza, documento, email, telefone) {
  const sal = gerarSal();
  return {
    id, organizacaoId, papel, nome, natureza, documento, email, telefone, endereco: null,
    sal, senhaHash: await hashSenha(SENHA_EXEMPLO, sal),
  };
}

// Devolve o banco inicial. Datas relativas a agora, para não vencerem.
export async function semear(agora) {
  const marina = {
    nome: 'Marina Exemplo (exemplo fictício)', natureza: 'Pessoa Física', documento: '52998224725',
    email: 'marina@teb.example', telefone: '00900000001',
  };
  const usuarios = [
    await conta(1, 1, 'proponente', marina.nome, marina.natureza, marina.documento, marina.email, marina.telefone),
    await conta(2, 1, 'gestor', 'Gestor Exemplo (exemplo fictício)', null, '11144477735', 'gestor@teb.example', '00900000002'),
    await conta(3, 1, 'avaliador', 'Avaliadora Exemplo (exemplo fictício)', null, '39053344705', 'avaliadora@teb.example', '00900000003'),
    await conta(4, null, 'plataforma', 'Admin Exemplo TEB (exemplo fictício)', null, '16899535009', 'admin@teb.example', '00900000004'),
  ];

  const editais = [
    edital({
      id: 1, organizacaoId: 1, slug: 'ed-exemplo-001', numero: 'Exemplo 001/2026', titulo: 'Edital Exemplo 001/2026 (exemplo fictício)',
      inicio: dataRelativa(agora, -10), fim: dataRelativa(agora, 30), ano: 2026, situacao: 'aberto', criadoEm: instanteRelativo(agora, -11),
    }),
    edital({
      id: 2, organizacaoId: 1, slug: 'ed-exemplo-000', numero: 'Exemplo 000/2026', titulo: 'Edital Exemplo 000/2026 (exemplo fictício)',
      inicio: dataRelativa(agora, -90), fim: dataRelativa(agora, -45), ano: 2026, situacao: 'encerrado',
      resultadoPublicadoEm: instanteRelativo(agora, -3), criadoEm: instanteRelativo(agora, -95),
    }),
    edital({
      id: 3, organizacaoId: 1, slug: 'ed-exemplo-002', numero: 'Exemplo 002/2026', titulo: 'Edital Exemplo 002/2026 (exemplo fictício)',
      inicio: dataRelativa(agora, -60), fim: dataRelativa(agora, -20), ano: 2026, situacao: 'encerrado', criadoEm: instanteRelativo(agora, -65),
    }),
    edital({
      id: 4, organizacaoId: 1, slug: 'ed-exemplo-2025', numero: 'Exemplo 003/2025', titulo: 'Edital Exemplo 003/2025 (exemplo fictício)',
      inicio: '2025-03-01', fim: '2025-04-30', ano: 2025, situacao: 'encerrado',
      resultadoPublicadoEm: '2025-06-01T12:00:00.000Z', criadoEm: '2025-02-20T12:00:00.000Z',
    }),
    edital({
      id: 5, organizacaoId: 2, slug: 'ed-aurora-001', numero: 'Aurora 001/2026', titulo: 'Edital Aurora 001/2026 (exemplo fictício)',
      descricao: 'Edital de exemplo fictício da Produtora Exemplo Aurora.',
      inicio: dataRelativa(agora, -5), fim: dataRelativa(agora, 40), ano: 2026, situacao: 'aberto', teto: 500000,
      categorias: ['Música'], cotas: ['Ampla concorrência'],
      criterios: [{ chave: 'merito', nome: 'Mérito', maximo: 10, bonus: false }], camposExtras: [],
      criadoEm: instanteRelativo(agora, -6),
    }),
  ];
  const porSlug = Object.fromEntries(editais.map(e => [e.slug, e]));

  const ficha = (titulo, categoria, cota) => ({
    titulo, categoria, cota,
    extras: { 'extra-resumo': 'Resumo de exemplo fictício do projeto.' },
    metas: [{ etapa: 'Ensaios', inicio: '', fim: '', acao: 'Realizar ensaios abertos (exemplo fictício)' }],
    equipe: [{ nome: 'Pessoa Exemplo (exemplo fictício)', funcao: 'Direção', documento: '' }],
    orcamento: [{ descricao: 'Item de exemplo fictício', qtd: 4, valor: 150000 }],
    anexos: {},
    aceite: true,
    proponente: { nome: marina.nome, documento: marina.documento, natureza: marina.natureza, email: marina.email, telefone: marina.telefone },
  });

  const inscricoes = [
    {
      id: 'semente-000101', organizacaoId: 1, editalId: 2, usuarioId: 1, protocolo: 'TEB-2026-000101',
      ficha: ficha('Projeto Exemplo A (exemplo fictício)', 'Teatro', 'Ampla concorrência'),
      situacao: 'enviada', resultado: 'selecionado', etapa: 5, avaliadorId: 3,
      enviadaEm: instanteRelativo(agora, -60), criadoEm: instanteRelativo(agora, -62), atualizadoEm: instanteRelativo(agora, -3),
    },
    {
      id: 'semente-000102', organizacaoId: 1, editalId: 2, usuarioId: 1, protocolo: 'TEB-2026-000102',
      ficha: ficha('Projeto Exemplo B (exemplo fictício)', 'Música', 'Pessoas negras'),
      situacao: 'enviada', resultado: 'nao_selecionado', etapa: 3, avaliadorId: 3,
      enviadaEm: instanteRelativo(agora, -59), criadoEm: instanteRelativo(agora, -61), atualizadoEm: instanteRelativo(agora, -3),
    },
    {
      id: 'semente-000103', organizacaoId: 1, editalId: 3, usuarioId: 1, protocolo: 'TEB-2026-000103',
      ficha: ficha('Projeto Exemplo C (exemplo fictício)', 'Artes Visuais', 'Ampla concorrência'),
      situacao: 'enviada', resultado: null, etapa: 2, avaliadorId: 3,
      enviadaEm: instanteRelativo(agora, -30), criadoEm: instanteRelativo(agora, -32), atualizadoEm: instanteRelativo(agora, -30),
    },
    {
      id: 'semente-000104', organizacaoId: 1, editalId: 4, usuarioId: 1, protocolo: 'TEB-2026-000104',
      ficha: ficha('Projeto Exemplo D (exemplo fictício)', 'Teatro', 'Ampla concorrência'),
      situacao: 'concluida', resultado: 'selecionado', etapa: 7, avaliadorId: null,
      enviadaEm: '2025-04-20T12:00:00.000Z', criadoEm: '2025-04-18T12:00:00.000Z', atualizadoEm: '2025-12-01T12:00:00.000Z',
    },
  ];

  const avaliacoes = [
    { inscricaoId: 'semente-000101', organizacaoId: 1, avaliadorId: 3, notas: notas([9, 9, 1]), notaGeral: 19, parecer: 'Parecer de exemplo fictício.', enviadaEm: instanteRelativo(agora, -10) },
    { inscricaoId: 'semente-000102', organizacaoId: 1, avaliadorId: 3, notas: notas([7, 7, 0]), notaGeral: 14, parecer: 'Parecer de exemplo fictício.', enviadaEm: instanteRelativo(agora, -10) },
  ];

  // Confere a própria semente: a inscrição 101 precisa estar em Habilitação.
  const etapa101 = calcularEtapas(inscricoes[0], porSlug['ed-exemplo-000']).find(e => e.estado === 'atual');
  if (etapa101?.nome !== 'Habilitação') throw new Error('Semente inconsistente: 101 deveria estar em Habilitação.');

  return {
    versao: 1,
    criadoEm: agora.toISOString(),
    organizacoes: [
      { id: 1, slug: 'fundacao-exemplo', nome: 'Fundação Exemplo de Cultura (exemplo fictício)' },
      { id: 2, slug: 'produtora-aurora', nome: 'Produtora Exemplo Aurora (exemplo fictício)' },
    ],
    usuarios,
    editais,
    inscricoes,
    avaliacoes,
    recursos: [],
    anexos: [],
    avisos: [
      { id: 1, organizacaoId: 1, texto: 'Aviso de exemplo fictício: prazo de envio da habilitação.', ativo: true, criadoEm: agora.toISOString() },
    ],
    tentativas: {},
    tokens: [],
    sequencias: { 'protocolo-2026': 104 },
    ids: { usuario: 4, organizacao: 2, edital: 5, aviso: 1 },
  };
}
