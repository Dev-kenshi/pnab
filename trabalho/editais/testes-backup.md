REPROVADO

# Teste da etapa de backups (commits 1a2399f a a713933)

Revisor: segunda opinião. Ramo `construcao`. Data: 2026-11-11.

## Portões
- `cd entregas/editais && npm test`: 120 de 120 passam (16 são de backup).
- `node scripts/portoes/portao-3.mjs entregas/editais`: APROVADO.
- Observação: a árvore de trabalho tem 10 arquivos modificados e não commitados, de outra frente (login e senha). Só `principal.js` toca o backup nessa lista, e a mudança é uma linha em `criarPlataforma`. Os testes rodaram com essa árvore.

## O que passou no ataque
Script: `node trabalho/editais/r4-backup-ataque.mjs` (nuvem falsa, sem rede). 31 de 33 verificações ok.
- Cifra recusa arquivo vazio, só cabeçalho, sem tag, bit trocado, byte sobrando e chave curta. Nada sobra no disco (`.parcial` some). IV muda a cada cifra.
- Destino com nomes `anexos/../../x.bin.teb`, `banco/../x` e variantes: nada grava fora da pasta. Nome com `..` pedido à mão é recusado.
- NDJSON malicioso, cifrado por mim com a chave certa: tabela `sqlite_master`, tabela com `; DROP`, coluna com injeção, tabela `sessoes`, sem marcador de fim, contagem errada, contagem de tabela ausente, sem cabeçalho, versão 2, JSON quebrado, valor objeto, arquivo vazio. Todos recusados e o banco de destino fica intacto (13 tabelas, 0 usuários).
- Retenção não apaga `banco/notas.txt`, `banco/leia-me` nem `.teb.bak`.
- Falha de um destino não derruba os outros. Relatório e log não trazem token, chave ou segredo.
- Pasta temporária fica vazia depois de sucesso e de falha.
- NDJSON não traz `sessoes`, `tokens_redefinicao`, `tentativas_login`.
- CLI (`env -i`, sem rede): sem chave, sem destino, variáveis pela metade, chaves iguais, `TEB_BACKUP_RETER=0`, destino não configurado e `restaurar` com arquivo existente. Todos saem com código 1 e mensagem clara, sem segredo.
- Números de `docs/backups.md` conferem com o código: 14 de retenção, 50 MB no GitHub, 16 testes, nomes das variáveis, comandos, `--listar`, formato do nome do objeto.

## Falhas

### 1. Média. Backup feito durante escrita pode não restaurar
- O que fez: `exportarBanco` com um cadastro novo entrando entre a leitura de `organizacoes` e a de `usuarios`.
- Esperava: backup restaurável.
- Aconteceu: `importarBanco` falha com `FOREIGN KEY constraint failed`. O backup é aceito como ok, cifrado e enviado, mas não restaura.
- Por que importa: `TEB_BACKUP_INTERVALO_HORAS` roda o backup dentro do servidor, com tráfego. O cron externo também roda com o sistema no ar. Cada tabela é lida em consultas separadas, sem transação. Ninguém descobre até o dia da restauração.
- Repetir: `node trabalho/editais/r4-backup-ataque.mjs`, linha `FALHA exportar com escrita concorrente gera backup restaurável`.
- Arquivo provável: `entregas/editais/servidor/backup/exportar.js` (`exportarBanco`). Ler tudo dentro de uma única leitura consistente (transação). Opcional: testar o NDJSON antes de enviar (importar num SQLite temporário).
- Falta teste para isso em `backup.test.js`.

### 2. Média. Documento erra a conta do GitHub
- O que diz: "14 cópias dão 140 MB. Folga grande." (`docs/backups.md`, tabela de capacidade).
- Esperava: número que vale com o tempo.
- O que acontece (leitura do código e do funcionamento do Git, não rodei contra o GitHub): `apagar` usa DELETE da API de conteúdo. Isso remove o arquivo do ramo, mas o blob continua no histórico do repositório. Com um backup por dia de 10 MB, o repositório passa de 3,6 GB em um ano, acima do 1 GB que o próprio documento recomenda.
- Arquivo provável: `docs/backups.md` (linha 63 e "O que olhar com o tempo"). Ajustar a conta e dizer como limpar (repositório novo por ano, ou reduzir a frequência para o GitHub).

### 3. Baixa. Relógio atrasado apaga o backup recém-criado, com relatório ok
- O que fez: `fazerBackup` com `reter: 1`, primeiro em 2026-07-10, depois em 2026-07-05.
- Esperava: manter o backup novo, ou avisar.
- Aconteceu: sobra só o de 07-10. O de 07-05, recém-enviado, foi apagado e o relatório diz `ok`.
- Repetir: o script imprime `INFO relogio atrasado, sobra no b2: banco/2026-07-10...`.
- Arquivo provável: `servidor/backup/rotina.js` linha 60. Nunca apagar o nome que acabou de enviar.

### 4. Baixa. Restauração que falha no meio deixa estado pela metade
- O que fez: restaurar com um anexo adulterado no destino.
- Aconteceu: erro correto (`Backup adulterado ou chave errada`), mas o banco restaurado já ficou no disco e a pasta de anexos está vazia. Uma nova tentativa pelo CLI recusa (`já existe`). A mensagem não diz qual anexo falhou.
- Repetir: seção F do script (linha `INFO anexo adulterado`).
- Arquivo provável: `rotina.js` (`restaurar`) e `principal.js` (`restaurarComando`). Incluir o id do anexo no erro e dizer no erro que o banco novo deve ser apagado.

### 5. Baixa. `TEB_GITHUB_REPO=../x` passa na validação
- O que fez: `TEB_GITHUB_REPO=../x node servidor/principal.js backup` (com chaves e token falsos, sem rede útil).
- Esperava: recusa, pois `..` não é dono de repositório.
- Aconteceu: a regex `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` aceita; o programa tentou a chamada (`fetch failed`). É configuração do operador, risco baixo.
- Arquivo provável: `servidor/backup/destinos.js` linha 169.

### 6. Baixa. Arquivo sem gzip e com conteúdo vazio não decifra
- O que fez: cifrar e decifrar um arquivo de 0 bytes sem gzip.
- Aconteceu: `ERR_OUT_OF_RANGE: start must be <= end`. O ramo `vazio()` na linha 73 de `cifra.js` nunca roda, porque `createReadStream` com `end < start` lança antes.
- Hoje não acontece de verdade: o anexo no disco tem no mínimo 28 bytes. Vira falha se alguém usar `decifrarArquivo` com vazio.
- Repetir: seção A do script.

## Riscos que não consegui verificar (sem rede, sem contas)
- Google Drive: a busca usa `name contains 'anexos/'` e `name contains '<nome inteiro>'`. A documentação diz que `contains` faz só prefixo de termo. Com `/`, `-` e `.` no nome, o resultado pode vir vazio. Se vier vazio, todo backup reenvia todos os anexos (o Drive aceita nomes repetidos), a retenção não apaga nada e `baixar` não acha o arquivo. A nuvem falsa usa `includes` e esconde isso. O código já filtra com `startsWith` depois, então basta listar a pasta inteira sem `name contains`.
- Os destinos reais nunca foram chamados. O próprio documento admite isso.

## Melhorias opcionais
- Se o processo morrer à força (SIGKILL) entre exportar e cifrar, `servidor/dados/tmp-backup/bkp-*/banco.ndjson` fica em claro, com dados pessoais. Não há limpeza no início da próxima execução. Não reproduzi. Limpar `bkp-*` e `rest-*` antigos ao começar.
- Sem trava entre backup do cron e backup interno do servidor. Duas execuções juntas duplicam anexos no Drive.
- B2: upload com 401 ou 5xx não tenta de novo com novo `b2_get_upload_url`, como a documentação do B2 recomenda.
- `fetch failed` sem causa na mensagem. Ajuda pouco o operador.
- Nenhum teste cobre os comandos da CLI em `principal.js`, a paginação do Drive e do B2, nem a retenção com relógio atrasado.
- `criar-pasta-drive` cria uma pasta nova a cada execução.
- Anexo é enviado sem conferir se o arquivo local está íntegro.

## Limpeza
- Criados: `trabalho/editais/r4-backup-ataque.mjs` (ignorado pelo git) e este arquivo. A pasta `tmp-r4/cli` foi apagada.
- Nada na entrega foi editado. Sem commit nem push.
