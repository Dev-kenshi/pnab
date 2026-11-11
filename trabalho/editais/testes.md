APROVADO (rodada 4: F7 corrigida)

# Testes: Sistema Integrado TEB (editais), rodadas 1 a 3

Testador: segunda opinião. Data: 07/11/2026.

Motivo único da reprovação: F6, erro 401 no console do navegador no servidor real. As cinco falhas da rodada 1 estão corrigidas.

## Portões refeitos
- `node scripts/portoes/portao-3.mjs entregas/editais`: APROVADO.
- `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas`: APROVADO. C1 a C12 ok.
- `cd entregas/editais && npm test`: 99 testes, 99 passam.

## Falhas da rodada 1

**F1 Logo 404 no servidor real: CORRIGIDA.**
Servidor real na porta 4402, banco e anexos em `tmp-r2`, chave AES gerada na hora (`r2-api.mjs`).
- `GET /img/logo.png` dá 200, `image/png`, 36778 bytes.
- `/img/../servidor/app.js` e `/img/%2e%2e/servidor/app.js` dão 404. `/img/nada.png` dá 404.
- No navegador, `.marca-logo` carregou (`naturalWidth > 0`). Nenhum 404 no console.

**F2 Centavos do orçamento: CORRIGIDA.**
O servidor agora guarda centavos inteiros e recusa fração.
- API: valor 1050 gravado como 1050. 10.5 e 0.1 dão 400 "Use no máximo dois decimais". -1 e -5 dão 400 "não pode ser negativo". "abc" e `true` dão 400.
- Navegador: digitar 10.5 mostra "R$ 10,50" e o banco guarda 1050.
- Teto: enviar 1000001 com teto 1000000 dá 400 `acima_do_teto`. Enviar 1000000 dá 200.
- Edital criado pela tela com teto "10000" grava 1000000. Dois itens de 5000,01 mostram "R$ 10.000,02" e o alerta de passar do teto. Dois de 5000 não alertam, o que está certo (igual ao teto não passa).

**F3 Texto cortado nos seletores do gestor: CORRIGIDA.**
`r2-demo.mjs`, 1280 px. Seletor de avaliador com 317 px de largura e de resultado com 288 px. Medi o texto de todas as opções com canvas: nenhuma passa da largura. A captura mostra "Avaliadora Exemplo (exemplo fictício)", "Não selecionado" e "Sem resultado" inteiros. Em 360 px também.

**F4 Mensagem de teto: CORRIGIDA.**
Na tela e na API: vazio dá "Campo obrigatório: Teto do orçamento (R$)". -5 e 0 dão "O teto precisa ser maior que R$ 0,00." 100.5 e "abc" na API dão "Teto inválido. Informe o valor em reais, como 10.000,00." O modo demonstração dá as mesmas mensagens.

**F5 Total negativo e mensagem enganosa: CORRIGIDA.**
Valor -5 mostra total "R$ 0,00", sem sinal negativo. Enviar com -1 mostra "Valor do item não pode ser negativo". Não diz mais "obrigatório".

## Falhas novas

### Média
**F6. Erro 401 no console no servidor real para quem não está logado.**
- Fez: abri `http://localhost:4406/#/login` sem sessão, no servidor real (`r2-real.mjs`). Também abri `#/inscricao/novo?edital=x` sem sessão.
- Esperava: console limpo.
- Aconteceu: `401 http://localhost:4406/api/sessao` e "Failed to load resource: the server responded with a status of 401". Aparece em toda visita anônima. O front cai no login corretamente, a tela funciona. Só o console registra erro.
- Arquivo provável: `entregas/editais/js/api.js` linha 107 (`sessao: () => pedir('GET', '/api/sessao')`) e a rota de sessão em `servidor/`. Correção simples: devolver 200 com `{ usuario: null }` quando não há sessão.
- Observação honesta: não mudou nesta volta. Já existia na rodada 1 e eu não registrei. Na demonstração não aparece, porque lá não há servidor.

## Regressão (vista acontecer)
Servidor real, porta 4406 (`r2-real.mjs`), tudo pela tela:
- Login de gestor, criação de proponente, de avaliador e da organização.
- Gestor cria edital com clique duplo em salvar: uma linha só. Abre as inscrições: situação "aberto".
- Proponente se cadastra, inscreve com item no teto exato e envia com clique duplo: protocolo `TEB-2026-000001`, sem erros.
- Avaliador abre a avaliação, lança nota 8, envia: "Avaliação enviada. Nota geral: 8,0".
- Resultado e publicação (por API): 200. Recurso pela tela com clique duplo: um recurso, "Em análise".
- Console sem erro nos papéis logados, fora o 401 anônimo (F6).

## Contraste de gestor e avaliador
`r2-demo.mjs`, WCAG (4,5 para 1, 3 para 1 em texto grande), 1280 px e 360 px:
- Gestor: `#/gestor`, `#/gestor/editais`, `#/gestor/editais/novo`, `#/gestor/inscricoes`, `#/conta`.
- Avaliador: `#/avaliador`, `#/conta`.
- Nenhum texto abaixo do limite. Menor razão medida: 5,88. Sem rolagem horizontal. Console limpo em modo demonstração.
- Capturas de gestor em 360 px (inscrições) e avaliador em 360 px olhadas: sem corte, sem sobreposição. Seletores desativados aparecem esmaecidos, o que é esperado.

## Melhorias opcionais (não reprovam)
- Rótulos da linha do tempo diferem da referência (Inscrição, Avaliação, Resultado...). A spec não fixa os nomes.
- Em "Novo edital", Início, Fim e Teto ficam desalinhados em 1280 px.
- Em demonstração o front aceita um "PDF" falso. O servidor real confere `%PDF-`.
- Criar conta: e-mail e telefone só são validados depois de ir ao servidor.
- Valor 0.105 na tela mostra "R$ 0,11" (arredonda), enquanto o servidor recusaria três decimais. O campo `step="any"` convida a isso. Usar `step="0.01"` ajudaria.
- A API aceita valor de item de 1e15 centavos. Um limite máximo evitaria números absurdos.

## Limpeza
- Servidores que subi (portas 4400 a 4406): encerrados pelo `.kill()` dentro de cada script. `netstat` mostra só conexões em TIME_WAIT na 4406, nenhuma porta escutando.
- A pasta `trabalho/editais/tmp-r2/` não foi apagada: o `rm` foi negado. Contém bancos `r2*.sqlite`, `teb.sqlite`, `x.sqlite`, anexos cifrados, capturas e as saídas `saida-*.txt`. As chaves e senhas são só de teste.
- Também ficaram as pastas `tmp-VMFw`, `tmp2` e `tmp3` e os scripts antigos da rodada 1.
- Scripts desta rodada em `trabalho/editais/`: `r2-api.mjs`, `r2-demo.mjs`, `r2-real.mjs`.
- Servidores da rodada 1 (portas 4300, 4301, 4310) não foram verificados nem encerrados por mim nesta rodada.

---

# Rodada 3 (última)

Testador: segunda opinião. Data: 11/11/2026.

**Veredito: REPROVADA.** Motivo único: F7, teto de edital muito grande dá erro 500 no servidor. F1 a F6 estão corrigidas. Todo o resto passou.

## Portões refeitos
- `node scripts/portoes/portao-3.mjs entregas/editais`: APROVADO.
- `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas`: APROVADO. Layout em 4 larguras e C1 a C12 ok.
- `cd entregas/editais && npm test`: 102 testes, 102 passam.

## F1 a F6
- **F6 (401 anônimo): CORRIGIDA.** `GET /api/sessao` sem cookie dá 200 `{"usuario":null}`. No navegador (`r3-testador*.mjs`, servidor real, portas 4500 a 4520), abri `/`, `#/login`, `#/criar-conta`, `#/esqueci-senha`, `#/painel`, `#/gestor`, `#/avaliador`, `#/plataforma`, `#/inscricao/novo?edital=x`, `#/redefinir?token=zzz` e `#/conta` sem sessão, em 1280 e 360 px. Console limpo em todos. Rotas protegidas caem em `#/login`. As APIs protegidas seguem dando 401 (correto).
- **F1 (logo), F3 (seletores), F4 e F5:** conferidos de novo nas capturas e nas telas do gestor em 1280 e 360 px. Logo carrega, sem 404, seletores sem corte.
- **F2 (centavos e teto):** na tela, campo com `step=0.01`. Valores acima de R$ 10.000.000,00 por item mostram "Valor do item acima do máximo de R$ 10.000.000,00." e `aria-invalid`. 5000.01 mostra R$ 5.000,01. -3 mostra total R$ 0,00 e "não pode ser negativo". Edital criado pela tela com teto 10000 foi criado uma vez só com clique duplo. Item de R$ 10.000,00 no teto de R$ 10.000,00 enviou sem alerta.

## Falhas novas

### Média
**F7. Teto de edital acima de 9e15 reais dá HTTP 500 (e 1e20 é aceito).**
- Fez: `POST /api/gestor/editais` como gestor, com teto 1e16, 1e18 e 1e20 (`r3-ataque.mjs`, bloco "edital teto").
- Esperava: 400 com mensagem de teto inválido ou acima do máximo, como já existe para o valor do item (R$ 10.000.000,00).
- Aconteceu: 1e12 e 9e15 dão 201. 1e16 e 1e18 dão **500**. 1e20 dá 201 (aceita número absurdo). Infinity dá 400. O servidor não caiu. A tela do gestor envia o mesmo valor, então chega ao mesmo erro (não conferi a mensagem na tela).
- Arquivo provável: `entregas/editais/js/regras.js` função `erroTeto` (linha 127, sem limite máximo) e `servidor/rotas/gestor.js` linha 30 a 37 (teto vai ao SQLite como inteiro em centavos, estoura acima de 2^63). Correção: limite máximo em `erroTeto`.

## Regressão pela tela (vista acontecer)
Servidor real, tudo pela UI, `r3-testador3.mjs` (1280 px) e `r3-360.mjs` (360 px):
- Plataforma cria organização e gestor. Gestor cria avaliador e edital (clique duplo, uma linha) e abre.
- Proponente cria conta (clique duplo), preenche inscrição com título `<b>"x"</b> & ç`, anexa PDF, salva rascunho, recarrega e o título volta. Envia com clique duplo: protocolo `TEB-2026-000001`, sem erro.
- Gestor atribui avaliador. Avaliador lança nota 11 (recusada: "Nota acima do máximo de 10,0"), depois 8, envia com clique duplo: "Avaliação enviada. Nota geral: 8,0".
- Gestor encerra, define resultado e publica: "Resultado publicado em 11/11/2026. Prazo de recurso até 26/11/2026." Proponente vê as notas e o parecer.
- Recurso vazio recusado. Recurso com texto e clique duplo: um só, "Em análise". Gestor sem parecer recebe "Campo obrigatório: Parecer". Com parecer: "Deferido".
- Sair volta ao login. Anexo falso (texto com nome .pdf): o servidor recusa com 415 e a tela mostra "Há 1 ponto para corrigir antes de enviar. Envie um arquivo PDF." O título fica preservado. .txt é recusado já na tela.
- A faixa de modo demonstração não aparece no servidor real.
- Console: só aparecem os 400 e 415 que eu provoquei de propósito (nota 11, parecer vazio, PDF falso). Sem erro inesperado.
- 360 px: capturas em `telas-r3u/` e `telas-r3w/` olhadas. Sem rolagem horizontal, sem texto cortado, mesmo com nome de 300 caracteres. Erros do cadastro e do envio legíveis.
- Só teclado: Tab percorre seletor de organização, Inscrever-se, links e sanfona do painel, na ordem lógica.
- Rotas de gestor, avaliador e plataforma acessadas por proponente voltam ao `#/painel`.

## Ataques via API (`r3-ataque.mjs`, duas organizações)
- Entre organizações (proponente, gestor e avaliador de B contra dados de A): inscrição, anexo, atribuição, resultado, edital, recurso e avaliação dão 404. Lista do gestor B não traz o protocolo de A.
- Papéis: proponente, avaliador, gestor e plataforma recebem 403 nas rotas dos outros. Anônimo recebe 401.
- Entradas: documento de 200 mil caracteres 400, JSON inválido 400, corpo de 5 MB 413, nome de 1 MB na conta (aceito, ver melhoria), título de 100 mil caracteres cortado em 200. Nome com `<script>` é guardado como texto.
- Envio duplo simultâneo: 200 e 409. Seis envios paralelos: seis protocolos únicos.
- Anexo vazio 400, 11 MB 413, nome com `../` e quebra de linha aceito e sanitizado, chave inexistente 404.
- Login: bloqueio com 429 após 5 erros seguidos (S4).
- Cabeçalhos: CSP, nosniff, frame DENY e referrer ok. `/servidor/app.js`, `/.env` e `/..%2fpackage.json` dão 404.
- Quantidade negativa ou zero é recusada. Quantidade 1e9 com valor 1e9 dá 400 de teto.

## Melhorias opcionais (não reprovam)
- Orçamento com mais de 200 itens: o servidor corta em silêncio (10000 itens enviados, 200 gravados, envio 200). Melhor recusar com mensagem.
- Nome de 1 MB na criação de conta retorna 201. Convém limitar o tamanho.
- Validações do avaliador e do gestor (nota acima do máximo, parecer vazio) vão ao servidor e aparecem como 400 no console do navegador. Validar antes no cliente deixaria o console limpo.
- Valor 0.005 digitado mostra R$ 0,01 sem erro (arredonda no cliente).
- O seletor `[data-campo='anexo']` da spec só existe nos dados de demonstração. No servidor real o campo se chama `extra-<rótulo>` (ex.: `extra-plano-em-pdf`). Coerente com editais montados pelo gestor, mas difere da spec.
- Login aceita o parâmetro `organizacao` de outra org e abre a sessão na org verdadeira do usuário. Sem vazamento.

## Limpeza
- Servidores subidos por mim (portas 4500, 4510 e 4520): encerrados com `.kill()` em `finally`. Conferi com `netstat -ano | grep LISTENING | grep :45xx`: nenhuma porta 45xx escutando. (Durante uma rodada longa a 4500 estava ativa e depois sumiu.)
- Servidores antigos 4300, 4301, 4310 e 4321: nenhum escutando. Não mexi neles.
- Bancos e anexos de teste em `trabalho/editais/tmp-r3/` (`r3*.sqlite`, `anexos-*`, `saida-*.txt`). Chaves geradas na hora, senhas só de teste. Nada gravado fora de `trabalho/editais/`. Pastas antigas intactas.
- Scripts: `r3-real.mjs` (rascunho do pedido), `r3-testador.mjs`, `r3-testador2.mjs`, `r3-testador3.mjs`, `r3-360.mjs`, `r3-ataque.mjs`. Capturas em `telas-r3`, `telas-r3t`, `telas-r3u`, `telas-r3v`, `telas-r3w`.
- Sem commit nem push.

# Rodada 4

Testador: segunda opinião. Data: 11/11/2026.

**Veredito: APROVADA.** A F7 está corrigida no servidor, na tela real e no modo demonstração. Nenhuma falha nova.

## Portões refeitos
- `cd entregas/editais && npm test`: 104 testes, 104 passam, 0 falham.
- `node scripts/portoes/portao-3.mjs entregas/editais`: "ok npm run test: passou", APROVADO (45 arquivos).
- `node scripts/portoes/portao-4.mjs entregas/editais --criterios trabalho/editais/criterios.json --telas trabalho/editais/telas`: layout ok em 1440, 1024, 768 e 390 px, C1 a C12 ok, APROVADO.

## F7 (teto de edital)
Script `r4-ataque-f7.mjs`, servidor real na porta 4601, gestor logado, POST e PUT. Saída em `tmp-r4/saida-f7.txt`. O teto é em centavos, máximo 1000000000.
- 201 (PUT 200): 999999999, 1000000000 e a string "1e9".
- 400 com "Teto acima do máximo de R$ 10.000.000,00.": 1e12, 1000000001, 9e15, 1e16, 1e18, 1e20, "1e16" e "1000000001".
- 400 "Teto inválido...": "Infinity", "-Infinity", "NaN", string de 100 mil dígitos, string "1" seguida de 400 zeros, 1.5, true, objeto.
- 400: negativo (-1 e -1e20), zero, null e vazio.
- JSON bruto: 1e400, -1e400 e 123456789012345678901234567890 dão 400. Infinity e NaN sem aspas dão 400 "não é um JSON válido".
- Nenhum 500. Servidor vivo depois do ataque. Log do servidor sem erro.
- Única divergência: teto `[5]` (lista com um número) é aceito, POST 201 e PUT 200, porque `Number([5])` vale 5. Valor dentro do limite, sem 500. Entra nas melhorias.

## F7 pela tela
- Servidor real (`r4-ui-real.mjs`, porta 4602), teto 100000000000000 reais, em 1280 e 360 px: aparece "Teto acima do máximo de R$ 10.000.000,00." dentro do bloco do campo, com `aria-invalid` e foco no campo, mais o aviso "Confira os campos destacados.". Fica no formulário. Sem rolagem horizontal em 360 px. Capturas `telas-r4/real-teto-1280.png` e `real-teto-360.png` olhadas: texto inteiro, sem corte.
- Teto R$ 10.000.000,00 cria o edital. Na edição, 10.000.000,01 mostra a mesma mensagem.
- Modo demonstração (`r4-ui-demo.mjs`, servidor estático), em 1280 e 360 px: mesma mensagem, `aria-invalid`, sem rolagem horizontal, limite de R$ 10.000.000,00 cria o edital. Console e rede sem nenhum erro. Capturas `demo-teto-1280.png` e `demo-teto-360.png`.

## Regressão pela tela (servidor real, porta 4602)
Tudo pela interface, em `r4-ui-real.mjs`:
- Gestor cria avaliador, cria edital, abre. Proponente cria conta e envia inscrição (protocolo TEB-2026-000001, com orçamento e meta).
- Gestor atribui avaliador. Avaliador lança nota 8 e envia: "Nota geral: 8,0".
- Gestor encerra, define resultado e publica: "Resultado publicado em 11/11/2026. Prazo de recurso até 26/11/2026."
- Proponente envia recurso: "Em análise". Gestor defere com parecer.
- Console: só os três 400 que provoquei de propósito (POST com teto 1e14 reais em 1280 e 360 px, PUT com 10.000.000,01). Nenhum erro de JavaScript, nenhum 4xx ou 5xx inesperado.
- Obs.: na primeira execução o script falhou por erro meu (recarga de rota com o mesmo hash). Corrigi o script, a entrega não mudou. Segunda execução limpa.

## Melhorias opcionais (não reprovam)
- Teto como lista, `[5]`, é aceito por coerção. Convém exigir número ou string.
- As melhorias da rodada 3 seguem valendo: limite de 200 itens do orçamento cortado em silêncio, nome de 1 MB na conta, validar nota e parecer no cliente para evitar 400 no console.
- O botão "Adicionar categoria" aparece cinza na captura 1280 do formulário. Parece estado de hover do mouse. Não investiguei.

## Limpeza
- Servidores subidos por mim (portas 4601 e 4602): encerrados com SIGTERM em `finally`. Servidor estático da demonstração fechado. Conferi com `ss -ltn`: nenhuma porta 46xx escutando.
- Bancos e anexos em `trabalho/editais/tmp-r4/` (`f7.sqlite`, `ui.sqlite`, `anexos-*`, `saida-*.txt`). Chaves geradas na hora, senhas só de teste. Nada escrito fora de `trabalho/editais/`.
- Scripts: `r4-lib.mjs`, `r4-ataque-f7.mjs`, `r4-ui-real.mjs`, `r4-ui-demo.mjs`. Capturas em `telas-r4/`.
- Sem commit nem push. Entrega intacta.
