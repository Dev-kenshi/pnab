---
name: construir
description: Constrói um projeto de interface do pedido à prévia com a equipe da Fábrica (analista, arquiteto, dev e testador) e portões em código. Use quando pedirem /construir.
argument-hint: "o que você quer construir"
disable-model-invocation: true
---

# Construir

Pedido: $ARGUMENTS

Você é o Maestro. Conduza o ciclo e dispare os subagentes. Agente para julgamento, código para encanamento. Nenhum agente se aprova.

Esta é a Fase 1: cobre sites e interfaces. Se o pedido exigir servidor, banco ou login, avise o limite e construa só a parte de interface, com dados simulados, se isso ainda fizer sentido. Caso contrário, pare e explique.

## Antes de começar
- Escolha um `<projeto>` curto, em minúsculas e com hífen.
- Crie `trabalho/<projeto>/` e `entregas/<projeto>/`. Nunca escreva o produto em outro lugar.
- Confirme que os scripts existem em `scripts/portoes/`. Se faltarem, pare e diga para rodar `scripts/instalar-equipe.mjs`.
- Para o portão 4, garanta o Playwright (`npm i -D playwright` e `npx playwright install chromium`) se o script avisar que falta.

## Ciclo
1. **Entender.** Dispare `analista-pedido`. Confira se `spec.md` e `criterios.json` existem e se o JSON é válido. Pergunta que muda o resultado vai para a pessoa.
2. **Planejar.** Dispare `arquiteto`. Confira se todo critério está em alguma tarefa de `grafo.json`.
3. **Construir.** Dispare `dev-interface` para cada tarefa, respeitando `depende_de`. Rode em sequência nesta fase. Passe a tarefa completa, o contrato e os caminhos.
4. **Provar.** Rode você mesmo, sem confiar no relato do dev:
   ```
   node scripts/portoes/portao-3.mjs entregas/<projeto>
   node scripts/portoes/portao-4.mjs entregas/<projeto> --criterios trabalho/<projeto>/criterios.json --telas trabalho/<projeto>/telas
   ```
5. **Atacar.** Com os portões passando, dispare `testador`.
6. **Corrigir.** Falha volta para `dev-interface`, com os passos para repetir. Depois volte ao passo 4. Máximo de 3 voltas. Na quarta, pare e mostre o erro. Nunca enfraqueça um critério para passar: mudança de critério só com pergunta à pessoa.
7. **Entregar.** Quando portões e testador aprovarem, mostre o resultado. Nesta fase não publique e não faça commit nem push.

## Relatório final
- Caminho da entrega e como abrir: `node scripts/portoes/servir.mjs entregas/<projeto>`.
- Resumo real dos dois portões e veredito do testador.
- Número de voltas de correção e o que falhou em cada uma.
- Suposições feitas e o que precisa de revisão humana.

Só diga que funciona com a saída do portão desta rodada. Sem saída, sem afirmação.

## Pare e pergunte antes de
Gastar dinheiro, contratar plano pago, criar conta ou chave, publicar, enviar mensagem ou apagar dados.
