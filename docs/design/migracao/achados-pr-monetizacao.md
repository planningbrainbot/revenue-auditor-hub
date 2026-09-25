# Rascunho do PR · Monetização e /clientes

### Achados para o Eliezek / dono
1. Dado, não corrigido: Contratos e churn lê central_tratativas com .limit(2000), e o PostgREST corta em 1.000, então o churn pode estar subcontado. A tela agora diz "churn lido em até 1.000 cards". O conserto é paginar por range, como as outras quatro leituras da página.
2. Fila Cella: saíram componentes, hook e server functions. Ficam no banco as tabelas, a view, as migrations e as chaves view/manage.fila_cella (permissions.functions.ts:384-391; cockpit-ceo/portas.ts:29-50). Remover as chaves é decisão sua.
3. areas.ts: uma linha removida (item Fila Cella). Nenhuma outra mudança em areas.ts, sidebar, route.tsx, supabase/ ou src/lib/monetizacao.
4. Contratos e churn sem a chave cai em "Nenhum cliente": a RLS devolve vazio e a tela não sabe distinguir. Para mostrar EstadoSemAcesso é preciso publicar a permissão em functions.ts (pendência de 22/09).
5. Componentes genéricos fora do lugar: BotaoComMotivo, FOCO_VISIVEL (monetizacao/common.tsx) e useFocoDeVolta (monetizacao/analysis.tsx) já são usados em /clientes. Proposta: movê-los para src/components/planning/ numa rodada do DS. Panel de monetizacao/common continua usado pelo cockpit-ceo/jev-roteador.tsx.
6. Integração: as seis branches da migração acrescentam no fim do DECISIONS.md (conflito de append). A branch rede também mexe em vitrine.tsx, em outras linhas.
7. Catraca: V6 20→19, V3-matiz 78→66. Travar com design:lint --baseline no merge.
8. Portão: o build precisa de NODE_OPTIONS=--max-old-space-size=8192; o tsc segue com os 7 erros antigos, nenhum em arquivo tocado.
9. Cockpit do CEO (dono: Pedro): /monetizacao e /clientes agora recebem período, responsável, produto e situação na URL, então os destinos com mesmoRecorte: false podem passar o recorte e bater.
10. Pendentes de produto, sem mudança aqui: 5.4 (forma final da Base), 5.5 (guarda de Produtos e listas), Z0 (Matheus como padrão; alternativa "Toda a frente").
