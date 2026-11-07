// Registro de auditoria. Nunca grava senha nem token.

export const ACOES = [
  'login', 'login_falha', 'login_bloqueado', 'conta_criada', 'inscricao_enviada', 'avaliacao_enviada',
  'resultado_publicado', 'recurso_decidido', 'edital_criado', 'edital_alterado', 'edital_aberto', 'edital_encerrado',
];

const SENSIVEL = /senha|token|cookie|chave/i;

function limpar(valor, profundidade = 0) {
  if (valor === null || typeof valor !== 'object') return valor;
  if (profundidade > 4) return null;
  if (Array.isArray(valor)) return valor.map(v => limpar(v, profundidade + 1));
  const saida = {};
  for (const [k, v] of Object.entries(valor)) if (!SENSIVEL.test(k)) saida[k] = limpar(v, profundidade + 1);
  return saida;
}

export async function registrar(banco, { agora, usuarioId = null, organizacaoId = null, acao, alvo = null, detalhe = null, ip = null }) {
  await banco.executar(
    'INSERT INTO auditoria (quando, usuario_id, organizacao_id, acao, alvo, detalhe, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [agora.toISOString(), usuarioId, organizacaoId, acao, alvo == null ? null : String(alvo), detalhe == null ? null : JSON.stringify(limpar(detalhe)), ip],
  );
}
