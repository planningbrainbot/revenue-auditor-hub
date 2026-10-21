-- Portal de Faturamento · prazos da higiene na fila da tesouraria (Ana, 21/10/2026).
--
-- Pendência 5 da E1 (e1/pendencias-ana-tesouraria.md): "3 dias para conferir e 1 dia útil para faturar estão bons?".
-- Resposta da Ana (controladoria), 21/10/2026: 2 dias para conferir e 1 dia útil para faturar.
-- Os prazos moram em ops.fat_fila_tesouraria (os contadores e o filtro de higiene) e nos rótulos da tela
-- (src/lib/faturamento/fila.ts):
--   - "Vence em até 3 dias sem nota" vira "Vence em até 2 dias sem nota": pedido sem nota (na fila do Omie, erro,
--     simulado, OS criada ou em conferência) cujo 1º vencimento cai até hoje + 2 dias corridos. A chave passa de
--     vence_3d para vence_2d.
--   - "Parado há mais de 1 dia útil" (parado_1du) não muda.
--
-- Compatibilidade até o app novo entrar no ar (o deploy do app é separado desta migration): o filtro aceita também
-- vence_3d, como sinônimo de vence_2d, e os contadores e itens trazem vence_3d com o mesmo valor de vence_2d. A
-- próxima migration do portal tira o nome antigo.
-- Ensaio (begin … rollback): supabase/gates/20261021_portal_faturamento_respostas_ana.sql
-- Rollback: supabase/rollback/20261021122000_portal_faturamento_prazos_tesouraria_rollback.sql

begin;

CREATE OR REPLACE FUNCTION ops.fat_fila_tesouraria(p_emissora uuid DEFAULT NULL::uuid, p_filtro jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _f jsonb := coalesce(p_filtro, '{}'::jsonb);
  _k text;
  _erros jsonb := '[]'::jsonb;
  _emis uuid[];
  _sit text;
  _hig text;
  _dia date;
  _busca text;
  _busca_doc text;
  _lim int := 300;
  _hoje date;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if cardinality(_e.tesouraria) = 0 then
    raise exception 'Só a tesouraria abre a fila.' using errcode = '42501';
  end if;
  if p_emissora is not null and not p_emissora = any (_e.tesouraria) then
    raise exception 'Esta empresa não está no seu recorte da tesouraria.' using errcode = '42501';
  end if;
  _hoje := receita.fat_hoje();
  _emis := case when p_emissora is null then _e.tesouraria else array[p_emissora] end;
  if jsonb_typeof(_f) <> 'object' then perform receita.fat_recusar(receita.fat_erro(null, 'p_filtro precisa ser um objeto.')); end if;

  for _k in select jsonb_object_keys(_f) loop
    begin
      case _k
        when 'situacao' then
          _sit := _f ->> 'situacao';
          if _sit not in ('para_faturar', 'em_conferencia', 'erro_omie', 'na_fila_omie', 'faturado', 'cancelamento_pedido') then
            raise exception 'situacao'; end if;
        when 'higiene' then
          _hig := _f ->> 'higiene';
          if _hig not in ('erro', 'vence_2d', 'vence_3d', 'parado_1du') then raise exception 'higiene'; end if;
          -- vence_3d: nome antigo (até o app de 21/10 entrar no ar); vale a regra nova de 2 dias.
          if _hig = 'vence_3d' then _hig := 'vence_2d'; end if;
        when 'dia' then _dia := case when _f ->> 'dia' = 'hoje' then _hoje else (_f ->> 'dia')::date end;
        when 'busca' then _busca := nullif(btrim(_f ->> 'busca'), '');
        when 'limite' then _lim := (_f ->> 'limite')::int; if _lim not between 1 and 1000 then raise exception 'limite'; end if;
        else raise exception 'desconhecido';
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlerrm = 'desconhecido' then 'Filtro desconhecido.' else 'Valor inválido.' end);
    end;
  end loop;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;
  _busca_doc := case when char_length(coalesce(receita.fat_documento_normalizar(_busca), '')) >= 3 then receita.fat_documento_normalizar(_busca) end;

  with base as materialized (
    select p.*,
           (p.na_fila_em at time zone 'America/Sao_Paulo')::date as dia_chegada,
           exists (select 1 from integracoes.omie_envios x where x.origem = 'fat_pedido' and x.origem_id = p.id
                     and x.operacao = 'faturar_os' and x.status in ('pendente', 'processando')) as faturando,
           p.status in ('na_fila_omie', 'erro_omie', 'simulado', 'os_criada', 'em_conferencia')
             and p.primeiro_vencimento <= _hoje + 2 as vence_2d,
           p.status in ('os_criada', 'simulado', 'em_conferencia')
             and receita.fat_dias_uteis((p.status_em at time zone 'America/Sao_Paulo')::date, _hoje) > 1 as parado_1du
      from receita.fat_pedidos p
     where p.emissora_id = any (_e.tesouraria) and p.enviado_em is not null
       and (p.status in ('na_fila_omie', 'erro_omie', 'simulado', 'os_criada', 'em_conferencia', 'cancelamento_pedido')
            or (p.status = 'faturado' and (p.faturado_em at time zone 'America/Sao_Paulo')::date = _hoje))
  ), fila as (
    select b.* from base b where b.emissora_id = any (_emis)
  ), filt as (
    select f.* from fila f
     where (_sit is null and f.status <> 'faturado'
            or _sit = 'para_faturar' and f.status in ('os_criada', 'simulado')
            or _sit = f.status)
       and (_hig is null or (_hig = 'erro' and f.status = 'erro_omie') or (_hig = 'vence_2d' and f.vence_2d)
            or (_hig = 'parado_1du' and f.parado_1du))
       and (_dia is null or f.dia_chegada = _dia or (_sit = 'faturado' and (f.faturado_em at time zone 'America/Sao_Paulo')::date = _dia))
       and (_busca is null or f.numero ilike '%' || _busca || '%' or f.tomador_nome ilike '%' || _busca || '%'
            or f.projeto ilike '%' || _busca || '%' or (_busca_doc is not null and f.tomador_documento like '%' || _busca_doc || '%'))
  ), pagina as (
    select f.*,
           row_number() over (order by f.dia_chegada,
             array_position(array['erro_omie', 'cancelamento_pedido', 'em_conferencia', 'os_criada', 'simulado',
                                  'na_fila_omie', 'faturado'], f.status),
             f.primeiro_vencimento, f.numero) as ord
      from filt f
     order by ord
     limit _lim
  )
  select jsonb_build_object(
    'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'apelido', g.apelido, 'modo_omie', g.modo_omie,
               'trabalho', (select count(*) from base b where b.emissora_id = g.id
                             and b.status in ('erro_omie', 'simulado', 'os_criada', 'em_conferencia', 'cancelamento_pedido')),
               'omie', jsonb_build_object('indisponivel', coalesce(s.indisponivel, false), 'motivo', s.motivo,
                                          'bloqueada_ate', s.bloqueada_ate))
             order by g.apelido)
        from organizacao.empresas_grupo g left join integracoes.omie_emissora_estado s on s.emissora_id = g.id
       where g.ativa and g.id = any (_e.tesouraria)), '[]'::jsonb),
    'ritmo', jsonb_build_object(
      'para_faturar', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                 'filtro', '{"situacao": "para_faturar"}'::jsonb)
                         from fila f where f.status in ('os_criada', 'simulado')),
      'em_conferencia', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                   'filtro', '{"situacao": "em_conferencia"}'::jsonb)
                           from fila f where f.status = 'em_conferencia'),
      'faturados_hoje', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                   'filtro', '{"situacao": "faturado", "dia": "hoje"}'::jsonb)
                           from fila f where f.status = 'faturado')),
    'higiene', (select jsonb_build_object('erro', count(*) filter (where f.status = 'erro_omie'),
                                          'vence_2d', count(*) filter (where f.vence_2d),
                                          'vence_3d', count(*) filter (where f.vence_2d),
                                          'parado_1du', count(*) filter (where f.parado_1du)) from fila f),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'numero', f.numero, 'chegou_em', f.na_fila_em, 'dia', f.dia_chegada,
               'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
               'tomador', jsonb_build_object('nome', f.tomador_nome, 'documento', f.tomador_documento,
                                             'situacao_conferida', f.tomador_situacao is not null),
               'servico', jsonb_build_object('descricao', s.descricao, 'codigo', s.codigo),
               'projeto', f.projeto, 'documento', f.documento, 'forma', f.forma, 'parcelas', f.parcelas,
               'valor', f.valor, 'primeiro_vencimento', f.primeiro_vencimento, 'status', f.status,
               'simulacao', f.simulacao, 'faturando', f.faturando, 'conferido_por', receita.fat_pessoa(f.conferido_por),
               'erro_legivel', case when f.status = 'erro_omie' then f.motivo_status end,
               'pipefy_erro', (select y.erro_legivel from integracoes.pipefy_envios y
                                where y.origem = 'fat_pedido' and y.origem_id = f.id and y.status = 'erro'
                                order by y.seq desc limit 1),
               'onde_parou', (select jsonb_build_object('evento', v.evento, 'em', v.em, 'autor', receita.fat_pessoa(v.autor_id),
                                                        'motivo', v.diff ->> 'motivo')
                                from receita.fat_eventos v where v.entidade = 'pedido' and v.entidade_id = f.id
                               order by v.em desc, v.id desc limit 1),
               'proxima_acao', jsonb_build_object(
                 'acao', case when f.faturando then 'aguardar_omie'
                              when f.status = 'erro_omie' then 'reenviar'
                              when f.status = 'cancelamento_pedido' then 'confirmar_cancelamento'
                              when f.status = 'em_conferencia' then 'faturar'
                              when f.status in ('os_criada', 'simulado') then 'conferir'
                              when f.status = 'na_fila_omie' then 'aguardar_omie' end,
                 'data', case when f.status in ('em_conferencia', 'os_criada', 'simulado') then f.primeiro_vencimento end,
                 'desde', f.status_em,
                 'tentar_em', case when f.status = 'na_fila_omie' or f.faturando then (
                   select min(x.proxima_tentativa_em) from integracoes.omie_envios x
                    where x.origem = 'fat_pedido' and x.origem_id = f.id and x.status = 'pendente') end),
               'higiene', jsonb_build_object('erro', f.status = 'erro_omie', 'vence_2d', f.vence_2d, 'vence_3d', f.vence_2d,
                                             'parado_1du', f.parado_1du))
             order by f.ord)
        from pagina f
        join organizacao.empresas_grupo g on g.id = f.emissora_id
        left join receita.fat_servicos s on s.id = f.servico_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_fila', (select count(*) from fila f where f.status <> 'faturado'),
    'lido_em', now())
  into _r;
  return _r;
end $function$;

commit;
