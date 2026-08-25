-- =====================================================================================
-- 20260826080000_rls_performance_initplan_geral.sql
-- Timestamp 20260826080000: roda ANTES das cinco migrations da Fila Cella (0900xx) de
-- proposito — as policies novas da Fila Cella ja nascem com o wrap `(select can(...))`,
-- entao nao ha nada a corrigir nelas. Nao colide com os slots 20260825HH0000_crm_fabrica_*
-- reservados pela spec-unificacao-repos.md.
--
-- CONSERTA OS 176 AVISOS DE PERFORMANCE DO PROJETO "Ops" (ulgiochewwpmmssksqlw)
--   112 auth_rls_initplan  ·  38 multiple_permissive_policies
--    10 unindexed_foreign_keys  ·   4 duplicate_index
--
-- =====================================================================================
-- §0.1  O QUE ESTA MIGRATION MUDA
-- -------------------------------------------------------------------------------------
-- PARTE A (auth_rls_initplan, 112 avisos) — reescreve TODA policy de `public` que chama
--   auth.uid(), can(), has_role(), is_custom_role() ou current_user_unidade() "solta"
--   dentro do USING/WITH CHECK, envolvendo cada chamada em `( SELECT … )`. Mesma lógica
--   booleana, mesmos papéis, mesmo comando, mesmos grants. Só muda o PLANO: o Postgres
--   passa a avaliar a função uma vez por query (InitPlan) em vez de uma vez por linha.
--
-- PARTE B (unindexed_foreign_keys, 10 avisos) — cria índice para toda FK de `public`
--   cujas colunas não são o prefixo de nenhum índice existente.
--
-- PARTE C (duplicate_index, 4 avisos) — dropa índices estruturalmente idênticos, sempre
--   preservando o que dá suporte a constraint / é PK / é unique / é replica identity.
--
-- PARTE D (multiple_permissive_policies, 38 avisos) — NÃO É EXECUTADA AQUI. Está no
--   apêndice §10 como proposta + query que gera o plano. Motivo em §0.5.
--
-- =====================================================================================
-- §0.2  POR QUE (a mecânica, não a citação de doc)
-- -------------------------------------------------------------------------------------
-- `public.can(_key text)` é `LANGUAGE sql STABLE SECURITY DEFINER` e o corpo é:
--     SELECT COALESCE(bool_or(rp.allowed), false)
--       FROM public.user_roles ur
--       JOIN public.role_permissions rp ON rp.role = ur.role
--      WHERE ur.user_id = auth.uid() AND rp.permission_key = _key
--   (lido na definição de public.can nas migrations do repo)
--
-- Escrita solta no USING, essa função é um qual do Seq Scan: roda o join uma vez POR
-- LINHA VARRIDA. Envolvida em `( SELECT can(…) )` ela vira um SubLink não-correlacionado,
-- que o planner materializa como InitPlan e executa UMA vez por query.
--
-- Isso não é teoria neste banco — já foi medido nele, em 14/08, e está registrado em
-- DECISIONS.md:538-546 do próprio repo:
--   · `v_reconciliacao_mensal` sobre `contas_receber` (~30k linhas):
--       65ms sem RLS  →  1,2s como usuário autenticado (18x), estourando o statement
--       timeout da API em /rede-overview;
--   · o mesmo predicado isolado: 332ms (solto) → 9ms (com `select`) = 36x;
--   · depois do fix (20260814170000_rls_perf_contas_receber.sql): 1,2s → ~130ms.
-- Aquela migration consertou UMA tabela — o próprio cabeçalho dela diz "same unwrapped
-- pattern exists on ~42 other tables … not touched here". Esta conserta o resto. É a
-- mesma transformação, aplicada ao banco inteiro.
--
-- =====================================================================================
-- §0.3  POR QUE ELA É DIRIGIDA PELO CATÁLOGO, E NÃO UMA LISTA DE `ALTER POLICY`
-- -------------------------------------------------------------------------------------
-- HONESTIDADE — ESTE É O PONTO MAIS IMPORTANTE DESTE CABEÇALHO:
-- **NÃO FOI POSSÍVEL LISTAR `pg_policies` NA SESSÃO EM QUE ESTE ARQUIVO FOI ESCRITO.**
-- O conector MCP do Supabase estava fora do ar (`MCP server "claude.ai Supabase" is not
-- connected`; o servidor sequer aparece em `claude mcp list`). O `supabase` CLI local
-- está logado em outra conta, que só enxerga o projeto "CSA OA" (buowabeicxcgclbkdacb) —
-- o Ops não aparece em `supabase projects list`. Não há `.env` com credencial do Ops no
-- clone local, não há `psql` nem runtime de container nesta máquina.
--
-- Sem o catálogo ao vivo, uma lista estática de `ALTER POLICY "nome exato" ON tabela`
-- seria chute — e chute nesse formato ou FALHA EM APLICAR (nome inexistente = erro) ou,
-- pior, deixa policy sem corrigir sem ninguém notar. As duas armadilhas já conhecidas
-- provam a deriva:
--   · `omie_clientes_cadastro` — a policy NÃO se chama "Permission-based read", se chama
--     "Authenticated can read omie_clientes_cadastro" (qual = true);
--   · `omie_clientes` — RLS ligada e ZERO policies.
-- E a deriva é estrutural, não pontual: o histórico de migrations APLICADAS no Ops tem
-- 51 versões e para em 20260619181646, enquanto o repo tem 110 arquivos
-- (spec-unificacao-repos.md:407). Cruzando `Relationships` de
-- src/integrations/supabase/types.ts (39 FKs, arquivo gerado do banco vivo) com os 24
-- `create index` que existem nas migrations, sobrariam ~29 FKs sem índice — mas o
-- advisor acusa 10. Ou seja: ~19 índices existem no banco e em migration nenhuma.
-- Reconstruir o catálogo a partir dos arquivos daria a resposta errada.
--
-- Por isso cada parte abaixo LÊ o catálogo no momento de aplicar e age sobre o que
-- encontrar. É idempotente: rodar duas vezes não muda nada na segunda.
--
-- O QUE ACONTECE COM AS DUAS ARMADILHAS, concretamente — é o teste de fogo do desenho:
--   · `omie_clientes_cadastro`: a policy entra no laço pelo nome REAL que estiver no
--     catálogo, seja ele qual for. Como o `qual` dela é `true`, não há chamada de função,
--     a transformação devolve o mesmo texto, e a policy é PULADA sem `ALTER` e sem erro.
--     Uma lista estática com `ALTER POLICY "Permission-based read" ON omie_clientes_cadastro`
--     teria derrubado a migration inteira aqui.
--   · `omie_clientes`: não tem policy nenhuma, logo não aparece em `pg_policies` e não é
--     tocada. Continua com RLS ligada e zero policies — o gap de RLS é problema de outra
--     migration, e este arquivo não finge resolvê-lo.
--
-- =====================================================================================
-- §0.4  POR QUE ISSO É SEGURO (as travas, em ordem)
-- -------------------------------------------------------------------------------------
-- 1. Roda inteira dentro da transação do migration runner. Qualquer erro = rollback.
-- 2. §1 aborta se qualquer uma das 5 funções da whitelist não for STABLE/IMMUTABLE, ou
--    for set-returning. Envolver em `( SELECT … )` só é neutro para função escalar e
--    estável — a migration se recusa a rodar se essa premissa deixar de valer.
-- 3. §3 faz uma PROVA TEXTUAL por policy: aplica a transformação inversa no texto novo e
--    exige que ele volte a ser byte-a-byte o texto antigo. Se um caractere de lógica
--    tivesse sido perdido, a inversa não bateria e a migration aborta. A única coisa que
--    a transformação pode ter feito é inserir os invólucros.
-- 4. §3 também compara `pg_depend` (pg_policy → pg_proc) antes e depois: o conjunto de
--    funções referenciadas por policy tem de ser idêntico. Nenhuma chamada some, nenhuma
--    aparece.
-- 5. §4 reaplica a transformação em tudo e exige que nada mais mude (idempotência).
-- 6. NENHUM `drop policy` / `create policy`. Só `ALTER POLICY … USING/WITH CHECK`, que
--    não toca em `cmd`, em `TO <roles>`, nem em PERMISSIVE/RESTRICTIVE. Tabela sem policy
--    (ex.: `omie_clientes`) continua sem policy — este arquivo não é o lugar de consertar
--    gap de RLS, e não o faz.
-- 7. Nenhum `drop table`, `delete`, `update` de dado. O único `drop` é de índice
--    comprovadamente duplicado (§6), com quatro guardas.
--
-- =====================================================================================
-- §0.5  O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
-- -------------------------------------------------------------------------------------
-- Não consolida as multiple_permissive_policies. Dois motivos, nessa ordem:
--   (a) SEGURANÇA. Juntar duas policies com OR só preserva a semântica se as duas
--       tiverem o MESMO `cmd`, os MESMOS `roles` e as duas forem PERMISSIVE. Se os roles
--       diferem, o OR AMPLIA acesso para o role mais restrito. Se uma for RESTRICTIVE,
--       ela entra com AND, não com OR, e o OR AMPLIA acesso para todo mundo. Não dá para
--       verificar isso sem ler `pg_policies` — e não deu (§0.3).
--   (b) RETORNO. Os 38 avisos são contados por (tabela, role, cmd), não por tabela: 38
--       avisos podem ser um punhado de tabelas. E depois da PARTE A o custo marginal de
--       N policies permissivas é N InitPlans avaliados UMA vez cada — some no ruído. O
--       que custava caro era cada policy extra multiplicar as chamadas POR LINHA, e é
--       exatamente isso que a PARTE A mata. Consolidar é a parte arriscada e de menor
--       retorno do lote; vira migration própria, depois de ler o catálogo. Ver §10.
--
-- =====================================================================================
-- §0.6  CONVENÇÕES / COMO ENTRAR NO REPO
-- -------------------------------------------------------------------------------------
-- Destino: revenue-auditor-hub/supabase/migrations/
-- Nome:    20260826090000_rls_performance_initplan_geral.sql
--   · > 20260825000000 (exigido; o mais recente hoje é 20260824160000);
--   · 26/08 e não 25/08 de propósito: spec-unificacao-repos.md:351-352 reserva
--     20260825HH0000_crm_fabrica_produto_e_consumo.sql e
--     20260825HH0500_crm_fabrica_views_cross_sell_e_bodra.sql, com HH ainda em aberto.
--     Sair do dia 25 elimina a colisão sem precisar saber qual HH será usado.
-- Ordem da casa (spec-unificacao-repos.md:422): migration COMMITADA e MERGEADA primeiro,
-- APLICADA depois. Este arquivo não deve ser aplicado por agente via `apply_migration`.
-- Vai em branch → PR → merge → aplica.
--
-- ESTE ARQUIVO NÃO FOI EXECUTADO EM LUGAR NENHUM. Não há Postgres local, container nem
-- acesso ao Ops nesta máquina — nem sequer um `psql` para checar sintaxe. Foi revisado
-- linha a linha, não testado. Rodar primeiro numa branch do Supabase (create_branch) ou
-- num Postgres descartável é o caminho certo antes do merge.
-- =====================================================================================


-- =====================================================================================
-- §1 · TRAVA DE PREMISSA — as 5 funções precisam ser escalares e estáveis
-- =====================================================================================
do $trava$
declare
  r        record;
  faltando text[];
begin
  select array_agg(f)
    into faltando
  from unnest(array['can','has_role','is_custom_role','current_user_unidade']) f
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f
  );

  if faltando is not null then
    raise exception
      'Abortado: funcao(oes) esperada(s) nao existe(m) em public: %. O catalogo mudou; revise a whitelist antes de rodar.',
      faltando;
  end if;

  for r in
    select n.nspname, p.proname, p.provolatile, p.proretset,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public'
             and p.proname in ('can','has_role','is_custom_role','current_user_unidade'))
       or (n.nspname = 'auth' and p.proname = 'uid')
  loop
    if r.proretset then
      raise exception
        'Abortado: %.%(%) e set-returning. Envolver em ( SELECT ... ) mudaria a semantica.',
        r.nspname, r.proname, r.args;
    end if;
    if r.provolatile not in ('s','i') then
      raise exception
        'Abortado: %.%(%) e VOLATILE. Envolver em ( SELECT ... ) mudaria quantas vezes ela roda, e portanto o resultado.',
        r.nspname, r.proname, r.args;
    end if;
  end loop;

  raise notice '[1] premissas ok: as 5 funcoes da whitelist sao escalares e STABLE/IMMUTABLE.';
end
$trava$;


-- =====================================================================================
-- §2 · A TRANSFORMAÇÃO, COMO FUNÇÃO (criada aqui, dropada em §9)
-- -------------------------------------------------------------------------------------
-- Recebe o texto deparseado de um qual/with_check e devolve o mesmo texto com as
-- chamadas da whitelist envolvidas em ( SELECT … ). Passos, nesta ordem exata:
--
--   (1) mascara `auth.uid()` quando ele é o 1º argumento de has_role/is_custom_role.
--       Duas consequências: (a) o argumento não é envolvido separadamente — o padrão do
--       repo é `(select has_role(auth.uid(), 'admin'::app_role))`, não um invólucro
--       dentro do outro; (b) o argumento deixa de ter parênteses, então o passo (3) pode
--       usar um padrão SEM aninhamento, que é o que torna a regex auditável a olho.
--   (2) mascara as chamadas JÁ envolvidas (as que vêm logo depois de um SELECT), para
--       não envolver duas vezes. É o que garante idempotência.
--   (3) envolve o que sobrou.
--   (4)(5)(6) desfaz as máscaras.
--
-- As máscaras (ZZQ*/ZZU*/ZZAUID/ZZSAUID) são temporárias e todas desfeitas antes do
-- retorno — nenhuma chega ao banco. O `\m` (início de palavra) impede que `can(` case
-- dentro de `scan(` ou de `ZZUcan(`.
-- =====================================================================================
create or replace function public._zz_wrap_stable_calls(expr text)
returns text
language plpgsql
immutable
as $wrap$
declare
  e  text := expr;
  fn text;
begin
  if e is null then
    return null;
  end if;

  -- (1) auth.uid() como argumento de has_role/is_custom_role: fica nu, sai da conta
  e := regexp_replace(e,
        '(\m(?:public\.)?(?:has_role|is_custom_role)\()auth\.uid\(\)',
        '\1ZZAUID', 'g');
  -- (1b) caso misto: argumento JÁ envolvido volta a ser nu. É neutro — tira um invólucro
  --      escalar de dentro de outro invólucro escalar.
  e := regexp_replace(e,
        '(\m(?:public\.)?(?:has_role|is_custom_role)\()\(\s*SELECT\s+auth\.uid\(\)[^()]*\)',
        '\1ZZAUID', 'gi');

  foreach fn in array array['can','has_role','is_custom_role','current_user_unidade'] loop
    -- (2) mascara as que já estão envolvidas
    e := regexp_replace(e, '(\mSELECT\s+)public\.' || fn || '\(', '\1ZZQ' || fn || '(', 'gi');
    e := regexp_replace(e, '(\mSELECT\s+)'         || fn || '\(', '\1ZZU' || fn || '(', 'gi');
    -- (3) envolve as que sobraram
    e := regexp_replace(e, '(\m(?:public\.)?' || fn || '\([^()]*\))', '( SELECT \1 )', 'g');
    -- (4) desfaz a máscara de (2)
    e := replace(e, 'ZZQ' || fn || '(', 'public.' || fn || '(');
    e := replace(e, 'ZZU' || fn || '(', fn || '(');
  end loop;

  -- (5) auth.uid() avulso (fora de has_role/is_custom_role)
  e := regexp_replace(e, '(\mSELECT\s+)auth\.uid\(\)', '\1ZZSAUID', 'gi');
  e := regexp_replace(e, '\mauth\.uid\(\)', '( SELECT auth.uid() )', 'g');
  e := replace(e, 'ZZSAUID', 'auth.uid()');

  -- (6) desfaz a máscara de (1)
  e := replace(e, 'ZZAUID', 'auth.uid()');

  return e;
end
$wrap$;

-- A máscara do passo (1), isolada. Usada na prova de §3 para comparar os dois lados no
-- mesmo estado (has_role/is_custom_role sem parênteses no argumento).
create or replace function public._zz_mask_uid_arg(expr text)
returns text
language sql
immutable
as $mask$
  select case when expr is null then null else
    regexp_replace(
      regexp_replace(expr,
        '(\m(?:public\.)?(?:has_role|is_custom_role)\()auth\.uid\(\)',
        '\1ZZAUID', 'g'),
      '(\m(?:public\.)?(?:has_role|is_custom_role)\()\(\s*SELECT\s+auth\.uid\(\)[^()]*\)',
      '\1ZZAUID', 'gi')
  end
$mask$;

-- A inversa. Só existe para a prova de §3: remove exatamente — e somente — os invólucros
-- que _zz_wrap_stable_calls insere. Opera com ZZAUID ainda mascarado.
create or replace function public._zz_unwrap_stable_calls(expr text)
returns text
language sql
immutable
as $unwrap$
  select case when expr is null then null else
    replace(
      regexp_replace(expr,
        '\( SELECT ((?:public\.)?(?:can|has_role|is_custom_role|current_user_unidade)\([^()]*\)) \)',
        '\1', 'g'),
      '( SELECT auth.uid() )', 'auth.uid()')
  end
$unwrap$;


-- =====================================================================================
-- §3 · PARTE A — reescreve as policies (auth_rls_initplan, 112 avisos)
-- =====================================================================================
drop table if exists _zz_dep_antes;
drop table if exists _zz_log;

create temp table _zz_dep_antes as
  select d.objid, d.refobjid, d.deptype
  from pg_depend d
  where d.classid    = 'pg_policy'::regclass
    and d.refclassid = 'pg_proc'::regclass;

create temp table _zz_log(
  tabela text,
  policy text,
  campo  text,
  antes  text,
  depois text
);

do $parteA$
declare
  p           record;
  novo_qual   text;
  novo_check  text;
  clausulas   text[];
  n_policies  int := 0;
  n_clausulas int := 0;
begin
  for p in
    select schemaname, tablename, policyname, permissive, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  loop
    novo_qual  := public._zz_wrap_stable_calls(p.qual);
    novo_check := public._zz_wrap_stable_calls(p.with_check);

    if novo_qual  is not distinct from p.qual
   and novo_check is not distinct from p.with_check then
      continue;
    end if;

    ---------------------------------------------------------------------------
    -- PROVA TEXTUAL (trava 3): a inversa do texto novo tem de reproduzir o
    -- texto antigo, byte a byte, com os dois lados no mesmo estado de máscara.
    ---------------------------------------------------------------------------
    if novo_qual is distinct from p.qual then
      if public._zz_unwrap_stable_calls(public._zz_mask_uid_arg(novo_qual))
         is distinct from public._zz_mask_uid_arg(p.qual) then
        raise exception
          'Abortado em %.% (USING): a reescrita nao e reversivel, logo nao e provadamente equivalente. ANTES=[%] DEPOIS=[%]',
          p.tablename, p.policyname, p.qual, novo_qual;
      end if;
    end if;

    if novo_check is distinct from p.with_check then
      if public._zz_unwrap_stable_calls(public._zz_mask_uid_arg(novo_check))
         is distinct from public._zz_mask_uid_arg(p.with_check) then
        raise exception
          'Abortado em %.% (WITH CHECK): a reescrita nao e reversivel, logo nao e provadamente equivalente. ANTES=[%] DEPOIS=[%]',
          p.tablename, p.policyname, p.with_check, novo_check;
      end if;
    end if;

    ---------------------------------------------------------------------------
    -- ALTER POLICY. Só USING/WITH CHECK: cmd, roles e PERMISSIVE ficam intactos.
    ---------------------------------------------------------------------------
    clausulas := array[]::text[];

    if novo_qual is not null and novo_qual is distinct from p.qual then
      clausulas := clausulas || format('using (%s)', novo_qual);
      insert into _zz_log values (p.tablename, p.policyname, 'USING', p.qual, novo_qual);
      n_clausulas := n_clausulas + 1;
    end if;

    if novo_check is not null and novo_check is distinct from p.with_check then
      clausulas := clausulas || format('with check (%s)', novo_check);
      insert into _zz_log values (p.tablename, p.policyname, 'WITH CHECK', p.with_check, novo_check);
      n_clausulas := n_clausulas + 1;
    end if;

    if array_length(clausulas, 1) is null then
      continue;
    end if;

    execute format('alter policy %I on public.%I %s',
                   p.policyname, p.tablename, array_to_string(clausulas, ' '));

    n_policies := n_policies + 1;
    raise notice '[3] % / % (%): reescrita', p.tablename, p.policyname, p.cmd;
  end loop;

  raise notice '[3] % policies reescritas, % clausulas USING/WITH CHECK alteradas.',
               n_policies, n_clausulas;
end
$parteA$;

-- Trava 4: o conjunto de funções referenciadas por policy tem de ser idêntico.
do $dep$
declare
  sumiu    int;
  apareceu int;
begin
  select count(*) into sumiu from (
    select objid, refobjid, deptype from _zz_dep_antes
    except
    select d.objid, d.refobjid, d.deptype
    from pg_depend d
    where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
  ) x;

  select count(*) into apareceu from (
    select d.objid, d.refobjid, d.deptype
    from pg_depend d
    where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
    except
    select objid, refobjid, deptype from _zz_dep_antes
  ) y;

  if sumiu <> 0 or apareceu <> 0 then
    raise exception
      'Abortado: as dependencias policy->funcao mudaram (% sumiram, % apareceram). A reescrita perdeu ou inventou uma chamada.',
      sumiu, apareceu;
  end if;

  raise notice '[3] pg_depend policy->pg_proc identico antes/depois. Nenhuma chamada perdida ou criada.';
end
$dep$;


-- =====================================================================================
-- §4 · IDEMPOTÊNCIA — reaplicar a transformação não pode mudar mais nada
-- =====================================================================================
do $idem$
declare
  restantes int;
begin
  select count(*) into restantes
  from pg_policies
  where schemaname = 'public'
    and (public._zz_wrap_stable_calls(qual)       is distinct from qual
      or public._zz_wrap_stable_calls(with_check) is distinct from with_check);

  if restantes <> 0 then
    raise exception
      'Abortado: % policies ainda mudariam numa segunda passada. A transformacao nao convergiu.',
      restantes;
  end if;

  raise notice '[4] convergiu: nenhuma policy de public tem chamada solta de auth.uid()/can()/has_role()/is_custom_role()/current_user_unidade().';
end
$idem$;


-- =====================================================================================
-- §5 · PARTE B — índice para FK sem índice (unindexed_foreign_keys, 10 avisos)
-- -------------------------------------------------------------------------------------
-- SOBRE `CREATE INDEX CONCURRENTLY`: ele NÃO roda dentro de bloco de transação, e o
-- migration runner do Supabase envolve o arquivo inteiro numa transação. Um
-- `create index concurrently` aqui devolveria
--     ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- e derrubaria a migration inteira. Existem duas saídas: (a) tirar o comando da migration
-- e rodá-lo à mão, fora de transação; ou (b) usar `create index` comum.
--
-- ESCOLHA: (b), e o motivo é o tamanho. O Ops tem 87 MB e 104.298 linhas somando as 97
-- relações; as maiores tabelas envolvidas são `omie_clientes_cadastro` (10.226 linhas),
-- `contas_receber` (~30k) e `empresas` (1.282). Construir um btree nesse porte é ordem de
-- dezenas de milissegundos, e o lock é SHARE — bloqueia escrita, não leitura.
-- `CONCURRENTLY` existe para não segurar escrita por minutos em tabela grande; aqui ele
-- trocaria milissegundos de lock por uma migration que não pode viver no runner. Custo
-- maior que o benefício, hoje. A variante CONCURRENTLY, para quando alguma dessas tabelas
-- crescer, está no §11.
-- =====================================================================================
do $parteB$
declare
  r        record;
  idx_nome text;
  cols_sql text;
  n_criados int := 0;
begin
  for r in
    select c.conname,
           t.relname as tabela,
           (select array_agg(a.attname order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a
                on a.attrelid = c.conrelid and a.attnum = k.attnum) as colunas
    from pg_constraint c
    join pg_class     t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relkind = 'r'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indislive
          and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
          and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] <@ c.conkey
      )
    order by t.relname, c.conname
  loop
    idx_nome := left(format('idx_%s_%s', r.tabela, array_to_string(r.colunas, '_')), 63);

    select string_agg(format('%I', col), ', ' order by ord)
      into cols_sql
      from unnest(r.colunas) with ordinality as u(col, ord);

    execute format('create index if not exists %I on public.%I (%s)',
                   idx_nome, r.tabela, cols_sql);

    n_criados := n_criados + 1;
    raise notice '[5] FK % em % (%) -> criado indice %',
                 r.conname, r.tabela, array_to_string(r.colunas, ','), idx_nome;
  end loop;

  raise notice '[5] % indices de FK criados. O advisor acusava 10.', n_criados;
  if n_criados <> 10 then
    raise notice '[5] NOTA: o numero difere dos 10 do advisor. Nao e erro por si so — o advisor foi lido em outro momento. Confira a lista acima antes do merge.';
  end if;
end
$parteB$;


-- =====================================================================================
-- §6 · PARTE C — índices duplicados (duplicate_index, 4 avisos)
-- -------------------------------------------------------------------------------------
-- "Duplicado" aqui tem definição ESTRITA: mesma tabela, mesmas colunas-chave NA MESMA
-- ORDEM (indkey), mesmas operator classes (indclass), mesmas opções de ordenação
-- (indoption — carrega DESC/NULLS FIRST), mesma collation (indcollation), mesma divisão
-- entre chave e INCLUDE (indnkeyatts), mesma expressão (indexprs), mesmo predicado
-- parcial (indpred) e mesma unicidade (indisunique). Dois índices assim são
-- intercambiáveis: o que sobra atende todo plano que o dropado atendia. Não é inferência
-- sobre nome — é igualdade de definição, campo a campo.
--
-- QUEM FICA, em ordem de prioridade: o que dá suporte a constraint > o PK > o unique >
-- o de menor oid (o mais antigo). QUEM NUNCA É DROPADO: índice de constraint, PK, e o que
-- for REPLICA IDENTITY USING INDEX.
--
-- Esta definição é mais estrita que a do advisor (que compara `indexdef` textual). Se ela
-- pegar menos que 4, o resto fica para inspeção humana — a query do §8.3 lista. Por isso
-- §8 NÃO aborta por duplicado remanescente: derrubar a migration inteira por um índice a
-- mais no banco seria trocar 112 correções por zero.
-- =====================================================================================
do $parteC$
declare
  g      record;
  manter oid;
  vitima record;
  n_dropados int := 0;
begin
  for g in
    select i.indrelid,
           i.indkey::text       as k,
           i.indclass::text     as cls,
           i.indoption::text    as opt,
           i.indcollation::text as coll,
           i.indnkeyatts        as nkey,
           coalesce(pg_get_expr(i.indexprs, i.indrelid), '') as expr,
           coalesce(pg_get_expr(i.indpred,  i.indrelid), '') as pred,
           i.indisunique,
           array_agg(i.indexrelid order by i.indexrelid) as idxs
    from pg_index i
    join pg_class     t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    where i.indislive
    group by 1,2,3,4,5,6,7,8,9
    having count(*) > 1
  loop
    select x.indexrelid
      into manter
    from unnest(g.idxs) as u(indexrelid)
    join pg_index x on x.indexrelid = u.indexrelid
    order by (exists (select 1 from pg_constraint co where co.conindid = x.indexrelid)) desc,
             x.indisprimary desc,
             x.indisunique  desc,
             x.indexrelid   asc
    limit 1;

    for vitima in
      select ci.relname as idx_nome,
             ct.relname as tabela,
             pg_get_indexdef(x.indexrelid) as def,
             x.indisreplident,
             exists (select 1 from pg_constraint co where co.conindid = x.indexrelid) as de_constraint
      from unnest(g.idxs) as u(indexrelid)
      join pg_index x  on x.indexrelid = u.indexrelid
      join pg_class ci on ci.oid = x.indexrelid
      join pg_class ct on ct.oid = x.indrelid
      where x.indexrelid <> manter
    loop
      if vitima.de_constraint then
        raise notice '[6] PULADO % em %: da suporte a constraint.', vitima.idx_nome, vitima.tabela;
        continue;
      end if;
      if vitima.indisreplident then
        raise notice '[6] PULADO % em %: e REPLICA IDENTITY.', vitima.idx_nome, vitima.tabela;
        continue;
      end if;

      raise notice '[6] DROP % em % (identico a %). def: %',
                   vitima.idx_nome,
                   vitima.tabela,
                   (select relname from pg_class where oid = manter),
                   vitima.def;

      execute format('drop index if exists public.%I', vitima.idx_nome);
      n_dropados := n_dropados + 1;
    end loop;
  end loop;

  raise notice '[6] % indices duplicados dropados. O advisor acusava 4.', n_dropados;
end
$parteC$;


-- =====================================================================================
-- §7 · RELATÓRIO — o que mudou, tabela a tabela (aparece no log do apply)
-- =====================================================================================
do $rel$
declare
  r         record;
  n_pol     int;
  n_tabelas int;
begin
  select count(distinct (tabela, policy)), count(distinct tabela)
    into n_pol, n_tabelas
  from _zz_log;

  raise notice '--------------------------------------------------------';
  raise notice ' PARTE A: % policies em % tabelas', n_pol, n_tabelas;
  for r in
    select tabela, count(distinct policy) as policies
    from _zz_log group by tabela order by 2 desc, 1
  loop
    raise notice '   %  (% policies)', rpad(r.tabela, 34), r.policies;
  end loop;
  raise notice '--------------------------------------------------------';
end
$rel$;


-- =====================================================================================
-- §8 · VERIFICAÇÃO
-- -------------------------------------------------------------------------------------
-- §8.0 roda DENTRO da migration e ABORTA se o efeito não estiver lá. As demais são para
-- rodar DEPOIS, no SQL editor, com a migration já aplicada.
-- =====================================================================================

-- §8.0 — dentro da migration
do $verif$
declare
  soltas         int;
  fks_sem_indice int;
  duplicados     int;
  com_select     int;
  total_policies int;
begin
  -- (a) nenhuma policy pode ter chamada solta. Usa a própria transformação como oráculo:
  --     se ela ainda mudaria alguma coisa, é porque sobrou chamada solta.
  select count(*) into soltas
  from pg_policies
  where schemaname = 'public'
    and (public._zz_wrap_stable_calls(qual)       is distinct from qual
      or public._zz_wrap_stable_calls(with_check) is distinct from with_check);

  -- (b) nenhuma FK sem índice
  select count(*) into fks_sem_indice
  from pg_constraint c
  join pg_class     t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'f' and n.nspname = 'public' and t.relkind = 'r'
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and i.indislive
        and (string_to_array(i.indkey::text,' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
        and (string_to_array(i.indkey::text,' ')::int2[])[1:cardinality(c.conkey)] <@ c.conkey
    );

  -- (c) grupos de índice duplicado remanescentes (informativo, não aborta — ver §6)
  select count(*) into duplicados from (
    select 1
    from pg_index i
    join pg_class     t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    where i.indislive
    group by i.indrelid, i.indkey::text, i.indclass::text, i.indoption::text,
             i.indcollation::text, i.indnkeyatts,
             coalesce(pg_get_expr(i.indexprs, i.indrelid),''),
             coalesce(pg_get_expr(i.indpred,  i.indrelid),''),
             i.indisunique
    having count(*) > 1
  ) d;

  -- (d) quantas policies usam o formato ( select … ). ANTES: 1 de 164, medido.
  select count(*) filter (
           where coalesce(qual,'') || ' ' || coalesce(with_check,'')
                 ~* '\mSELECT\s+((public\.)?(can|has_role|is_custom_role|current_user_unidade)|auth\.uid)\('
         ),
         count(*)
    into com_select, total_policies
  from pg_policies where schemaname = 'public';

  raise notice '========================================================';
  raise notice ' VERIFICACAO';
  raise notice '   policies com chamada solta (esperado 0) ....... %', soltas;
  raise notice '   FKs sem indice (esperado 0) .................. %', fks_sem_indice;
  raise notice '   grupos de indice duplicado (informativo) ..... %', duplicados;
  raise notice '   policies no formato ( select ... ) ........... % de %', com_select, total_policies;
  raise notice '========================================================';

  if soltas <> 0 then
    raise exception 'Abortado: % policies ainda com chamada solta.', soltas;
  end if;
  if fks_sem_indice <> 0 then
    raise exception 'Abortado: % FKs ainda sem indice.', fks_sem_indice;
  end if;
end
$verif$;



-- =====================================================================================
-- §8.1 (RODAR DEPOIS, no SQL editor) — nenhuma policy com chamada solta.
-- Esperado: 0 linhas. Mascara auth.uid() dentro de has_role/is_custom_role antes de
-- contar, senão `( SELECT has_role(auth.uid(), 'x') )` daria falso positivo (2 chamadas,
-- 1 precedida de SELECT).
-- -------------------------------------------------------------------------------------
-- with p as (
--   select tablename, policyname, cmd,
--          regexp_replace(coalesce(qual,'') || ' || ' || coalesce(with_check,''),
--            '(\m(public\.)?(has_role|is_custom_role)\()auth\.uid\(\)', '\1ZZ', 'g') as e
--   from pg_policies where schemaname = 'public'
-- )
-- select tablename, policyname, cmd
-- from p
-- where (select count(*) from regexp_matches(e,
--          '\m((public\.)?(can|has_role|is_custom_role|current_user_unidade)|auth\.uid)\(', 'g'))
--     > (select count(*) from regexp_matches(e,
--          '\mSELECT\s+((public\.)?(can|has_role|is_custom_role|current_user_unidade)|auth\.uid)\(', 'gi'))
-- order by tablename, policyname;

-- =====================================================================================
-- §8.2 (RODAR DEPOIS) — advisor do próprio Supabase. É a prova que fecha o círculo.
-- Esperado: auth_rls_initplan 112 -> 0 · unindexed_foreign_keys 10 -> 0 ·
--           duplicate_index 4 -> 0 · multiple_permissive_policies 38 -> 38 (ver §10).
-- -------------------------------------------------------------------------------------
--   MCP: get_advisors(project_id='ulgiochewwpmmssksqlw', type='performance')

-- =====================================================================================
-- §8.3 (RODAR DEPOIS) — índices duplicados que sobraram, para inspeção humana.
-- -------------------------------------------------------------------------------------
-- select ct.relname as tabela,
--        array_agg(ci.relname order by ci.relname) as indices,
--        pg_get_indexdef(min(i.indexrelid)) as def_exemplo
-- from pg_index i
-- join pg_class ci    on ci.oid = i.indexrelid
-- join pg_class ct    on ct.oid = i.indrelid
-- join pg_namespace n on n.oid = ct.relnamespace and n.nspname = 'public'
-- where i.indislive
-- group by ct.relname, i.indrelid, i.indkey::text, i.indclass::text, i.indoption::text,
--          i.indcollation::text, i.indnkeyatts,
--          coalesce(pg_get_expr(i.indexprs, i.indrelid),''),
--          coalesce(pg_get_expr(i.indpred,  i.indrelid),''), i.indisunique
-- having count(*) > 1;

-- =====================================================================================
-- §8.4 (RODAR DEPOIS) — O GANHO, MEDIDO.
-- Precisa de sessão autenticada EMULADA: com `postgres`/`service_role` a RLS é bypassada
-- e o EXPLAIN não mede nada. Rodar ANTES do merge (estado atual) e DEPOIS do apply, e
-- comparar os dois planos.
-- -------------------------------------------------------------------------------------
-- select id, email from auth.users limit 5;     -- pegar um uuid real de um usuário com role
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-de-um-usuario-real>","role":"authenticated"}';
--   explain (analyze, buffers, verbose) select count(*) from public.empresas;
--   explain (analyze, buffers, verbose) select count(*) from public.contratos;
--   explain (analyze, buffers, verbose) select count(*) from public.omie_clientes_cadastro;
-- rollback;
--
-- O QUE OLHAR: no plano de ANTES, as chamadas de can()/has_role() aparecem dentro do
-- `Filter:` do Seq Scan — avaliação por linha. No de DEPOIS, aparecem como
-- `InitPlan N (returns $n)` ACIMA do scan, e o Filter só compara os `$n`.

-- =====================================================================================
-- §8.5 · A ESTIMATIVA DE GANHO — o que é medido e o que é conta
-- -------------------------------------------------------------------------------------
-- MEDIDO NESTE BANCO (DECISIONS.md:538-546, 14/08, tabela `contas_receber`, ~30k linhas):
--   · endpoint real /rede-overview: 1,2s -> ~130ms depois do mesmo fix (9x)
--   · predicado isolado: 332ms -> 9ms (36x)
--   · a mesma query sem RLS nenhuma: 65ms — ou seja, depois do fix a RLS custa ~2x, não 18x
--
-- NÃO VERIFICADO, e por quê: não consegui rodar EXPLAIN em `public.empresas` nesta sessão
-- (§0.3 — sem MCP, sem CLI com acesso ao Ops, sem psql). O número abaixo é CONTA, não
-- medição, e está aqui para ser conferido pelo §8.4, não para ser citado como fato:
--
--   `empresas` tem 1.282 linhas (spec-unificacao-repos.md:124,130) e a policy
--   "Permission-based read" lida em pg_policies em 25/08 é
--       can('view.clientes') OR can('view.painel_cs') OR can('view.base_contatos')
--   Hoje: até 3 × 1.282 = 3.846 execuções de can() por `select * from empresas`, cada uma
--   fazendo o join user_roles ⋈ role_permissions.
--   Depois: 3 execuções, ponto. Fator ~1.282x em NÚMERO DE CHAMADAS.
--   O ganho em TEMPO DE PAREDE é menor que isso (o scan em si continua custando, e o
--   curto-circuito do OR já poupa parte das chamadas hoje) — a ordem de grandeza que os
--   36x medidos sugerem é 1 a 2 ordens, não 3.
--   `empresas` ainda tem policies aditivas de perfil customizado (DECISIONS.md:79), então
--   o número real de chamadas por linha é MAIOR que 3. Quantas exatamente: NÃO VERIFICADO.
--
-- Onde o ganho vai aparecer primeiro: nas tabelas grandes com policy de 3+ termos —
-- `omie_clientes_cadastro` (10.226 linhas), `contas_receber` (~30k, já corrigida em
-- agosto), `contratos` (585, policy de 4 termos). Em tabela de 12 linhas
-- (`ecd_gatilho_def`) o ganho é zero e isso está certo.


-- =====================================================================================
-- §9 · LIMPEZA — nada auxiliar fica no banco
-- =====================================================================================
drop function if exists public._zz_wrap_stable_calls(text);
drop function if exists public._zz_unwrap_stable_calls(text);
drop function if exists public._zz_mask_uid_arg(text);
drop table    if exists _zz_dep_antes;
drop table    if exists _zz_log;


-- =====================================================================================
-- §10 · APÊNDICE — multiple_permissive_policies (38 avisos). PROPOSTA, NÃO EXECUTADA.
-- -------------------------------------------------------------------------------------
-- O advisor conta um aviso por (tabela, role, cmd) com mais de uma policy PERMISSIVE.
-- 38 avisos podem ser bem menos que 38 tabelas: `empresas` sozinha, com 4 policies de
-- SELECT e 2 roles, já rende 8.
--
-- REGRA DE CONSOLIDAÇÃO — só é seguro fundir um grupo em `using (a or b or c)` se:
--   (i)   TODAS as policies do grupo forem PERMISSIVE. Uma RESTRICTIVE entra na expressão
--         com AND; fundir com OR AMPLIA acesso para todo mundo.
--   (ii)  TODAS tiverem exatamente o mesmo `cmd`.
--   (iii) TODAS tiverem exatamente o mesmo conjunto de `roles`. Se os roles diferem, o OR
--         dá ao role mais restrito o acesso do mais amplo. Nesse caso NÃO consolide: ou
--         mantenha separadas, ou reescreva o predicado com o teste de role dentro dele.
-- Fundir violando (i), (ii) ou (iii) é mudança de SEGURANÇA disfarçada de performance.
--
-- Query que lista os grupos E JÁ MONTA o rascunho da policy consolidada:
--
--   select tablename,
--          cmd,
--          roles::text                                as roles,
--          count(*)                                   as qtd,
--          bool_and(permissive = 'PERMISSIVE')        as pode_fundir,
--          array_agg(policyname order by policyname)  as policies_a_dropar,
--          '(' || string_agg('(' || qual || ')', ' or ' order by policyname) || ')'
--                                                     as using_consolidado
--   from pg_policies
--   where schemaname = 'public' and qual is not null
--   group by tablename, cmd, roles::text
--   having count(*) > 1
--   order by count(*) desc, tablename;
--
-- Leia `pode_fundir`: onde vier false, o grupo NÃO pode ser fundido. Onde vier true, o
-- `using_consolidado` é o corpo da policy única — que precisa ser criada com o MESMO
-- `to <roles>` e o MESMO `cmd` do grupo, e as antigas dropadas NA MESMA TRANSAÇÃO.
-- Note que o agrupamento é por `roles::text`: grupos com roles diferentes caem em linhas
-- diferentes de propósito, e cada linha é um candidato independente.
--
-- RECOMENDAÇÃO: migration SEPARADA, depois desta, e só depois de medir. Com a PARTE A
-- aplicada, cada policy extra custa um InitPlan avaliado uma vez — não uma varredura
-- extra. O ganho restante é de organização; o risco é de segurança. Trocar risco de
-- segurança por ganho de organização, no mesmo arquivo que entrega 112 correções sem
-- risco, é diluir a coisa boa.


-- =====================================================================================
-- §11 · APÊNDICE — a variante CONCURRENTLY dos índices de FK
-- -------------------------------------------------------------------------------------
-- Para quando alguma das tabelas crescer a ponto de o lock SHARE do `create index` comum
-- incomodar. NÃO PODE ficar em migration: `CREATE INDEX CONCURRENTLY` não roda dentro de
-- bloco de transação e o runner envolve o arquivo todo numa. Rode à mão, no SQL editor ou
-- via psql, UM COMANDO POR VEZ, fora de transação.
--
-- Passo 1 — gerar a lista (mesma detecção do §5, só imprimindo):
--
--   select format('create index concurrently if not exists %I on public.%I (%s);',
--                 left(format('idx_%s_%s', t.relname,
--                      (select string_agg(a.attname, '_' order by k.ord)
--                         from unnest(c.conkey) with ordinality as k(attnum, ord)
--                         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)), 63),
--                 t.relname,
--                 (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
--                    from unnest(c.conkey) with ordinality as k(attnum, ord)
--                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)) as ddl
--   from pg_constraint c
--   join pg_class t     on t.oid = c.conrelid
--   join pg_namespace n on n.oid = t.relnamespace
--   where c.contype = 'f' and n.nspname = 'public' and t.relkind = 'r'
--     and not exists (
--       select 1 from pg_index i
--       where i.indrelid = c.conrelid and i.indislive
--         and (string_to_array(i.indkey::text,' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
--         and (string_to_array(i.indkey::text,' ')::int2[])[1:cardinality(c.conkey)] <@ c.conkey
--     )
--   order by t.relname;
--
-- Passo 2 — rodar cada linha devolvida, uma por vez.
-- Passo 3 — conferir que nenhum ficou INVALID (CONCURRENTLY que falha deixa índice
--           inválido, que ocupa espaço e não é usado por ninguém):
--
--   select ci.relname, i.indisvalid
--   from pg_index i
--   join pg_class ci    on ci.oid = i.indexrelid
--   join pg_class ct    on ct.oid = i.indrelid
--   join pg_namespace n on n.oid = ct.relnamespace and n.nspname = 'public'
--   where not i.indisvalid;
--
--   Se aparecer alguma linha: `drop index concurrently public.<nome>;` e refazer.
-- =====================================================================================
