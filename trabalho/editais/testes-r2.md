APROVADO (rodada 2)

# Revisão do adaptador Cloudflare R2 (ramo `construcao`, commit 78edb02)

Duas falhas. A SigV4 está correta. O resto do adaptador se comportou bem nos ataques.

## Portões (rodados de novo por mim)
- `cd entregas/editais && npm test`: 269 passam, 0 falham.
- `node scripts/portoes/portao-3.mjs entregas/editais`: APROVADO.
- `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas`: APROVADO, C1 a C12 ok.
- Os commits bb81576 a 78edb02 não mexem em HTML, CSS nem JS do navegador. Não reli as capturas de tela por isso.

## Falhas

### 1. Alta. Token de continuação repetido trava a listagem para sempre
- Fez: `listarIds()` com resposta do R2 que diz `IsTruncated=true` e devolve sempre o mesmo `NextContinuationToken`. Script `trabalho/editais/r4-r2-infinito.mjs`.
- Esperava: parar depois de um limite de páginas, ou ao ver um token repetido, com erro `ARMAZEM_INDISPONIVEL`.
- Aconteceu: o laço pediu 20.001 páginas sem parar. Só parou porque o meu teste lançou erro. Num teste anterior sem esse freio, o processo ficou preso em 100% de CPU e os temporizadores nunca dispararam.
- Efeito: `migrar-anexos`, `backup` e a restauração com R2 podem ficar presos. Só o timeout de 30 s por pedido não ajuda, porque cada pedido responde rápido.
- Arquivo: `entregas/editais/servidor/anexos.js`, laço `do ... while (continuar)` em `listarIds` (linhas 166 a 178).

### 2. Média. R2 fora do ar na listagem derruba o backup do banco inteiro
- Fez: `fazerBackup` com `anexos` apontando para um R2 que responde 500 na listagem. Script `trabalho/editais/r4-r2-ataque.mjs`, bloco 8.
- Esperava: o banco ser enviado aos destinos mesmo assim, com o erro registrado só nos anexos. A doc diz que um destino com erro não impede os outros, e o banco é o dado mais importante.
- Aconteceu: `fazerBackup` lançou `R2 respondeu 500 ao listar os anexos.` antes do laço de destinos. Nenhum destino recebeu o banco. O comando `backup` sai com erro e não há backup do dia.
- Efeito: uma queda do R2 apaga a proteção do banco no mesmo dia.
- Arquivo: `entregas/editais/servidor/backup/rotina.js`, linha `const ids = await fonte.listarIds();` fora do `try` por destino (cerca da linha 114).
- Contraste: com um anexo ilegível no R2 (403 só nele), o banco foi enviado (`banco: true`) e o destino ficou `ok: false` com o erro. Esse caso está certo.

### 3. Baixa. Corpo da resposta cortado no meio vira 500 e não 503
- Fez: download com `GET` do R2 respondendo 200 e a conexão caindo no meio do corpo. Script `trabalho/editais/r4-r2-rota.mjs`.
- Esperava: 503 `armazenamento_indisponivel`, como nos outros defeitos do R2.
- Aconteceu: 500 `anexo_corrompido` ("Não foi possível abrir o anexo"). O erro de `r.arrayBuffer()` e de `r.text()` sai de `pedir` sem o `code`.
- Não vaza segredo e o servidor continua de pé. Por isso é baixa. Mas a mensagem engana o usuário e o suporte.
- Arquivo: `anexos.js`, `lerBruto` (`await r.arrayBuffer()`) e `listarIds` (`await r.text()`).

## O que conferi e está certo
- SigV4 contra uma referência independente de lado servidor, escrita por mim a partir da documentação da AWS (`r4-r2-ref.mjs`). Ela recalcula caminho e consulta a partir da URL que vai no fio, como o S3 faz. Script `r4-r2-sigv4.mjs`: 294 combinações (GET e PUT; espaço, `+`, `~`, `%`, `*`, `!`, `'`, `()`, `$`, unicode e emoji em caminho e consulta; consultas fora de ordem, chaves repetidas em maiúscula e minúscula; cabeçalho com espaços e tabulação), 0 divergências.
- Pedido real gerado: `GET https://<conta>.r2.cloudflarestorage.com/<bucket>/?list-type=2&prefix=anexos%2F&max-keys=1000`, região `auto`, serviço `s3`, `x-amz-content-sha256` assinado, `host` e `x-amz-date` assinados.
- Ciclo grava, lê, lista e apaga aceito por esse verificador independente.
- Id malicioso (`../../x`, maiúsculas, 31 e 33 caracteres, `\n` no fim, vazio, null, objeto): recusado em `ler` e `apagar` com "Id de anexo inválido."
- Segredo em erro: com fetch que lança texto com o segredo, 403 e 500 que devolvem o segredo no corpo, a mensagem, o `stack` e o JSON do erro nunca contêm o segredo. Log do servidor (`[anexos] ...`) idem. A resposta HTTP ao usuário idem.
- XML hostil na listagem: de 8 chaves (prefixo errado, `../`, subpasta, maiúsculas, extensão extra, `&amp;`, CDATA), só a chave válida entrou.
- 403, 500 e rede caída: envio e download dão 503 `armazenamento_indisponivel` sem detalhe. O servidor seguiu respondendo depois.
- Timeout: com um fetch que nunca responde, o erro veio em 30 s com `ARMAZEM_INDISPONIVEL` e sem segredo (`r4-r2-timeout.mjs`).
- Sobrescrita: segundo PUT no mesmo id recebe 412 e o original fica intacto.
- Migração: falha no 3º anexo deixou 2 no R2. Segunda rodada copiou 3 e pulou 2. Terceira pulou 5. Conteúdo igual ao do disco e disco intacto.
- Backup com R2: com um anexo ilegível, o banco sobe e o erro vem no relatório, sem sobra na pasta temporária.
- Variáveis: espaços e `\n` nas pontas são aparados e funcionam. Uma só em branco dá "faltam as variáveis". Todas em branco usa o disco. Bucket com espaço, maiúscula, ponto ou 2 letras é recusado. URL no lugar do ID da conta é recusada.
- Linha de comando, sem rede e com `env -i`: `migrar-anexos` sem R2 diz para preencher `TEB_R2_*`. Com metade, lista as que faltam. Com tudo e sem rede, diz "R2 fora do alcance." e sai com 1. O servidor com metade das variáveis não sobe. Com `REPL_ID` e disco, imprime o aviso. Com R2, imprime `Anexos: r2`. O segredo não aparece na saída.
- Docs: `.env.example` e `docs/backups.md` batem com o código (quatro variáveis, escolha automática, metade é erro, migração, restaurar grava em pasta, 9 testes em `r2.test.js`, 23 em `backup.test.js`). O limite "nunca testado contra o R2 de verdade" está declarado.
- `docs/relatorio.md`: sem segredo, sem chave, sem valor de orçamento. O único valor em reais é o teto técnico de R$ 10.000.000,00 do F7, que é limite de código e não orçamento.

## Não verificado
- Nenhum pedido foi feito ao R2 de verdade (sem conta). A aceitação de `If-None-Match: *` no PUT pelo R2 vem da documentação pública da Cloudflare e não foi vista por mim. Se o R2 recusar o cabeçalho, todo envio dará 503. O primeiro teste real da doc cobre isso.

## Melhorias opcionais (não reprovam)
- Troca de disco para R2 sem migrar: o download de um anexo que só existe no disco dá 500 "anexo_corrompido" (R2 devolve 404). Sugestão: na subida com R2, avisar no log se `TEB_ANEXOS` tem arquivos `.bin`. Hoje o aviso só existe para Replit com disco.
- `listarIds` com `IsTruncated=true` e sem token devolve a lista parcial em silêncio. Melhor lançar erro, para o backup não passar por completo sem estar.
- O token de continuação não tem as entidades XML decodificadas (`&amp;`). Os tokens reais da Cloudflare não usam `&`, então é só higiene.
- `assinarSigV4` lança `URIError` com `%` solto no caminho. Só afeta chamadas diretas, pois o adaptador usa ids hexadecimais.
- `conferirId` aceita um array com um id (`String(["aaa..."])`). Não é alcançável pela rota, pois o id vem do banco.
- Os testes de `r2.test.js` conferem a assinatura com a própria `assinarSigV4`, o que é circular. Os 4 vetores oficiais cobrem isso, mas vale um teste com um verificador à parte, como o `r4-r2-ref.mjs`.

## Limpeza
- Nada fora de `trabalho/editais/`. `git status` sem alterações. Pastas temporárias dos testes apagadas.
- Scripts desta revisão (ignorados pelo git): `r4-r2-ref.mjs`, `r4-r2-sigv4.mjs`, `r4-r2-ataque.mjs`, `r4-r2-infinito.mjs`, `r4-r2-timeout.mjs`, `r4-r2-rota.mjs`.
- Comando: `node trabalho/editais/r4-r2-<nome>.mjs`, da raiz do repositório.

# Rodada 2

Veredito: APROVADO. Commits b1eefc4, 04ce750, 28e7331 e 0eb5ef8 (HEAD 0eb5ef8).

## Portões (rodados de novo)
- `cd entregas/editais && npm test`: 272 passam, 0 falham.
- Portão 3: APROVADO. Portão 4: APROVADO, C1 a C12.
- `git status` limpo. Nada escrito fora de `trabalho/editais/`.

## Falhas da rodada 1
1. Token de continuação repetido (alta): corrigida. `node trabalho/editais/r4-r2-infinito.mjs` agora lança `ARMAZEM_INDISPONIVEL` após 2 páginas ("R2 repetiu o token de continuação"). Antes eram 20.001 páginas.
2. Backup sem banco com R2 fora na listagem (média): corrigida. Com listagem 500, o relatório traz `banco: true`, `ok: false` e o erro "não foi possível listar os anexos: R2 respondeu 500 ao listar os anexos." O banco foi enviado. Com um anexo ilegível o comportamento seguiu igual, sem sobra na pasta temporária.
3. Corpo cortado vira 500 (baixa): corrigida. Na rota, o download com corpo cortado agora dá 503 `armazenamento_indisponivel`, sem segredo (`r4-r2-rota.mjs`).

## Melhorias da rodada 1 que entraram
- Truncada sem token agora lança erro (antes devolvia lista parcial em silêncio).
- Aviso na subida: com R2 e 2 arquivos `.bin` no disco, imprime "[aviso] 2 anexos ainda estão no disco. Rode: node servidor/principal.js migrar-anexos". Sem `.bin` ou com pasta inexistente, não avisa e o servidor sobe normal. Arquivo que não é anexo (`lixo.txt`) é ignorado.

## Regressões procuradas
- `r4-r2-sigv4.mjs`: 294 combinações, 0 divergências.
- `r4-r2-ataque.mjs`: ids maliciosos, segredo em erro, XML hostil, sobrescrita (412), migração com falha e repetida, variáveis com espaço. Tudo igual à rodada 1. Ajustei só o meu script, porque a listagem truncada sem token agora lança.
- Timeout: 30 s com `ARMAZEM_INDISPONIVEL`.
- Paginação legítima com tokens diferentes segue funcionando (testes do repositório).
- Nenhuma regressão encontrada.

## Opcionais que sobram
- Token de continuação sem decodificar `&amp;`, `URIError` com `%` solto em `assinarSigV4`, array aceito como id e teste de assinatura circular em `r2.test.js`. Nenhum é alcançável pelo sistema.
- Continua sem teste contra o R2 de verdade, e `If-None-Match: *` no PUT não foi visto aceito.
