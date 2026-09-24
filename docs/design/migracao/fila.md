# Fila do orquestrador (migração DS v2, todos os módulos)

Atualizada a cada evento. Uma linha por worktree `planning-brain-ds-v2-<nome>`. Portão com trava: `docs/design/migracao/portao.sh` (cópia; o original usado pelos agentes fica no scratchpad da sessão).

## migracao · Monetização
- feito: T0 Fila Cella aposentada · T1 moldura (+fix) · T2 Operação (+fix) · T3 Follow Day (+fix) · T4 Temporal `de18ba6`
- feito: T6 Capacidade `30ef448` (revisão T4+T6 aprovada)
- feito: T5 `5c2e7f1` (aprovada; menores: FOCO de forecast.tsx pela constante única de common; "Só totais" com has-[:focus-visible]; Limpar da barra zera mes, blocos e totais — levar junto na T7)
- rodando: T4/T6 fixes
- depois: T4/T6 fixes (agente afa1ffa): M1 PRIORITÁRIO com responsável "todos" a Capacidade mostra EstadoVazio "Escolha um responsável para ver e editar o plano" (não deixar salvar sobre o plano do Matheus); M2 "passa a ser X" sem plano salvo; M3 FOCO unificado em common.tsx com ring-offset-2 (dashboard também); M4 role=alert só num lugar; M5 selo "{n} faltam"; M6 fonte "Plano + Base + carga do CRM"; M7 nota de autoria no DealDetails fora do estoque
- depois: T7 Funil + Distribuição · T8 Pessoas + Abordagens · T9 revisão final
- /clientes: C1 feito (`d6dba22`, `ceef80e`), revisão REPROVADA; C2 rodando (a354847)
- depois (após C2): C1 fixes (agente a8173de): B1 ContratosClientes sincroniza unidade com o parâmetro (useEffect) ou Carregando enquanto a carga pende; B2 cartões de origem da gaveta contam sobre o recorte sem a origem; B3 DECISÃO honrar 18/09: unidade e origem como LISTA na URL com MultiSelect no topo (nada de valor único); menores: origem com ORIGENS_BASE em Pendências/CSV; aria-pressed nos cartões que alternam filtro (ou clicar de novo tira); Limpar do topo não some (foco); "N de M" no título da tabela; Enviar (0) bloqueado com motivo quando product && !enviaveis.length; Contatos com estados do DS e sem "0 pessoas"; procedencia "churn lido em até 1.000 cards" em Contratos (pode ir para C3); chips de situação: 4 ou nota
- C2 feito (`d5be87f`, `21391f2`, `66f5e19`), revisão: 1 bloqueante no Recon
- depois (após C1 fixes): C2 fixes (agente a354847): BLOQUEANTE recon.tsx:290 marcar soma (Set com picked + rows) e desmarcar tira só as do filtro; filtrar dos cartões limpa query/unit/contact; rótulo sem "não só as N desta página" quando cabe; #painel-recon com anel de foco; summary de pendências com FOCO_VISIVEL; cn() e border-primary na lista atual; vazio do Recon sem "Voltar ao radar" quando não há contas
- depois: C3 · revisão C3 · T9 revisão final do módulo 1
- capturas: worktree `planning-brain-ds-v2-antes` (b5c44d7) criado; Chrome de login aberto em localhost:8080 aguardando o Pedro; scripts `capturar-telas.mjs` e `capturar-modulo.sh` em docs/design/migracao/
- (histórico) 3b `/clientes` (contrato em `docs/design/contratos/clientes.md`), empilhado nesta branch

## rede
- feito: R1 Overview (+fix) · R2 Indicadores (+fix) · R3 IDU `8727f16` · R4 Realizado `bc11fbd`
- rodando: R5 LTV + R6 Headcount (retomada)
- depois: R3 fixes (BLOQUEANTE foco em idu-view 446/627 e idu-metas-padrao 326/66; "cruzou" pela faixa; aria-controls só aberto; linha aberta por unidade_id; "ok" desabilitado salvando) · revisão R4–R6 · R7 revisão final

## base-cs · Base de clientes (relacionamento)
- feito: B1 CS · B2 NPS
- rodando: B1 fixes (retomada)
- depois: B2 fix (BLOQUEANTE nota CSAT l.650 "% das N notas de serviço com nota ≥ 8"; CSAT_FILL → CORES_SERIE[1]; "N respostas" no aviso de amostra; aria-label no Alternar; toggle Por mês/segmento na URL; sinal de menos; procedência sem "sem data" durante carga) · B3 Auditoria · B4 Reforma · B5 Disparos · B6 Base de Contatos · B7 revisão
- feito: B1 fix `685ac78`, B2 fix `7de6459`, B3 `b076e42`, B4 `24247c9`; rodando B5+B6 (a2043cf)
- feito: B5 `4254da6`, B6 `2cbf52f` (aprovados)
- depois: B5/B6 menores (agente a2043cf): linha da Execução com aria-haspopup + sr-only "Abrir {empresa}" e pílula não parecer botão; permissões carregando/erro não afirmam "sem edit.nps"; próxima ação avalia retorno antes da falha, marca vencido, neutra sem edit.nps ("Ver contato"); Sem contato positivo: usar soma das linhas por unidade (só ativos) — é a mesma régua do rótulo; régua "perigo abaixo de 30%"; link /clientes com nome quando CNPJ inválido; toast do sync alinhado
- CÓDIGO CONCLUÍDO: B7 revisão final; ajustes `af5cd8d` (CS), `0b94cb4` (cnpj em lib neutra — conflito resolvido), `f8f5956`, `03300ca`; DECISIONS `f669b37`. Pendente: capturas e texto do PR.
- rodando/depois: B3/B4 fixes (agente a958aff): BLOQUEANTE html-generator.ts:464 sinal `(delta > 0 ? '+' : delta < 0 ? '−' : '')`; foco devolvido ao campo de arquivo após Descartar; irParaPrazos respeita prefers-reduced-motion e leva o foco (tabIndex -1 + focus preventScroll); achado p/ dono: textos "Acréscimo de −X" / "Queda de −R$" no HTML

## receita
- feito: RR1 Visão geral (+fix `3e66195`) · RR2 Funil `aa05bb5` · RR3 Contas a Receber `5f47fa9`
- depois: RR2/3 fixes (BLOQUEANTE funil-content 295-298 checkbox `checked={todas||selected.includes(u)}` e desmarcar a partir de Todas; BLOQUEANTE 253-260 abrir de Faturado/Recebido só com 1 unidade; menores: aba atual ao mudar filtro no Resumo, Delta sem tom no corte, "contratos ativos hoje", plural, Ver faturas por CNPJ, Abrir cliente com motivo, busca sem perder tecla, redirect auditoria-faturamento → aba esperado, cards do topo ocultos em Mensalidades)
- feito: RR2/3 fixes (`9beee97`, `9a188a7`); RR4 `679d587`, RR5 `91468b3` `bc4232e` (aprovados); rodando RR6+RR7 (aac7903)
- depois: RR5 fixes (agente a0ef7f2): PRIORITÁRIO ficha com `key={`${unidadeId}-${mes}`}` (ou só renderizar ApuracaoLoaded quando mes_referencia bate com o mes) para não mostrar/fechar a apuração do mês anterior; emissão: podeEmitir exige !simular.isPending && plano; diálogo de emissão não desmonta aberto na ficha; aviso "não foi possível conferir se a fatura já saiu" quando a consulta de faturas falha/carrega; botao-com-motivo acessível (role=button aria-disabled + nome do botão no label); motivo da ficha com status da unidade; mesma regra de fatura entre lista e ficha (não-erro mais recente); erro da lista no motivo do Emitir; frase no Fechar sobre CSC da regra atual × gravado
- feito: RR6/RR7 (`6f9c400`, `b592f18`, `b8ea8a6`, `26e4479`); rodando RR5 fixes
- depois: RR6/7 fixes (agente aac7903): DECISÃO cabeçalho de Comissões titulo "Comissões" = menu (areas.ts é do Eliezek; renome do menu vira proposta no PR e no contrato §8); busca de Comissões com rascunho e pausa 300 ms; filtro Closer/SDR com o mesmo teste do card; um nome só "Com 1º pagamento"/"Recebido"; pendência DataProvider (carregando/erro fora do DS) no contrato; Funil de CAC: "A cobrar" das linhas de churn "—"/"churn" ou nota; EBIT: nota com custo lançado somando 0; seção de serviços escondida no erro de vendas; ícones 16px; barras do funil em rampa de um tom
- depois: RR8 revisão final
- (antigo) depois: RR4 Regras · RR5 Royalties lista+ficha (ler `?mes=` com `useMesNaUrl`) · RR6 Funil de CAC + Split · RR7 Comissões + EBIT · RR8 revisão

## people · People, Broker, Minha Unidade
- feito: P1 (+fix) · P2 (+fix)
- feito: P3 (`0afdffc`, `c33c8f8`, `573921a`)
- feito: P4 Broker (`c9a0bd1`, `ea64f9a`); rodando P3 fixes, revisão P4
- depois: P4 fix (agente a36f8ca): DECISÃO DO ORQUESTRADOR Reservar não trava por saldo (tela não sabe se bloqueio_por_saldo está ligado); mostra aviso "o saldo exibido é menor que o preço; a reserva pode ser recusada" e deixa o servidor decidir (tirar saldoInsuficiente do disabled/motivo em broker-unidade-view 330-336/444-449; atualizar contrato broker.md:9); menores: Procedencia também nos estados degradados; mapa de rótulos com acento no StatusBadge; faturas da unidade em StatusBadge; "Acesso negado" na unidade → EstadoSemAcesso; "Liberando…"/"Dando baixa…"
- rede: R3 fix `729e8ab`; R4–R6 fixes rodando (ab4ca73)
- depois: P3 fixes (agente a2d7be9): BLOQUEANTE Enviar convites com totalEnviados>0: "vai para quem, entre as N ativas com e-mail, ainda não recebeu (X já receberam)"; "Nenhuma pessoa no cadastro que você enxerga (status)"; nota do KPI "sem contar N sem unidade"; registrar dívida: listAdocao engole erro (Eliezek)
- depois: P5 Minha Unidade · P6 revisão

## admin
- feito: A1 (+fix) · A2 (+fix `487b79e`, `73940dc`, `b084856`)
- feito: A3 (`08f9bde`, `cd2de3d`, `4029c3d`), aprovada
- feito: A4 (`7d76f56`, `252215a`, `3c78141`), aprovada; rodando A3 menores
- depois: A4 menores (agente a22755a): Navigate com partesDoLink (e abrir()); esqueleto sem h1 enquanto carrega; card sem controle aninhado + filete no hover; texto do diálogo de validação "continua em"/"Não conferido"; não setError nas falhas de gravação; teclado e aria-label em pagamentos-unidades; link da tela substituta no aviso N14 (Receita e Repasses); achado p/ Eliezek: salvar observação regrava validado_por
- depois: A3 menores (agente ac98f1b): aria-label por página na Checkbox; status com herança da pai ("Segue a pai"); Nomear sócio desabilitado sem unidade; "Para desfazer, só tirando da área ou em Níveis de acesso"; aria-describedby no Salvar
- CÓDIGO CONCLUÍDO: A5 revisão final aprovada; ajustes `bc1cfb8`; contrato de Perfis + DECISIONS `d0edb4a`
- pendente para o PR: capturas antes/depois (Usuários, Permissões, /inicio, Títulos por vencimento, claro e escuro); texto do PR com exceções (filtros das órfãs fora da URL, 6× confirm() na DRE projetada, indigo em fxc-view, procedência das órfãs) e os achados para o Eliezek (rascunho no relatório da A5)

## Reconciliar antes dos PRs
- (RESOLVIDO em `0b94cb4`) CONFLITO: base-cs (B6 `991bbb6`) importa `cnpjDvValido` de `src/lib/fila-cella.types.ts`, que a branch migracao APAGOU (Fila Cella aposentada). Mover a função para `src/lib/cnpj.ts` na base-cs antes do merge; grep em todas as branches por `fila-cella` antes de juntar.
- `useFocoDeVolta` exportado de analysis.tsx (aviso react-refresh): mover para common.tsx depois da C1.
- `BotaoComMotivo` duplicado (monetizacao/common.tsx, gente/estados-gente.tsx): subir um para `components/planning`.
- `AppShell.pergunta` (admin, A1) × `MolduraReceita` (receita, RR1): unificar.
- Cherry-pick `1bb0341` (V4 IDU) em todas exceto rede (R3 corrigiu lá).
- Capturas antes/depois com a sessão do Pedro (`.env.local` em migracao).
- Regra para próximos prompts: foco visível em todo controle focável novo (em `<tr>` usar `outline-*`).
