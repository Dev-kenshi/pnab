# Engenharia reversa visual

Medido no portal de referência em 07/11/2026, com o navegador, só lendo estilos. Nenhum dado pessoal foi lido para este arquivo.

Regra: **estrutura, fluxo e experiência iguais ou melhores. Cores, logotipo e marca são próprios da cliente.** As cores da referência (verde petróleo e vermelho) não serão usadas.

## Medidas da referência

| Elemento | Medida |
|---|---|
| Fonte | Inter, 16 px, texto rgb(33,37,41) |
| Fundo da página | cinza claro rgb(244,246,249) |
| Barra superior | branca, 65 px de altura, sombra leve, logo à esquerda, menu do usuário à direita |
| Largura do conteúdo | 1320 px no máximo, margem lateral de 12 px |
| Saudação | título de 28 px, peso 700, e linha "Natureza da conta" abaixo |
| Cartões de contador | 4 em linha, 312 x 85 px, raio 12 px, sombra, **borda esquerda de 4 px** com cor por situação (ciano, azul, verde, vermelho), rótulo em caixa alta de 11 px, número de 28 px, ícone redondo à direita |
| Cartões em geral | branco, raio 12 px, padding 16 px, sombra leve |
| Sanfonas | raio 12 px, botão de 60 px de altura, texto peso 600, aberta com fundo rosado e texto na cor de destaque |
| Selos | 12 px, peso 700, raio 6 px |
| Aviso em janela | 800 px de largura, raio 8 px, cabeçalho colorido com texto branco, botão "Ciente, fechar" em negrito |
| Linha do tempo | 7 etapas na horizontal, ícone redondo de cerca de 30 px, linha fina entre etapas, rótulo em caixa alta de 10 px; feita em verde, atual em amarelo com anel, futura em cinza |
| Abas | 14,4 px, peso 600, ativa na cor de destaque com sublinhado; abas travadas mostram cadeado |
| Painel da aba | cartão com **borda superior de 4 px** na cor de destaque |
| Seções da ficha | título h6 de 16 px, peso 700, com ícone colorido à esquerda e linha separadora |
| Campos somente leitura | rótulo de 14 px em negrito, valor numa caixa cinza clara com raio |
| Rodapé | faixa branca de 71 px com logotipos dos apoiadores |
| Tela de impressão | página própria com "Imprimir meu processo" e "Fechar aba": 1 identificação, 2 proposta técnica com tabelas (membros, metas, equipe, orçamento), 3 resultado da avaliação, 4 recursos |

## Nossa identidade (Sistema Integrado TEB)

Cores tiradas do logotipo da cliente (claquete com faixas verde, amarela, azul e vermelha, texto preto e círculo vermelho).

- Fonte do sistema (`system-ui`, Segoe UI, Roboto), para funcionar sem rede. Títulos em peso 800, caixa alta curta, como o letreiro do logo.
- Tinta: #111111 (preto do letreiro). Fundo: #F6F5F2. Cartões brancos.
- Destaque: vermelho claquete #C8102E (contraste de 5,9 para 1 no branco). Uso: ações principais, aba ativa, borda das seções, cabeçalho do aviso.
- As 4 faixas da claquete viram as cores dos contadores e das situações:
  - Verde #1E8E3E: Concluídos, etapa feita.
  - Amarelo #F2C200: Em andamento, etapa atual. Sempre com texto preto em cima, nunca texto amarelo no branco.
  - Azul #1D4F91: Enviados, links.
  - Vermelho #C8102E: Não aprovados, erros.
- Detalhe de marca: faixa listrada fina nas 4 cores no topo da barra superior e no cabeçalho do aviso, lembrando a claquete.
- Logotipo: `img/logo.png` quando a cliente enviar o arquivo. Até lá, o nome em texto "Teste de Elenco Brasil · Sistema Integrado" no lugar do logo.

## Onde vamos melhorar

1. **Celular de verdade.** A linha do tempo vira vertical abaixo de 600 px. A tabela do orçamento vira cartões.
2. **Acessibilidade.** Foco visível, rótulos reais, `aria-current` na etapa atual, abas com teclado (setas), contraste conferido.
3. **Anexos privados.** Na referência os editais ficam em pasta pública com caminho previsível. No nosso, os anexos de inscrição só saem pelo servidor, com sessão e permissão.
4. **Nota zero em bônus** sem desclassificar, limite que a referência admite no parecer.
5. **Rascunho automático** do formulário de inscrição, para não perder o texto.
6. **Contador de prazo** no aviso e no edital ("faltam 3 dias").
7. **Impressão** pela própria página, com estilo de impressão, sem abrir outra aba.
8. **Várias organizações** no mesmo sistema, cada uma com seus editais e sua marca.
