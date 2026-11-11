REPROVADO

# Testes de segurança do editais, segunda passada independente

Ramo `construcao`. Data 2026-11-11. Passada do testador, sem olhar o catálogo como prova.

## O que rodei

| Comando | Resultado |
|---|---|
| `cd entregas/editais && npm test` | 234 de 234 passam, 16,4 s |
| `node scripts/portoes/portao-3.mjs entregas/editais` | APROVADO |
| `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas` | APROVADO, 4 larguras e 12 critérios |
| `node trabalho/editais/r4-seg-docs.mjs` | docs/seguranca.md bate com o catálogo: 100 linhas, 0 diferenças de título, manual ou NIST, 0 títulos repetidos |
| Contagens do doc | Seções do manual 39/26/15/7/7/6 e NIST PR 94, DE 5, RC 1 conferem. Backup tem 23 testes. Turso tem 5. |

Os portões passam. As falhas abaixo são o que eles não viram.

## Como ataquei

Servidor real: `node servidor/principal.js` sem e-mail configurado, SQLite em arquivo, três instâncias (sem proxy, com `TEB_CONFIAR_PROXY=1`).

Scripts, todos em `trabalho/editais/`:
- `r4-seg-lib.mjs`: sobe o servidor real e faz os pedidos com `node:http` (permite Host e Origin falsos).
- `r4-seg-ataque1.mjs`: senha, limites, XFF, Origin, corrida, enumeração, log. Saída: `tmp-r4/saida-seg1.txt`. 33 ok, 3 falhas.
- `r4-seg-ataque2.mjs`: Origin em rota sem limite, corrida grande, tempo, IDOR, upload, sessão, estático, cabeçalhos, 253 pedidos de lixo. Saída: `tmp-r4/saida-seg2.txt`. 55 ok, 3 falhas (uma era erro do meu script, ver nota em "O que passou").
- `r4-seg-ataque3.mjs`: redefinição com token real e corrida no redefinir.
- `r4-seg-ui.mjs`: tela de criar conta no modo demonstração, captura em `telas-r4/seg-criar-conta.png`.
- `tmp-r4/r4-seg-mut.sh`: mutação em cópia da pasta.

## Falhas, por gravidade

### F1. ALTA. Pedidos paralelos contornam o limite de 5 erros de senha

- Fez: 120 logins ao mesmo tempo, mesmo IP, mesmo documento. 119 senhas erradas e a certa na posição 120.
- Esperava: 5 respostas 401, o resto 429. A senha certa não deveria nem ser avaliada.
- Aconteceu: `{"200":1,"401":119}` em 4,9 s. As 119 foram avaliadas e a certa entrou. Com 30 em paralelo deu o mesmo (`{"200":1,"401":29}`).
- Mesmo defeito em `PUT /api/conta/senha`: 20 senhas atuais erradas em paralelo, todas 400 (`{"400":20}`), limite era 5.
- Causa: o servidor lê o bloqueio, gasta o scrypt, e só depois grava o erro. Todos os pedidos leem "sem bloqueio" antes de o primeiro gravar. O catálogo (SEG-005, SEG-006, SEG-027) só testa pedidos em fila.
- Arquivos prováveis: `servidor/rotas/acesso.js` (rota `/api/acesso/entrar`), `servidor/seguranca.js` (`loginBloqueado`, `registrarErroLogin`), `servidor/rotas/conta.js` (`dentroDoLimite` seguido de `contarUso`).
- Correção sugerida: reservar a tentativa antes do scrypt, com `contarUso` dentro de transação, e devolver a tentativa se a senha estiver certa. Ou uma fila por documento.
- Passos: `node trabalho/editais/r4-seg-ataque2.mjs`, linha "corrida de 120 logins paralelos". O de 60 consultas em paralelo em `/api/acesso/documento` deu exatamente 30 e 30, porque `contarUso` usa transação. O mesmo padrão resolve o login.

### F2. MÉDIA. `TEB_CONFIAR_PROXY=1` confia no primeiro item do X-Forwarded-For

- Fez: 40 consultas de documento com `X-Forwarded-For: 10.9.<i>.1, 192.0.2.77`, onde o último é o IP real e o primeiro é forjado.
- Esperava: bloqueio na 31ª, pois o IP real é o mesmo.
- Aconteceu: 0 bloqueios. O cliente escolhe o próprio IP e anula todos os limites por IP (login por IP, documento, esqueci-senha). Proxies comuns acrescentam o IP real no fim da lista, então o primeiro item é do atacante.
- Sem a variável, o XFF é ignorado corretamente: 40 pedidos deram 30 e 10 bloqueios.
- Arquivo: `servidor/seguranca.js`, `ipPadrao` (`.split(',')[0]`). Usar o último item, ou o N-ésimo da direita para N proxies.
- Nenhum teste cobre o XFF com proxy: troquei para `.at(-1)` na cópia e o catálogo e o `npm test` seguiram 101 e 234 de 234.
- `docs/seguranca.md` fala do proxy só como "sem isso todos parecem o mesmo IP". Não avisa disto.
- Passos: `node trabalho/editais/r4-seg-ataque1.mjs`, seção 4.

### F3. MÉDIA. `criar-conta` não tem limite e revela se o documento tem conta

- Fez: 25 `POST /api/acesso/criar-conta` do mesmo IP que já estourou o limite de `/api/acesso/documento` (429), alternando documento novo e documento existente.
- Esperava: 429 ou, no mínimo, resposta que não diga se o documento existe.
- Aconteceu: `{"201":13,"409:documento_existente":12}`. O 409 confirma que o CPF tem conta. Contas novas são criadas sem freio (13 em 2,3 s, cada uma com scrypt).
- Efeito: o limite de 30 por 15 min de SEG-034 é contornável por esta rota, e dá para encher o banco e gastar CPU.
- Arquivo: `servidor/rotas/acesso.js`, rota `criar-conta`. Aplicar `contarUso` por IP e tratar o 409 de forma neutra, ou aceitar que `/documento` já revela e limitar as duas com a mesma chave.
- Passos: `node trabalho/editais/r4-seg-ataque1.mjs`, seção 5.

### F4. MÉDIA. As telas dizem "Pelo menos 8 caracteres", a regra é 10 (proponente) e 12 (equipe)

- Fez: abri a criação de conta no modo demonstração (`node trabalho/editais/r4-seg-ui.mjs`, captura `telas-r4/seg-criar-conta.png`) e digitei 9 caracteres.
- Esperava: dica coerente com a regra. O doc diz que a regra "vale igual nas telas".
- Aconteceu: a dica diz "Pelo menos 8 caracteres." e o erro diz "A senha precisa ter ao menos 10 caracteres." A pessoa é induzida ao erro. Gestor e avaliador veem "8" ou "Mínimo de 8" e a regra pede 12.
- Arquivos: `js/telas/acesso.js` linhas 119 e 217, `js/telas/conta.js` linha 80, `js/telas/gestor.js` linha 89, `js/telas/plataforma.js` linha 33.
- Os portões passam porque nenhum critério confere esse texto.

### F5. MÉDIA. Validações do catálogo que passam com a defesa desligada

Fiz 13 mutações em cópia (`tmp-r4/mut-*`, já apagadas). O catálogo pegou 7 e deixou passar 6. Destas, 5 também passaram no `npm test` inteiro (234 de 234).

| Mutação na cópia | Catálogo (101 testes) | `npm test` inteiro |
|---|---|---|
| `app.js`: e-mail padrão passa a imprimir o link no log (vaza token por padrão) | passa, SEG-099 não pega | passa |
| `seguranca.js` `origemConfiavel`: Origin inválido, como `null`, passa a ser aceito | passa | passa |
| `seguranca.js` `verificarSenhaFicticia`: sem o hash falso, login de documento sem conta fica rápido (enumeração por tempo) | passa | passa |
| `proponente.js` download de anexo: sem a checagem de dono, qualquer proponente da mesma organização baixa anexo de outro | passa, SEG-046 só testa outra organização | passa |
| `seguranca.js` `ipPadrao`: XFF com proxy trocado por último item | passa | passa |
| `proponente.js` `inscricaoDoDono`: sem checagem de dono (`OR 1=1`) | passa, SEG-042 só testa outra organização | falha em 2 testes (S7, S11), então coberto |
| `acesso.js`: sem `loginBloqueado` | falha SEG-005, 006, 094 | |
| `acesso.js`: sem apagar sessões na redefinição | falha SEG-029 | |
| `acesso.js`: limite por documento do esqueci-senha removido | falha SEG-033 | |
| `regras.js`: senha com CPF aceita | falha SEG-012 | |
| scrypt `p=1` | falha SEG-001, 009 | |
| limite de `/documento` em 3000 | falha SEG-034 | |
| HSTS sem `includeSubDomains` | falha SEG-060 | |

As três últimas linhas confirmam a tabela de mutação do doc.

Itens fracos por nome:
- **SEG-099** testa só a função `emailDesligado`, não que o app a use por padrão nem o log real. Eu rodei o servidor real e o log ficou limpo (veja abaixo), mas o teste não protege isso.
- **SEG-046 e SEG-042** dizem "proponente não baixa/vê de outro", mas usam o proponente de outra organização. O filtro por organização já bloqueia. O caso "outro proponente da mesma organização" não existe no catálogo. Eu fiz este ataque no servidor real e deu 404 (ok), então o código está certo, o teste é que não prova.
- **SEG-065** só testa Origin `https://malicioso.example`. `null`, porta diferente e lixo não são testados.
- **SEG-004** compara só o corpo da resposta, não o tempo.
- **SEG-053** só confere que o servidor devolve JSON, não que a tela escapa o texto.
- **SEG-097** procura só duas senhas conhecidas na auditoria.

## O que passou no ataque (resumo)

- Senha: 10 espaços, 10 vezes "á", 10 vezes "ç", 20 emojis iguais, "S.e.n.h.a 1 2 3 4 5", `Senha@12345`, `password123!`, CPF com pontos, e-mail e primeiro nome com acento e maiúscula, objeto, número, array e null foram recusados. 128 emojis distintos aceitos, 129 recusados, 129 caracteres comuns recusados (limite conta pontos de código, não unidades UTF-16). Nenhum 500.
- Documento com 7 formatos (`529.982.247-25`, com espaços, em array, número, com letras) cai na mesma chave do limite.
- Origin `null`, porta diferente, subdomínio, lixo, `file://`, Host falso com Origin real, `Sec-Fetch-Site: cross-site`: todos 403. `PUT /api/conta` com Origin hostil não mudou o nome. `text/plain` deu 415.
- IDOR: 20 cenários entre organizações A e B e entre proponentes da mesma organização (ler, baixar anexo, subir anexo, alterar, recurso, enviar, atribuir avaliador de outra organização, publicar resultado): todos 403 ou 404.
- Upload: HTML sem `%PDF-` 415, vazio 400, `.exe` 415, sem nome 415, tipo errado 415. Nome com CRLF e aspas não injetou cabeçalho. Download vem como `attachment` com `nosniff`.
- Sessão: cookie com `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`. Fixação de sessão ignorada. Sair invalida. Trocar a senha derruba as outras sessões. Redefinição: 6 pedidos paralelos com o mesmo token deram um 204 e cinco 400. Senha fraca no redefinir dá 400 sem gastar o token.
- Enumeração: `esqueci-senha` igual em corpo, status e cabeçalhos com e sem conta. Tempo do login errado com conta e sem conta, 12 amostras: mediana 150,0 ms e 151,0 ms.
- Estático: 28 caminhos de travessia, ocultos, `/servidor/`, `/js/testes/`, `.sqlite`, byte nulo, barra invertida. Nenhum serviu código do servidor. `/img/..` e `/js/regras.js/` dão 200, sem risco.
- Cabeçalhos de segurança presentes na página, no 404 estático e na API (`no-store`). Sem `Server` nem `X-Powered-By`.
- 253 pedidos de lixo (JSON quebrado, 200 mil colchetes aninhados, 1 MB de senha, bytes inválidos, corpos de tipos errados em 16 rotas): 0 respostas 500, servidor sem `[erro]`, ainda vivo.
- Log do servidor real sem e-mail configurado: só `[e-mail] envio não configurado. "Redefinição de senha" para t***@teste.example não foi enviado.` Sem token, link nem e-mail completo. Nenhuma senha, hash ou cookie em 346 bytes de log. O `criar-plataforma` não mostra a senha.
- Nota: meu script marcou "sair invalida cookie" como falha, porque mandei `POST /api/acesso/sair` sem corpo e veio 415. Com `{}` (como o front manda em `js/api.js`) dá 204 e a sessão cai. Não é falha, vai em melhorias.

## Citações do manual e do NIST

- As seis seções citadas existem no README do Cybersecurity101, dentro de "Fundamentos de Cibersegurança", como itens em negrito e não como títulos: Conceitos de Segurança, Criptografia, Gestão de Identidade e Acesso, Resposta a Incidentes, Legislação e Ética, Desenvolvimento Seguro. "Frameworks e Melhores Práticas" existe como título e só cita o NIST em uma linha. O doc admite isso.
- As subcategorias NIST usadas têm o formato de CSF 2.0 (PR.AA, PR.DS, PR.PS, PR.IR, DE.CM, DE.AE, RC.RP). Não consegui conferir o texto oficial de cada uma aqui.
- Ligações discutíveis, sem reprovar: SEG-008 (hash com custo absurdo) está em "CIA" com `PR.AA-01`, melhor `PR.IR-04`. SEG-068 a 071 (travessia de caminho) em `PR.DS-01`, melhor `PR.PS-06`. SEG-082 (envio duplo) em `PR.DS-01`.

## Melhorias opcionais (não reprovam)

1. Lista de senhas comuns curta. Aceitas: `Mudar@123456`, `1q2w3e4r5t`, `1357913579`, `ｓｅｎｈａ１２３４５` (largura total), 10 vogais acentuadas, 128 letras do alfabeto repetidas. Normalizar com NFKC e usar uma lista maior.
2. A senha não é normalizada na entrada. Criada com "é" decomposto e digitada com "é" composto, o login dá 401. Normalizar NFKC na criação e no login.
3. Bloqueio por documento permite travar a conta de outra pessoa com 5 erros a cada 15 minutos. É a troca conhecida do desenho. Documentar.
4. IPv6: um atacante com um bloco /64 troca de IP à vontade. Agrupar o limite por /64.
5. A tabela `tentativas_login` só cresce. Apagar linhas vencidas.
6. `POST /api/acesso/sair` sem corpo dá 415 e não encerra a sessão. Aceitar sem corpo.
7. Gestor define a senha inicial do avaliador e a dica diz que a pessoa "deve trocar", mas nada obriga. Forçar a troca no primeiro acesso.
8. `origemConfiavel` compara com o `Host` recebido. Um proxy que reescreve o Host bloquearia todos os pedidos legítimos com 403. Comparar com o host de `TEB_URL_PUBLICA` e documentar. Não testei com proxy real.
9. Tornar os testes do catálogo independentes. SEG-031 depende do e-mail guardado por SEG-029, SEG-089 depende do arquivo de SEG-088, SEG-093 a 096 e SEG-047 dependem de eventos de testes anteriores. Rodar um item isolado quebra.
10. `docs/seguranca.md` deve listar as pendências F1, F2 e F3 enquanto não forem corrigidas. Hoje o item "Limites de tentativa" aparece como "pendências fechadas".

## Limpeza

- Entrega não foi editada. `git status` limpo, sem commit nem push.
- Apagados: cópias de mutação `tmp-r4/mut-*` e bancos temporários `tmp-r4/seg`. Nenhum processo `principal.js` ficou rodando.
- Ficam, todos ignorados pelo git: `trabalho/editais/r4-seg-*.mjs`, `tmp-r4/r4-seg-mut.sh`, `tmp-r4/saida-seg1.txt`, `tmp-r4/saida-seg2.txt`, `telas-r4/seg-criar-conta.png`.

## Para voltar a APROVADO

1. Corrigir F1 e provar com um teste paralelo (120 logins, no máximo 5 avaliados). Idem senha atual.
2. Corrigir F2 e cobrir o XFF com proxy.
3. Corrigir F3.
4. Corrigir as dicas de senha (F4) e, de preferência, um critério do portão 4 que leia a dica.
5. Fechar as brechas de F5: SEG-099 pelo app e pelo log, Origin `null`, tempo do hash falso, anexo e inscrição de outro proponente da mesma organização, XFF.
