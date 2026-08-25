-- ============================================================================
-- 20260826094000_v_fila_cella.sql
--
-- Migration 5 de 5 da spec-tela-fila-cella.md v0.3 (§4.2). Depende de #1, #2 e #3.
--
-- A view existe para que `tem_ecd`, `forca`, `frente` e o score nao sejam
-- materializados em duas rotinas diferentes. `security_invoker = true`: ela
-- respeita a RLS de quem consulta, nao a do dono.
--
-- Custo: le 57 linhas de fila contra 404 + 1.236 + 14.321, com indice parcial em
-- (cnpj, ano) where abs(valor) >= 1. Nenhuma federacao, nenhum RTT de 370 ms.
--
-- O score continua sendo calculado tambem em fila-cella.functions.ts (spec §7.1)
-- para o caminho de escrita e para o export; a view e a leitura, e as duas
-- transcrevem a mesma formula — se divergirem, a formula da FUNCAO e a canonica,
-- porque e onde a D1 vai bater.
--
-- LIMITE CONHECIDO: o exercicio esta fixo em 2024 no join com `sinal`. E o unico
-- exercicio que existe hoje (ecd_0000 tem DT_INI 01012024 e DT_FIN 31122024 e um
-- unico exercicio). Quando o Bodra entregar 2025, ESTA LINHA e o ponto de troca.
-- ============================================================================
create or replace view public.v_fila_cella with (security_invoker = true) as
with gat as (
  select g.cnpj, g.ano,
         count(distinct g.gatilho)                          as n_gatilhos,
         bool_or(d.dispara_forte)                           as tem_gatilho_forte,
         sum(abs(g.valor)) filter (where g.gatilho = 'T1')  as folha,
         -- o gatilho principal e a frente saem do MESMO registro: precedencia de
         -- frente (Contencioso > Transacao > Tese, spec §6.3 coluna 10) e, dentro
         -- dela, maior valor. Sem isso a tela mostra "Folha" como gatilho e
         -- "Transacao" como frente, que nao conversam.
         (array_agg(g.gatilho    order by (case d.frente when 'Contencioso' then 0
                                                         when 'Transação'  then 1
                                                         when 'Tese'       then 2
                                                         else 9 end), abs(g.valor) desc))[1] as gatilho_principal,
         (array_agg(d.nome       order by (case d.frente when 'Contencioso' then 0
                                                         when 'Transação'  then 1
                                                         when 'Tese'       then 2
                                                         else 9 end), abs(g.valor) desc))[1] as gatilho_principal_nome,
         (array_agg(d.frente     order by (case d.frente when 'Contencioso' then 0
                                                         when 'Transação'  then 1
                                                         when 'Tese'       then 2
                                                         else 9 end), abs(g.valor) desc))[1] as frente_sugerida,
         (array_agg(abs(g.valor) order by (case d.frente when 'Contencioso' then 0
                                                         when 'Transação'  then 1
                                                         when 'Tese'       then 2
                                                         else 9 end), abs(g.valor) desc))[1] as gatilho_principal_valor
    from public.ecd_gatilho_conta g
    join public.ecd_gatilho_def   d on d.gatilho = g.gatilho
   where abs(g.valor) >= 1              -- corta ruido de centavos
   group by 1,2
),
sinal as (
  select e.cnpj, e.ano, e.razao_social_ecd, e.uf as uf_ecd, e.receita_operacional,
         e.curva_ecd, e.cobertura_nomes,
         (select count(*) from public.empresa_consumo ec
           where ec.cnpj = e.cnpj and ec.ano = e.ano)  as n_categorias,
         coalesce(g.n_gatilhos,0) as n_gatilhos, g.tem_gatilho_forte, g.folha,
         g.gatilho_principal, g.gatilho_principal_nome, g.gatilho_principal_valor,
         g.frente_sugerida,
         -- FORCA — regra (a) de casa_ecd.py:88-94, que e a que a D1 tem de
         -- confirmar. NULL quando nao ha gatilho nenhum: "sem forca" e "forca
         -- fraca" sao coisas diferentes. Note a dependencia circular declarada:
         -- a regra da folha depende da receita, e 202 dos 404 nao tem receita —
         -- nunca chegam a Forte por ela.
         case when coalesce(g.n_gatilhos,0) = 0                          then null
              when g.tem_gatilho_forte                                   then 'Forte'
              when e.receita_operacional > 0
               and g.folha / e.receita_operacional > 0.10                then 'Forte'
              when g.n_gatilhos >= 3                                     then 'Moderado'
              else                                                            'Fraco'
         end as forca_apurada
    from public.ecd_empresa e
    left join gat g on g.cnpj = e.cnpj and g.ano = e.ano
),
ciclo as (
  select c.conta_id, c.id as ciclo_id, c.numero, c.frente, c.bloqueado_ate, c.recusa_explicita,
         (select count(*)    from public.fila_cella_toques t where t.ciclo_id = c.id) as toques,
         (select max(t.data) from public.fila_cella_toques t where t.ciclo_id = c.id) as ultimo_toque
    from public.fila_cella_ciclos c
   where c.status = 'aberto'
),
base as (
  select f.id, f.pipedrive_deal_id, f.org_id_pipedrive, f.procedencia, f.lista, f.titulo,
         -- empresas.razao_social e lixo em ~24 das 55 linhas ('.', '0', '1', '-'),
         -- por isso o fallback e obrigatorio (spec §5.6 no 6).
         -- CORRECAO CONTRA A SPEC v0.3: ela escreve
         --   coalesce(nullif(btrim(f.razao_social),''), s.razao_social_ecd)
         -- que so pega string VAZIA. Os quatro valores que a propria spec nomeia
         -- ('.', '0', '1', '-') passam intactos e vao para a tela como se fossem
         -- razao social. Provado em PG 18.3 local: com razao_social='.', a view
         -- devolvia '.'. O regex exige duas letras seguidas para considerar que
         -- ha nome; abaixo disso, cai no nome da ECD.
         coalesce(nullif(case when f.razao_social ~ '[[:alpha:]]{2}'
                              then btrim(f.razao_social) end, ''),
                  s.razao_social_ecd)                                as razao_social,
         f.cnpj_principal, f.segmento, f.segmento_prioritario,
         f.faixa_declarada, f.curva_declarada, s.curva_ecd, s.receita_operacional,
         f.regime_tributario, f.opcao_simples_receita, f.elegivel,
         coalesce(f.uf, s.uf_ecd) as uf, f.unidade, f.dono_conta, f.mrr, f.cliente_desde, f.avisos,
         coalesce(o.relacionamento,'Não verificado')   as relacionamento,
         o.relacionamento_resposta, o.relacionamento_em, o.papel_decisao,
         coalesce(o.urgencia,false)                    as urgencia,
         coalesce(o.estagio,'1 Base elegível')         as estagio,
         coalesce(o.conflito_interno,false)            as conflito_interno,
         o.proximo_passo, o.proximo_passo_em, o.motivo_perda,
         coalesce(o.frente_escolhida, s.frente_sugerida) as frente,
         coalesce(o.forca_override,  s.forca_apurada)    as forca,
         (o.forca_override is not null)                  as forca_tem_override,
         o.forca_motivo,
         s.gatilho_principal, s.gatilho_principal_nome, s.gatilho_principal_valor,
         s.n_gatilhos, s.n_categorias, s.cobertura_nomes,
         cl.ciclo_id, cl.numero as ciclo_num, cl.frente as ciclo_frente,
         cl.toques, cl.ultimo_toque, cl.bloqueado_ate, cl.recusa_explicita,
         -- OS CINCO ESTADOS DE ECD. O boolean `tem_ecd` da v0.2 modelava dois; o
         -- §6.7 exige tres; a medicao de 25/08 achou cinco casos reais distintos.
         case
           when f.cnpj_principal is null            then 'sem_cnpj'
           when s.cnpj is null                      then 'sem_ecd'
           when s.cobertura_nomes = 'ausente'       then 'ecd_sem_nome_de_conta'
           when coalesce(s.n_gatilhos,0) = 0
            and coalesce(s.n_categorias,0) = 0      then 'ecd_sem_sinal'
           else                                          'ecd_com_sinal'
         end as ecd_estado
    from public.fila_cella_contas f
    left join public.fila_cella_conta_operacao o on o.conta_id = f.id
    left join sinal s  on s.cnpj = f.cnpj_principal and s.ano = 2024
    left join ciclo cl on cl.conta_id = f.id
)
select b.*,
       -- SCORE, transcrito da celula B2 do xlsx (build_planilha.py:115-120), com
       -- duas diferencas deliberadas: (a) 'Alerta aberto' vira coluna booleana
       -- `vetado` + score NULL, em vez da string "FORA" num campo numerico — e
       -- veto absoluto, nao nota; (b) `score_comparavel` expoe em coluna a
       -- armadilha que o §6.4 documenta em tooltip.
       (b.relacionamento = 'Alerta aberto') as vetado,
       case when b.relacionamento = 'Alerta aberto' then null else
            (case upper(left(coalesce(b.curva_declarada,''),1))
                  when 'A' then 3 when 'B' then 2 else 1 end)
          + (case when b.segmento_prioritario then 2 else 0 end)
          + (case b.forca when 'Forte' then 3 when 'Moderado' then 2
                          when 'Fraco' then 1 else 0 end)
          + (case when b.urgencia then 3 else 0 end)
       end::smallint                                        as score,
       (b.ecd_estado = 'ecd_com_sinal')                     as score_comparavel,
       -- LEFT($C2,1) do Excel faz "A · regime?" valer 3 igual a "A" homologada.
       -- O rotulo carrega a ressalva; o score ignora. Por isso o chip existe.
       (b.curva_declarada = 'A'
        and coalesce(b.regime_tributario,'') <> 'Lucro Real')  as curva_a_sem_lucro_real,
       (b.curva_declarada is not null and b.curva_ecd is not null
        and b.curva_declarada <> b.curva_ecd)                  as curva_diverge,
       (b.ultimo_toque is not null and b.ultimo_toque < current_date - 15) as esfriando,
       (b.proximo_passo_em is not null and b.proximo_passo_em < current_date) as passo_vencido,
       (b.bloqueado_ate is not null and b.bloqueado_ate > current_date)       as reentrada_bloqueada
  from base b
 -- ORDENACAO PADRAO = a regra de 5 chaves que o Matheus ja opera
 -- (build_planilha.py:107-109), com o veto na frente. Contradiz README.md:11
 -- ("curva -> segmento -> MRR"), que descreve a v1. Isto e a v2. Ver D5.
 order by (b.relacionamento = 'Alerta aberto'),
          (b.ecd_estado <> 'ecd_com_sinal'),
          case b.forca when 'Forte' then 0 when 'Moderado' then 1
                       when 'Fraco' then 2 else 3 end,
          coalesce(b.curva_declarada,'Z'),
          (not b.segmento_prioritario),
          b.mrr desc nulls last;

comment on view public.v_fila_cella is
  'Leitura da Fila Cella. security_invoker: respeita a RLS de quem consulta. Junta a camada apurada, a operada, o ciclo aberto e o sinal de ECD (exercicio 2024). O score e o mesmo de build_planilha.py:115-120, com Alerta aberto virando veto (score NULL) em vez da string FORA.';

-- A view herda a RLS das tabelas base por security_invoker; o GRANT ainda e
-- necessario para que `authenticated` consiga referenciar o objeto.
grant select on public.v_fila_cella to authenticated;
grant select on public.v_fila_cella to service_role;
