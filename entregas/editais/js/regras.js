// Regras de negócio puras do Sistema Integrado TEB.
// Sem DOM, sem rede, sem Node. O front e o servidor importam este mesmo arquivo.

export const ETAPAS = ['Inscrição', 'Avaliação', 'Resultado', 'Selecionado', 'Habilitação', 'Termo', 'Execução'];
export const NATUREZAS = ['Pessoa Física', 'Pessoa Jurídica', 'MEI', 'Coletivo'];
export const TIPOS_CAMPO = ['texto', 'texto-longo', 'numero', 'data', 'selecao', 'marcar', 'anexo'];
export const RESULTADOS = ['selecionado', 'suplente', 'nao_selecionado'];
export const LIMITE_ANEXO = 10485760;
export const DIAS_RECURSO = 15;

const DIA_MS = 24 * 60 * 60 * 1000;

export function somenteDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}

function repetido(d) {
  return /^(\d)\1+$/.test(d);
}

export function validarCPF(texto) {
  const d = somenteDigitos(texto);
  if (d.length !== 11 || repetido(d)) return false;
  for (const tam of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tam; i++) soma += Number(d[i]) * (tam + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(d[tam])) return false;
  }
  return true;
}

export function validarCNPJ(texto) {
  const d = somenteDigitos(texto);
  if (d.length !== 14 || repetido(d)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const tam of [12, 13]) {
    let soma = 0;
    const p = pesos.slice(13 - tam);
    for (let i = 0; i < tam; i++) soma += Number(d[i]) * p[i];
    const resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== Number(d[tam])) return false;
  }
  return true;
}

export function validarDocumento(texto) {
  const digitos = somenteDigitos(texto);
  if (digitos.length === 11) return { valido: validarCPF(digitos), tipo: 'cpf', digitos };
  if (digitos.length === 14) return { valido: validarCNPJ(digitos), tipo: 'cnpj', digitos };
  return { valido: false, tipo: null, digitos };
}

export function formatarDocumento(digitos) {
  const d = somenteDigitos(digitos);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

function milhares(inteiro) {
  return String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatarMoeda(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const sinal = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const reais = Math.floor(abs / 100);
  const cent = String(abs % 100).padStart(2, '0');
  return `${sinal}R$ ${milhares(reais)},${cent}`;
}

export function formatarNota(numero) {
  const n = Math.round((Number(numero) || 0) * 10) / 10;
  return n.toFixed(1).replace('.', ',');
}

export function reaisParaCentavos(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
  let t = String(valor ?? '').replace(/R\$/g, '').replace(/\s/g, '');
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function slug(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function totalOrcamento(linhas) {
  let total = 0;
  for (const l of linhas || []) {
    const qtd = Number(l?.qtd) || 0;
    const valor = Number(l?.valor) || 0;
    total += Math.round(qtd * valor);
  }
  return total;
}

export function mensagemTeto(total, teto) {
  if (Number(total) > Number(teto)) return `Total ${formatarMoeda(total)} passa do teto de ${formatarMoeda(teto)}.`;
  return null;
}

// Teto máximo do valor unitário de um item: R$ 10.000.000,00, em centavos.
export const VALOR_ITEM_MAXIMO = 1000000000;

// Valor unitário de item do orçamento, em centavos inteiros. Devolve a mensagem de erro ou null.
export function erroValorItem(valor) {
  if (vazio(valor)) return obrigatorio('Valor do item');
  const n = typeof valor === 'boolean' ? NaN : Number(valor);
  if (!Number.isFinite(n)) return 'Valor do item inválido.';
  if (n < 0) return 'Valor do item não pode ser negativo';
  if (!Number.isInteger(n)) return 'Valor do item inválido. Use no máximo dois decimais.';
  if (n > VALOR_ITEM_MAXIMO) return `Valor do item acima do máximo de ${formatarMoeda(VALOR_ITEM_MAXIMO)}.`;
  return null;
}

// Teto máximo do edital: igual ao máximo do item, R$ 10.000.000,00, em centavos.
// Evita números que estouram o inteiro do banco (F7).
export const TETO_MAXIMO = VALOR_ITEM_MAXIMO;

// Teto do edital, em centavos inteiros. A mensagem fala em reais, como o campo da tela.
export function erroTeto(teto) {
  if (vazio(teto)) return obrigatorio('Teto do orçamento (R$)');
  const n = typeof teto === 'boolean' ? NaN : Number(teto);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Teto inválido. Informe o valor em reais, como 10.000,00.';
  if (n <= 0) return 'O teto precisa ser maior que R$ 0,00.';
  if (n > TETO_MAXIMO) return `Teto acima do máximo de ${formatarMoeda(TETO_MAXIMO)}.`;
  return null;
}

function vazio(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function obrigatorio(rotulo) {
  return `Campo obrigatório: ${rotulo}`;
}

export function validarFicha(edital, ficha) {
  const f = ficha || {};
  const erros = [];
  const base = [['titulo', 'Título do projeto'], ['categoria', 'Categoria'], ['cota', 'Cota']];
  for (const [campo, rotulo] of base) if (vazio(f[campo])) erros.push({ campo, mensagem: obrigatorio(rotulo) });
  if (f.categoria && !vazio(f.categoria) && Array.isArray(edital?.categorias) && !edital.categorias.includes(f.categoria)) {
    erros.push({ campo: 'categoria', mensagem: 'Categoria fora da lista do edital.' });
  }
  if (f.cota && !vazio(f.cota) && Array.isArray(edital?.cotas) && !edital.cotas.includes(f.cota)) {
    erros.push({ campo: 'cota', mensagem: 'Cota fora da lista do edital.' });
  }
  for (const c of edital?.camposExtras || []) {
    if (!c.obrigatorio) continue;
    if (c.tipo === 'anexo') {
      if (!f.anexos || !f.anexos[c.chave]) erros.push({ campo: c.chave, mensagem: obrigatorio(c.rotulo) });
    } else if (c.tipo === 'marcar') {
      if (f.extras?.[c.chave] !== true) erros.push({ campo: c.chave, mensagem: obrigatorio(c.rotulo) });
    } else if (vazio(f.extras?.[c.chave])) {
      erros.push({ campo: c.chave, mensagem: obrigatorio(c.rotulo) });
    }
  }
  (f.metas || []).forEach((m, linha) => {
    if (vazio(m?.etapa)) erros.push({ campo: 'meta-etapa', mensagem: obrigatorio('Etapa da meta'), linha });
    if (vazio(m?.acao)) erros.push({ campo: 'meta-acao', mensagem: obrigatorio('Ação da meta'), linha });
  });
  (f.equipe || []).forEach((p, linha) => {
    if (vazio(p?.nome)) erros.push({ campo: 'equipe-nome', mensagem: obrigatorio('Nome na equipe'), linha });
    if (vazio(p?.funcao)) erros.push({ campo: 'equipe-funcao', mensagem: obrigatorio('Função na equipe'), linha });
  });
  (f.orcamento || []).forEach((o, linha) => {
    if (vazio(o?.descricao)) erros.push({ campo: 'orc-descricao', mensagem: obrigatorio('Descrição do item'), linha });
    const qtd = Number(o?.qtd);
    if (vazio(o?.qtd) || !Number.isFinite(qtd) || qtd <= 0) erros.push({ campo: 'orc-qtd', mensagem: obrigatorio('Quantidade maior que zero'), linha });
    const erroValor = erroValorItem(o?.valor);
    if (erroValor) erros.push({ campo: 'orc-valor', mensagem: erroValor, linha });
  });
  if (f.aceite !== true) erros.push({ campo: 'aceite', mensagem: obrigatorio('Aceite dos termos do edital') });
  return erros;
}

export function validarNotas(criterios, notas) {
  const erros = [];
  let soma = 0;
  for (const c of criterios || []) {
    const bruto = notas ? notas[c.chave] : undefined;
    if (bruto === null || bruto === undefined || (typeof bruto === 'string' && bruto.trim() === '')) {
      erros.push({ campo: c.chave, mensagem: `Nota obrigatória: ${c.nome}` });
      continue;
    }
    const n = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(',', '.'));
    if (typeof bruto === 'boolean' || !Number.isFinite(n)) {
      erros.push({ campo: c.chave, mensagem: `Nota inválida: ${c.nome}` });
      continue;
    }
    if (n < 0) {
      erros.push({ campo: c.chave, mensagem: `Nota negativa não é aceita: ${c.nome}` });
      continue;
    }
    if (n > Number(c.maximo)) {
      erros.push({ campo: c.chave, mensagem: `Nota acima do máximo de ${formatarNota(c.maximo)}: ${c.nome}` });
      continue;
    }
    soma += n;
  }
  return { erros, notaGeral: Math.round(soma * 10) / 10 };
}

function etapaAtual(inscricao, edital) {
  if (!inscricao || inscricao.situacao === 'rascunho') return 1;
  if (inscricao.situacao === 'concluida') return ETAPAS.length + 1;
  if (!edital?.resultadoPublicadoEm) return 2;
  if (inscricao.resultado === 'selecionado' || inscricao.resultado === 'suplente') {
    return Math.min(ETAPAS.length, Math.max(4, Number(inscricao.etapa) || 4));
  }
  return 3;
}

export function calcularEtapas(inscricao, edital) {
  const atual = etapaAtual(inscricao, edital);
  return ETAPAS.map((nome, i) => {
    const numero = i + 1;
    const rotulo = numero === 4 && inscricao?.resultado === 'suplente' ? 'Suplente' : nome;
    const estado = numero < atual ? 'passada' : numero === atual ? 'atual' : 'futura';
    return { numero, nome: rotulo, estado };
  });
}

export function selo(inscricao, edital) {
  if (!inscricao || inscricao.situacao === 'rascunho') return 'Rascunho';
  if (inscricao.situacao === 'concluida') return 'Concluído';
  if (edital?.resultadoPublicadoEm) {
    if (inscricao.resultado === 'selecionado') return 'Selecionado';
    if (inscricao.resultado === 'suplente') return 'Suplente';
    if (inscricao.resultado === 'nao_selecionado') return 'Não aprovado';
  }
  return 'Enviado';
}

function slugDoEdital(inscricao) {
  return typeof inscricao?.edital === 'string' ? inscricao.edital : inscricao?.edital?.slug;
}

export function contadores(inscricoes, editaisPorSlug) {
  let enviados = 0, concluidos = 0, naoAprovados = 0;
  for (const i of inscricoes || []) {
    if (i.situacao === 'rascunho') continue;
    enviados++;
    if (i.situacao === 'concluida') { concluidos++; continue; }
    const ed = editaisPorSlug?.[slugDoEdital(i)];
    if (i.resultado === 'nao_selecionado' && ed?.resultadoPublicadoEm) naoAprovados++;
  }
  return { enviados, andamento: enviados - concluidos - naoAprovados, concluidos, naoAprovados };
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dataValida(texto) {
  if (!DATA_RE.test(String(texto ?? ''))) return false;
  const d = new Date(`${texto}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

export function inicioDoPeriodo(inicio) {
  return new Date(`${inicio}T00:00:00-03:00`);
}

export function fimDoPeriodo(fim) {
  return new Date(`${fim}T23:59:59-03:00`);
}

export function periodoAberto(edital, agora) {
  if (!edital || edital.situacao !== 'aberto') return false;
  const t = new Date(agora).getTime();
  if (edital.inicio && dataValida(edital.inicio) && t < inicioDoPeriodo(edital.inicio).getTime()) return false;
  if (!edital.fim || !dataValida(edital.fim)) return false;
  return t <= fimDoPeriodo(edital.fim).getTime();
}

export function motivosParaNaoAbrir(edital, agora) {
  const motivos = [];
  if (!edital?.fim || !dataValida(edital.fim)) motivos.push('Informe a data de fim das inscrições.');
  else if (fimDoPeriodo(edital.fim).getTime() <= new Date(agora).getTime()) motivos.push('A data de fim precisa estar no futuro.');
  if (!edital?.categorias?.length) motivos.push('Cadastre ao menos uma categoria.');
  if (!edital?.cotas?.length) motivos.push('Cadastre ao menos uma cota.');
  if (!edital?.criterios?.length) motivos.push('Cadastre ao menos um critério de avaliação.');
  return motivos;
}

export function prazoRecurso(resultadoPublicadoEm) {
  return new Date(new Date(resultadoPublicadoEm).getTime() + DIAS_RECURSO * DIA_MS);
}

export function recursoPermitido({ inscricao, edital, recurso, agora }) {
  if (!inscricao || inscricao.situacao !== 'enviada') return false;
  if (!edital?.resultadoPublicadoEm) return false;
  if (recurso) return false;
  return new Date(agora).getTime() <= prazoRecurso(edital.resultadoPublicadoEm).getTime();
}

export function abasLiberadas(inscricao, edital) {
  if (inscricao?.situacao === 'concluida') return { habilitacao: true, termo: true };
  const etapa = Number(inscricao?.etapa) || 0;
  const aprovado = inscricao?.resultado === 'selecionado' || inscricao?.resultado === 'suplente';
  const publicado = Boolean(edital?.resultadoPublicadoEm);
  return {
    habilitacao: publicado && aprovado && etapa >= 5,
    termo: publicado && aprovado && etapa >= 6,
  };
}

export function gerarProtocolo(ano, sequencia) {
  return `TEB-${ano}-${String(sequencia).padStart(6, '0')}`;
}

export function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha precisa ter ao menos 8 caracteres.';
  if (senha.length > 200) return 'A senha pode ter no máximo 200 caracteres.';
  return null;
}

export function validarArquivoPdf({ nome, tipo, tamanho } = {}) {
  if (!/\.pdf$/i.test(String(nome ?? '')) || tipo !== 'application/pdf') return 'Envie um arquivo PDF.';
  if (!(Number(tamanho) > 0)) return 'O arquivo está vazio.';
  if (Number(tamanho) > LIMITE_ANEXO) return 'O arquivo passa de 10 MB.';
  return null;
}
