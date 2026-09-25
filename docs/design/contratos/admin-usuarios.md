# Contrato · Pessoas (`/admin/usuarios`)

**Dono de produto:** Eliezek (Administração)   **Dono do código:** Eliezek   **Data:** 25/09/2026
**Estado:** rascunho escrito junto com o código, a pedido do dono ("execute todo o plano", 24/09/2026). Falta o "contrato ok".

## Propósito
- **Pergunta que responde (h1):** "Quem entra no Brain, e em quê?"
- **Público:** super admin (hoje Pedro Luca e Victor Eliezek).
- **Decisão ou ação que provoca:** achar quem tem acesso pendente ou errado e abrir a ficha para corrigir; criar pessoa nova já com perfil e recorte.
- **Métrica de sucesso:** "Com pendência" em zero; nenhuma conta criada sem recorte (as duas de 24/09/2026 nasceram assim).
- **Arquétipo:** Lista/Relatório (cada linha abre a Ficha).
- **Universo medido:** todas as contas de `public.profiles` (43 em 24/09/2026) · estado atual · unidade de contagem: pessoa (conta).

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Com pendência | pessoas ativas com ao menos uma pendência de `pendenciasDe()` e sem pedido aberto | pessoa | `src/lib/pessoas-situacao.ts` sobre `adminListUsers` | ao abrir | lista filtrada `?situacao=pendencia` | sim |
| Convite pendente | ativas, sem pendência, que nunca entraram (`last_sign_in_at` nulo) | pessoa | Auth + mesma regra | ao abrir | `?situacao=convite` | sim |
| Pediram acesso | ativas com pedido `pendente` em `ops.acesso_pedidos` | pessoa | idem | ao abrir | `?situacao=pedido` | sim |
| Desativadas | `profiles.ativo = false` | pessoa | idem | ao abrir | `?situacao=desativada` | sim |

A situação é exclusiva e segue esta ordem: desativada > pediu acesso > com pendência > convite pendente > ativa. A ficha usa a mesma função, então lista e ficha nunca discordam.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | lista em curso | `Carregando variante="pagina"` |
| Vazio (sem dado na fonte) | não acontece (quem abre tem conta) | — |
| Vazio por filtro | nenhuma pessoa no filtro | `EstadoVazio total={n}` + "Limpar filtros" |
| Fonte indisponível / erro | falha em `adminListUsers` | `EstadoErro` com a mensagem |
| Sem acesso | não é super admin | redireciona para `/` (a rota só existe para super admin) |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `situacao` | ativa, pendencia, convite, pedido, desativada | ausente = todas | tabela |
| `busca` | texto (nome, e-mail, perfil, unidade) | ausente | tabela |

## Permissões (N8)
- Área que abre a tela: `admin`, e o servidor exige super admin ATIVO (`ops.eh_super_admin`).
- Quem não é super admin: redirecionado.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Nova pessoa | super admin | formulário exige perfil e recorte (ou unidade do sócio regional); avisa domínio incomum | painel com convite/link + link para a ficha; `toast` |
| Abrir ficha | super admin | — | navega para a ficha |

## O que NÃO entra, e por quê
- Editar, senha, produtos, desativar e excluir: moram na ficha. A linha antiga fazia tudo e não dizia o que a pessoa acessa.
- Gestão de áreas por pessoa em lote: não existe pedido.
- Empresas do Financeiro: `/admin/acessos-financeiro` (a Ana administra sem ser super admin).

## Para onde manda (tela dona)
- Ficha da pessoa (`/admin/usuarios/$userId`).
- Pedidos de acesso: `/equipe` (o sócio da unidade decide).

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida (falta captura escuro/claro: não há login de teste; ver DECISIONS 25/09)
- [x] Números conferidos na fonte (contagens batem com a consulta direta ao banco de 24/09/2026)
