-- Durante "ver como", as chaves passam a ser as do papel simulado.
--
-- O que apareceu. Em 23/09/2026, simulando o sócio de Fortaleza, a aba CAC do
-- /broker mostrava R$ 103.818 cobrados e R$ 78.361 a pagar. Esses números são
-- de MACEIÓ. Fortaleza tem R$ 17.230,63 cobrados e R$ 0,63 a pagar.
--
-- A causa. `v_broker_cac_saldo` tem uma porta de admin no escopo:
--
--   where u.paga_cac and (ops.can('view.broker_admin')
--     or ops.can('view.broker') and u.id in (select ops.minhas_unidades()))
--
-- A migration de ontem fez a simulação valer em `minhas_unidades()`, mas quem
-- simula continua sendo super admin, então `can('view.broker_admin')` é
-- verdadeiro, a primeira condição já resolve e a view devolve as 8 unidades. O
-- componente pega a primeira linha, e a primeira linha era Maceió. O mesmo
-- valia para `v_broker_cac_extrato` (93 linhas de 5 unidades), para
-- `v_broker_cac_fila` (33 de 4) e para `v_cac_funil`.
--
-- Por que consertar em `can()` e não nas quatro views. A porta de admin é um
-- padrão da casa, não um descuido dessas views: "quem enxerga a rede vê tudo,
-- o resto vê a própria unidade" está escrito em dezenas de lugares. Emendar as
-- quatro deixaria a quinta nascer com o mesmo furo. E há um argumento mais
-- forte: o front JÁ troca as chaves pelas do papel simulado desde 18/09
-- (`getMyPermissions` monta a sessão com `acesso_do_papel`). O banco continuava
-- respondendo com as chaves do super admin, então as duas camadas discordavam
-- sobre quem era a pessoa. Esta migration faz o banco concordar com a tela.
--
-- O enxerto vai em `ops.can()` e NUNCA em `ops.can_user(uid, key)`. `can()`
-- pergunta "eu posso", e durante a simulação o "eu" é o papel vestido.
-- `can_user` pergunta "fulano pode", que é outra coisa: é o que as telas de
-- administração usam para montar o acesso de terceiros, e simular não pode
-- mudar a resposta sobre outra pessoa.
--
-- Consequência, dita de frente: enquanto a simulação está ligada, você perde as
-- chaves de admin na plataforma inteira, em todas as abas, e não só no broker.
-- É o ponto da feature. A saída é um clique na tarja, e nenhuma trava depende
-- de `can()` para sair: `ver_como_encerrar()` só confere `auth.uid()`.

set search_path = ops, public;

-- ─────────────────────────────────────────────────────────────
-- 1. O que um PAPEL alcança, chave a chave
-- ─────────────────────────────────────────────────────────────
-- `acesso_do_papel()` já responde isso, mas devolvendo o jsonb inteiro com
-- todas as áreas e chaves. Serve para montar a sessão uma vez; não serve para
-- rodar dentro de policy, onde a pergunta é por uma chave só e acontece muitas
-- vezes por consulta. Mesmos joins, um EXISTS no lugar de dois array_agg.
create or replace function ops.papel_tem_chave(_papel text, _key text)
returns boolean
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    when _papel is null then false
    -- Escopo, não permissão, e não vive em role_areas: a simulação é sempre de
    -- UMA unidade, então quem está simulando está limitado a ela por definição,
    -- qualquer que seja o papel vestido. É isto que fecha as 31 policies que
    -- perguntam por esta chave.
    when _key = 'data.scope.own_unit_only' then true
    else exists (
      select 1
        from ops.role_areas  ra
        join ops.areas       a  on a.slug  = ra.area and a.ativa
        join ops.area_chaves ac on ac.area = ra.area
       where ra.role = _papel
         and ra.allowed
         and ac.permission_key = _key
    )
  end
$function$;

comment on function ops.papel_tem_chave(text, text) is
  'Uma chave de permissão pertence a um papel? Usada pelo can() durante "ver como".';

-- ─────────────────────────────────────────────────────────────
-- 2. can() veste o papel simulado
-- ─────────────────────────────────────────────────────────────
-- Fora da simulação o texto é o mesmo de antes, delegando para can_user.
create or replace function ops.can(_key text)
returns boolean
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    when ops.ver_como_ativa() then
      ops.papel_tem_chave(
        (select v.papel from ops.ver_como v where v.user_id = auth.uid()),
        _key)
    else ops.can_user(auth.uid(), _key)
  end
$function$;

revoke execute on function ops.papel_tem_chave(text, text) from public, anon;
grant execute on function ops.papel_tem_chave(text, text) to authenticated;

notify pgrst, 'reload schema';
