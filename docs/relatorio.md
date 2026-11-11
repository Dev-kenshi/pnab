# Relatório da sessão na nuvem: 11/11/2026

Sistema Integrado TEB, para a Teste de Elenco Brasil Sistema Integrado.
Emanuel Macêdo Luz, desenvolvedor do projeto.

## Resumo

| Etapa | Situação | Prova |
|---|---|---|
| 1. F7 (teto absurdo dava HTTP 500) | Feita e na `main` | Testador: rodada 4 aprovada (`trabalho/editais/testes.md`) |
| 2. Backups cifrados em 3 destinos | Feita e na `main` | Testador: reprovou na rodada 1, aprovou na rodada 3 (`trabalho/editais/testes-backup.md`) |
| 3. Segurança: 100 validações e duplo teste | PREENCHER | PREENCHER |
| 4. Push na `main` a cada etapa aprovada | Feito | Merges `a2e1b85` (F7) e `2b5b052` (backups e senha), e o da segurança |
| 5. Este relatório | Feito | |

Números finais: PREENCHER testes em `npm test`, portão 3 aprovado, portão 4 aprovado (C1 a C12, 4 larguras).

## O que foi feito

### 1. F7: teto do edital
- **Causa.** `erroTeto` em `js/regras.js` não tinha máximo. Um teto de 1e16 estourava o inteiro do SQLite e dava 500.
- **Correção.** `TETO_MAXIMO` de R$ 10.000.000,00, igual ao máximo do item. A regra é a mesma no servidor e no modo demonstração. Depois, o teto passou a aceitar só número ou texto, então `[5]` também é recusado.
- **Testes.** Novos testes nas regras, no servidor e na demonstração. Eles falham sem a correção.
- **Testador, rodada 4.** Aprovada. Nenhum 500, e a mensagem aparece na tela em 1280 px e em 360 px.

### 2. Backups (`docs/backups.md`)
- **O que vai.** O banco e os anexos, cifrados com AES-256-GCM e uma chave própria (`TEB_CHAVE_BACKUP`).
- **Para onde vai.** Google Drive grátis (banco e anexos), Backblaze B2 (banco e anexos) e um GitHub privado (só o banco, uma vez por semana, por causa do histórico do Git).
- **Anexos incrementais.** Cada anexo vai uma vez só, o que cabe nos 15 GB do Drive.
- **Cópia confiável.** O banco é lido numa só transação e restaurado num banco temporário antes de enviar. Uma trava impede duas execuções juntas.
- **Comandos.** `backup`, `restaurar <destino>` (nunca sobrescreve) e `criar-pasta-drive`. Credenciais só por variável de ambiente, listadas no `.env.example`.
- **Testes.** 23, sem rede, com os três destinos simulados.
- **Capacidade no plano grátis.** 10 GB de anexos no R2 dão cerca de 700 a 2.000 inscrições. Os 5 GB do Turso dão para centenas de milhares de inscrições, então o limite real são os anexos.
- **Testador.** A rodada 1 reprovou com 6 falhas. A pior era um backup feito durante uma escrita, que não restaurava. A rodada 2 achou uma falha baixa. A rodada 3 aprovou.

### 3. Segurança (`docs/seguranca.md`)
- **Manual.** Cybersecurity101 (danieldonda) e NIST CSF 2.0.
- **100 validações.** Ficam em `servidor/testes/seguranca-catalogo.js`. Cada uma está ligada a uma seção do manual e a uma subcategoria do CSF.
- **Duplo teste.**
  - Passada 1, do construtor: 100 de 100, conferidas por mutação. Com quatro defesas desligadas, seis validações falharam como esperado.
  - Passada 2, do testador: PREENCHER.
- **Melhorias.**
  - Política de senha do NIST SP 800-63B, nas telas, no servidor e na demonstração.
  - scrypt mais forte, refeito no login.
  - Limites de tentativa no documento, no esqueci-senha e na senha atual.
  - Link de redefinição fora do log, com adaptador Resend opcional.
  - CSRF em camadas, conferindo `Origin` e `Sec-Fetch-Site`.
  - Auditoria de acesso negado e de limites.
  - HSTS com subdomínios.
  - Tabela com mais de 200 linhas recusada com mensagem.
- **Pendências conhecidas, todas fechadas:**
  - limite de tentativas em `/api/acesso/documento` e no esqueci-senha;
  - link de redefinição no log;
  - adaptador Turso nunca testado. Ganhou 5 testes, que acharam um defeito real: o `ROLLBACK` usava o baton antigo depois de um erro. Corrigido.

## Como a equipe trabalhou
- Quem construiu não aprovou o próprio trabalho. O agente testador revisou cada etapa, e cada reprovação voltou para correção com os passos para repetir.
- Os portões foram rodados a cada etapa. O Chromium do Playwright 1.65 não pôde ser baixado, porque a rede da nuvem bloqueia `cdn.playwright.dev`. O portão 4 rodou com o Chromium que já vem na nuvem, ligado por `PLAYWRIGHT_BROWSERS_PATH`, sem mudar o portão.
- O ambiente usou Node 22, que tem `node:sqlite`. O `package.json` pede Node 24 ou mais novo. Os testes passam nos dois, mas convém conferir no Node 24 da máquina local.
- O contêiner reiniciou duas vezes durante a sessão. Nada se perdeu, porque cada etapa foi enviada ao GitHub assim que ficou pronta.

## O que falta
1. **Orçamento.** Fora do repositório público. É feito na máquina local.
2. **Hospedagem no Replit.** Precisa do Chrome do usuário. Na hospedagem, configure:
   - `TEB_HTTPS=1`, `TEB_CONFIAR_PROXY=1` e `TEB_URL_PUBLICA`;
   - as duas chaves e os segredos dos destinos de backup;
   - o agendamento diário de `node servidor/principal.js backup`.
3. **Primeiro uso real dos serviços externos.** Google Drive, Backblaze B2, GitHub, Resend e Turso nunca foram chamados de verdade, porque aqui não há conta nem rede. Faça um backup, uma restauração de teste e um esqueci-senha de ponta a ponta antes de abrir para o público.
4. **Adaptador R2 dos anexos.** Está previsto na spec, mas ainda não existe. Hoje os anexos ficam em disco. Quando ele existir, o backup vai precisar ler do R2.
5. **Segurança, próximos passos.**
   - Verificação em duas etapas (TOTP) para gestor e plataforma.
   - Comando para trocar a chave dos anexos.
   - Antivírus nos PDFs.
6. **Melhorias opcionais registradas pelo testador.**
   - Validar nota e parecer na tela antes de enviar.
   - Renovar a trava em backup que passe de 6 horas.
   - Repetir o envio ao B2 quando ele responder 5xx.
   - Ver também os relatórios em `trabalho/editais/`.
