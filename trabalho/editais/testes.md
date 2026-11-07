REPROVADO

# Testes: Sistema Integrado TEB (editais)

Testador: segunda opinião. Data: 07/11/2026.

## Portões refeitos
- `node scripts/portoes/portao-3.mjs entregas/editais`: APROVADO.
- `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas`: APROVADO. 4 larguras e C1 a C12 ok.
- `cd entregas/editais && npm test`: 92 testes, 92 passam.

## Falhas

### Alta
**F1. Logotipo quebrado no servidor real e erro 404 no console.**
- Fez: subi `node entregas/editais/servidor/principal.js` e abri `http://localhost:4310/#/login`.
- Esperava: logo da barra superior visível e console limpo.
- Aconteceu: `GET /img/logo.png` responde 404. A imagem aparece quebrada, só com o texto alternativo "Teste". Playwright registrou `404 /img/logo.png` em todas as telas. `curl -i localhost:4300/img/logo.png` também dá 404.
- No modo demonstração o logo carrega, porque o servidor de prévia serve a pasta inteira.
- Arquivo provável: `entregas/editais/servidor/app.js`, função `servirEstatico`. A lista `permitido` só aceita `/index.html`, `/css/`, `/js/` e `/exemplos/`. Falta `/img/`.
- Script: `trabalho/editais/ataque-ui3.mjs`.

### Média
**F2. O servidor arredonda o valor do item do orçamento para reais inteiros. O navegador aceita centavos.**
- Fez: via API, `PUT /api/inscricoes/:id` com `orcamento: [{qtd:1, valor:10.5}]`. No navegador, valor unitário `0.1` mostra "R$ 0,10".
- Esperava: o valor gravado igual ao que a tela mostrou e somou.
- Aconteceu: o servidor grava `valor: 11` para 10,5. Um valor de 0,10 vira 0. O total e a checagem do teto no servidor diferem do que o proponente viu. O campo aceita decimais (`step="any"`) e o texto diz "valor unitário em reais".
- Arquivo provável: `entregas/editais/servidor/rotas/proponente.js`, `limparFicha`, linha com `Math.round(valor)`. Decidir: ou o campo aceita só inteiros, ou o servidor guarda centavos.
- Script: `trabalho/editais/ataque-api2.mjs`.

**F3. Texto cortado nos seletores da lista de inscrições do gestor.**
- Fez: entrei como gestor demo em 1280 px e abri `#/gestor/inscricoes`.
- Esperava: texto inteiro nos seletores.
- Aconteceu: o seletor de avaliador mostra "Avaliadora Exemplo (" e o de resultado mostra "Não selecionadc". O texto é cortado pela largura da coluna.
- Arquivo provável: `entregas/editais/css/gestao.css` (largura dos `select` na tabela) e `js/telas/gestor.js`.
- Captura: gerada por `ataque-ui.mjs` (pasta temporária `tmp3`).

### Baixa
**F4. Mensagem de teto confusa.** No novo edital, o campo se chama "Teto do orçamento (R$)", mas o erro diz "Campo obrigatório: Teto, em centavos e maior que zero". O usuário digita reais. Arquivo provável: `servidor/rotas/gestor.js` (`lerModeloEdital`) e `js/api-demo.js`, que repetem o texto. Ao digitar `-5` a mensagem também diz "obrigatório", e o campo não está vazio.

**F5. Total negativo e mensagem enganosa na planilha.** Digitando `-5` no valor do item, `[data-orcamento-total]` mostra "-R$ 15,00". Com `-1` ao enviar, a mensagem é "Campo obrigatório: Valor do item", mas o campo está preenchido. O envio é bloqueado, então não há bypass do teto. Arquivos prováveis: `js/telas/inscricao.js`, `js/regras.js` linha 157.

## O que passou no ataque
Tudo abaixo eu vi acontecer, em modo demonstração (`node scripts/portoes/servir.mjs entregas/editais 4301`) ou no servidor real (porta 4310, banco e anexos em pasta temporária, chave AES gerada na hora).

Servidor real, por API (`ataque-api.mjs`, `ataque-api2.mjs`):
- Login da plataforma, criação de duas organizações com gestores.
- Isolamento: gestor, proponente e avaliador da B recebem 404 em edital, inscrição, anexo, atribuição e recurso da A.
- Papéis: proponente 403 em rotas de gestor e de plataforma. Gestor 403 em plataforma. Plataforma 403 em inscrições e no painel do proponente. Sem cookie, 401. Avaliador só abre a inscrição atribuída e sem e-mail nem telefone do proponente.
- Anexo: PDF real 201. Arquivo com `Content-Type` PDF e conteúdo falso 415. `text/plain` 415. Vazio 400. 10 MB mais 1 byte 413. Download 200 para o dono, o gestor da A e o avaliador atribuído. 404 para a B. 401 sem sessão. Em disco só existe um `.bin` sem a marca `%PDF`.
- Congelamento: envio duplo em paralelo dá 200 e 409, um só protocolo. Editar e anexar depois do envio dão 409.
- Teto: orçamento acima do teto dá 400 `acima_do_teto`.
- Notas: 11 de 10, vazia, negativa, texto e nulo dão 400. Zero em bônus passa. Segunda avaliação dá 409.
- Recurso: antes da publicação 400. Vazio 400. De outra organização 404. Segundo recurso 409. Com o resultado publicado há 20 dias (data alterada direto no banco temporário) dá 400 `fora_do_prazo`. Decisão pela B 404, pelo proponente 403, sem parecer 400.
- CSRF e Content-Type: POST ou PUT com `text/plain`, formulário ou sem tipo dão 415. Cookie `HttpOnly; SameSite=Strict; Path=/`.
- Login: 5 erros e depois 429, também com a senha certa. Contas demo (`52998224725` com `Exemplo#2026`) não entram no servidor real. Criar conta com CPF demo dá 400. Senha curta dá 400. Esqueci senha devolve resposta igual para documento existente e inexistente.
- Cabeçalhos: CSP, nosniff, X-Frame-Options DENY, Referrer-Policy, COOP, CORP, Permissions-Policy.
- Estáticos: `/.env`, `/servidor/...`, `/js/testes/...` e `..` codificado dão 404.
- JSON inválido 400. Corpo de 2 MB 413. Sessão não vale depois de sair. Hash de senha é scrypt com sal. A auditoria não guarda senha.
- XSS: título `<img src=x onerror=alert(1)>`, nome e justificativa com HTML aparecem como texto no painel, na ficha, no recurso, na avaliação e na lista de editais. Nenhum `<img>` injetado, nenhum `alert` disparado.

Navegador (`ataque-ui.mjs`, `ataque-ui2.mjs`, `ataque-ui3.mjs`, `ataque-contraste.mjs`):
- 4 papéis em 1280 px e 360 px, todas as rotas: sem erro de console, sem rolagem horizontal, sem link interno quebrado.
- Login vazio, 5000 letras, CPF com máscara, Enter na senha, sair e voltar. Criar conta com campos vazios, com nome de 500 letras e HTML, e com clique duplo (uma conta só).
- Esqueci senha mostra `[data-link-redefinicao]` na demonstração, e a tela de redefinir abre.
- Inscrição: envio vazio mostra um erro por campo. Texto de 60 mil caracteres. Recarregar no meio recupera título e resumo (rascunho automático). Soma 3 x 5.000 = R$ 15.000,00 com alerta de teto exato. Anexo PNG recusado. Anexo acima de 10 MB recusado. Salvar rascunho mostra o aviso. Envio com clique duplo vira um protocolo no servidor real.
- Abas: cadeado em Habilitação e Termo conforme a etapa. Setas e End movem o foco entre abas. Recurso vazio recusado, com clique duplo cria um só ("Em análise"), persiste após recarregar. Fora do prazo mostra `[data-recurso-encerrado]`.
- Avaliador: nota vazia, 11 de 10 e bônus 3 de 2 recusados. Soma ao vivo "15,0". Zero em bônus aceito. "Nota geral: 15,0" na confirmação.
- Gestor: formulário já vem com Geral, Ampla concorrência e Mérito 10. Datas invertidas e teto negativo recusados. Clique duplo em salvar cria um edital. Plataforma abre o formulário de organização e não mostra inscrições.
- Servidor real no navegador: faixa de demonstração oculta e lista de contas demo ausente. Criar conta mostra erros de e-mail e telefone. Painel, inscrição e protocolo funcionam.
- Contraste (WCAG, 4,5 para 1) varrido no painel, na inscrição, no formulário e em Minha conta do proponente: nenhum texto abaixo do limite.
- Dado pessoal real, segredo no código, texto de exemplo esquecido, "lorem", prefeitura: nada encontrado. Contatos usam `.example`. Os dados de exemplo trazem "exemplo fictício". Rodapé presente.

## Requisitos e levantamento
- Spec: itens 1 a 8 e S1 a S14 cobertos por teste ou por ataque acima. O único descumprimento é F1 (erro no console no servidor real).
- Levantamento e referência visual: o que a spec mandou deixar de fora continua fora (ZIP de anexos, PDF gerado, heteroidentificação). Imprimir existe pela página (`data-acao='imprimir'` e `@media print`). Rascunho automático e contador de prazo ("faltam 31 dias") existem.

## Melhorias opcionais (não reprovam)
- Os rótulos da linha do tempo são Inscrição, Avaliação, Resultado, Selecionado, Habilitação, Termo e Execução. A referência usa Enviado, Inscrito, Avaliado, Selecionado ou Suplente, Habilitação, Termo e Execução. A spec não fixa os nomes. Alinhar ajudaria.
- No formulário de novo edital, "Início das inscrições", "Fim" e "Teto" ficam desalinhados em 1280 px, porque só o teto tem texto de ajuda.
- Em modo demonstração o front aceita um "PDF" falso (só o nome e o tipo contam). O servidor real confere `%PDF-`. Conferir os bytes no navegador evitaria o susto.
- Na criação de conta, o front só confere se e-mail e telefone não estão vazios. No servidor real a API recusa e a mensagem aparece, então funciona, mas o erro chega depois de uma ida ao servidor.
- No login o título "Entrar" nasce com o anel de foco, o que parece um campo.
- Contraste do gestor e do avaliador, e as capturas de 360 px de gestor, avaliador e plataforma, só foram olhadas por amostra. O script `ataque-contraste.mjs` parou ao trocar de papel e não mediu esses dois.

## Limpeza (pendência)
Não consegui apagar as pastas temporárias nem encerrar os servidores. Os comandos `pkill`, `taskkill` e `rm` foram negados pelo sistema de permissões. Ficaram:
- Servidores de teste nas portas 4300 (servidor real, 1ª rodada), 4301 (prévia demonstração) e 4310 (servidor real, 2ª rodada).
- Pastas `trabalho/editais/tmp-*`, `trabalho/editais/tmp2` e `trabalho/editais/tmp3` (banco, anexos cifrados e capturas de teste).
- Scripts de ataque em `trabalho/editais/`: `ataque-api.mjs`, `ataque-api2.mjs`, `ataque-ui.mjs`, `ataque-ui2.mjs`, `ataque-ui3.mjs`, `ataque-contraste.mjs`, `setup-d.mjs`. As chaves e senhas usadas são só de teste e valem só para esses bancos.
