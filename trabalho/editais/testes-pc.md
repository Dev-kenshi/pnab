REPROVADO

# Testes dos 3 commits feitos no PC (35ba19b, 05d57f6, e615753)

Ramo `construcao`, commit e615753. Testador: segunda opinião, rodada r4-pc.

## Portões e catálogo (rodados de novo)

- `cd entregas/editais && npm test`: 243 testes, 243 passam.
- `node scripts/portoes/portao-3.mjs entregas/editais`: APROVADO.
- `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas`: 4 larguras e 12 critérios, APROVADO.
- `node --test servidor/testes/seguranca-100.test.js`: 101 de 101 passam.
- Nenhuma das 100 validações ficou mais fraca. O catálogo não foi alterado nos 3 commits. Mas ele roda só com o recurso desligado. O apelido tem cobertura apenas em `login-plataforma.test.js`.

## Falhas, por gravidade

### 1. Média. Texto com letra no login gera erro 400 no console do navegador, mesmo com o recurso desligado

- **O que fez.** Servidor real, recurso desligado. Digitou `root`, `admin`, `Admin!` e `12345` no login e apertou Enter.
- **O que esperava.** Erro na tela e nada no console, como antes. O CPF inválido era barrado no navegador, sem pedido ao servidor.
- **O que aconteceu.** O texto com letra vai ao servidor como "usuário". A resposta é 400. O navegador registra `Failed to load resource: the server responded with a status of 400`. Cada tentativa também gasta o limite de 30 consultas por 15 minutos por IP em `/api/acesso/documento`.
- **Prova.** `node trabalho/editais/r4-pc-ui.mjs`. Saída: 5 erros de console no servidor sem o recurso e 3 com o recurso. O portão 4 não pega isso, porque roda em modo demonstração.
- **Arquivo provável.** `entregas/editais/js/telas/acesso.js`, função `passo1` (linha da constante `usuario`).
- **Regra violada.** "Erro no console" reprova. O erro novo vem do commit e615753.

### 2. Média. O rótulo "CPF, CNPJ ou usuário" aparece com o recurso desligado

- **O que fez.** Abriu o login do servidor real sem `TEB_PLATAFORMA_LOGIN`.
- **O que esperava.** "CPF ou CNPJ". A tela só deve oferecer "usuário" quando existe.
- **O que aconteceu.** O rótulo diz "usuário" em todo servidor real. Quem digita um usuário recebe "Documento inválido. Confira os números.". O texto de apoio e o "lead" da tela seguem dizendo só CPF ou CNPJ.
- **Prova.** Capturas `trabalho/editais/telas-r4/pc-login-sem.png` e `pc-login-sem-erro.png`.
- **Arquivo provável.** `entregas/editais/js/telas/acesso.js` (`servidor ? 'CPF, CNPJ ou usuário'`). O front não sabe se o recurso está ligado. Falta um sinal vindo do servidor, por exemplo em `modo.json` ou em `/api/sessao`. Esse sinal também revelaria o recurso, então avalie o custo.

### 3. Baixa. Trava do backup não é solta em todos os caminhos de erro

- **O que fez.** Chamou `fazerBackup` com uma sobra `bkp-sobra/banco.ndjson` impossível de apagar (`chattr +i`). Script: `node trabalho/editais/r4-pc-trava.mjs`, caso 2.
- **O que esperava.** O erro sobe e a trava `backup.trava` é apagada.
- **O que aconteceu.** `travar()` cria a trava e depois lança no passo de limpar sobras (`ENOTDIR`). Ninguém recebe a função `destravar`. A trava fica no disco. O backup seguinte falha com "Outro backup ou restauração está em andamento" por até 6 horas. No Windows, uma sobra bloqueada por antivírus causa o mesmo.
- **Mesma família.** O `mkdtemp` de `fazerBackup` e de `restaurar` está fora do `try`. Se ele falhar, a trava também fica. Não consegui provocar esse caso aqui. Vi no código.
- **O que funciona.** Soltam a trava: backup normal, destino com erro, exportação que lança, chave inválida, restauração com chave errada e restauração com destino de banco que falha (casos 1a a 1i). `reter=0`, sem destino e sem backup para restaurar nem criam trava.
- **Arquivo provável.** `entregas/editais/servidor/backup/rotina.js`, funções `travar`, `fazerBackup`, `restaurar`.

### 4. Baixa. O apelido pode valer para uma conta que não é da plataforma

- **O que fez.** Criou uma organização com um gestor. Subiu de novo o servidor, sem `TEB_PLATAFORMA_SENHA`, com `TEB_PLATAFORMA_LOGIN=admin` e `TEB_PLATAFORMA_DOCUMENTO` igual ao CPF do gestor. Script: `node trabalho/editais/r4-pc-cfg2.mjs`.
- **O que esperava.** Recusa na subida. A doc diz que o apelido "vale como o CPF da conta da plataforma".
- **O que aconteceu.** Subiu sem aviso. `admin` com a senha do gestor deu 200 e papel `gestor`.
- **Alcance.** Não é escalada de privilégio nem vazamento. Exige erro do operador e a senha certa. Mas a checagem de papel só existe quando a senha está no ambiente (`garantirContaPlataforma`). A doc manda apagar essa variável depois do primeiro acesso.
- **Arquivo provável.** `entregas/editais/servidor/conta-plataforma.js` (`loginPlataformaDoAmbiente`) e `servidor/principal.js` (`servir`). Conferir o papel da conta no banco ao subir.

### 5. Baixa. Erro 500 com corpo JSON malicioso (já existia antes dos 3 commits)

- **O que fez.** `POST /api/acesso/documento` com `{"documento":{"toString":"x"}}`. Também deu 500 em `/api/acesso/entrar`, `/api/acesso/esqueci-senha` e `/api/acesso/criar-conta`.
- **O que esperava.** 400.
- **O que aconteceu.** 500 `erro_interno`. `String(objeto)` lança `TypeError`. Repeti no commit 3bbd7c6 (antes dos 3 commits) e deu o mesmo. Não é regressão. As rodadas anteriores não testaram esse formato.
- **Arquivo provável.** `entregas/editais/js/regras.js`, `somenteDigitos`. Usar `typeof texto === 'string'` antes de converter. Vale também para `documentoDoLogin` em `servidor/rotas/acesso.js`.

## O que foi atacado e passou

Servidor real (`node servidor/principal.js`), portas 4701 a 4772. Scripts `r4-pc-api.mjs`, `r4-pc-cfg.mjs`, `r4-pc-cfg2.mjs`, `r4-pc-tempo.mjs`.

- **Desligado por padrão.** Sem a variável, `admin`, `ADMIN` e `root` dão 400 `documento_invalido` com o mesmo corpo nas duas rotas. O log não anuncia login de teste.
- **Variações.** Aceitos: `admin`, `ADMIN`, ` Admin `, NBSP no início, tab e quebra de linha no fim. Recusados (400): `аdmin` com a cirílica, `admın`, `ａｄｍｉｎ` em largura total, `ADMİN`, byte nulo, espaço de largura zero, `admin1`, `admi`, `root`, 41 e 200 mil letras, `admin admin admin`. Vazio e só espaços dão `documento_obrigatorio`.
- **Limites.** O apelido grava erro no documento da plataforma. 5 erros por IPs diferentes, misturando `admin`, `ADMIN` e CPF, bloqueiam o apelido e o CPF (429). 40 erros em paralelo: 5 respostas 401 e 35 respostas 429. Por IP: o 6º erro seguido bloqueia, com o apelido misturado. Cabeçalho `X-Forwarded-For` falso sem `TEB_CONFIAR_PROXY` é ignorado. `/api/acesso/documento` bloqueia no 31º pedido por IP e conta o apelido.
- **Revela o recurso.** Sim, por necessidade. Com o recurso ligado, `admin` em `/api/acesso/documento` dá 200 `{"existe":true}` e `root` dá 400. Quem sabe o apelido confirma que ele existe. Quem não sabe só vê que `admin` não é recusado como as outras palavras, o que denuncia o recurso. A doc não registra isso. Ver melhoria 2.
- **Tempo e mensagem.** Senha errada pelo apelido, pelo CPF da plataforma e por CPF inexistente: mesma resposta (`Senha incorreta.`) e mesmo tempo (cerca de 210 ms).
- **Auditoria.** `login`, `login_falha` e `login_bloqueado` por apelido levam `{"via":"apelido"}`. `alvo` traz só o CPF da plataforma. Não há senha. `limite_excedido` não leva a marca, e isso é aceitável.
- **Outras rotas.** O apelido não vale em `/api/acesso/esqueci-senha`, `/criar-conta` nem `/redefinir`. A resposta é 400.
- **Isolamento.** Com a configuração correta, o apelido só abre a conta da plataforma. Nada do apelido aparece em outra organização, em outro papel ou na resposta do usuário.
- **Política de senha.** Na subida com `TEB_PLATAFORMA_SENHA`, conta nova recusa senha curta, senha com 11 caracteres, senha de demonstração e senha com o nome. A saída não imprime a senha. Subida recusa `TEB_PLATAFORMA_LOGIN` com `1admin`, `ab`, `ad min`, sem documento e com documento de demonstração, mesmo formatado. Conta demo não loga no servidor real (401). Criar conta com CPF reservado ou com a senha de demonstração dá 400.
- **500.** Nenhum 500 nos 4 casos acima nem com JSON quebrado, número, booleano, array, objeto simples e `null`. Única exceção: falha 5.
- **Tela.** Com o recurso: Enter avança, o foco vai para a senha, senha errada mostra "Senha incorreta." e seleciona o campo, clique duplo em Avançar e em Entrar não quebra, entra em `/plataforma` e F5 mantém a sessão. Celular de 390 px: sem rolagem horizontal. Capturas lidas: `pc-login-sem.png`, `pc-login-sem-erro.png`, `pc-login-com-senha-errada.png`, `pc-login-mobile-etapa2.png`, `pc-plataforma.png`, `pc-demo.png`. Sem texto cortado nem sobreposição.
- **Demonstração.** Rótulo "CPF ou CNPJ". `admin` dá "Documento inválido. Confira os números.". Sem pedido ao servidor.

## Backup: folga de relógio

Script `r4-pc-trava.mjs`, caso 3.

- Trava recente, de agora, com +30 s e +59 s no futuro, e com 5h59 de idade: recusa. Correto.
- Trava com +61 s, +1 dia, 6h01 e 7 dias: descarta e solta ao fim. Correto.
- A folga não abre brecha de descarte precoce. Ela só amplia a janela em que a trava vale. O limite de 6 horas não mudou.
- Dois backups em paralelo com trava nova: um recusa e a trava é solta.
- Corrida em trava velha: dois processos que a encontram ao mesmo tempo sobrescrevem a trava e ambos rodam. Já era assim antes. Ver melhoria 3.

## Pages, README, `.env.example` e `docs/seguranca.md`

- **Pages.** O repositório está pronto: `index.html` na raiz redireciona (meta refresh relativo) para `entregas/editais/` e há `.nojekyll`. Servi a raiz como estático: abre o login em modo demonstração, com a faixa visível, sem resposta HTTP de 400 ou mais. Não há workflow nem pasta `.github`, então os commits não ligam nada. Não sei se o Pages está ligado nas configurações do GitHub. A URL da demonstração não respondeu daqui (`curl` devolveu 000), e não pude conferir. O README já trata a URL como no ar.
- **README.** As 4 contas e a senha `Exemplo#2026` batem com `js/telas/acesso.js` e são fictícias. Não há senha real nem CPF real. O nome no rodapé é o crédito exigido pela spec. Comandos, links para `docs/` e a lista de recursos batem com o código. A frase "O servidor real recusa essas contas e essa senha" foi comprovada.
- **`.env.example`.** As variáveis `TEB_*` do código e do arquivo são as mesmas. Os comentários do apelido e da criação automática batem com o comportamento.
- **`docs/seguranca.md`.** Conferido contra o código: rotas, `via: apelido`, limites, modo demonstração e conta já existente. Duas lacunas: o apelido pode ser usado só quando o papel confere (falha 4) e o recurso é detectável (melhoria 2).

## Melhorias opcionais (não reprovam)

1. Teste de catálogo com o recurso ligado, por exemplo a validação de 5 erros e a de tempo igual repetidas com `admin`.
2. Registrar em `docs/seguranca.md` que, com o apelido ligado, `admin` em `/api/acesso/documento` responde diferente de outras palavras.
3. Trocar a sobrescrita da trava velha por remoção seguida de `wx`, para fechar a corrida entre dois processos.
4. Mostrar o apelido digitado na etapa 2 do login com a dica "Trocar documento" renomeada para "Trocar usuário ou documento".
5. Avisar na subida, em letras claras, quando `TEB_PLATAFORMA_LOGIN` estiver ligado junto com `TEB_HTTPS=1`.

## Limpeza

- Scripts criados em `trabalho/editais/`: `r4-pc-api.mjs`, `r4-pc-cfg.mjs`, `r4-pc-cfg2.mjs`, `r4-pc-trava.mjs`, `r4-pc-tempo.mjs`, `r4-pc-ui.mjs`. Ignorados pelo git.
- Capturas em `trabalho/editais/telas-r4/pc-*.png`. Ignoradas pelo git.
- Bancos temporários `tmp-r4/seg/pc-*` apagados. Servidores de teste encerrados. A cópia do commit anterior no scratchpad foi apagada.
- `git status` limpo. Sem commit nem push. Nada da entrega foi editado.
