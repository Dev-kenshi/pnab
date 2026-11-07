REPROVADO

# Testes: Sistema Integrado TEB (editais), rodada 2

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
