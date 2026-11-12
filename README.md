# Sistema Integrado TEB

Sistema de editais culturais da **Teste de Elenco Brasil Sistema Integrado**. Proponentes se inscrevem, gestores criam e acompanham editais, e avaliadores dão notas. Várias organizações usam a mesma instalação.

**Demonstração:** https://dev-kenshi.github.io/pnab/

A demonstração roda só no navegador, com dados fictícios. Nada sai do seu computador. Para usar de verdade, com login real e anexos guardados, rode o servidor (veja abaixo).

Desenvolvido por **Emanuel Macêdo Luz, desenvolvedor do projeto**.

## Contas de demonstração

Todas são fictícias e só funcionam no modo demonstração. A senha de todas é `Exemplo#2026`.

| Papel | CPF |
|---|---|
| Proponente | 529.982.247-25 |
| Gestor da organização | 111.444.777-35 |
| Avaliador | 390.533.447-05 |
| Plataforma | 168.995.350-09 |

As mesmas contas aparecem na tela de login, em "Contas de demonstração". O servidor real recusa essas contas e essa senha.

## Exemplo no servidor real

Recurso de teste, desligado por padrão. Mostra no servidor real (Replit) as mesmas telas da demonstração, com contas próprias da organização "Fundação Cultural Exemplo (teste)". Os CPFs são fictícios e diferentes das contas de demonstração.

```text
Gestora Exemplo (exemplo)     gestor      CPF 861.357.924-82
Avaliador Exemplo (exemplo)   avaliador   CPF 862.468.135-93
Proponente Exemplo (exemplo)  proponente  CPF 863.579.246-79
```

- `TEB_SEMEAR_EXEMPLO=1`: a subida cria o exemplo se faltar. Útil porque o disco do Replit publicado pode ser zerado a cada reinício. Se já existe, nada muda.
- `TEB_EXEMPLO_SENHA`: senha das três contas. Vai só nos Secrets do Replit, nunca no código nem no Git. Precisa de 12 caracteres ou mais e não pode ser comum.
- Sem subir o servidor: `node servidor/principal.js semear-exemplo`. O comando imprime os CPFs, nunca a senha.
- O proponente tem 4 inscrições: uma em avaliação, uma suplente com notas e parecer, uma não aprovada com recurso em análise e uma selecionada em habilitação. O avaliador tem uma inscrição sem nota. Há um aviso em janela.
- Apague as duas variáveis antes de usar o sistema de verdade. Detalhes em [`docs/seguranca.md`](docs/seguranca.md).

## O que o sistema faz

- **Acesso:** login em 2 etapas (CPF ou CNPJ, depois senha), criar conta, esqueci a senha.
- **Painel do proponente:** contadores, editais abertos, minhas inscrições com linha do tempo de 7 etapas e aviso em janela.
- **Inscrição:** formulário montado pelo edital, com metas, equipe, planilha orçamentária com soma e alerta de teto, anexos em PDF, rascunho automático e protocolo no envio.
- **Acompanhamento:** ficha somente leitura, notas por critério, parecer e recurso dentro do prazo. Habilitação e termo aparecem travados até a etapa liberar.
- **Gestor:** cria editais (critérios, cotas, categorias, campos extras), abre e encerra inscrições, publica avisos, atribui avaliadores, publica resultado e decide recursos.
- **Avaliador:** dá nota por critério e escreve o parecer, sem ver documento nem contato do proponente.
- **Plataforma:** cria as organizações contratantes e o gestor de cada uma.
- **Minha conta:** dados, endereço com busca de CEP e troca de senha.

## Segurança e dados

- Senhas com scrypt, sessão por cookie HttpOnly e SameSite=Strict, papéis e isolamento por organização em toda consulta.
- Anexos cifrados com AES-256-GCM e servidos só a quem tem acesso.
- Limite de tentativas de login, auditoria e cabeçalhos de segurança (CSP e outros).
- 100 validações de segurança automatizadas, ligadas ao NIST CSF 2.0 e ao Cybersecurity101. Detalhes em [`docs/seguranca.md`](docs/seguranca.md).
- Backups cifrados para Google Drive, Backblaze B2 e GitHub privado. Detalhes e capacidade do plano grátis em [`docs/backups.md`](docs/backups.md).

## Rodar o servidor

Precisa do Node 24 ou mais novo. Não há pacote npm para instalar.

```bash
cd entregas/editais
cp .env.example .env
```

Preencha o `.env`. A chave dos anexos se gera assim:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Depois:

```bash
node servidor/principal.js criar-plataforma
node servidor/principal.js
```

Abra http://localhost:3000. Nunca faça commit do `.env`.

## Testes

```bash
cd entregas/editais && npm test
```

Na raiz, os portões da Fábrica conferem código e telas:

```bash
npm ci && npx playwright install chromium
npm run portoes
```

## Estrutura

| Pasta | O que tem |
|---|---|
| `entregas/editais/` | O sistema: telas em HTML, CSS e JavaScript sem framework, e o servidor em `servidor/` |
| `trabalho/editais/` | Spec, critérios, plano de tarefas e relatórios do Testador |
| `docs/` | Levantamento, referência visual, segurança, backups e relatório |
| `scripts/portoes/` | Portões 3 e 4 da Fábrica |
| `.claude/` | Agentes e o comando `/construir` da Fábrica |

## O que falta

A lista atualizada está em [`docs/relatorio.md`](docs/relatorio.md). Em resumo: banco Turso e anexos no R2 em produção, primeiro uso real dos backups e do e-mail, habilitação, termo e execução.

---

Feito com a Fábrica de agentes. Emanuel Macêdo Luz, desenvolvedor do projeto.
