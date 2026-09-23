# PRODUCT.md · Para que serve o Brain, para quem, e o que falta decidir

Fonte principal: `diagnostico/objetivos-e-modulos.md` (auditoria de 23/09/2026 sobre specs, PRDs, DECISIONS e rotas). Siglas de fonte como lá: `PU/` = `PM Work/projeto-unificado/`, `CP/` = briefing do Cockpit do CEO, `FC` = spec da Fila Cella, `CRM` = spec das telas do CRM núcleo, `D` = DECISIONS do worktree `planning-brain-filtros-multi`, `F/` = Brain Financeiro, `W/` = Growth, `N` = estudo de navegação da Base, `S` = spec do cockpit da base.

Este arquivo não decide produto. Ele registra o que está decidido e lista o que não está.

---

## 1. Objetivo em uma frase

Fazer cada pessoa do Grupo Planning, do CEO ao hunter, saber em minutos o que está acontecendo com clientes, rede e dinheiro, com números de procedência declarada, e executar a próxima ação que converte a base que já é nossa em receita atribuível, rumo a R$ 1 bi/ano.

Síntese de `CP/PRD.md:15`, `CP/contexto-roadmap.md:17`, `PU/spec-banco-unico.md:16-18` e `PU/narrativas-v2.md:9-13`. O objetivo foi reescrito três vezes sem revogação formal (ver §5.1), e a meta de R$ 1 bi não tem perímetro nem ano-alvo.

**O elo que falta:** entre a pergunta do CEO e a ação de quem opera. A maioria das telas exibe; só três forçam ação por linha: Fila Cella, Base de clientes ("Preparar lista → Enviar ao Pipedrive") e Distribuição do Growth (`objetivos-e-modulos.md` §0).

**Consequência para design:** toda tela declara a pergunta (N1) e a ação que provoca (contrato de tela). Tela que só exibe precisa dizer para onde manda (N10).

---

## 2. Públicos e job to be done

| Público | Quando… quero… para… | Onde está hoje |
|---|---|---|
| CEO / sócios da matriz | …abro o Brain, entender em 1 min como estamos, o que mudou, o que ameaça o resultado e quais decisões são minhas, para alocar capital e cobrar donos | piloto `/piloto/cockpit-ceo`; Financeiro `/`; `/rede-overview`; OKRs |
| Comercial / pré-venda / hunter | …começo o dia, saber quem ligar, com qual argumento e onde parei, para ir de abordagem a ganho | `/fila-cella`; `/monetizacao`; `/clientes` → Produtos e listas; Growth `/comercial/*` |
| Marketing / Growth | …reviso campanhas, saber qual recorte compra MQL e reunião no preço certo, para escalar ou cortar verba | Growth `/trafego`, `/criativos` |
| CS / Relacionamento | …olho a carteira, ver quem está em risco (NPS, inadimplência, tratativa) e agir antes do churn | `/painel-cs`, `/nps`, Contratos e churn, IDU |
| Financeiro / controladoria | …fecho o mês, ter DRE, caixa e repasse conciliados e com régua declarada, para fechar sem planilha | Brain Financeiro + Receita e Repasses |
| Gestão da rede / sócio regional | …olho a rede ou a unidade, saber quais crescem com margem e o que devo, recebo ou cobro | `/rede-*`, `/idu`, `/painel-unidade`, `/unidades/*`, `/meus-royalties` |
| Líderes (pessoas) | …cuido do time, ver minha vez, meu time, PDI e avaliação | `/gente?tela=*` |
| Admin | …concedo acesso, dar o mínimo por área e página e ver como o usuário vê | `/admin/*`, "ver como" |

Fonte: `objetivos-e-modulos.md` §1 (cada linha com a sua fonte lá).

---

## 3. Módulos do Ops: a ação que cada um deve provocar

Estado: **E** existe e é usado · **P** parcial (não provoca a ação ou tem defeito conhecido) · **N** não existe. "*inferido*" = a spec não diz; o relatório inferiu. Estado em `eea3d90` / relatório de 23/09.

| Área → módulo | Rota | Ação que deve provocar | Estado | Arquétipo alvo |
|---|---|---|---|---|
| Estratégia & Execução | OKRs (fora de `areas.ts` aqui) | atualizar status de ação ou ponteiro de KR; cobrar KR sem medição | P (OKRs ainda duplicados no Growth) | Lista/Relatório |
| Rede | `/rede-overview` | achar unidade fora da curva e abrir o detalhe | P (cards levam a total que não bate) | Visão geral |
| Rede | `/idu` | plano de ação para unidade com nota baixa | E | Lista/Relatório |
| Rede | `/indicadores-trimestre` | substituir o deck manual | E | Visão geral |
| Rede | `/rede-realizado`, `/rede-ltv`, `/rede-headcount` | comparar unidades (*inferido*) | E, sem spec de decisão | Lista/Relatório |
| Base de clientes | `/clientes` | auditar nominalmente → montar lista → enviar ao CRM | P (guarda `view.aquario` não aplicada; KPIs homônimos) | Lista/Relatório + Fila (Validar origem) |
| Base de clientes | Validar origem | resolver a conta pendente pelo motivo real | P (494 sem destino) | Fila de trabalho |
| Base de clientes | Contratos e churn | agir sobre inadimplente/churn (*inferido*) | P (sobrepõe Tratativas) | Lista/Relatório |
| Base de clientes | `/painel-cs` | tratar o cliente em risco | P (tratativa sem escrita no Ops) | Visão geral + Fila |
| Base de clientes | `/nps` | responder ao detrator (*inferido*) | E | Fila de trabalho |
| Base de clientes | `/auditoria-interna` | *inferido* | E, sem spec | Lista/Relatório |
| Base de clientes | `/reforma-tributaria` | rodar simulação para um cliente | E | Ficha |
| Base de clientes | `/disparos-whatsapp` | disparar campanha (custa por conversa) | E, só super admin | Configuração |
| Base de clientes | `/base-contatos` | encontrar o contato | P (duplica Contatos de `/clientes`) | Lista/Relatório |
| Receita e Repasses | `/receita-overview` | ver se o mês fechou, faturou e recebeu | E (22/09) | Visão geral |
| Receita e Repasses | `/funil-receita` | ver onde o contratado não vira faturado/recebido | P | Lista/Relatório |
| Receita e Repasses | `/contas-receber` | cobrar | E, mas sem ação na tela | Fila de trabalho |
| Receita e Repasses | `/unidades`, `/unidades/royalties`, `/unidades/funil-cac`, `/unidades/split` | apurar → confirmar → faturar no Omie; cobrar CAC | E | Configuração / Lista → Ficha |
| Receita e Repasses | `/comissoes`, `/ebit-operacional` | ratear custo e apurar comissão | E | Lista/Relatório |
| Planning People | `/gente?tela=*` | liderança, elogios, avaliação, PDI | P (trilha que substituiria o Qulture não existe) | Fila / Ficha |
| Monetização | `/monetizacao` (9 visões) | trabalhar a fila de negócios; alocar capacidade por produto | P (alocação 0/0/0) | Fila + Lista |
| Monetização | `/fila-cella` | abrir a primeira linha desbloqueada e registrar toque | P (spec v0.3) | Fila de trabalho |
| Broker | `/broker`, `/broker/admin` | pegar oportunidade; matriz vê custo/CAC | E | Fila / Configuração |
| Minha Unidade | `/painel-unidade` e demais | agir na própria unidade | P (sócio cai em bloco vazio sem aviso) | Visão geral |
| Administração | `/admin/*`, `/equipe`, `/atividade` | conceder o mínimo; validar página antes da main | E | Configuração |
| Fora do menu | `/financeiro-partners`, `/pagamentos-unidades` | nenhuma definida | sem dono de menu | — |

Fora do Ops (outros apps, mesma casca): Growth (`/growth`, padrão de título-pergunta mais maduro da casa) e Brain Financeiro (`/financeiro`, único que já usa `components/planning`). Saídas planejadas sem tela: S1 clusterização (P), S2 `/crm` (N), S3 anúncio → margem (N), S4 parcerias (N), Funil A "os 50 contratos" (N).

---

## 4. Donos

| Pessoa | Dono de |
|---|---|
| Pedro Luca | decisões de produto e navegação da Base de clientes; Monetização (`/monetizacao`, `/fila-cella`); Cockpit do CEO; Brain Financeiro |
| Victor Eliezek | repo e casca do Ops (lateral, áreas, `/inicio`); acessos e permissões; Rede, IDU, Indicadores; Receita e Repasses; Planning People; Broker; NPS/CS |
| Mikael (Mika) | Growth; marca (logo, fonte, paleta) |
| Bodra | ECD/AWS, `new-business-explorer` (S1, `/crm`) |
| CEO (Pedro Araújo) | usuário do Cockpit; escolhe cluster piloto |
| Ana (controladoria) | regras de fechamento, orçamento, `admin_financeiro` |

Fonte: `objetivos-e-modulos.md` §5. Risco apontado lá: duas pessoas definem a navegação do mesmo app (casca do Eliezek, navegação da Base do Pedro) sem regra comum; `NAVEGACAO.md` é essa regra.

---

## 5. Decisões pendentes de produto

Nenhuma destas é resolvida pelo design system. Dono **sugerido** pelo relatório; a decisão vira entrada no `DECISIONS.md`.

| # | Pendência | Conflito | Dono sugerido | Fonte |
|---|---|---|---|---|
| 5.1 | O Cockpit do CEO é a área Estratégia & Execução ou outra coisa? | Em 21/09 o dono descartou "Cockpit" (colide com o Financeiro) e criou Estratégia & Execução; em 22/09 o PRD voltou a chamar de "Cockpit do CEO". "Cockpit" hoje tem três sentidos. | Pedro | DECISIONS 21/09; `CP/PRD.md:21` |
| 5.2 | Qual é a casa única da fila de ligação (S2)? | `/crm` (Bodra) × `/fila-cella` × `/monetizacao` Operação; as próprias specs proíbem o terceiro painel | Pedro, ouvindo Bodra | `CRM:54`; `FC:26,97` |
| 5.3 | "Cliente ativo" por contexto | três réguas: conta conciliada (Base), "pagou em 90 dias" (Contratos), "não deu churn" (Rede) | Pedro + Eliezek | `D:2158-2160`; `CP/PRD.md:121` |
| 5.4 | Forma final da Base de clientes | 4 blocos numa rolagem (`S:153`) × rotas irmãs (`N:230-252`) × faixa única no topo (implementada 22/09) | Pedro | `D:2189,2210` |
| 5.5 | Guarda de "Produtos e listas" | decisão é `view.aquario`, mas a entrada aparece para todos; sócio cai em bloco vazio | Pedro (regra), Eliezek (casca) | `D:2154` × `D:2210`; `N:217` |
| 5.6 | OKRs em dois apps | passo 2 (tirar do Growth) não executado | Pedro + Mika | DECISIONS 21/09 |
| 5.7 | Pessoas/PDI em três casas | Growth `/pessoas` `/pdi`, `/monetizacao?aba=pessoas`, `/gente` | Eliezek (People) + Mika (Growth) | `objetivos-e-modulos.md` §4.2 |
| 5.8 | Funil comercial e Distribuição em dois apps | Growth (inbound) × Monetização (base); fronteira não documentada | Pedro + Mika | idem |
| 5.9 | Contatos | visão oculta de `/clientes` × `/base-contatos` | Pedro + Eliezek | `N:90-98` |
| 5.10 | Doutrina de rota aposentada (N14) | Ops redireciona em silêncio (22/09: "link antigo não pode virar 404"); Financeiro explica a rota aposentada | Eliezek | `F/src/App.tsx:20-26`; DECISIONS 22/09 |
| 5.11 | `/financeiro-partners` e `/pagamentos-unidades` | vivas e fora do menu desde 14/09 | Eliezek | `telas-do-brain.md` §1.3 |
| 5.12 | Perímetro e ano-alvo da meta de R$ 1 bi | meta sem perímetro | CEO + Pedro | `CP/PRD.md:11,121` |
| 5.13 | Pergunta sem tela | Funil A ("os 50 contratos") e S3 (anúncio → margem) sem spec de tela | Pedro | `FC:63,103`; `PU/spec-banco-unico.md:16` |
| 5.14 | Módulos sem dono nomeado | `/auditoria-interna`, `/rede-realizado`, `/rede-ltv`, `/rede-headcount`, `/comissoes`, `/ebit-operacional`, Recon, Validar origem, Tratativas | Pedro + Eliezek | `objetivos-e-modulos.md` §4.5 |
| 5.15 | Telemetria de navegação | `ops.acessos_log` tem 22 linhas e só registra ação administrativa; sem ela não há como cortar tela com segurança | Eliezek | `N:54` |
| 5.16 | Fonte e logo oficiais | `.woff2` da Bw Glenn ausentes; dois gradientes de logo em uso | Mika | spec §2.3; `design-system-planning.md` §2 |
| 5.17 | Qual Ana administra o Financeiro | docs do Financeiro dizem "Ana Laura", DECISIONS diz "Ana Carvalhais" | Pedro | DECISIONS 17/09; `F/produto/duas-reguas…:11` |

Ordem sugerida pelo relatório (§6): 5.1, 5.2, 5.3 e 5.4 primeiro; instrumentar navegação (5.15) antes de fundir qualquer tela duplicada.
