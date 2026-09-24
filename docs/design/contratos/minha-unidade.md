# Contrato · Minha Unidade (`/painel-unidade`, `/meus-royalties`, `/minhas-auditorias`)

**Dono de produto:** Eliezek (casca e Minha Unidade)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Fontes, RLS e recorte por unidade não mudam. As demais telas da área são as da matriz (Base, CS, NPS, IDU, Receita) e seguem o contrato de cada uma.

## `/painel-unidade` · Painel (Visão geral)
- **Pergunta:** "Como a minha unidade está este mês, e o que pede atenção?"
- `AppShell` → `PageHeader` com pergunta, universo ("{unidade} · {mês} · contratos, tratativas e títulos da unidade") e procedência.
- **N11:** "Clientes Ativos" conta contratos → "Contratos ativos". "Nota média (90d)" não é NPS → "Nota média das pesquisas (90 dias)". "Churn no mês" conta tratativas perdidas movidas no mês por troca de fase **ou** atualização (o número infla): rótulo "Tratativas perdidas movidas no mês", e a régua fica para o dono (achado abaixo).
- **N4:** erros das leituras eram ignorados e os cards mostravam 0: passam a `EstadoErro`/`indisponivel`. Inadimplência e Clientes em risco → `KpiCard`.
- Gráfico "MRR por mês de ganho" (contratos ativos hoje): título diz "dos contratos ativos hoje, pelo mês de ganho" (viés de sobrevivente declarado); cores `hsl` e fonte 11px → tema de gráfico.
- Top 5 alertas: linha abre o cliente em `/clientes` (próxima ação).
- `.limit(10000/20000)` sem aviso: a procedência diz o teto.

## `/meus-royalties` · Meus Royalties (Lista)
- **Pergunta:** "Quanto a minha unidade repassou, e o que está em aberto?"
- `AppShell` → `PageHeader`; cards `Info` → `KpiCard`.
- **Correções:** usuário sem unidade ficava com o skeleton girando para sempre → `EstadoVazio` "Seu usuário não tem unidade vinculada"; mês sem linha aparecia R$ 0 → "—"; previsto 0 e repasse 0 aparecia "Pago" → "Sem cobrança"; erros ignorados → `EstadoErro`.

## `/minhas-auditorias` · Auditorias
Já é a referência da área (pergunta, procedência, estados). Só: "R$ 0" para valor nulo no card → "—"; tipo (Tabs) na URL; `.limit(1000)` declarado na procedência.

## Achados para o Eliezek
- `/painel-unidade` não confere `view.painel_unidade`.
- A régua de "churn no mês" (troca de fase ou atualização) conta cards que só foram editados.
