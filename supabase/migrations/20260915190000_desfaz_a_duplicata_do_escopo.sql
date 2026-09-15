-- ────────────────────────────────────────────────────────────────────────────────────────────
-- DESFAZ A MINHA PRÓPRIA DUPLICATA: `public.produto_escopo` sai, `ops.usuario_empresas` fica.
--
-- O QUE ACONTECEU, sem enfeite: às 13h39 de 15/09/2026 eu criei `public.produto_escopo` para
-- guardar o recorte de unidades por pessoa no cockpit. Às 10h21 do MESMO DIA — três horas antes —
-- o dono do Ops já tinha subido `ops.usuario_escopo` + `ops.usuario_empresas` com o mesmo
-- propósito e granularidade mais fina (empresa do grupo, não unidade de navegação). Eu não vi
-- porque estava lendo um checkout local que estava vinte commits atrás do `origin/main`.
--
-- O commit dele declara, na seção Pendente, exatamente a tarefa que eu estava fazendo:
--   "sessoes-irmas.functions.ts ainda monta o escopo do cockpit lendo role_permissions em vez de
--    ops.usuario_empresas."
--
-- Duas tabelas respondendo à mesma pergunta é precisamente a redundância que este trabalho veio
-- evitar. A dele fica, por três motivos e nenhum deles é cortesia:
--   · é mais fina — empresa, não unidade. "Só a Marox" cabe nas duas; "só a PARTNERS dentro da
--     EXPANSÃO" só cabe na dele.
--   · tem a flag `todas_empresas`, que responde "vê tudo" numa linha e continua certa quando uma
--     empresa nova for cadastrada amanhã. A minha lista explícita faria a pessoa PERDER a empresa
--     nova sem ninguém ter mexido.
--   · serve aos dois produtos. A minha era só do Financeiro.
--
-- NINGUÉM PERDE ACESSO NA TROCA: as 23 linhas de `ops.usuario_escopo` estão todas com
-- `todas_empresas = true`, e `usuario_empresas` está vazia. Ou seja, o estado que a tabela dele
-- descreve hoje é "todo mundo vê tudo" — idêntico ao que a minha descrevia com 90 linhas.
--
-- SAI TAMBÉM o seed que fiz em `ops.role_permissions`. Aquela tabela "ficou intacta e deixou de
-- ser consultada" no corte dele: ela é o retrato para rollback. Semear ali agora não liga nada e
-- só deixaria uma linha mentindo para quem for ler.
--
-- FICAM: a área `admin_financeiro`, a chave `admin.acessos.financeiro`, o papel
-- `financeiro_admin` e `ops.can_user`. Nada disso é duplicata — ele não construiu admin delegado.
--
-- REVERSÃO: o `create table` está na migration 20260915170000, parte 3.
-- ────────────────────────────────────────────────────────────────────────────────────────────

-- ── GATE 1 · antes de apagar, PROVE que ninguém perde ──────────────────────────────────────
do $gate$
declare v_perdem text;
begin
  select string_agg(u.email, ', ') into v_perdem
    from (select distinct user_id from public.produto_escopo where produto = 'financeiro') pe
    join auth.users u on u.id = pe.user_id
   where not coalesce((select e.todas_empresas from ops.usuario_escopo e where e.user_id = pe.user_id), false)
     and not exists (select 1 from ops.usuario_empresas ue where ue.user_id = pe.user_id);
  if v_perdem is not null then
    raise exception 'GATE 1 FALHOU: % ficaria(m) sem escopo nenhum ao trocar de tabela. '
                    'Popule ops.usuario_empresas antes de apagar.', v_perdem;
  end if;
  raise notice 'GATE 1 ok · todas as pessoas do produto_escopo estão cobertas pelo modelo do Ops.';
end $gate$;

drop table if exists public.produto_escopo;

delete from ops.role_permissions where permission_key = 'admin.acessos.financeiro';

-- ── GATE 2 · o que FICA continua de pé ─────────────────────────────────────────────────────
do $gate$
declare v_ana uuid; n int;
begin
  select id into v_ana from auth.users where email = 'ana.aguiar@planning.com.br';
  if not ops.can_user(v_ana, 'admin.acessos.financeiro') then
    raise exception 'GATE 2 FALHOU: a ana perdeu a chave ao limpar role_permissions — sinal de que '
                    'a cadeia de áreas não estava sustentando sozinha.';
  end if;
  select count(*) into n from auth.users u where ops.can_user(u.id, 'admin.acessos.financeiro');
  if n <> 3 then raise exception 'GATE 2 FALHOU: % pessoas com a chave (esperado 3).', n; end if;

  -- E a área tem de aparecer para ela pela MESMA cadeia que a lateral lê.
  if not exists (
    select 1 from ops.user_roles ur
      join ops.role_areas ra on ra.role = ur.role and ra.allowed
     where ur.user_id = v_ana and ra.area = 'admin_financeiro') then
    raise exception 'GATE 2 FALHOU: a ana não tem a área admin_financeiro em role_areas — a '
                    'lateral não mostraria o item.';
  end if;
  raise notice 'GATE 2 ok · a ana mantém a chave e a área; 3 pessoas administram.';
end $gate$;

-- ── GATE 3 · a duplicata sumiu mesmo ───────────────────────────────────────────────────────
do $gate$
begin
  if to_regclass('public.produto_escopo') is not null then
    raise exception 'GATE 3 FALHOU: public.produto_escopo ainda existe.';
  end if;
  raise notice 'GATE 3 ok · sobrou uma tabela só respondendo "quais pedaços esta pessoa abre".';
end $gate$;
