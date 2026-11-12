// Exemplo no servidor real: recurso de TESTE, desligado por padrão.
// Espelha as telas do modo demonstração (js/semente.js) com contas próprias, senhas com scrypt e
// CPFs fictícios diferentes dos reservados da demonstração. Nenhuma senha fica no código.
// Idempotente: se a organização exemplo-teste já existe, nada é criado nem alterado.
import * as regras from '../js/regras.js';
import { registrar } from './auditoria.js';
import { DOCUMENTOS_RESERVADOS, SENHA_PROIBIDA } from './seguranca.js';
import { inserirUsuario } from './rotas/acesso.js';

const DIA_MS = 24 * 60 * 60 * 1000;

export const ORG_EXEMPLO = { slug: 'exemplo-teste', nome: 'Fundação Cultural Exemplo (teste)' };

// CPFs fictícios válidos por dígito, fora de DOCUMENTOS_RESERVADOS.
export const CONTAS_EXEMPLO = {
  gestor: { papel: 'gestor', nome: 'Gestora Exemplo (exemplo)', documento: '86135792482', email: 'gestora.exemplo@teb.example', telefone: '00900000011', natureza: null },
  avaliador: { papel: 'avaliador', nome: 'Avaliador Exemplo (exemplo)', documento: '86246813593', email: 'avaliador.exemplo@teb.example', telefone: '00900000012', natureza: null },
  proponente: { papel: 'proponente', nome: 'Proponente Exemplo (exemplo)', documento: '86357924679', email: 'proponente.exemplo@teb.example', telefone: '00900000013', natureza: 'Pessoa Física' },
};

const CRITERIOS = [
  { chave: 'qualidade', nome: 'Qualidade', maximo: 10, bonus: false },
  { chave: 'viabilidade', nome: 'Viabilidade', maximo: 10, bonus: false },
  { chave: 'bonus-regional', nome: 'Bônus regional', maximo: 2, bonus: true },
];

const MODELO = {
  categorias: ['Teatro', 'Música', 'Artes Visuais'],
  cotas: ['Ampla concorrência', 'Pessoas negras', 'Indígenas', 'PcD'],
  criterios: CRITERIOS,
  camposExtras: [
    { chave: 'extra-resumo', rotulo: 'Resumo do projeto', tipo: 'texto-longo', obrigatorio: true },
    { chave: 'anexo', rotulo: 'Portfólio em PDF', tipo: 'anexo', obrigatorio: false },
  ],
};

const dataBrasil = (agora, dias) => new Date(agora.getTime() + dias * DIA_MS - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const instante = (agora, dias) => new Date(agora.getTime() + dias * DIA_MS).toISOString();
const notas = valores => CRITERIOS.map((c, i) => ({ ...c, nota: valores[i] }));

// Confere a senha contra a mesma política das contas reais, para cada conta do exemplo.
// Lança Error com mensagem clara. Nada é gravado antes desta conferência.
export function conferirSenhaExemplo(senha) {
  if (typeof senha !== 'string' || !senha) throw new Error('Defina TEB_EXEMPLO_SENHA nos Secrets para criar o exemplo.');
  if (senha === SENHA_PROIBIDA) throw new Error('TEB_EXEMPLO_SENHA: essa senha é de demonstração. Escolha outra.');
  for (const c of Object.values(CONTAS_EXEMPLO)) {
    if (!regras.validarDocumento(c.documento).valido) throw new Error(`CPF do exemplo inválido: ${c.documento}.`);
    if (DOCUMENTOS_RESERVADOS.has(c.documento)) throw new Error(`CPF do exemplo é reservado da demonstração: ${c.documento}.`);
    const msg = regras.validarSenha(senha, c);
    if (msg) throw new Error(`TEB_EXEMPLO_SENHA não vale para a conta ${c.papel}: ${msg}`);
  }
}

function resumoContas() {
  return Object.values(CONTAS_EXEMPLO).map(c => ({ papel: c.papel, nome: c.nome, documento: c.documento }));
}

// Cria a organização exemplo-teste com contas, editais, inscrições, notas, recurso e aviso.
// Devolve { criada, organizacao, contas }. contas traz papel, nome e CPF. Nunca a senha.
export async function semearExemplo(banco, { senha, agora = new Date(), ip = 'exemplo' } = {}) {
  conferirSenhaExemplo(senha);
  const saida = criada => ({ criada, organizacao: { ...ORG_EXEMPLO }, contas: resumoContas() });
  const existe = async b => (await b.executar('SELECT id FROM organizacoes WHERE slug = ?', [ORG_EXEMPLO.slug])).linhas[0];
  if (await existe(banco)) return saida(false);

  const quando = agora.toISOString();
  const ano = new Date(agora.getTime() - 3 * 60 * 60 * 1000).getUTCFullYear();
  const resultadoEm = instante(agora, -3);

  const r = await banco.transacao(async tx => {
    // Dentro da transação de novo: duas subidas ao mesmo tempo não duplicam.
    if (await existe(tx)) return null;
    for (const c of Object.values(CONTAS_EXEMPLO)) {
      const { linhas } = await tx.executar('SELECT id FROM usuarios WHERE documento = ?', [c.documento]);
      if (linhas[0]) throw new Error(`Já existe uma conta com o CPF ${c.documento}, fora do exemplo. Nada foi criado.`);
    }
    const orgId = (await tx.executar('INSERT INTO organizacoes (slug, nome, criado_em) VALUES (?, ?, ?)', [ORG_EXEMPLO.slug, ORG_EXEMPLO.nome, quando])).ultimoId;
    const ids = {};
    for (const [chave, c] of Object.entries(CONTAS_EXEMPLO)) {
      ids[chave] = await inserirUsuario(tx, { organizacaoId: orgId, papel: c.papel, nome: c.nome, natureza: c.natureza, documento: c.documento, email: c.email, telefone: c.telefone, senha, agora });
    }

    const inserirEdital = async e => (await tx.executar(
      `INSERT INTO editais (organizacao_id, slug, numero, titulo, descricao, inicio, fim, teto, ano, situacao, resultado_publicado_em, modelo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1000000, ?, ?, ?, ?, ?)`,
      [orgId, e.slug, e.numero, e.titulo, 'Edital de exemplo fictício, criado para teste no servidor real.', e.inicio, e.fim, Number(e.inicio.slice(0, 4)), e.situacao, e.resultado, JSON.stringify(MODELO), e.criado],
    )).ultimoId;
    const aberto = await inserirEdital({
      slug: 'exemplo-aberto', numero: `Exemplo 001/${ano}`, titulo: `Edital Exemplo 001/${ano} (exemplo)`,
      inicio: dataBrasil(agora, -10), fim: dataBrasil(agora, 30), situacao: 'aberto', resultado: null, criado: instante(agora, -11),
    });
    const encerrado = await inserirEdital({
      slug: 'exemplo-encerrado', numero: `Exemplo 000/${ano}`, titulo: `Edital Exemplo 000/${ano} (exemplo)`,
      inicio: dataBrasil(agora, -90), fim: dataBrasil(agora, -45), situacao: 'encerrado', resultado: resultadoEm, criado: instante(agora, -95),
    });

    const p = CONTAS_EXEMPLO.proponente;
    const ficha = (titulo, categoria, cota) => ({
      titulo, categoria, cota,
      extras: { 'extra-resumo': 'Resumo de exemplo fictício do projeto.' },
      metas: [{ etapa: 'Ensaios', inicio: '', fim: '', acao: 'Realizar ensaios abertos (exemplo)' }],
      equipe: [{ nome: 'Pessoa Exemplo (exemplo)', funcao: 'Direção', documento: '' }],
      orcamento: [{ descricao: 'Item de exemplo fictício', qtd: 4, valor: 150000 }],
      anexos: {},
      aceite: true,
      proponente: { nome: p.nome, documento: p.documento, natureza: p.natureza, email: p.email, telefone: p.telefone },
    });

    // Protocolos pela mesma sequência das inscrições reais: nunca colidem com um envio de verdade.
    const nomeSeq = `protocolo-${ano}`;
    await tx.executar('INSERT INTO sequencias (nome, valor) VALUES (?, 0) ON CONFLICT (nome) DO NOTHING', [nomeSeq]);
    const protocolo = async () => {
      await tx.executar('UPDATE sequencias SET valor = valor + 1 WHERE nome = ?', [nomeSeq]);
      return regras.gerarProtocolo(ano, (await tx.executar('SELECT valor FROM sequencias WHERE nome = ?', [nomeSeq])).linhas[0].valor);
    };

    const planos = [
      // 1. Enviada no edital aberto, atribuída ao avaliador e ainda sem nota (etapa Avaliação).
      { chave: 'enviada', edital: aberto, ficha: ficha('Projeto Exemplo A (exemplo)', 'Teatro', 'Ampla concorrência'), resultado: null, etapa: 1, enviada: -2 },
      // 2. Avaliada com notas e parecer, resultado publicado como suplente (etapa Suplente).
      { chave: 'avaliada', edital: encerrado, ficha: ficha('Projeto Exemplo B (exemplo)', 'Música', 'Pessoas negras'), resultado: 'suplente', etapa: 4, enviada: -60, notas: [8, 8, 1], parecer: 'Parecer de exemplo: proposta consistente, orçamento claro. Ficou como suplente.' },
      // 3. Resultado publicado, não selecionada, com recurso em análise dentro do prazo.
      { chave: 'recurso', edital: encerrado, ficha: ficha('Projeto Exemplo C (exemplo)', 'Artes Visuais', 'Ampla concorrência'), resultado: 'nao_selecionado', etapa: 3, enviada: -59, notas: [6, 7, 0], parecer: 'Parecer de exemplo: viabilidade pouco detalhada no cronograma.', recurso: 'Recurso de exemplo: o cronograma está detalhado no anexo da proposta.' },
      // 4. Selecionada e em Habilitação (etapa 5): libera a aba de habilitação. O termo fica travado.
      { chave: 'habilitacao', edital: encerrado, ficha: ficha('Projeto Exemplo D (exemplo)', 'Teatro', 'Ampla concorrência'), resultado: 'selecionado', etapa: 5, enviada: -61, notas: [9, 9, 2], parecer: 'Parecer de exemplo: proposta de alta qualidade e equipe experiente.' },
    ];
    const inscricoes = {};
    for (const [i, pl] of planos.entries()) {
      const id = `exemplo-${pl.chave}`;
      const prot = await protocolo();
      inscricoes[pl.chave] = prot;
      await tx.executar(
        `INSERT INTO inscricoes (id, organizacao_id, edital_id, usuario_id, protocolo, ficha, situacao, resultado, etapa, avaliador_id, enviada_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'enviada', ?, ?, ?, ?, ?, ?)`,
        [id, orgId, pl.edital, ids.proponente, prot, JSON.stringify(pl.ficha), pl.resultado, pl.etapa, ids.avaliador, instante(agora, pl.enviada), instante(agora, pl.enviada - 2 - i), pl.notas ? resultadoEm : instante(agora, pl.enviada)],
      );
      if (pl.notas) {
        const { erros, notaGeral } = regras.validarNotas(CRITERIOS, Object.fromEntries(CRITERIOS.map((c, k) => [c.chave, pl.notas[k]])));
        if (erros.length) throw new Error(`Notas do exemplo inválidas: ${erros.map(e => e.mensagem).join(' ')}`);
        await tx.executar(
          'INSERT INTO avaliacoes (organizacao_id, inscricao_id, avaliador_id, notas, nota_geral, parecer, enviada_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [orgId, id, ids.avaliador, JSON.stringify(notas(pl.notas)), notaGeral, pl.parecer, instante(agora, -10)],
        );
      }
      if (pl.recurso) {
        await tx.executar(
          `INSERT INTO recursos (id, organizacao_id, inscricao_id, justificativa, situacao, parecer, criado_em, decidido_em, decidido_por)
           VALUES (?, ?, ?, ?, 'Em análise', NULL, ?, NULL, NULL)`,
          [`exemplo-recurso-${pl.chave}`, orgId, id, pl.recurso, instante(agora, -1)],
        );
      }
    }

    await tx.executar('INSERT INTO avisos (organizacao_id, texto, ativo, criado_em) VALUES (?, ?, 1, ?)', [
      orgId, 'Aviso de exemplo: o prazo de envio da habilitação termina em 10 dias.', quando,
    ]);
    return { orgId, inscricoes };
  });
  if (!r) return saida(false);
  await registrar(banco, { agora, organizacaoId: r.orgId, acao: 'exemplo_semeado', alvo: ORG_EXEMPLO.slug, detalhe: { contas: resumoContas().map(c => c.documento), inscricoes: r.inscricoes }, ip });
  return saida(true);
}
