-- Hunter Sócio: o sócio vê as vendas que a unidade dele fechou pelo pipe "Negociação - Sócios" (pipeline 4 do
-- Pipedrive). Pedido do Eliezek em 02/10/2026: "preciso trazer para a visão do sócio quantos clientes ele vendeu,
-- página chamada Hunter Sócio".
--
-- Decisões do Eliezek em 02/10/2026:
--   1. O grão é a UNIDADE. O dono do deal no Pipedrive só é o sócio quando ele mesmo criou o deal: dos 203 ganhos do
--      pipe 4, 115 estão no nome do Paulo, dono do token da integração (cargas e deals criados pela apuração).
--   2. Venda sem "Unidade de Negócio" no Pipedrive (54 das 203) cai na unidade do dono do deal quando ele é sócio de
--      uma unidade em ops.socios (Adílio, Maceió; Rogério, Curitiba; Wirlon, São Luis). As outras ficam de fora.
--      A inferência vale só para esta tela: contratos.unidade não muda, e royalties, CAC e carteira seguem iguais.
--
--   a. contratos.pipedrive_owner_email: e-mail do dono do deal. O pipedrive-contratos-sync passa a gravar; aqui vai a
--      carga dos 203 deals ganhos do pipe 4 lidos da API v2 em 02/10/2026.
--   b. view v_hunter_socio, com a trava dentro (views de postgres não herdam RLS, feedback_view_nao_herda_rls): quem
--      tem recorte de unidade só vê a sua; a matriz precisa de view.hunter_socio ou view.unidades_rede.
--   c. view.hunter_socio na área minha_unidade.

-- a. Dono do deal -----------------------------------------------------------------------------------------------------
alter table ops.contratos add column if not exists pipedrive_owner_email text;
comment on column ops.contratos.pipedrive_owner_email is
  'E-mail do dono do deal no Pipedrive (user_id). Gravado pelo pipedrive-contratos-sync. Não é o vendedor: deal criado por carga fica no nome do dono do token.';

update ops.contratos c
   set pipedrive_owner_email = v.email
  from (values
    ('17187', 'paulo.carvalho@planning.com.br'),
    ('17188', 'paulo.carvalho@planning.com.br'),
    ('17189', 'paulo.carvalho@planning.com.br'),
    ('17190', 'paulo.carvalho@planning.com.br'),
    ('17201', 'paulo.carvalho@planning.com.br'),
    ('17208', 'paulo.carvalho@planning.com.br'),
    ('17389', 'paulo.carvalho@planning.com.br'),
    ('24826', 'paulo.carvalho@planning.com.br'),
    ('24827', 'paulo.carvalho@planning.com.br'),
    ('24834', 'jordana.vieira@planning.com.br'),
    ('24838', 'paulo.carvalho@planning.com.br'),
    ('25175', 'paulo.carvalho@planning.com.br'),
    ('25176', 'paulo.carvalho@planning.com.br'),
    ('25355', 'paulo.carvalho@planning.com.br'),
    ('25430', 'paulo.carvalho@planning.com.br'),
    ('25537', 'paulo.carvalho@planning.com.br'),
    ('25553', 'paulo.carvalho@planning.com.br'),
    ('25868', 'paulo.carvalho@planning.com.br'),
    ('40725', 'paulo.carvalho@planning.com.br'),
    ('40789', 'paulo.carvalho@planning.com.br'),
    ('41742', 'jordana.vieira@planning.com.br'),
    ('42770', 'paulo.carvalho@planning.com.br'),
    ('43938', 'paulo.carvalho@planning.com.br'),
    ('52681', 'paulo.carvalho@planning.com.br'),
    ('52690', 'paulo.carvalho@planning.com.br'),
    ('54532', 'paulo.carvalho@planning.com.br'),
    ('54889', 'mateus.nunes@planning.com.br'),
    ('54998', 'paulo.carvalho@planning.com.br'),
    ('55064', 'jordana.vieira@planning.com.br'),
    ('55892', 'paulo.carvalho@planning.com.br'),
    ('55893', 'paulo.carvalho@planning.com.br'),
    ('55895', 'paulo.carvalho@planning.com.br'),
    ('60329', 'jordana.vieira@planning.com.br'),
    ('60333', 'paulo.carvalho@planning.com.br'),
    ('60404', 'paulo.carvalho@planning.com.br'),
    ('60408', 'paulo.carvalho@planning.com.br'),
    ('60409', 'paulo.carvalho@planning.com.br'),
    ('60450', 'paulo.carvalho@planning.com.br'),
    ('60520', 'paulo.carvalho@planning.com.br'),
    ('61010', 'jordana.vieira@planning.com.br'),
    ('62312', 'jordana.vieira@planning.com.br'),
    ('62314', 'jordana.vieira@planning.com.br'),
    ('62316', 'jordana.vieira@planning.com.br'),
    ('62832', 'jordana.vieira@planning.com.br'),
    ('62844', 'jordana.vieira@planning.com.br'),
    ('62845', 'eduardo.borsoi@planning.com.br'),
    ('63034', 'jordana.vieira@planning.com.br'),
    ('63134', 'jordana.vieira@planning.com.br'),
    ('63139', 'jordana.vieira@planning.com.br'),
    ('63335', 'jordana.vieira@planning.com.br'),
    ('63576', 'rogerio.carvalho@br.planning.com.br'),
    ('63578', 'rogerio.carvalho@br.planning.com.br'),
    ('63653', 'jordana.vieira@planning.com.br'),
    ('63870', 'rogerio.carvalho@br.planning.com.br'),
    ('64128', 'jordana.vieira@planning.com.br'),
    ('64313', 'jordana.vieira@planning.com.br'),
    ('64518', 'jordana.vieira@planning.com.br'),
    ('64519', 'jordana.vieira@planning.com.br'),
    ('64635', 'eduardo.borsoi@planning.com.br'),
    ('64636', 'eduardo.borsoi@planning.com.br'),
    ('64637', 'eduardo.borsoi@planning.com.br'),
    ('64638', 'eduardo.borsoi@planning.com.br'),
    ('66378', 'jordana.vieira@planning.com.br'),
    ('68731', 'rogerio.carvalho@br.planning.com.br'),
    ('68732', 'rogerio.carvalho@br.planning.com.br'),
    ('68735', 'rogerio.carvalho@br.planning.com.br'),
    ('68736', 'rogerio.carvalho@br.planning.com.br'),
    ('68739', 'rogerio.carvalho@br.planning.com.br'),
    ('69388', 'mateus.nunes@planning.com.br'),
    ('69420', 'jordana.vieira@planning.com.br'),
    ('69422', 'jordana.vieira@planning.com.br'),
    ('69469', 'jordana.vieira@planning.com.br'),
    ('70772', 'jordana.vieira@planning.com.br'),
    ('70879', 'rogerio.carvalho@br.planning.com.br'),
    ('72014', 'rogerio.carvalho@br.planning.com.br'),
    ('74105', 'rogerio.carvalho@br.planning.com.br'),
    ('74862', 'rogerio.carvalho@br.planning.com.br'),
    ('75508', 'rogerio.carvalho@br.planning.com.br'),
    ('75966', 'rogerio.carvalho@br.planning.com.br'),
    ('77798', 'rogerio.carvalho@br.planning.com.br'),
    ('77799', 'rogerio.carvalho@br.planning.com.br'),
    ('78935', 'rogerio.carvalho@br.planning.com.br'),
    ('79064', 'rogerio.carvalho@br.planning.com.br'),
    ('80966', 'rogerio.carvalho@br.planning.com.br'),
    ('83998', 'rogerio.carvalho@br.planning.com.br'),
    ('84054', 'rogerio.carvalho@br.planning.com.br'),
    ('86150', 'jeure.souza@grupoplanning.com.br'),
    ('86592', 'adilio.mello@grupoplanning.com.br'),
    ('86611', 'adilio.mello@grupoplanning.com.br'),
    ('86667', 'adilio.mello@grupoplanning.com.br'),
    ('86746', 'adilio.mello@grupoplanning.com.br'),
    ('86748', 'adilio.mello@grupoplanning.com.br'),
    ('86753', 'adilio.mello@grupoplanning.com.br'),
    ('86812', 'rogerio.carvalho@br.planning.com.br'),
    ('87397', 'rogerio.carvalho@br.planning.com.br'),
    ('89040', 'adilio.mello@grupoplanning.com.br'),
    ('89940', 'adilio.mello@grupoplanning.com.br'),
    ('89942', 'adilio.mello@grupoplanning.com.br'),
    ('90536', 'adilio.mello@grupoplanning.com.br'),
    ('90566', 'adilio.mello@grupoplanning.com.br'),
    ('90631', 'erlon.silva@planning.com.br'),
    ('91267', 'adilio.mello@grupoplanning.com.br'),
    ('91572', 'adilio.mello@grupoplanning.com.br'),
    ('91864', 'adilio.mello@grupoplanning.com.br'),
    ('91998', 'paulo.carvalho@planning.com.br'),
    ('91999', 'paulo.carvalho@planning.com.br'),
    ('92000', 'paulo.carvalho@planning.com.br'),
    ('92002', 'paulo.carvalho@planning.com.br'),
    ('92012', 'adilio.mello@grupoplanning.com.br'),
    ('92013', 'adilio.mello@grupoplanning.com.br'),
    ('92060', 'paulo.carvalho@planning.com.br'),
    ('92061', 'paulo.carvalho@planning.com.br'),
    ('92062', 'paulo.carvalho@planning.com.br'),
    ('92063', 'paulo.carvalho@planning.com.br'),
    ('92064', 'paulo.carvalho@planning.com.br'),
    ('92065', 'paulo.carvalho@planning.com.br'),
    ('92066', 'paulo.carvalho@planning.com.br'),
    ('92067', 'paulo.carvalho@planning.com.br'),
    ('92068', 'paulo.carvalho@planning.com.br'),
    ('92069', 'paulo.carvalho@planning.com.br'),
    ('92070', 'paulo.carvalho@planning.com.br'),
    ('92071', 'paulo.carvalho@planning.com.br'),
    ('92072', 'paulo.carvalho@planning.com.br'),
    ('92073', 'paulo.carvalho@planning.com.br'),
    ('92074', 'paulo.carvalho@planning.com.br'),
    ('92075', 'paulo.carvalho@planning.com.br'),
    ('92076', 'paulo.carvalho@planning.com.br'),
    ('92077', 'paulo.carvalho@planning.com.br'),
    ('92078', 'paulo.carvalho@planning.com.br'),
    ('92079', 'paulo.carvalho@planning.com.br'),
    ('92080', 'paulo.carvalho@planning.com.br'),
    ('92081', 'paulo.carvalho@planning.com.br'),
    ('92082', 'paulo.carvalho@planning.com.br'),
    ('92083', 'paulo.carvalho@planning.com.br'),
    ('92084', 'paulo.carvalho@planning.com.br'),
    ('92085', 'paulo.carvalho@planning.com.br'),
    ('92086', 'paulo.carvalho@planning.com.br'),
    ('92087', 'paulo.carvalho@planning.com.br'),
    ('92088', 'paulo.carvalho@planning.com.br'),
    ('92089', 'paulo.carvalho@planning.com.br'),
    ('92090', 'paulo.carvalho@planning.com.br'),
    ('92091', 'paulo.carvalho@planning.com.br'),
    ('92527', 'adilio.mello@grupoplanning.com.br'),
    ('92534', 'adilio.mello@grupoplanning.com.br'),
    ('92535', 'adilio.mello@grupoplanning.com.br'),
    ('92635', 'paulo.carvalho@planning.com.br'),
    ('92636', 'paulo.carvalho@planning.com.br'),
    ('92637', 'paulo.carvalho@planning.com.br'),
    ('92638', 'paulo.carvalho@planning.com.br'),
    ('92639', 'paulo.carvalho@planning.com.br'),
    ('92640', 'paulo.carvalho@planning.com.br'),
    ('92641', 'paulo.carvalho@planning.com.br'),
    ('92642', 'paulo.carvalho@planning.com.br'),
    ('92643', 'paulo.carvalho@planning.com.br'),
    ('92644', 'paulo.carvalho@planning.com.br'),
    ('92645', 'paulo.carvalho@planning.com.br'),
    ('92646', 'paulo.carvalho@planning.com.br'),
    ('92647', 'paulo.carvalho@planning.com.br'),
    ('92648', 'paulo.carvalho@planning.com.br'),
    ('92649', 'paulo.carvalho@planning.com.br'),
    ('92650', 'paulo.carvalho@planning.com.br'),
    ('92651', 'paulo.carvalho@planning.com.br'),
    ('92652', 'paulo.carvalho@planning.com.br'),
    ('92653', 'paulo.carvalho@planning.com.br'),
    ('92654', 'paulo.carvalho@planning.com.br'),
    ('92655', 'paulo.carvalho@planning.com.br'),
    ('92656', 'paulo.carvalho@planning.com.br'),
    ('92657', 'paulo.carvalho@planning.com.br'),
    ('92658', 'paulo.carvalho@planning.com.br'),
    ('92659', 'paulo.carvalho@planning.com.br'),
    ('92660', 'paulo.carvalho@planning.com.br'),
    ('92661', 'paulo.carvalho@planning.com.br'),
    ('92662', 'paulo.carvalho@planning.com.br'),
    ('92663', 'paulo.carvalho@planning.com.br'),
    ('92664', 'paulo.carvalho@planning.com.br'),
    ('92665', 'paulo.carvalho@planning.com.br'),
    ('92666', 'paulo.carvalho@planning.com.br'),
    ('92667', 'paulo.carvalho@planning.com.br'),
    ('92668', 'paulo.carvalho@planning.com.br'),
    ('92669', 'paulo.carvalho@planning.com.br'),
    ('92670', 'paulo.carvalho@planning.com.br'),
    ('92671', 'paulo.carvalho@planning.com.br'),
    ('92672', 'paulo.carvalho@planning.com.br'),
    ('92673', 'paulo.carvalho@planning.com.br'),
    ('92674', 'paulo.carvalho@planning.com.br'),
    ('92675', 'paulo.carvalho@planning.com.br'),
    ('92676', 'paulo.carvalho@planning.com.br'),
    ('92691', 'paulo.carvalho@planning.com.br'),
    ('92692', 'paulo.carvalho@planning.com.br'),
    ('93810', 'paulo.carvalho@planning.com.br'),
    ('93963', 'adilio.mello@grupoplanning.com.br'),
    ('94238', 'adilio.mello@grupoplanning.com.br'),
    ('94362', 'adilio.mello@grupoplanning.com.br'),
    ('94365', 'adilio.mello@grupoplanning.com.br'),
    ('94366', 'adilio.mello@grupoplanning.com.br'),
    ('94500', 'adilio.mello@grupoplanning.com.br'),
    ('96024', 'adilio.mello@grupoplanning.com.br'),
    ('96025', 'adilio.mello@grupoplanning.com.br'),
    ('98051', 'rogerio.carvalho@br.planning.com.br'),
    ('98269', 'wirlon.dutra@grupoplanning.com.br')
  ) v(deal, email)
 where c.pipedrive_deal_id = v.deal
   and c.pipedrive_owner_email is distinct from v.email;

-- b. A view -----------------------------------------------------------------------------------------------------------
create or replace view ops.v_hunter_socio as
with base as (
  select c.id as contrato_id,
         c.pipedrive_deal_id,
         c.empresa_id,
         c.titulo as cliente,
         c.ganho_em,
         c.mrr_mensal,
         c.status_contrato,
         c.unidade as unidade_pipedrive,
         coalesce(c.unidade, ud.nome_da_praca) as unidade,
         (c.unidade is null and ud.id is not null) as unidade_inferida,
         s.nome_completo as socio_dono
    from ops.contratos c
    left join ops.socios s on c.pipedrive_owner_email is not null
                          and lower(s.email) = lower(c.pipedrive_owner_email)
    left join ops.unidades ud on ud.id = s.unidade_id
   where c.origem_pipeline = 'socios'
)
select b.*
  from base b
 where b.unidade is not null
   and (
     (select auth.role()) is distinct from 'authenticated'
     or (
       ((select ops.can('view.hunter_socio')) or (select ops.can('view.unidades_rede')))
       and (
         not (select ops.can('data.scope.own_unit_only'))
         or nullif(ops.norm_unidade(b.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'))
       )
     )
   );

grant select on ops.v_hunter_socio to authenticated;

-- c. A chave ----------------------------------------------------------------------------------------------------------
insert into ops.area_chaves (area, permission_key) values ('minha_unidade', 'view.hunter_socio')
on conflict do nothing;
