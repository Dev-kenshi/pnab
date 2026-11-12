# Relatório consolidado do PNAB (Sistema Integrado TEB)

Para a Teste de Elenco Brasil Sistema Integrado.
Emanuel Macêdo Luz, desenvolvedor do projeto.
Atualizado em 12/11/2026. Junta o trabalho de todas as sessões e agentes. Valores de orçamento ficam fora deste repositório público.

## Situação em uma tabela

| Parte | Situação | Prova |
|---|---|---|
| F7 (teto absurdo dava HTTP 500) | Feita e na `main` | Testador: rodada 4 aprovada (`trabalho/editais/testes.md`) |
| Backups cifrados em 3 destinos | Feita e na `main` | Testador: reprovou na rodada 1, aprovou na rodada 3 (`testes-backup.md`) |
| Segurança: 100 validações e duplo teste | Feita e na `main` | Passada do construtor com mutação; passada do testador reprovou na rodada 1 e aprovou na rodada 2 (`testes-seguranca.md`) |
| Commits feitos no PC (README, Pages, trava, login admin, exemplo) | Revisados, corrigidos e na `main` | Testador: reprovou na rodada 1 (5 falhas), aprovou na rodada 2 (`testes-pc.md`) |
| Anexos no Cloudflare R2 | Feito no ramo `construcao` | **Aguarda a revisão do testador** antes de ir para a `main` |
| Replit | Importado em endereço de desenvolvimento, não publicado | Relato da sessão do PC: 234 de 234 testes no Node 24 |

Números atuais no ramo `construcao`: **269 testes, todos passando**; portão 3 aprovado; portão 4 aprovado (4 larguras, critérios C1 a C12).

## Quem fez o quê

### Sessão na nuvem (esta)
- **F7.** Teto do edital limitado a R$ 10.000.000,00 no servidor e na demonstração. Depois, só número ou texto.
- **Backups.** Banco e anexos cifrados com AES-256-GCM para Google Drive, Backblaze B2 e GitHub privado (só o banco, semanal). Cópia lida numa transação e conferida antes de enviar, trava contra execuções juntas, restauração que nunca sobrescreve. Guia em `docs/backups.md`.
- **Segurança.** 100 validações automatizadas ligadas ao Cybersecurity101 e ao NIST CSF 2.0. Política de senha do NIST SP 800-63B, scrypt mais forte, limites de tentativa, trava contra logins em paralelo, CSRF em camadas, e-mail sem token no log, adaptador Turso testado (com defeito real corrigido no ROLLBACK). Guia em `docs/seguranca.md`.
- **Revisão dos commits do PC.** Cinco correções: tela de login só aceita usuário quando o recurso está ligado, rótulo certo, trava do backup solta em qualquer erro, apelido só na conta da plataforma, objeto no documento sem 500.
- **Cloudflare R2.** Anexos no R2 pela API S3 com assinatura SigV4 sem pacotes, conferida com 4 exemplos oficiais da AWS. Mesma cifra do disco, escolha automática pelo ambiente, comando `migrar-anexos`, backup e restauração pelo armazém em uso, 503 claro com o R2 fora do ar e aviso no Replit com anexos em disco.
- **Medição de capacidade.** Com SQLite local, 1 núcleo: 6 logins, 1.278 aberturas de painel e 729 rascunhos salvos por segundo. Na menor máquina do Replit (0,5 núcleo), estimativa de 1.000 a 2.000 pessoas navegando ao mesmo tempo. Com o Turso remoto a velocidade cai e precisa ser medida no Replit.

### Sessão "PNAB" no PC do usuário
- README completo e `index.html` na raiz para o GitHub Pages (só modo demonstração).
- Trava do backup ajustada para o Windows.
- Login de teste opcional com apelido (`TEB_PLATAFORMA_LOGIN`), desligado por padrão.
- Exemplo opcional no servidor real (`TEB_SEMEAR_EXEMPLO`), desligado por padrão e marcado como exemplo.
- Replit importado da `main` (antes das últimas correções), com 234 de 234 testes no Node 24. Servidor no endereço de desenvolvimento, **não publicado**.
- Criou no Replit um `iniciar-replit.sh` que gera a chave dos anexos num arquivo do servidor. **Recomendação: usar só a chave dos Secrets**, porque um arquivo pode sumir na publicação e deixar os anexos ilegíveis.

### Tarefa agendada "pnab-continuar-1101" (no PC)
- Rodou às 16:40 de Brasília de 11/11, quando a nuvem estava parada. Atualizou o orçamento local e fez a importação no Replit descrita acima.

### Agente testador (todas as rodadas)
| Revisão | Rodadas | Veredito final |
|---|---|---|
| F7 | 4 | Aprovado |
| Backups | 3 | Aprovado |
| Segurança, segunda passada | 2 | Aprovado |
| Commits do PC | 2 | Aprovado |
| Cloudflare R2 | 0 | **Pendente** |

## O que falta (depende do usuário)

1. **Revisão do R2 pelo testador** e merge na `main`.
2. **Atualizar o Replit**, que está atrás da `main`: no Shell do Replit, rode `git pull`.
3. **Chave dos anexos nos Secrets** (`TEB_CHAVE_ANEXOS`), com cópia no cofre de senhas. Não usar a chave gerada em arquivo pelo `iniciar-replit.sh`.
4. **Criar o bucket R2** e o token, preencher as `TEB_R2_*` e rodar `node servidor/principal.js migrar-anexos` se já houver anexos no disco.
5. **Banco no Turso**: criar o banco e preencher `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`. Depois, medir a velocidade no Replit.
6. **Publicar** na Reserved VM e ligar o domínio próprio, com `TEB_HTTPS=1`, `TEB_CONFIAR_PROXY=1` e `TEB_URL_PUBLICA`.
7. **Criar a conta da plataforma** com senha própria de 12 caracteres ou mais, por Secret.
8. **Contas reais dos backups e do e-mail**: Google Drive, Backblaze B2, GitHub privado e Resend, com um backup, uma restauração e um esqueci-senha de ponta a ponta.
9. **Confirmar o GitHub Pages.** No pedido original ele não devia ser ligado; o README já aponta para lá.
10. **Melhorias opcionais registradas pelo testador**:
    - exemplo no servidor real: aviso com HTTPS, seguir sem o exemplo se o CPF já existir, protocolo próprio e comando para removê-lo;
    - login de teste: texto que não é o apelido ainda gera um 400 no console;
    - trava de login sem tempo máximo de espera; limite de criação de conta conta também as recusadas;
    - backup: renovar a trava acima de 6 horas e repetir o envio ao B2 quando ele responder 5xx;
    - verificação em duas etapas, troca da chave dos anexos e antivírus nos PDFs.
