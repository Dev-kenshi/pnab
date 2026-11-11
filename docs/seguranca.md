# Segurança do Sistema Integrado TEB

Emanuel Macêdo Luz, desenvolvedor do projeto.

## Resumo

- **100 validações automatizadas.** Cada uma é um teste que roda com `npm test` e está ligada a uma seção do manual e a uma subcategoria do NIST CSF 2.0.
- **Manual.** Repositório [danieldonda/Cybersecurity101](https://github.com/danieldonda/Cybersecurity101), README, seções "Fundamentos de Cibersegurança" e "Frameworks e Melhores Práticas".
- **Duplo teste.** Duas passadas independentes:
  - A primeira é a do construtor: 100 de 100, mais a prova por mutação abaixo.
  - A segunda é a do agente testador. O resultado dela está no fim deste documento.
- **Onde estão.**
  - Catálogo: `entregas/editais/servidor/testes/seguranca-catalogo.js`.
  - Execução: `entregas/editais/servidor/testes/seguranca-100.test.js`.

Como rodar, dentro de `entregas/editais`:

```bash
node --test servidor/testes/seguranca-100.test.js
```

## Sobre o manual

O Cybersecurity101 é um guia de estudo introdutório. Ele traz temas, não controles detalhados. Por isso, cada validação cita a seção do manual que trata do tema e uma subcategoria do NIST CSF 2.0. O manual cita o NIST em "Frameworks e Melhores Práticas", sem detalhar as funções. A política de senha segue o NIST SP 800-63B, e os parâmetros do scrypt seguem a OWASP, que o manual também cita.

| Seção do manual | Validações |
|---|---|
| Gestão de Identidade e Acesso (AAA, RBAC) | 39 |
| Desenvolvimento Seguro (OWASP Top 10) | 26 |
| Criptografia | 15 |
| Legislação e Ética (LGPD) | 7 |
| Resposta a Incidentes | 7 |
| Conceitos de Segurança (triângulo CIA) | 6 |

| Função do NIST CSF 2.0 | Validações |
|---|---|
| PR (Proteger) | 94 |
| DE (Detectar) | 5 |
| RC (Recuperar) | 1, mais os 23 testes de backup em `backup.test.js` |

Subcategorias usadas:
- PR.AA-01: credenciais.
- PR.AA-02: identidade.
- PR.AA-03: autenticação.
- PR.AA-05: menor privilégio.
- PR.DS-01: dados guardados.
- PR.DS-02: dados em trânsito.
- PR.DS-10: dados em uso.
- PR.DS-11: backups.
- PR.PS-01: configuração.
- PR.PS-04: registros.
- PR.PS-06: desenvolvimento seguro.
- PR.IR-04: capacidade.
- DE.CM-03: atividade de pessoas.
- DE.AE-02: análise de eventos.
- RC.RP-03: integridade do backup.

## Prova de que as validações pegam erro de verdade (mutação)

Desliguei de propósito quatro defesas e rodei as 100 validações. As validações certas falharam:

| Defesa desligada | Validações que falharam |
|---|---|
| scrypt com `p=1` em vez de `p=5` | SEG-001, SEG-009 |
| Limite da consulta de documento em 3000 | SEG-034 |
| HSTS sem `includeSubDomains` | SEG-060 |
| Conferência de origem sempre aceitando | SEG-065, SEG-066 |

Com o código restaurado, as 100 passam.

Na segunda passada, o testador fez 13 mutações e achou 6 validações fracas. Elas foram reforçadas e conferidas de novo:

| Defesa desligada (rodada 2) | Validação que falhou |
|---|---|
| Logins em paralelo sem trava | SEG-005 |
| `X-Forwarded-For` lendo o primeiro item | SEG-006 |
| `Origin: null` aceito | SEG-065 |
| Sem o scrypt falso para documento sem conta (enumeração por tempo) | SEG-004 |
| Criação de conta sem limite | SEG-034 |
| E-mail padrão do servidor imprimindo o link | SEG-099 |

## Melhorias de segurança feitas nesta etapa

1. **Política de senha (NIST SP 800-63B).**
   - Mínimo de 10 caracteres para proponente e 12 para gestor, avaliador e plataforma. Máximo de 128.
   - Lista de senhas comuns, incluindo variações com números no fim.
   - Recusa senha que tenha o CPF ou CNPJ, o e-mail ou o primeiro nome da pessoa.
   - Sem exigir símbolo ou maiúscula, que o NIST desaconselha.
   - A regra vale igual no servidor, no modo demonstração e nas telas.
2. **scrypt mais forte.** Os parâmetros passaram para `N=2^14, r=8, p=5`, a recomendação da OWASP. Senha antiga é refeita no próximo login certo. Hash com custo absurdo é recusado sem travar o servidor.
3. **Limites de tentativa** (pendências fechadas):
   - consulta de documento: 30 por 15 minutos por IP;
   - esqueci a senha: 10 por hora por IP, e 3 e-mails por hora por documento, com a mesma resposta para não revelar se a conta existe;
   - senha atual na troca de senha: 5 erros em 15 minutos bloqueiam;
   - criação de conta: 10 por hora por IP, e cada uma conta também no limite da consulta de documento, porque o 409 revela se a conta existe;
   - **trava em memória** por documento, por IP e por usuário. Sem ela, 120 logins em paralelo passavam do limite e a senha certa entrava. Vale para um processo só: com várias instâncias, ponha um limitador no proxy.
4. **Link de redefinição fora do log** (pendência fechada).
   - Sem e-mail configurado, o log diz só que houve um pedido, com o e-mail mascarado e sem link nem token.
   - Com o Resend configurado, o link vai por e-mail.
   - O modo `TEB_EMAIL_LOG_LINK=1`, de desenvolvimento, é recusado com HTTPS ligado.
5. **Adaptador Turso testado** (pendência fechada). São 5 testes com um Turso simulado sobre SQLite real. Eles acharam um defeito: depois de um erro dentro de uma transação, o `ROLLBACK` ia com o baton antigo e era recusado em silêncio. Isso foi corrigido.
6. **CSRF em camadas.** Além do `SameSite=Strict` e do JSON obrigatório, pedido que muda dados e vem de outro site (cabeçalho `Origin` ou `Sec-Fetch-Site`) é recusado com 403.
7. **Auditoria maior.** Passam a ser registrados os acessos negados (403), os limites excedidos e os pedidos de redefinição.
8. **Outras melhorias.**
   - HSTS com `includeSubDomains`.
   - O teto do edital só aceita número ou texto.
   - Tabela com mais de 200 linhas é recusada com mensagem, em vez de cortada.
   - Backups cifrados (veja `docs/backups.md`).

## Senhas e chaves que você vai criar

Guarde tudo num cofre de senhas, por exemplo o Bitwarden ou o 1Password. Nunca coloque nada disso no Git, no WhatsApp ou em e-mail.

| O quê | Como criar | Onde fica |
|---|---|---|
| `TEB_CHAVE_ANEXOS` | O comando abaixo | Segredo da hospedagem e cópia no cofre. Sem ela, os anexos não abrem. |
| `TEB_CHAVE_BACKUP` | O mesmo comando, de novo, para ser diferente | Segredo da hospedagem e cópia no cofre, separada da outra |
| Senha da plataforma (`TEB_PLATAFORMA_SENHA`) | Frase de 4 ou 5 palavras sem relação entre si, 16 caracteres ou mais (exemplo de formato, não use: `cadeira-nuvem-tambor-limão`). O sistema exige 12 caracteres ou mais, recusa senhas comuns e recusa o seu CPF, e-mail ou primeiro nome. | Use só no comando `criar-plataforma`. Depois do primeiro acesso, apague a variável. |
| Senhas de gestores e avaliadores | A mesma regra: 12 caracteres ou mais. Cada pessoa troca a senha no primeiro acesso, em "Minha conta". | Cada pessoa guarda a sua |
| Tokens do Google Drive, do B2, do GitHub e do Resend | Painel de cada serviço, com o menor acesso possível (veja `docs/backups.md`) | Segredos da hospedagem, com data de renovação anotada |

Comando para gerar cada chave:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Regras práticas:
- Uma senha por serviço. Nunca reaproveite.
- Ligue a verificação em duas etapas nas contas Google, Backblaze, GitHub, Resend e da hospedagem.
- Se uma chave ou senha vazar, troque na hora. Para trocar `TEB_CHAVE_ANEXOS`, é preciso recifrar os anexos (não há comando para isso ainda). Por isso, guarde bem essa chave.

## Pendências e riscos conhecidos

- **E-mail real.** O adaptador Resend existe, mas nunca foi chamado de verdade, porque não há conta nem rede aqui. Sem configuração, o link de redefinição não chega a ninguém. A pessoa precisa pedir à equipe a troca de senha.
- **Turso real.** O adaptador foi testado contra um Turso simulado, não contra o serviço.
- **Limites por IP atrás de proxy.** Eles só funcionam bem com `TEB_CONFIAR_PROXY=1` quando o site está atrás de um proxy confiável, como o do Replit. O sistema usa o último item de `X-Forwarded-For`, que é o que o proxy acrescenta. Sem isso, todos os pedidos parecem vir do mesmo IP. Com mais de um proxy em sequência, é preciso ajustar o código.
- **Trava de login em memória.** Ela vale para um processo só. Com várias instâncias do servidor, use também um limitador na frente.
- **Sem verificação em duas etapas no sistema.** Para gestor e plataforma, é a próxima melhoria recomendada (TOTP).
- **Sem troca de chave dos anexos.** Não há comando para recifrar os anexos com uma chave nova.
- **Sem antivírus nos PDFs.** O sistema confere o tipo e o tamanho, mas não procura vírus.
- **Varredura de dependências.** O servidor não usa pacotes externos. Só o Playwright, usado nos portões, entra pelo npm.

## Lista das 100 validações

| Id | Validação | Seção do manual | NIST CSF 2.0 |
|---|---|---|---|
| SEG-001 | Senha guardada com scrypt nos parâmetros da OWASP (N=2^14, r=8, p=5) | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-002 | Sal único: mesma senha gera hashes diferentes | Criptografia | PR.AA-01 |
| SEG-003 | Nenhuma senha em texto no banco | Criptografia | PR.DS-01 |
| SEG-004 | Senha errada e documento sem conta dão a mesma resposta | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-005 | Cinco erros no mesmo documento bloqueiam o login por 15 minutos | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-006 | Cinco erros do mesmo IP em documentos diferentes bloqueiam o IP | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-007 | Hash malformado nunca confere e não lança erro | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-008 | Hash com custo absurdo é recusado sem travar o servidor | Conceitos de Segurança (triângulo CIA) | PR.AA-01 |
| SEG-009 | Senha com parâmetros antigos é refeita no próximo login | Criptografia | PR.AA-01 |
| SEG-010 | Senha com menos de 10 caracteres é recusada | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-011 | Senha comum de vazamentos é recusada | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-012 | Senha com o próprio CPF é recusada | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-013 | Conta da equipe exige 12 caracteres | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-014 | Senha de demonstração não vale no servidor real | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-015 | Contas de demonstração não existem no servidor real | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-01 |
| SEG-016 | Documentos reservados da demonstração não criam conta | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-02 |
| SEG-017 | Cookie de sessão é HttpOnly | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-018 | Cookie de sessão é SameSite=Strict | Desenvolvimento Seguro (OWASP Top 10) | PR.AA-03 |
| SEG-019 | Com HTTPS o cookie leva Secure | Criptografia | PR.DS-02 |
| SEG-020 | Sessão dura no máximo 8 horas | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-021 | Token de sessão tem 256 bits aleatórios | Criptografia | PR.AA-03 |
| SEG-022 | Banco guarda só o hash do token de sessão | Criptografia | PR.DS-01 |
| SEG-023 | Cada login gera um token novo (sem fixação de sessão) | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-024 | Sair apaga a sessão no servidor | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-025 | Sessão vencida não vale | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-026 | Trocar a senha encerra as outras sessões | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-027 | Senha atual errada 5 vezes bloqueia a troca de senha | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-028 | Esqueci a senha responde igual para documento com e sem conta | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-029 | Link de redefinição vale uma vez só e encerra as sessões | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-030 | Link de redefinição vence em 1 hora | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-031 | Token de redefinição guardado só como hash | Criptografia | PR.DS-01 |
| SEG-032 | Esqueci a senha: 10 pedidos por hora por IP | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-033 | Esqueci a senha: 3 e-mails por hora por documento, com resposta igual | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-034 | Consulta de documento: 30 por 15 minutos por IP | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-035 | Cookie com token gigante é ignorado | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-03 |
| SEG-036 | Anônimo recebe 401 nas rotas protegidas | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-037 | Proponente não entra em rota de gestor | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-038 | Avaliador não entra em rota de gestor | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-039 | Gestor não entra em rota da plataforma | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-040 | Plataforma não lê inscrições de proponentes | Legislação e Ética (LGPD) | PR.AA-05 |
| SEG-041 | Avaliador só vê inscrições atribuídas a ele | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-042 | Proponente não vê inscrição de outro proponente | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-043 | Gestor de outra organização não vê a inscrição | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-044 | Gestor de outra organização não altera o edital | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-045 | Avaliador de outra organização não avalia | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-046 | Proponente não baixa anexo de outro | Legislação e Ética (LGPD) | PR.AA-05 |
| SEG-047 | Acesso negado (403) entra na auditoria | Resposta a Incidentes | DE.CM-03 |
| SEG-048 | Documento da conta não pode ser trocado | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-02 |
| SEG-049 | Criar conta com papel de gestor no corpo gera só proponente | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-050 | Trocar para organização inexistente é recusado | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-051 | Injeção SQL no documento do login é recusada | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-052 | Injeção SQL no endereço do edital não acha nada nem quebra a tabela | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-053 | Texto com <script> é guardado como texto e servido como JSON | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-054 | CSP restringe tudo à própria origem e proíbe moldura | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-01 |
| SEG-055 | X-Content-Type-Options: nosniff | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-01 |
| SEG-056 | X-Frame-Options: DENY | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-01 |
| SEG-057 | Referrer-Policy não vaza endereço para outros sites | Legislação e Ética (LGPD) | PR.PS-01 |
| SEG-058 | Permissions-Policy desliga câmera, microfone e localização | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-01 |
| SEG-059 | Cross-Origin-Opener-Policy e Resource-Policy na própria origem | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-01 |
| SEG-060 | Com HTTPS vai HSTS de 1 ano com subdomínios | Criptografia | PR.DS-02 |
| SEG-061 | Respostas da API não ficam em cache | Legislação e Ética (LGPD) | PR.DS-10 |
| SEG-062 | JSON inválido dá 400 sem expor detalhes internos | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-063 | Corpo JSON acima de 1 MB dá 413 | Conceitos de Segurança (triângulo CIA) | PR.IR-04 |
| SEG-064 | Pedido que não é JSON dá 415 | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-065 | CSRF: pedido com Origin de outro site é recusado | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-066 | CSRF: Sec-Fetch-Site cross-site é recusado | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-067 | Pedido da própria origem continua aceito | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-068 | Caminho com ../ não sai da pasta pública | Desenvolvimento Seguro (OWASP Top 10) | PR.DS-01 |
| SEG-069 | Código do servidor não é servido | Desenvolvimento Seguro (OWASP Top 10) | PR.DS-01 |
| SEG-070 | Arquivos ocultos como .env não são servidos | Desenvolvimento Seguro (OWASP Top 10) | PR.DS-01 |
| SEG-071 | Testes do front não são servidos | Desenvolvimento Seguro (OWASP Top 10) | PR.DS-01 |
| SEG-072 | Anexo que não é PDF de verdade é recusado | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-073 | Anexo acima de 10 MB dá 413 | Conceitos de Segurança (triângulo CIA) | PR.IR-04 |
| SEG-074 | Anexo fica cifrado no disco | Criptografia | PR.DS-01 |
| SEG-075 | Anexo adulterado no disco não é entregue | Criptografia | PR.DS-01 |
| SEG-076 | Nome de anexo com ../ e quebra de linha é limpo | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-077 | Teto absurdo do edital dá 400, nunca 500 (F7) | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-078 | Teto que não é número nem texto é recusado | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-079 | Nota acima do máximo é recusada | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-080 | Valor negativo no orçamento é recusado | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-081 | Tabela com mais de 200 linhas é recusada | Conceitos de Segurança (triângulo CIA) | PR.IR-04 |
| SEG-082 | Envio duplo simultâneo gera um protocolo só | Conceitos de Segurança (triângulo CIA) | PR.DS-01 |
| SEG-083 | Ficha enviada não pode ser alterada | Conceitos de Segurança (triângulo CIA) | PR.DS-01 |
| SEG-084 | Edital em rascunho é invisível para o proponente | Gestão de Identidade e Acesso (AAA, RBAC) | PR.AA-05 |
| SEG-085 | JSON com __proto__ não contamina objetos do servidor | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-086 | Método e endereço estranhos dão 4xx, nunca 500 | Desenvolvimento Seguro (OWASP Top 10) | PR.PS-06 |
| SEG-087 | Chave dos anexos exige 32 bytes (AES-256) | Criptografia | PR.DS-01 |
| SEG-088 | Backup cifrado com AES-256-GCM, sem dado pessoal em claro | Criptografia | PR.DS-11 |
| SEG-089 | Backup adulterado é recusado na restauração | Criptografia | RC.RP-03 |
| SEG-090 | Chave do backup precisa ser diferente da chave dos anexos | Criptografia | PR.DS-11 |
| SEG-091 | IV aleatório: cifrar duas vezes dá resultados diferentes | Criptografia | PR.DS-01 |
| SEG-092 | Backup não leva sessões nem tokens de redefinição | Legislação e Ética (LGPD) | PR.DS-11 |
| SEG-093 | Login com falha entra na auditoria | Resposta a Incidentes | DE.CM-03 |
| SEG-094 | Login bloqueado entra na auditoria | Resposta a Incidentes | DE.CM-03 |
| SEG-095 | Limite excedido entra na auditoria | Resposta a Incidentes | DE.AE-02 |
| SEG-096 | Pedido de redefinição de senha entra na auditoria | Resposta a Incidentes | DE.CM-03 |
| SEG-097 | Auditoria nunca guarda senha nem token | Resposta a Incidentes | PR.PS-04 |
| SEG-098 | Auditoria registra IP e horário | Resposta a Incidentes | PR.PS-04 |
| SEG-099 | Sem e-mail configurado, o log não traz link, token nem e-mail completo | Legislação e Ética (LGPD) | PR.DS-10 |
| SEG-100 | Avaliador não recebe e-mail nem telefone do proponente | Legislação e Ética (LGPD) | PR.AA-05 |

## Duplo teste

- **Passada 1 (construtor).** 100 de 100, e a suíte completa com 234 de 234. A mutação está descrita acima.
- **Passada 2 (agente testador, independente), rodada 1.** REPROVADO:
  - 1 falha alta: logins em paralelo contornavam o limite;
  - 4 médias: `X-Forwarded-For`, criação de conta sem limite, dica de 8 caracteres nas telas e 6 validações fracas.
  - Todas corrigidas. Detalhes em `trabalho/editais/testes-seguranca.md`.
- **Passada 2, rodada 2.** Veja o mesmo arquivo.
