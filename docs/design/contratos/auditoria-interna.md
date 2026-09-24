# Contrato · Auditoria Interna (`/auditoria-interna`)

**Dono de produto:** sem dono nomeado (`PRODUCT.md` 5.14)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Fórmulas e fonte (`auditorias_internas`, pipe 307181077) não mudam.

## Propósito
- **Pergunta (N1):** "Quais projetos fiscais estão atrasados, e quanto eles acharam por unidade?"
- **Público:** time fiscal (Qualidade), diretoria.
- **Ação:** cobrar o projeto com prazo vencido e levar o achado de oportunidade para a unidade.
- **Arquétipo:** Visão geral + Lista por tipo de projeto (abas).
- **Universo (`descricao`):** "Projetos do pipe da Auditoria Interna · {tipo} · valores estimados pelos relatórios, em R$".

## Números (rótulos que mudam — N11)
| Hoje | Passa a | Por quê |
|---|---|---|
| Concluídas | Concluídos (flag ou fase final) | régua de 3 fases + flag |
| Auditorias realizadas (resumo por unidade) | Projetos em "Projeto Concluído" | é uma fase só e conta todos os tipos |
| Saúde da carteira | Exposição fiscal por unidade | "Saúde da carteira" era o nome da tela que saiu em 23/09, com outra métrica |

Oportunidades e contingências: Σ estimado dos relatórios; valor ausente mostra "—" (hoje "R$ 0"), e a soma declara "{n} projetos sem valor".

## Correções de exibição
1. Erro engolido (tela com zeros) → `EstadoErro`.
2. "Forçar atualização" desabilitado com motivo para quem não é admin.
3. KPIs locais → `KpiCard`; grade dos gráficos → `gradeProps`.
4. Aba e filtros da tabela de achados na URL (`aba`, `busca`, colunas).
5. Linha do projeto ganha o link para o card no Pipefy, quando houver id.

## O que NÃO entra
Minha Unidade › Auditorias (`/minhas-auditorias`, tela própria de 24/09).

## Achado para o dono
A policy "Custom roles can read" deixa papéis customizados lerem a tabela inteira, sem recorte de unidade (DECISIONS registra). Não mexido.
