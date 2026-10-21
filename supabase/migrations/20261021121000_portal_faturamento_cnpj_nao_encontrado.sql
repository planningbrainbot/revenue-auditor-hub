-- Portal de Faturamento · CNPJ que a Receita não acha bloqueia o envio (Ana, 21/10/2026).
--
-- Pendência 3 da E1 (e1/pendencias-ana-tesouraria.md): "CNPJ não achado na Receita: bloqueia o envio ou só avisa?".
-- Resposta da Ana (controladoria), 21/10/2026: "Aviso que está bloqueado". Até aqui, sem consulta o envio passava
-- como "situação não conferida", e o 404 da CNPJá era tratado como falha da consulta.
--
-- A regra passa a separar dois casos:
--   - A consulta foi feita e a Receita não tem o CNPJ (CNPJá aberta: HTTP 404 "tax id not registered at revenue
--     service"): o servidor grava a consulta com encontrado = false, e o envio é BLOQUEADO com a frase
--     "CNPJ não encontrado na Receita Federal: envio bloqueado. Confira o número." (rascunho continua salvando).
--   - A consulta não foi feita (CNPJá fora do ar, limite de consultas, erro de rede): nada é gravado, o pedido segue
--     com "situação não conferida" e o envio passa, como antes.
--
-- O que muda:
--   1. integracoes.receita_cnpj ganha encontrado (boolean, padrão true). Com encontrado = false, a linha só guarda
--      fonte e data: situação, nome e endereço ficam nulos (check).
--   2. integracoes.receita_cnpj_gravar (e a passagem ops.fat_receita_cnpj_gravar, que só a chama) aceita
--      p_dados.encontrado (booleano; padrão true). Com false, ignora o resto de p_dados. Devolve também encontrado.
--   3. receita.fat_bloqueio devolve a frase do não encontrado. Ela vale onde o bloqueio já valia: pendências do salvar,
--      validação do envio (ops.fat_pedido_enviar, 22023 no campo tomador_documento) e o bloqueio de ops.fat_tomador.
--   4. ops.fat_tomador devolve receita_encontrado (true, false, ou null quando não houve consulta, ou é CPF) e pede
--      consulta nova (consultar_receita) do não encontrado com mais de 1 dia, para um CNPJ recém-aberto não ficar
--      preso por 30 dias. Enquanto a consulta nova não acha, o bloqueio continua.
-- Ensaio (begin … rollback): supabase/gates/20261021_portal_faturamento_respostas_ana.sql
-- Rollback: supabase/rollback/20261021121000_portal_faturamento_cnpj_nao_encontrado_rollback.sql

begin;

-- =================================================================================================================
-- 1. Coluna
-- =================================================================================================================
alter table integracoes.receita_cnpj
  add column encontrado boolean not null default true,
  add constraint receita_cnpj_nao_encontrado_vazio check (
    encontrado or (situacao is null and situacao_desde is null and razao_social is null and nome_fantasia is null
                   and municipio is null and uf is null and logradouro is null and numero is null
                   and complemento is null and bairro is null and cep is null and cardinality(emails) = 0));

comment on column integracoes.receita_cnpj.encontrado is
  'false: a consulta foi feita e a Receita não tem o CNPJ (CNPJá aberta 404 "tax id not registered"). Bloqueia o envio '
  '(Ana, 21/10/2026). CNPJá fora do ar não grava linha: o pedido segue com situação não conferida.';

-- =================================================================================================================
-- 2. Gravação da consulta
-- =================================================================================================================
CREATE OR REPLACE FUNCTION integracoes.receita_cnpj_gravar(p_cnpj text, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _cnpj text := coalesce(receita.fat_documento_normalizar(p_cnpj), '');
  _d jsonb := coalesce(p_dados, '{}'::jsonb);
  _r integracoes.receita_cnpj;
  _enc boolean := true;
  _cep text;
begin
  perform integracoes.fat_exigir_conector();
  if char_length(_cnpj) <> 14 or not receita.fat_documento_valido(_cnpj) then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(_d ->> 'fonte'), '') is null then
    raise exception 'p_dados.fonte é obrigatório.' using errcode = '22023';
  end if;
  if _d ? 'encontrado' then
    if jsonb_typeof(_d -> 'encontrado') <> 'boolean' then
      raise exception 'p_dados.encontrado precisa ser verdadeiro ou falso.' using errcode = '22023';
    end if;
    _enc := (_d ->> 'encontrado')::boolean;
  end if;
  -- Não encontrado: só a fonte e a data valem (o resto é ignorado, e o check da tabela garante).
  if not _enc then
    _d := jsonb_build_object('fonte', _d -> 'fonte', 'consultado_em', _d -> 'consultado_em');
  end if;
  if _d ? 'emails' and jsonb_typeof(_d -> 'emails') <> 'array' then
    raise exception 'p_dados.emails precisa ser lista.' using errcode = '22023';
  end if;
  _cep := nullif(regexp_replace(coalesce(_d ->> 'cep', ''), '[^0-9]', '', 'g'), '');
  if _cep is not null and _cep !~ '^[0-9]{8}$' then
    raise exception 'p_dados.cep: o CEP tem 8 dígitos.' using errcode = '22023';
  end if;
  insert into integracoes.receita_cnpj as r
    (cnpj, razao_social, nome_fantasia, situacao, situacao_desde, municipio, uf, emails, fonte, consultado_em,
     logradouro, numero, complemento, bairro, cep, encontrado)
  values (_cnpj, nullif(btrim(_d ->> 'razao_social'), ''), nullif(btrim(_d ->> 'nome_fantasia'), ''),
          nullif(upper(btrim(_d ->> 'situacao')), ''), nullif(_d ->> 'situacao_desde', '')::date,
          nullif(btrim(_d ->> 'municipio'), ''), nullif(upper(btrim(_d ->> 'uf')), ''),
          coalesce(array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(_d -> 'emails', '[]'::jsonb)) x
                          where receita.fat_email_valido(lower(btrim(x)))), '{}'),
          btrim(_d ->> 'fonte'), coalesce(nullif(_d ->> 'consultado_em', '')::timestamptz, now()),
          nullif(btrim(_d ->> 'logradouro'), ''), nullif(btrim(_d ->> 'numero'), ''),
          nullif(btrim(_d ->> 'complemento'), ''), nullif(btrim(_d ->> 'bairro'), ''), _cep, _enc)
  on conflict (cnpj) do update
     set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, situacao = excluded.situacao,
         situacao_desde = excluded.situacao_desde, municipio = excluded.municipio, uf = excluded.uf,
         emails = excluded.emails, fonte = excluded.fonte, consultado_em = excluded.consultado_em,
         logradouro = excluded.logradouro, numero = excluded.numero, complemento = excluded.complemento,
         bairro = excluded.bairro, cep = excluded.cep, encontrado = excluded.encontrado
  returning r.* into _r;
  return jsonb_build_object('cnpj', _r.cnpj, 'situacao', _r.situacao, 'encontrado', _r.encontrado,
                            'consultado_em', _r.consultado_em);
end $function$;

-- =================================================================================================================
-- 3. Bloqueio
-- =================================================================================================================
CREATE OR REPLACE FUNCTION receita.fat_bloqueio(_doc text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when not r.encontrado
              then 'CNPJ não encontrado na Receita Federal: envio bloqueado. Confira o número.'
              when r.situacao is not null and r.situacao <> 'ATIVA'
              then format('CNPJ %s na Receita%s. O envio fica bloqueado.', r.situacao,
                          case when r.situacao_desde is not null then ' desde ' || to_char(r.situacao_desde, 'DD/MM/YYYY') else '' end)
         end
    from integracoes.receita_cnpj r
   where r.cnpj = _doc
$function$;

comment on function receita.fat_bloqueio(text) is
  'Motivo do bloqueio do envio pela Receita, ou nulo. CNPJ que a consulta não achou (encontrado = false, Ana 21/10/2026) '
  'e CNPJ com situação conhecida diferente de ATIVA (RF-P02, CA-05). Sem consulta no banco: nulo (situação não conferida).';

-- =================================================================================================================
-- 4. ops.fat_tomador: receita_encontrado e reconsulta do não encontrado em 1 dia
-- =================================================================================================================
CREATE OR REPLACE FUNCTION ops.fat_tomador(p_documento text, p_emissora uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _doc text := coalesce(receita.fat_documento_normalizar(p_documento), '');
  _tipo text;
  rc integracoes.receita_cnpj;
  _b_id integer;
  _b_razao text;
  _b_uf text;
  _emails jsonb;
  _ve_pf boolean;
  _ve_email_base boolean;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is not null and not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  -- Sem empresa, só a tesouraria e a controladoria consultam (revisão de 20/10, RNF-06).
  if p_emissora is null and cardinality(_e.tesouraria || _e.controladoria) = 0 then
    raise exception 'Escolha a empresa que fatura antes de buscar o cliente.' using errcode = '42501';
  end if;
  -- Nome de pessoa física da base só para quem tem papel na empresa; e-mail da base só para tesouraria e controladoria.
  _ve_pf := p_emissora is not null and p_emissora = any (_e.papel);
  _ve_email_base := case when p_emissora is null then true else p_emissora = any (_e.tesouraria || _e.controladoria) end;
  _tipo := case char_length(_doc) when 14 then 'pj' when 11 then 'pf' end;
  if _tipo is null or not receita.fat_documento_valido(_doc) then
    return jsonb_build_object('documento', _doc, 'tipo', _tipo, 'valido', false,
      'erro', case when _tipo is null then 'O documento precisa ter 11 dígitos (CPF) ou 14 caracteres (CNPJ).'
                   when _tipo = 'pf' and _doc ~ '[^0-9]' then 'CPF só tem dígitos.'
                   when _tipo = 'pj' and _doc !~ '^[0-9A-Z]{12}[0-9]{2}$' then 'CNPJ: 12 letras ou dígitos e 2 dígitos verificadores no fim.'
                   when _tipo = 'pf' then 'CPF com dígito verificador errado.' else 'CNPJ com dígito verificador errado.' end,
      'nome', null, 'nome_fonte', null, 'municipio', null, 'uf', null, 'situacao', null, 'situacao_desde', null,
      'situacao_fonte', null, 'situacao_consultada_em', null, 'receita_encontrado', null, 'consultar_receita', false,
      'emails', '[]'::jsonb, 'bloqueio', null, 'contratos_outra_emissora', '[]'::jsonb, 'contratos_lidos_em', null,
      'base', null);
  end if;

  select * into rc from integracoes.receita_cnpj r where r.cnpj = _doc;
  select x.id, x.razao_social, x.uf into _b_id, _b_razao, _b_uf
    from ops.empresas x where (ops.qb_so_digitos(x.cnpj) = _doc or (_doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc)) order by x.id limit 1;

  select coalesce(jsonb_agg(m.email order by m.ordem, m.email), '[]'::jsonb) into _emails
    from (select e.email, min(e.ordem) as ordem
            from (select lower(btrim(u)) as email, 1 as ordem from unnest(rc.emails) u
                  union all
                  select lower(btrim(x.email_fiscal)), 2 from ops.empresas x
                   where (ops.qb_so_digitos(x.cnpj) = _doc or (_doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc)) and nullif(btrim(x.email_fiscal), '') is not null and _ve_email_base
                  union all
                  select u, 3 from receita.fat_pedidos p, unnest(p.emails_envio) u
                   where p.tomador_documento = _doc and receita.fat_ve(_e, p)) e
           where receita.fat_email_valido(e.email)
           group by e.email) m;

  return jsonb_build_object(
    'documento', _doc, 'tipo', _tipo, 'valido', true, 'erro', null,
    'nome', coalesce(rc.razao_social, case when _tipo = 'pj' or _ve_pf then _b_razao end),
    'nome_fonte', case when rc.razao_social is not null then 'Receita' when _b_razao is not null and (_tipo = 'pj' or _ve_pf) then 'base de clientes' end,
    'municipio', rc.municipio, 'uf', coalesce(rc.uf, case when _tipo = 'pj' or _ve_pf then _b_uf end),
    'situacao', rc.situacao, 'situacao_desde', rc.situacao_desde, 'situacao_fonte', rc.fonte,
    'situacao_consultada_em', rc.consultado_em,
    'receita_encontrado', case when _tipo = 'pj' then rc.encontrado end,
    'consultar_receita', _tipo = 'pj' and (rc.cnpj is null or rc.consultado_em < now() - interval '30 days'
                                           or (not rc.encontrado and rc.consultado_em < now() - interval '1 day')),
    'emails', _emails,
    'bloqueio', case when receita.fat_bloqueio(_doc) is not null then jsonb_build_object('motivo', receita.fat_bloqueio(_doc)) end,
    'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_doc, p_emissora),
    'contratos_lidos_em', (select max(k.sincronizado_em) from ops.omie_contratos_servico k),
    'base', null);
end $function$;

commit;
