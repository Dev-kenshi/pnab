# Spec: Sistema Integrado TEB (editais culturais)

## Objetivo
Sistema web de editais culturais da **Teste de Elenco Brasil Sistema Integrado** (nome curto na interface: "Sistema Integrado TEB"). A empresa presta o serviço de editais e vai vender o sistema a vários órgãos e produtoras.

## Para quem é
- **Plataforma** (a empresa): cria organizações contratantes e o gestor de cada uma.
- **Gestor** da organização: cria editais, avisos, atribui avaliadores, publica resultado, decide recursos.
- **Avaliador**: avalia as inscrições atribuídas.
- **Proponente**: pessoa física, pessoa jurídica, MEI ou coletivo que se inscreve.

## Identidade e dados
- Identidade própria. Sem marca, brasão, nome ou textos de prefeitura nem da política oficial.
- Todo edital, pessoa e órgão de exemplo é fictício e traz o rótulo "exemplo fictício".
- Contatos de exemplo usam domínio `.example`.
- Rodapé em todas as telas: "Emanuel Macêdo Luz, desenvolvedor do projeto".
- Faixa visível "Modo demonstração: dados fictícios" quando a api estiver no modo demonstração.

## Arquitetura (decidida pelo Maestro)
- Pasta da entrega: `entregas/editais/`.
- Front estático (HTML, CSS, JS sem framework), `index.html` na raiz, navegação por hash.
- Rotas: `#/login`, `#/criar-conta`, `#/esqueci-senha`, `#/redefinir?token=`, `#/painel`, `#/inscricao/novo?edital=slug`, `#/inscricao/<protocolo>`, `#/conta`, `#/gestor`, `#/gestor/editais`, `#/gestor/editais/novo`, `#/gestor/inscricoes`, `#/avaliador`, `#/plataforma`. Parâmetro `?org=slug` vale em qualquer rota pública.
- Camada `api` com dois modos. **Servidor real** em `/api/...`. **Modo demonstração** quando o servidor não responde: simula tudo no navegador com `localStorage` e dados fictícios semeados. O portão 4 serve a pasta como estática, então roda em modo demonstração.
- Servidor em `entregas/editais/servidor/`: Node 24 sem framework, `node:sqlite` local (adaptador Turso por variável de ambiente), anexos em disco cifrados com AES-256-GCM (adaptador R2 previsto), senha com scrypt, cookie HttpOnly SameSite=Strict, papéis `plataforma`, `gestor`, `avaliador`, `proponente`, isolamento por organização em toda consulta, limite de tentativas de login, registro de auditoria.
- Testes: `node --test` via `npm test` em `entregas/editais/package.json`.

## O que entra (primeira entrega)
1. **Acesso**: login em 2 etapas (CPF ou CNPJ, Avançar; depois senha). Documento desconhecido leva a criar conta (natureza, nome, documento, e-mail, telefone, senha com confirmação). Esqueci minha senha gera link de redefinição, que aparece na tela no modo demonstração. Sair. Validação de CPF e CNPJ por dígito verificador. Máscara é opcional na digitação.
2. **Multi-organização**: plataforma cria organizações e gestores. Cada organização tem editais, avisos e equipe. O proponente escolhe a organização na tela inicial ou entra por `?org=slug`.
3. **Painel do proponente**: saudação com nome e natureza; 4 contadores; editais abertos; minhas inscrições com protocolo, cota, edital, selo, nota e linha do tempo de 7 etapas; histórico de encerrados por ano com links de edital e anexos; aviso em janela com "Ciente, fechar".
4. **Inscrição**: formulário gerado do modelo do edital. Blocos: dados do proponente (copiados da conta), modalidade, perguntas do edital, metas, equipe, planilha orçamentária, anexos (PDF, até 10 MB), aceite. Salvar rascunho. Enviar gera protocolo e congela a ficha.
5. **Visualizar inscrição**: abas Ficha, Notas/Avaliação, Recursos, Habilitação e Termo. As duas últimas ficam travadas com cadeado até a etapa liberar.
6. **Minha conta**: editar dados (documento inalterável), endereço com busca de CEP, alterar senha.
7. **Área do gestor**: criar e editar edital, abrir e encerrar, avisos, lista de inscrições com filtros, atribuir avaliador, publicar resultado, decidir recurso.
8. **Área do avaliador**: inscrições atribuídas, nota por critério, parecer, enviar avaliação.

## O que fica de fora
- Construtor de formulário com todos os tipos do levantamento (moeda, múltipla escolha, tabela com colunas próprias, bloco informativo). Só os 7 tipos do pedido.
- Heteroidentificação, bônus com anexos de prova, cronograma, divulgação, acessibilidade, ingressos e outras fontes de recurso como blocos fixos. Entram só como campos extras do edital, quando o gestor quiser.
- Imprimir processo, baixar ZIP de anexos, geração de PDF do edital (links existem, arquivo de exemplo).
- Habilitação documental e termo preenchíveis. Nesta entrega as abas aparecem, com cadeado e texto explicativo. Quando liberadas, mostram "Em breve".
- Conflito de interesse, prestação de contas, interruptor de cadastro suspenso, vários avaliadores por inscrição (um por inscrição).
- Envio real de e-mail. Cobrança e contrato da plataforma.

## Suposições
1. Nota geral é a soma das notas por critério. Todo critério tem máximo. Nota acima do máximo é recusada. Zero é aceito em qualquer critério, inclusive bônus, sem desclassificar. Nota vazia é recusada.
2. Formato numérico em pt-BR: "15,0" para notas, "R$ 15.000,00" para dinheiro.
3. Um proponente fica ligado a uma organização ao criar conta (por `?org` ou escolha). Pode escolher outra pelo seletor `[data-org-seletor]`.
4. Gestor, avaliador e plataforma pertencem a uma organização (plataforma, à empresa). A conta da plataforma não vê dados de inscrição de proponentes.
5. Edital novo nasce em rascunho. "Abrir" exige fim do período no futuro, ao menos uma categoria, uma cota e um critério. O formulário de novo edital já vem com categoria "Geral", cota "Ampla concorrência" e critério "Mérito" (máximo 10).
6. Situações do edital: `rascunho`, `aberto`, `encerrado`. Atributo `data-situacao`.
7. Prazo de recurso: 15 dias após a publicação do resultado. Um recurso por inscrição. Situações: Em análise, Deferido, Indeferido.
8. Contadores: Enviados = todas as inscrições enviadas; Em andamento = enviadas sem resultado final nem conclusão; Concluídos = execução concluída; Não aprovados = não selecionadas.
9. Etapa 4 da linha do tempo se chama "Selecionado" ou "Suplente", conforme o resultado. Estado de cada etapa em `data-estado`: `passada`, `atual`, `futura`.
10. Datas do semeado são relativas ao dia de hoje, para não vencerem.
11. Anexos são opcionais no edital semeado, porque o portão 4 não envia arquivo. Teste de anexo fica no servidor e em revisão humana.
12. Aviso em janela aparece uma vez por sessão do proponente, logo após entrar.
13. Link de redefinição vale 1 hora e 1 uso.

## Contas de demonstração (somente no modo demonstração)
Senha de exemplo, igual para todas: `Exemplo#2026`. Não é senha real. Nunca vale no servidor real.

| Papel | CPF fictício válido | Nome |
|---|---|---|
| proponente | 529.982.247-25 | Marina Exemplo (exemplo fictício), Pessoa Física |
| gestor | 111.444.777-35 | Gestor Exemplo (exemplo fictício) |
| avaliador | 390.533.447-05 | Avaliadora Exemplo (exemplo fictício) |
| plataforma | 168.995.350-09 | Admin Exemplo TEB (exemplo fictício) |

Para criar conta nos critérios: CPF 935.411.347-80 (válido, não semeado). CPF inválido: 111.111.111-11.

## Dados semeados
Organizações: **Fundação Exemplo de Cultura** (slug `fundacao-exemplo`, exemplo fictício) e **Produtora Exemplo Aurora** (slug `produtora-aurora`, exemplo fictício). Proponente, gestor e avaliador demo pertencem à primeira. Contatos em `@teb.example`.

Editais da Fundação:
- `ed-exemplo-001`, "Edital Exemplo 001/2026 (exemplo fictício)", **aberto**. Teto R$ 10.000,00. Categorias: Teatro, Música, Artes Visuais. Cotas: Ampla concorrência, Pessoas negras, Indígenas, PcD. Critérios: Qualidade (máx. 10), Viabilidade (máx. 10), Bônus regional (máx. 2, bônus). Campo extra obrigatório `extra-resumo` (texto longo). Campo extra anexo opcional. O proponente demo não tem inscrição nele.
- `ed-exemplo-000`, "Edital Exemplo 000/2026", inscrições encerradas, resultado publicado há 3 dias.
- `ed-exemplo-002`, "Edital Exemplo 002/2026", inscrições encerradas, em avaliação.
- `ed-exemplo-2025`, "Edital Exemplo 003/2025", encerrado (histórico por ano).

Inscrições do proponente demo:
| Protocolo | Edital | Situação | Contador |
|---|---|---|---|
| TEB-2026-000101 | ed-exemplo-000 | Selecionado, etapa atual Habilitação | Em andamento |
| TEB-2026-000102 | ed-exemplo-000 | Não aprovado, nota 14,0, prazo de recurso aberto, sem recurso | Não aprovados |
| TEB-2026-000103 | ed-exemplo-002 | Enviado, atribuído à avaliadora demo | Em andamento |
| TEB-2026-000104 | ed-exemplo-2025 | Concluído | Concluídos |

Resultado esperado dos contadores: Enviados 4, Em andamento 2, Concluídos 1, Não aprovados 1.

Aviso em janela semeado: "Aviso de exemplo fictício: prazo de envio da habilitação."

Critérios da avaliação 103: Qualidade, Viabilidade, Bônus regional. Notas 8, 7 e 0 dão nota geral "15,0".

## Seletores (o Dev implementa todos)
Visíveis só quando o elemento está na tela. Seletor com `[data-campo]` precisa ser único na tela no momento do passo.

**Acesso**
- `[data-campo='documento']`, `[data-acao='avancar']`, `[data-etapa='senha']` (bloco da etapa 2, visível só depois de Avançar), `[data-campo='senha']`, `[data-acao='entrar']`.
- `[data-erro='documento']` (texto contém "inválido" para dígito errado e "Documento" para vazio). `[data-erro='senha']` (texto "Senha incorreta").
- `[data-tela='criar-conta']`, `[data-campo='natureza']` (select com labels Pessoa Física, Pessoa Jurídica, MEI, Coletivo), `[data-campo='nome']`, `[data-campo='email']`, `[data-campo='telefone']`, `[data-campo='senha']` e `[data-campo='senha-confirmacao']` (na tela de criar conta o campo de senha do login não existe), `[data-acao='criar-conta']`.
- Esqueci senha: `[data-acao='esqueci-senha']`, `[data-link-redefinicao]` (aparece só no modo demonstração).
- `[data-acao='sair']`.

**Painel do proponente**
- `[data-painel='proponente']` (contém saudação e a natureza da conta). `[data-org-seletor]`.
- `[data-aviso]` (janela), `[data-aviso-fechar]` (botão "Ciente, fechar").
- `[data-contador]` com `data-contador='enviados|andamento|concluidos|nao-aprovados'`. Texto traz o rótulo e o número.
- `[data-edital-aberto]` (cartão), `[data-acao='inscrever'][data-edital='<slug>']`.
- `[data-inscricao='<protocolo>']` (item da inscrição, sanfona aberta por padrão), dentro dele `[data-etapa-tempo]` (7 itens, com `data-estado`), `[data-acao='visualizar'][data-inscricao='<protocolo>']`.
- `[data-historico-ano]` por ano, `[data-link-edital]`, `[data-link-anexos]`.

**Inscrição**
- `[data-form='inscricao']`. Campos: `titulo`, `categoria` (select), `cota` (select), `extra-resumo` (texto longo obrigatório), `[data-campo='aceite']` (checkbox).
- Metas: `[data-acao='add-meta']`, linha `[data-meta-linha]` com `meta-etapa`, `meta-inicio`, `meta-fim`, `meta-acao`. A tabela começa vazia.
- Equipe: `[data-acao='add-equipe']`, linha `[data-equipe-linha]` com `equipe-nome`, `equipe-funcao`, `equipe-documento`. Começa vazia.
- Orçamento: `[data-acao='add-orcamento']`, linha `[data-orcamento-linha]` com `orc-descricao`, `orc-qtd`, `orc-valor` (número) e total da linha. A tabela começa vazia. `[data-orcamento-total]` mostra a soma em "R$ 0,00". `[data-orcamento-alerta]` só aparece quando a soma passa do teto e traz o texto "Total R$ 15.000,00 passa do teto de R$ 10.000,00." com os valores reais.
- `[data-campo='anexo']` (PDF, até 10 MB, mensagem de erro em `[data-erro='anexo']`).
- `[data-acao='salvar-rascunho']`, `[data-aviso-salvo]`, `[data-acao='enviar-inscricao']`.
- `[data-erro='obrigatorio']` (um por campo vazio, texto "Campo obrigatório: <nome>").
- `[data-protocolo]` na tela de confirmação, formato `TEB-AAAA-NNNNNN`.

**Visualizar inscrição**
- `[data-aba='ficha|notas|recursos|habilitacao|termo']` (botões das abas), `[data-aba-painel='<nome>']` (conteúdo). Abas travadas têm `[data-cadeado]`.
- `[data-form='recurso']`, `[data-campo='justificativa']`, `[data-acao='enviar-recurso']`, `[data-recurso-situacao]` ("Em análise", "Deferido", "Indeferido"). Fora do prazo, o formulário não aparece e `[data-recurso-encerrado]` explica.

**Minha conta**
- `[data-form='conta']`, `[data-campo='cep']`, `[data-acao='buscar-cep']`, `[data-campo='nova-senha']`, `[data-acao='alterar-senha']`. Documento em campo desabilitado.

**Gestor**
- `[data-painel='gestor']`, `[data-acao='novo-edital']`.
- `[data-form='edital']`. Campos: `numero`, `titulo`, `descricao`, `inicio`, `fim` (type date), `teto`. Listas: categorias, cotas, critérios (nome, máximo, bônus), campos extras (rótulo, tipo, obrigatório).
- `[data-acao='salvar-edital']`, `[data-lista='editais']`, `[data-edital-linha]` com `data-situacao`, `[data-acao='abrir-edital']` (só em rascunho), `[data-acao='encerrar-edital']` (só em aberto).
- Avisos: `[data-form='aviso']`. Inscrições: `[data-lista='inscricoes']`, filtros `[data-filtro='edital']` e `[data-filtro='situacao']`, `[data-acao='atribuir-avaliador']`, `[data-acao='publicar-resultado']`, `[data-acao='deferir']`, `[data-acao='indeferir']`, `[data-campo='parecer-recurso']`.

**Avaliador**
- `[data-painel='avaliador']`, `[data-acao='avaliar'][data-inscricao='<protocolo>']`.
- `[data-form='avaliacao']`, notas `[data-nota='qualidade|viabilidade|bonus-regional']` (número), `[data-campo='parecer']`, `[data-acao='enviar-avaliacao']`, `[data-avaliacao-enviada]` (texto com a nota geral, ex.: "Nota geral: 15,0"), `[data-nota-geral]` (soma ao vivo).

**Plataforma**
- `[data-painel='plataforma']`, `[data-acao='nova-organizacao']`, `[data-form='organizacao']`.

## Critérios de revisão humana
- Aparência: identidade própria, nada que lembre prefeitura ou política oficial.
- Rótulo "exemplo fictício" visível nos dados de exemplo.
- Faixa do modo demonstração visível. Rodapé com o crédito.
- Envio de anexo PDF no navegador (limite de 10 MB, só PDF).
- Busca de CEP, esqueci minha senha, alterar senha, sair, cadeado das abas, salvar rascunho. Cobertos por teste de unidade da api e conferência manual.
- Leitura em celular de 360 px.

## Critérios do servidor (teste de unidade, `npm test`, fora do portão 4)
S1. Validação de CPF e CNPJ por dígito verificador. Rejeita sequências repetidas.
S2. Senha guardada com scrypt e sal único. Nunca em texto.
S3. Sessão por cookie HttpOnly e SameSite=Strict. Sem cookie, 401.
S4. Limite de tentativas de login: bloqueio após 5 erros seguidos por documento e por IP, por 15 minutos.
S5. Isolamento: gestor, avaliador e proponente de uma organização nunca leem nem alteram dados de outra. Teste com duas organizações.
S6. Papéis: proponente não acessa rotas de gestor. Avaliador só vê inscrições atribuídas. Plataforma não lê inscrições.
S7. Enviar inscrição exige campos obrigatórios, gera protocolo único e congela a ficha (edição depois do envio é recusada).
S8. Planilha orçamentária acima do teto: o servidor recusa o envio.
S9. Anexos: só PDF, até 10 MB, gravados cifrados com AES-256-GCM. Arquivo adulterado falha na leitura. Nunca servidos por caminho público. Download exige sessão e papel com acesso.
S10. Nota: aceita zero em bônus, recusa acima do máximo e vazia. Nota geral é a soma.
S11. Recurso: só dentro do prazo, um por inscrição, só do dono. Decisão só pelo gestor da organização, com parecer.
S12. Redefinição de senha: token aleatório, 1 hora, 1 uso. Resposta igual para documento existente e inexistente.
S13. Registro de auditoria para login, criação de conta, envio, nota, resultado, decisão de recurso e mudança de edital.
S14. Contas de demonstração não existem no servidor real.

## Critérios do portão 4
Doze critérios em `criterios.json`. Rodam em modo demonstração.
- C1 login com sucesso. C2 senha errada. C3 CPF inválido. C4 criar conta.
- C5 aviso em janela e 4 contadores. C6 linha do tempo de 7 etapas.
- C7 envio bloqueado por campo obrigatório. C8 envio com protocolo.
- C9 soma da planilha e alerta de teto. C10 gestor cria e abre edital.
- C11 avaliador lança notas, com zero em bônus. C12 recurso dentro do prazo.

Ordem de dependência para o Dev: a senha de exemplo e os quatro CPFs acima, o aviso semeado, os editais e inscrições semeados e os seletores desta spec precisam existir exatamente como escritos.
