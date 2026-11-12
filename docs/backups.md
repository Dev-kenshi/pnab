# Backups do Sistema Integrado TEB

Emanuel Macêdo Luz, desenvolvedor do projeto.

## Resumo

- O que vai: o banco inteiro e todos os anexos.
- Como vai: cifrado com AES-256-GCM antes de sair do servidor. Nenhum destino vê nome, CPF, e-mail ou PDF em claro.
- Para onde vai, em 3 destinos independentes:
  1. **Google Drive** (conta grátis de 15 GB): banco e anexos.
  2. **Backblaze B2**: banco e anexos.
  3. **GitHub privado**: só o banco.
- Credenciais: só por variável de ambiente. Os nomes estão em `entregas/editais/.env.example`. Nada fica no código.
- Comandos, rodados em `entregas/editais`:

```bash
node servidor/principal.js backup
```

```bash
node servidor/principal.js restaurar b2
```

## Como funciona

| Parte | Como é guardada | Nome no destino |
|---|---|---|
| Banco | Cópia completa a cada execução, em NDJSON compactado com gzip e cifrado | `banco/AAAA-MM-DDTHH-MM-SS-mmmZ.ndjson.gz.teb` |
| Anexos | Incremental: cada anexo vai **uma vez só**, porque nunca muda depois de gravado | `anexos/<id>.bin.teb` |

- **Chave própria.** `TEB_CHAVE_BACKUP` tem 32 bytes e é diferente de `TEB_CHAVE_ANEXOS`. O sistema recusa as duas iguais.
- **Nome autenticado.** O nome de cada objeto entra na verificação AES-GCM. Arquivo adulterado, trocado de nome ou aberto com a chave errada é recusado. Nada parcial é gravado.
- **Anexos com duas camadas.** No disco, eles já são cifrados com a chave dos anexos. O backup cifra de novo com a chave do backup.
- **O que fica de fora.** Sessões, tentativas de login e tokens de redefinição de senha. Depois de uma restauração, todos entram de novo e links antigos de redefinição não valem.
- **Retenção.** Ficam os `TEB_BACKUP_RETER` backups do banco mais novos em cada destino (padrão 14). O backup recém-enviado nunca é apagado, mesmo com o relógio do servidor atrasado. Anexos não são apagados do backup.
- **Cópia consistente e conferida.** O banco é lido inteiro numa só transação, para um cadastro que entra no meio não quebrar o backup. Antes de enviar, o sistema restaura o arquivo num banco temporário. Se não restaurar, nada é enviado e o comando falha.
- **Uma execução por vez.** Uma trava em `TEB_BACKUP_TEMP` impede dois backups juntos, por exemplo o do agendador e o interno. Trava com mais de 6 horas é descartada. Sobras de execuções que morreram no meio são apagadas no começo da próxima, porque podem ter o banco em claro.
- **Falha isolada.** Um destino fora do ar não impede os outros. O comando termina com código 1 e mostra qual falhou, só com o código HTTP, nunca com token ou chave. Cada execução gera uma linha na auditoria: `backup_ok` ou `backup_falhou`.
- **GitHub só privado.** Antes de enviar, o sistema confere se o repositório é privado. Se for público, não envia nada.
- **Sem pacotes externos.** Só `fetch` e `node:crypto`.

### Guarde as duas chaves fora do servidor

Guarde `TEB_CHAVE_BACKUP` **e** `TEB_CHAVE_ANEXOS` num cofre de senhas, por exemplo o Bitwarden ou o 1Password, ou em papel num lugar seguro.

- Sem a chave do backup, nenhum backup abre.
- Sem a chave dos anexos, os anexos restaurados continuam ilegíveis.

Se o servidor sumir junto com as chaves, o backup não serve para nada.

## Quanto a cliente consegue guardar no plano grátis

Premissas:
- Anexos no Cloudflare R2, com 10 GB grátis.
- Banco no Turso, com 5 GB grátis.
- Um anexo tem no máximo 10 MB.
- Uma inscrição costuma ter de 1 a 3 PDFs, de 5 a 14 MB no total.

| Recurso | Limite grátis | Na prática |
|---|---|---|
| Anexos no R2 | 10 GB | **Cerca de 700 a 2.000 inscrições** com anexos. São 10 GB divididos por 14 MB a 5 MB por inscrição. |
| Banco no Turso | 5 GB | Uma inscrição ocupa de 10 a 50 KB no banco, sem os PDFs. Os 5 GB dão para centenas de milhares de inscrições. O limite real são os anexos. |
| Google Drive | 15 GB, divididos com o Gmail e o Google Fotos da mesma conta | Cabe o espelho dos 10 GB de anexos mais as 14 cópias do banco. Use uma conta Google só para o backup. |
| Backblaze B2 | 10 GB grátis | Igual ao R2: cabe o espelho dos 10 GB. Acima disso, cobra por GB e por mês. Consulte o preço atual no site da Backblaze antes de passar do limite. |
| GitHub privado | Repositório recomendado até 1 GB, arquivo até 50 MB (o sistema recusa acima disso) | O Git guarda no histórico todo arquivo apagado, então a retenção não libera espaço. Por isso o GitHub recebe o banco **uma vez por semana** (`TEB_GITHUB_INTERVALO_DIAS=7`). Com 2.000 inscrições, o banco compactado fica perto de 10 MB, e um ano dá cerca de 520 MB. Crie um repositório novo por ano. |

O que olhar com o tempo:
- **Anexos apagados continuam no backup.** Com os anos, o backup pode passar do tamanho dos dados vivos. Faça uma limpeza manual uma vez por ano, ou crie conta e bucket novos por ano de edital.
- **Histórico do GitHub.** Apagar arquivos não diminui o repositório. Ao passar de 1 GB, crie um repositório novo, troque `TEB_GITHUB_REPO` e apague o antigo depois de conferir o novo.
- **Banco compactado acima de 50 MB.** O GitHub passa a recusar e marca a falha. O Drive e o B2 continuam. Nesse ponto, desligue o GitHub ou troque por outro destino.
- **Drive perto de 15 GB.** O envio falha com o código do Google. Libere espaço ou use outra conta.

## Como configurar cada destino

Todas as variáveis ficam no `.env` do servidor ou nos segredos da hospedagem, como os Secrets do Replit. Nunca faça commit do `.env`.

### Chave do backup

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Coloque o resultado em `TEB_CHAVE_BACKUP` e guarde uma cópia no cofre.

### 1. Google Drive

1. Crie uma conta Google só para o backup.
2. No Google Cloud Console, crie um projeto e ative a **Google Drive API**.
3. Na tela de consentimento OAuth, escolha "Externo" e use só o escopo `https://www.googleapis.com/auth/drive.file`. Com esse escopo, o sistema só enxerga os arquivos que ele mesmo criou.
4. **Publique o app como "Em produção".** No modo "Teste", o refresh token vence em 7 dias e o backup para.
5. Crie uma credencial "ID do cliente OAuth" do tipo "App da Web". O endereço de retorno é o do OAuth Playground: `https://developers.google.com/oauthplayground`.
6. No OAuth Playground, marque "Use your own OAuth credentials", autorize o escopo `drive.file` com a conta do backup e troque o código pelo **refresh token**.
7. Com as três primeiras variáveis preenchidas, rode o comando abaixo. Ele cria a pasta "Backup Sistema Integrado TEB" e mostra o ID. Com o escopo `drive.file`, o app só enxerga a pasta que ele mesmo criou. Por isso, não use uma pasta criada à mão.

```bash
node servidor/principal.js criar-pasta-drive
```

8. Preencha `TEB_GDRIVE_CLIENT_ID`, `TEB_GDRIVE_CLIENT_SECRET`, `TEB_GDRIVE_REFRESH_TOKEN` e `TEB_GDRIVE_PASTA_ID`.

### 2. Backblaze B2

1. Crie um bucket **privado**.
2. Em "Lifecycle Settings", escolha "Keep only the last version".
3. Crie uma **Application Key restrita a esse bucket**, com as permissões `listFiles`, `readFiles`, `writeFiles` e `deleteFiles`.
4. Preencha `TEB_B2_KEY_ID`, `TEB_B2_APP_KEY`, `TEB_B2_BUCKET_ID` e `TEB_B2_BUCKET_NOME`.

### 3. GitHub privado (só o banco)

1. Crie um repositório **privado** vazio, por exemplo `empresa/backup-teb`. Nunca use o repositório público do sistema.
2. Crie um token fino (fine-grained) com acesso **só a esse repositório**, permissão "Contents: Read and write" e validade de até 1 ano. Anote a data de renovação.
3. Preencha `TEB_GITHUB_TOKEN`, `TEB_GITHUB_REPO` (no formato `dono/nome`) e, se precisar, `TEB_GITHUB_RAMO` e `TEB_GITHUB_INTERVALO_DIAS` (padrão 7).

Destino com todas as variáveis vazias fica desligado. Destino com variáveis pela metade é erro, para ninguém achar que tem backup sem ter.

## Anexos no Cloudflare R2

No Replit, o disco do servidor é refeito a cada publicação, e anexos guardados nele se perdem. Por isso, em produção, os anexos devem ficar no Cloudflare R2. O sistema fala com o R2 pela API compatível com S3, com assinatura AWS SigV4 feita sem pacotes externos.

- **Mesma cifra.** Os anexos vão para o R2 cifrados com AES-256-GCM e a chave `TEB_CHAVE_ANEXOS`, no mesmo formato do disco. O R2 nunca vê o PDF em claro.
- **Escolha automática.** Com as quatro variáveis `TEB_R2_*`, o servidor usa o R2. Sem nenhuma, usa a pasta `TEB_ANEXOS`. Variáveis pela metade impedem o servidor de subir. Ao subir, o servidor diz no log qual armazém está usando (`Anexos: r2` ou `Anexos: disco`).
- **Aviso no Replit.** Se o servidor rodar no Replit com os anexos em disco, ele avisa no log.
- **R2 fora do ar.** O envio e o download de anexos respondem 503 com uma mensagem clara. O resto do sistema continua funcionando.

### Como configurar

1. No painel da Cloudflare, em R2, crie um bucket **privado** (sem acesso público), por exemplo `teb-anexos`.
2. Em "Manage R2 API Tokens", crie um token com permissão **Object Read & Write** só nesse bucket.
3. Preencha nos Secrets:
   - `TEB_R2_ACCOUNT_ID`: o ID da conta, com 32 caracteres, que aparece no painel do R2;
   - `TEB_R2_ACCESS_KEY_ID` e `TEB_R2_SECRET_ACCESS_KEY`: os dados do token;
   - `TEB_R2_BUCKET`: o nome do bucket.
4. Se já existem anexos no disco, copie-os para o R2:

```bash
node servidor/principal.js migrar-anexos
```

   A cópia não decifra nada e pode rodar de novo: os anexos que já estão no R2 são pulados. Depois de conferir um download pelo sistema, os arquivos da pasta podem ser apagados.

### Backup e restauração com o R2

- O backup lê os anexos do armazém em uso, seja disco ou R2, e os envia cifrados de novo com a chave do backup.
- O comando `restaurar` grava os anexos na pasta `TEB_RESTAURAR_ANEXOS`. Para levá-los ao R2, aponte `TEB_ANEXOS` para essa pasta e rode `migrar-anexos`.

## Quando rodar

Uma vez por dia, de madrugada. Escolha uma das opções:
- **Agendador externo** (recomendado): o cron do servidor ou o agendamento da hospedagem.

```bash
cd entregas/editais && node servidor/principal.js backup
```

- **Dentro do servidor:** `TEB_BACKUP_INTERVALO_HORAS=24`. Roda enquanto o servidor estiver no ar.

Confira a auditoria (`backup_ok`) ou a saída do comando. Código de saída 1 significa que pelo menos um destino falhou.

## Como restaurar

A restauração **nunca sobrescreve**. Ela cria um banco novo e uma pasta de anexos nova. Você confere e só depois troca.

1. Num servidor com o código do sistema e as variáveis do destino escolhido, defina:
   - `TEB_CHAVE_BACKUP`: a do cofre.
   - `TEB_CHAVE_ANEXOS`: a do cofre, a mesma de antes.
   - `TEB_RESTAURAR_BANCO`: o arquivo novo, que ainda não pode existir.
   - `TEB_RESTAURAR_ANEXOS`: a pasta nova.
2. Veja os backups disponíveis:

```bash
node servidor/principal.js restaurar b2 --listar
```

3. Restaure o mais novo:

```bash
node servidor/principal.js restaurar b2
```

Para restaurar um backup específico, passe o nome dele:

```bash
node servidor/principal.js restaurar b2 banco/2026-07-01T03-00-00-000Z.ndjson.gz.teb
```

   Os destinos possíveis são `gdrive`, `b2` e `github`. O `github` traz só o banco. Os anexos vêm do Drive ou do B2.
4. Aponte `TEB_BANCO` para o banco restaurado e `TEB_ANEXOS` para a pasta restaurada. Suba o servidor e confira um login, uma inscrição e o download de um anexo.
5. Avise as pessoas que elas precisam entrar de novo, porque as sessões não vão no backup.

Se a restauração falhar no meio, por exemplo com um anexo adulterado, a mensagem diz qual anexo falhou. O banco restaurado pela metade é apagado sozinho. Os anexos que já foram gravados ficam na pasta e são reaproveitados na próxima tentativa. Tente de novo com outro destino.

Para restaurar no Turso: restaure primeiro no SQLite local, como acima. Depois importe o arquivo no Turso com a ferramenta oficial deles (`turso db import`) e só então troque as variáveis `TURSO_*`.

**Teste a restauração uma vez por mês** numa máquina separada. Backup que nunca foi restaurado não é backup confiável.

## Testes

`servidor/testes/backup.test.js` tem 23 testes, e `servidor/testes/r2.test.js` tem 9, todos sem rede. Os três destinos são simulados por `servidor/testes/nuvem-falsa.js`. Os testes cobrem:
- cifra, adulteração, chave errada e nome trocado;
- sessões e tokens fora do backup;
- envio aos 3 destinos, com o GitHub sem anexos;
- anexos incrementais e retenção;
- destino fora do ar sem vazar segredo;
- renovação do token do B2;
- recusa de GitHub público e de arquivo acima de 50 MB;
- criação da pasta do Drive;
- variáveis pela metade;
- restauração completa tabela por tabela, com anexos idênticos e chaves estrangeiras íntegras;
- cadastro durante o backup e backup que não restaura (não é enviado);
- intervalo do GitHub, relógio atrasado, anexo adulterado com o id na mensagem, arquivo vazio e trava.

## Limites conhecidos

- O adaptador do Cloudflare R2 foi testado com um bucket simulado e com os exemplos oficiais de assinatura da AWS, mas nunca contra o R2 de verdade. No primeiro uso, envie e baixe um anexo de teste.
- Os destinos reais nunca foram chamados nesta sessão, porque não há conta nem rede. O formato das chamadas segue a documentação pública do Google Drive v3, do B2 v3 e da API de conteúdo do GitHub. No primeiro uso, rode um backup e uma restauração de teste.
- Enquanto o banco é exportado, os outros pedidos ao servidor esperam, porque a leitura é numa só transação. Com o banco pequeno, isso dura frações de segundo. Rode o backup de madrugada.
- O banco é exportado e cada arquivo é enviado inteiro, sem divisão em partes. Isso vale até algumas centenas de MB por backup. Acima disso, vai ser preciso dividir o envio em partes.
