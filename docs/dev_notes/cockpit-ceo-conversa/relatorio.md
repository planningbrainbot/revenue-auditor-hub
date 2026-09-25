# Cockpit do CEO: leitura de dez segundos e "Perguntar ao Brain" (relatório, 24–25/09/2026)

Branch `feat/cockpit-ceo-conversa-20260924`, a partir da `main` `20a8e95`. Spec em `docs/superpowers/specs/2026-09-24-cockpit-leitura-e-conversa-design.md` e plano em `docs/superpowers/plans/2026-09-24-cockpit-leitura-e-conversa.md`.

As skills do Superpowers não estão instaladas nesta máquina; o método (spec, plano, lotes, testes primeiro, verificação) foi seguido à mão.

## Onde cada coisa está

| Ambiente | Estado |
|---|---|
| Local | tudo implementado e testado; app com dado real em `./scripts/cockpit-ceo/conversa-local.sh` (porta 8082) |
| Banco de produção | **só as 4 tabelas novas da conversa** (migration `20260925000000`, aplicada com autorização do Pedro; rollback em `supabase/rollback/`). Nada existente mudou |
| Preview na Vercel | não feito (o deploy do Ops é do Eliezek) |
| Homologação | percurso real local com a sessão do Pedro (ver Verificações); sem homologação em ambiente publicado |
| Publicação | **não publicado**; a `main` não recebeu nada |

## O que mudou para quem usa

**Visão executiva** (`/cockpit-ceo`). Na primeira dobra:
- quatro números com comparação e tendência;
- o gráfico do faturamento com o "entrou × saiu" do mês;
- até três pontos de atenção, cada um com responsável.

Abaixo da dobra ficam as decisões, com as alternativas medidas. Sumiram da home:
- o cartão "não apurado" da meta;
- a procedência técnica;
- os motores;
- as contagens de perguntas;
- o filtro de período, que não mudava nenhum dos quatro números e continua nas frentes.

O selo "Fontes em dia / N atrasadas" abre a data de cada fonte.

**Perguntar ao Brain** (`/cockpit-ceo/perguntar`, novo item do menu):
- A pergunta sai da caixa à esquerda. A conclusão vem em uma a três frases, com os gráficos à direita e sugestões de próximas perguntas.
- Refinar é só escrever ("agora só a base nova", "e em Belém?"). Também dá para mexer nos controles acima dos gráficos (período, leitura, base, produto, unidades), e aí a consulta roda de novo sem passar pela IA.
- "Salvar visão" guarda as consultas e os filtros, não os números. "Visões salvas" abre, renomeia ou exclui. Ao abrir, os números são consultados de novo com o acesso de agora.
- O histórico de conversas e as visões são privados.

## Arquitetura (resumo)

1. **Jev** (`typesafe/jev-1.13`): classifica o domínio da pergunta, e acima de 0,7 o modelo só recebe as consultas daquele domínio. Pergunta fora do escopo, com certeza, é respondida sem IA. Se o Jev falha, a conversa segue sem dica.
2. **Modelo principal** (OpenRouter): escolhe consultas de um **catálogo fechado de 15**, que são as mesmas funções do cockpit. Não existe SQL livre. Termina com uma especificação de visão validada por schema.
3. **Servidor**:
   - troca cada referência pela consulta autorizada;
   - confere cada número do texto contra os resultados; frase com número sem origem sai;
   - grava definição, texto e consumo.
4. **Tela**: renderiza os blocos (KPI, série, barras, ranking, funil, ponte, tabela, coorte, ações) com os componentes do DS v2.

Orçamento, verificado antes de cada chamada:
- teto de US$ 20/mês para todos;
- US$ 3/dia e 150 chamadas/dia por pessoa;
- chamada sem custo informado conta como US$ 0,25;
- sem renovação por lote.

## Verificações

- **Testes:** 258/258 (`node --test tests/*.test.mjs`); 49 novos.
  - catálogo e réguas: valores escritos à mão;
  - especificação e conferência de números;
  - Jev e orçamento;
  - orquestração com modelo simulado: número inventado, pedido de SQL, número literal no bloco, falha do modelo e do Jev, teto, cancelamento, restrição por domínio, refinamento, salvar, esclarecimento;
  - leitura executiva: conciliação cartão × gráfico × ponte e selo de saúde.
- **RLS**, provada em transação desfeita e de novo depois de aplicada: 15 regras. Resultado:
  - uma pessoa não vê nem altera o que é de outra;
  - quem não tem a área não grava;
  - ninguém altera ou apaga consumo;
  - anônimo não lê.
- **Percurso real sem IA**, com a sessão do Pedro no app local:
  - salvar, reabrir e conferir a tabela contra SQL independente: 6/6 células;
  - trocar a base pelo controle e conferir de novo: 6/6;
  - renomear, excluir, e confirmar que a visão excluída não abre.
- **Percurso real com Jev:** pergunta fora do escopo → classificada, respondida sem modelo, 2,7 s.
- **Gabaritos independentes, só leitura:**
  - agosto/2026 do grupo = R$ 7.455.047,01 (mesmo número do cartão);
  - onboarding parado há mais de 30 dias = 95 (mesmo número do cartão).
- **`tsc`:** só os 7 erros anteriores da `main`.
- **`eslint`:** 0 erros nos arquivos tocados.
- **`design:lint:changed`:** 0 violações nos 35 arquivos. A catraca global acusa V4/V6 que já estão na `main`.
- **`vite build`:** ok. Nenhuma chave no pacote do navegador; a rota `/api/cockpit-ceo/conversa` está no servidor gerado.
- **Capturas:** `docs/design/capturas/cockpit-ceo/leitura-20260924/` (antes/depois, 1280×800 e 1440×900, claro e escuro), no preview sintético e no estado vazio. As capturas com número real ficaram fora do repositório.

| Medida (preview, 1280) | Antes | Depois |
|---|---|---|
| Altura da página | 3.213 px | 1.661 px |
| Cartão "não apurado" | sim | não |
| Gráfico + atenção inteiros em 1440×900 | — | sim |

No app real a 1280×800, com a lateral aberta, a primeira dobra mostra os quatro números, o topo do gráfico e o primeiro ponto de atenção. Gráfico e atenção terminam cerca de 160 px abaixo.

## Jev: calibração (36 perguntas, as nove do Pedro incluídas; US$ 0,0013)

- **Domínio:** 34/36 certos. Com limiar de 0,7, 31 perguntas ficam restritas ao domínio e o único erro (u2 → receita) mantém as ferramentas certas; 5 vão ao modelo sem dica.
- **Ambiguidade:** o sinal não separa (pergunta clara com 0,94, ambígua com 0,90); acertaria 7 a 11 de 31. **Desligado.** Quem pergunta de volta é o modelo, pelas réguas padrão.

Detalhe em `jev-calibracao.json`.

## Avaliação dos modelos: **pendente de crédito**

A conta do OpenRouter tem crédito zero. As duas chaves (a do piloto e a nova) são da mesma conta, e a sobra cobre só uns 3.800 tokens de resposta do Sonnet 5.

Está tudo pronto para rodar:
- **Conjunto:** `avaliacao/perguntas.json`, com 24 casos: simples, vários domínios, refinamentos, ambiguidade de receita, cliente ativo e período, fonte parcial e desatualizada, unidade fora do escopo, duas injeções, visualização sem dado, réguas que não se somam, fora do escopo.
- **Executor:** `scripts/cockpit-ceo/conversa-avaliar.mjs`, com gabaritos por SQL independente e teto cumulativo de US$ 5 no ledger.

Para rodar, depois de colocar crédito:

```bash
COCKPIT_IA_AVALIACAO=1 ./scripts/cockpit-ceo/conversa-local.sh   # num terminal
# noutro, com a sessão autorizada (ver cabeçalho do script):
node scripts/cockpit-ceo/conversa-avaliar.mjs http://127.0.0.1:8082 --teto 5
```

O modelo padrão fica `anthropic/claude-sonnet-5` até a avaliação decidir. A troca é a variável `COCKPIT_CONVERSA_MODELO`.

## Pendências

| Pendência | Quem | Efeito |
|---|---|---|
| Crédito no OpenRouter e rodada da avaliação | Pedro | escolha do modelo pelos números |
| Revogar as duas chaves que passaram pelo chat (`planning-openrouter-cockpit-piloto` e `-2`) e criar uma de servidor | Pedro | segurança |
| `OPENROUTER_API_KEY` e tetos (`COCKPIT_IA_TETO_*`) na Vercel do `ops-brain` | Eliezek + Pedro (custo) | sem isso, em produção a conversa diz que não está configurada e o cockpit segue normal |
| "Contrato ok" das duas telas; revisão da prop `tendencia` do `KpiCard` | Pedro; Eliezek/Mika | merge |
| Área `cockpit_ceo` para o CEO (pedro.araujo é `diretor`, sem a área) | Pedro + Eliezek | o CEO ainda não abre o cockpit |
| Responsáveis das exceções vêm do "Dono" de cada contrato | Pedro | confirmar nomes |
| Na primeira dobra real a 1280×800, o gráfico e a atenção terminam abaixo da dobra | Pedro | aceitar ou pedir mais compactação |
