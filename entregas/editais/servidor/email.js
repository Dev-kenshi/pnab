// Envio de e-mail do Sistema Integrado TEB. Só fetch, sem pacotes.
// Três modos, escolhidos por variável de ambiente:
//   1. Resend (https://resend.com): TEB_EMAIL_RESEND_CHAVE e TEB_EMAIL_REMETENTE.
//   2. Log de desenvolvimento: TEB_EMAIL_LOG_LINK=1. Mostra o link no terminal. Recusado com TEB_HTTPS=1.
//   3. Sem configuração: registra só que houve um pedido, sem link, sem token e sem o e-mail completo.
// O token de redefinição nunca vai para o log em produção.

export function mascararEmail(email) {
  const [local = '', dominio = ''] = String(email || '').split('@');
  if (!dominio) return '***';
  return `${local.slice(0, 1)}***@${dominio}`;
}

export function emailResend({ chave, remetente, fetch: f = globalThis.fetch, log = console }) {
  if (!chave || !remetente) throw new Error('Preencha TEB_EMAIL_RESEND_CHAVE e TEB_EMAIL_REMETENTE.');
  return async ({ para, assunto, texto }) => {
    const r = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remetente, to: [para], subject: assunto, text: texto }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Resend respondeu ${r.status}`);
    log.log(`[e-mail] enviado para ${mascararEmail(para)}: ${assunto}`);
  };
}

export function emailLogDesenvolvimento({ log = console } = {}) {
  return async ({ para, assunto, link }) => {
    log.log(`[e-mail de desenvolvimento] para ${mascararEmail(para)}: ${assunto}. Link: ${link}`);
  };
}

export function emailDesligado({ log = console } = {}) {
  return async ({ para, assunto }) => {
    log.warn(`[e-mail] envio não configurado. "${assunto}" para ${mascararEmail(para)} não foi enviado. Veja docs/seguranca.md.`);
  };
}

export function emailDoAmbiente(env, { fetch, log = console } = {}) {
  const chave = String(env.TEB_EMAIL_RESEND_CHAVE || '').trim();
  const remetente = String(env.TEB_EMAIL_REMETENTE || '').trim();
  if (chave || remetente) return emailResend({ chave, remetente, fetch, log });
  if (env.TEB_EMAIL_LOG_LINK === '1') {
    if (env.TEB_HTTPS === '1') throw new Error('TEB_EMAIL_LOG_LINK=1 não pode ser usado em produção (TEB_HTTPS=1): o link de redefinição iria para o log.');
    return emailLogDesenvolvimento({ log });
  }
  return emailDesligado({ log });
}
