-- Portal de Faturamento · T1b, ajustes (20/10/2026).
--
-- Depende de 20261020120000_portal_faturamento_t1b.sql (aplicada antes). Contrato: e1/API.md, seção "Mudanças".
-- Ensaio e gate (begin … rollback): supabase/gates/20261020_portal_faturamento_t1b_ajustes.sql
-- Rollback: supabase/rollback/20261020170000_portal_faturamento_t1b_ajustes_rollback.sql
--
-- 1. Passagem do conector em ops. O schema integracoes não é exposto no PostgREST (decisão de 20/10/2026), então a
--    edge do conector e a server function da tela (service_role) chamam ops.fat_conector_* e ops.fat_receita_cnpj_gravar,
--    com as mesmas assinaturas e retornos das funções de integracoes. Só o service_role executa (GRANT e conferência do
--    papel no corpo, nas duas pontas); public, anon e authenticated não.
-- 2. CNPJ alfanumérico (IN RFB 2.229/2024, vigente desde julho de 2026): o documento normalizado aceita [0-9A-Z] nas 12
--    primeiras posições e 2 DV numéricos; o DV usa o código ASCII menos 48 com os mesmos pesos do módulo 11. CPF segue
--    só com dígitos. Normalização única (receita.fat_documento_normalizar: maiúsculas, sem pontuação) em toda função que
--    recebe documento, e os checks de receita.fat_pedidos, integracoes.omie_vinculo_cliente e integracoes.receita_cnpj.
--    As funções alteradas são as da T1b com só essas trocas (geradas por script a partir do arquivo da T1b).

begin;

-- =================================================================================================================
-- 1. Documento: normalização, validação e checks
-- =================================================================================================================
create or replace function receita.fat_documento_normalizar(_t text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(_t, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;
comment on function receita.fat_documento_normalizar(text) is
  'Documento normalizado: só letras e dígitos, letras maiúsculas (CNPJ alfanumérico, IN RFB 2.229/2024). Nulo se vazio.';

create or replace function receita.fat_documento_valido(_doc text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  d int[];
  s int;
  r int;
  i int;
  p1 constant int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  p2 constant int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
begin
  if _doc is null then return false; end if;
  if _doc ~ '^[0-9]{11}$' then
    if _doc ~ '^(.)\1{10}$' then return false; end if;
    d := array(select substr(_doc, g, 1)::int from generate_series(1, 11) g);
    s := 0; for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> d[10] then return false; end if;
    s := 0; for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = d[11];
  elsif _doc ~ '^[0-9A-Z]{12}[0-9]{2}$' then
    -- CNPJ alfanumérico (IN RFB 2.229/2024): cada caractere vale o código ASCII menos 48 ('0'..'9' = 0..9,
    -- 'A' = 17 … 'Z' = 42); mesmos pesos e o mesmo módulo 11 do CNPJ numérico. Os 2 DV são sempre dígitos.
    if _doc ~ '^(.)\1{13}$' then return false; end if;
    d := array(select ascii(substr(_doc, g, 1)) - 48 from generate_series(1, 14) g);
    s := 0; for i in 1..12 loop s := s + d[i] * p1[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> d[13] then return false; end if;
    s := 0; for i in 1..13 loop s := s + d[i] * p2[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    return r = d[14];
  end if;
  return false;
end $$;
comment on function receita.fat_documento_valido(text) is
  'CPF (11 dígitos) ou CNPJ (14: 12 letras maiúsculas ou dígitos e 2 DV numéricos, IN RFB 2.229/2024), normalizado '
  'por receita.fat_documento_normalizar, com dígito verificador certo.';

alter table receita.fat_pedidos drop constraint fat_pedidos_documento_tomador;
alter table receita.fat_pedidos add constraint fat_pedidos_documento_tomador check (
  tomador_documento is null
  or (tomador_tipo = 'pj' and tomador_documento ~ '^[0-9A-Z]{12}[0-9]{2}$')
  or (tomador_tipo = 'pf' and tomador_documento ~ '^[0-9]{11}$'));
alter table integracoes.omie_vinculo_cliente drop constraint omie_vinculo_cliente_documento_check;
alter table integracoes.omie_vinculo_cliente add constraint omie_vinculo_cliente_documento_check
  check (documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');
alter table integracoes.receita_cnpj drop constraint receita_cnpj_cnpj_check;
alter table integracoes.receita_cnpj add constraint receita_cnpj_cnpj_check check (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');

comment on column receita.fat_pedidos.tomador_documento is
  'CNPJ (pj: 14 caracteres, 12 letras maiúsculas ou dígitos e 2 DV numéricos, IN RFB 2.229/2024) ou CPF (pf: 11 '
  'dígitos), sem pontuação, normalizado por receita.fat_documento_normalizar.';
comment on column integracoes.omie_vinculo_cliente.documento is
  'CPF (11 dígitos) ou CNPJ (14: alfanumérico desde jul/2026), sem pontuação, letras maiúsculas.';

create or replace function receita.fat_contratos_vigentes(_doc text)
returns table (emissora_id uuid, apelido text, unidade text, numero text, valor_mensal numeric, vigencia_inicial date,
               vigencia_final date, sincronizado_em timestamptz)
language sql stable set search_path = '' as $$
  with mapa as (
    select distinct c.unidade, g.id as emissora_id, g.apelido
      from ops.omie_credentials c
      left join ops.unidades u on u.id = c.unidade_id
      join organizacao.empresas_grupo g
        on g.cnpj = any (array(select receita.fat_documento_normalizar(x)
                                 from regexp_split_to_table(coalesce(u.cnpj, ''), E'[\\n,;]+') x))
        or (c.unidade = 'Planning Partners (Matriz)' and g.id = '769854a7-0b0b-48e2-ace8-9b0636e19a56')
  ), k as (
    -- Documento só com dígitos: pelo índice de cnpj_digitos. Alfanumérico (cnpj_digitos tira as letras): pelo
    -- documento normalizado, numa varredura que só roda quando o documento tem letra.
    select x.* from ops.omie_contratos_servico x where _doc ~ '^[0-9]+$' and x.cnpj_digitos = _doc
    union all
    select x.* from ops.omie_contratos_servico x
     where _doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc
  )
  select m.emissora_id, m.apelido, k.unidade, k.numero, k.valor_mensal, k.vigencia_inicial, k.vigencia_final,
         k.sincronizado_em
    from k join mapa m on m.unidade = k.unidade
   where _doc is not null and k.situacao = '10'
     and (k.vigencia_final is null or k.vigencia_final >= receita.fat_hoje())
$$;

-- =================================================================================================================
-- 2. Funções da T1b que recebem documento (só a normalização e as mensagens mudam)
-- =================================================================================================================

create or replace function ops.fat_tomador(p_documento text, p_emissora uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _doc text := coalesce(receita.fat_documento_normalizar(p_documento), '');
  _tipo text;
  rc integracoes.receita_cnpj;
  _b_id integer;
  _b_razao text;
  _b_uf text;
  _emails jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is not null and not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  _tipo := case char_length(_doc) when 14 then 'pj' when 11 then 'pf' end;
  if _tipo is null or not receita.fat_documento_valido(_doc) then
    return jsonb_build_object('documento', _doc, 'tipo', _tipo, 'valido', false,
      'erro', case when _tipo is null then 'O documento precisa ter 11 dígitos (CPF) ou 14 caracteres (CNPJ).'
                   when _tipo = 'pf' and _doc ~ '[^0-9]' then 'CPF só tem dígitos.'
                   when _tipo = 'pj' and _doc !~ '^[0-9A-Z]{12}[0-9]{2}$' then 'CNPJ: 12 letras ou dígitos e 2 dígitos verificadores no fim.'
                   when _tipo = 'pf' then 'CPF com dígito verificador errado.' else 'CNPJ com dígito verificador errado.' end,
      'nome', null, 'nome_fonte', null, 'municipio', null, 'uf', null, 'situacao', null, 'situacao_desde', null,
      'situacao_fonte', null, 'situacao_consultada_em', null, 'consultar_receita', false, 'emails', '[]'::jsonb,
      'bloqueio', null, 'contratos_outra_emissora', '[]'::jsonb, 'contratos_lidos_em', null, 'base', null);
  end if;

  select * into rc from integracoes.receita_cnpj r where r.cnpj = _doc;
  select x.id, x.razao_social, x.uf into _b_id, _b_razao, _b_uf
    from ops.empresas x where (ops.qb_so_digitos(x.cnpj) = _doc or (_doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc)) order by x.id limit 1;

  select coalesce(jsonb_agg(m.email order by m.ordem, m.email), '[]'::jsonb) into _emails
    from (select e.email, min(e.ordem) as ordem
            from (select lower(btrim(u)) as email, 1 as ordem from unnest(rc.emails) u
                  union all
                  select lower(btrim(x.email_fiscal)), 2 from ops.empresas x
                   where (ops.qb_so_digitos(x.cnpj) = _doc or (_doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc)) and nullif(btrim(x.email_fiscal), '') is not null
                  union all
                  select u, 3 from receita.fat_pedidos p, unnest(p.emails_envio) u
                   where p.tomador_documento = _doc and receita.fat_ve(_e, p)) e
           where receita.fat_email_valido(e.email)
           group by e.email) m;

  return jsonb_build_object(
    'documento', _doc, 'tipo', _tipo, 'valido', true, 'erro', null,
    'nome', coalesce(rc.razao_social, _b_razao),
    'nome_fonte', case when rc.razao_social is not null then 'Receita' when _b_razao is not null then 'base de clientes' end,
    'municipio', rc.municipio, 'uf', coalesce(rc.uf, _b_uf),
    'situacao', rc.situacao, 'situacao_desde', rc.situacao_desde, 'situacao_fonte', rc.fonte,
    'situacao_consultada_em', rc.consultado_em,
    'consultar_receita', _tipo = 'pj' and (rc.cnpj is null or rc.consultado_em < now() - interval '30 days'),
    'emails', _emails,
    'bloqueio', case when receita.fat_bloqueio(_doc) is not null then jsonb_build_object('motivo', receita.fat_bloqueio(_doc)) end,
    'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_doc, p_emissora),
    'contratos_lidos_em', (select max(k.sincronizado_em) from ops.omie_contratos_servico k),
    'base', case when _b_id is not null then jsonb_build_object('empresa_id', _b_id, 'razao_social', _b_razao, 'uf', _b_uf) end);
end $$;

create or replace function ops.fat_pedido_salvar(p_id uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _n receita.fat_pedidos;
  _antes jsonb;
  _erros jsonb := '[]'::jsonb;
  _k text;
  _v jsonb;
  _num numeric;
  _txt text;
  _nova_emissora uuid;
  _apelido text;
  _novo boolean := p_id is null;
  _campos constant text[] := array['emissora_id', 'dono_id', 'tomador_tipo', 'tomador_documento', 'tomador_nome',
    'emails_envio', 'projeto', 'servico_id', 'descricao_nf', 'valor', 'forma', 'parcelas', 'primeiro_vencimento',
    'competencia', 'documento', 'meio', 'departamento', 'observacoes', 'confirmou_emissora'];
  _diff jsonb;
  _parcelas jsonb := '[]'::jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    perform receita.fat_recusar(receita.fat_erro(null, 'p_dados precisa ser um objeto.'));
  end if;
  for _k in select jsonb_object_keys(p_dados) loop
    if not _k = any (_campos) then _erros := _erros || receita.fat_erro(_k, 'Campo desconhecido.'); end if;
  end loop;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  -- Carrega ou cria
  if _novo then
    begin
      _nova_emissora := (p_dados ->> 'emissora_id')::uuid;
    exception when others then
      perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Empresa inválida.'));
    end;
    if _nova_emissora is null then perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Escolha a empresa que fatura.')); end if;
    select g.apelido into _apelido from organizacao.empresas_grupo g where g.id = _nova_emissora and g.ativa;
    if not found then perform receita.fat_recusar(receita.fat_erro('emissora_id', 'Empresa fora do Portal de Faturamento.')); end if;
    if not _nova_emissora = any (_e.papel) then
      raise exception 'Você não pede faturamento pela %.', _apelido using errcode = '42501';
    end if;
    insert into receita.fat_pedidos (emissora_id, solicitante_id, dono_id)
    values (_nova_emissora, _e.uid, case when _nova_emissora = any (_e.dono) then _e.uid end)
    returning * into _p;
    _antes := '{}'::jsonb;
  else
    select * into _p from receita.fat_pedidos where id = p_id for update;
    if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
    if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
    perform receita.fat_exigir(_e, _p, 'editar');
    _antes := to_jsonb(_p);
  end if;
  _n := _p;

  -- Aplica cada campo enviado (erro de formato vira {campo, mensagem})
  foreach _k in array _campos loop
    continue when not p_dados ? _k;
    _v := p_dados -> _k;
    begin
      case _k
        when 'emissora_id' then
          _nova_emissora := (_v #>> '{}')::uuid;
          if _nova_emissora is null then raise exception 'Escolha a empresa que fatura.'; end if;
          if _nova_emissora is distinct from _p.emissora_id then
            if _p.omie_os_codigo is not null then
              raise exception 'A OS % já existe no Omie desta empresa: para trocar a empresa, peça o cancelamento e faça outro pedido.', _p.omie_os_codigo;
            end if;
            select g.apelido into _apelido from organizacao.empresas_grupo g where g.id = _nova_emissora and g.ativa;
            if not found then raise exception 'Empresa fora do Portal de Faturamento.'; end if;
            if not _nova_emissora = any (_e.papel) then
              raise exception 'Você não pede faturamento pela %.', _apelido;
            end if;
            _n.emissora_id := _nova_emissora;
            _n.servico_id := null;
            _n.confirmou_emissora := false;
            if not exists (select 1 from receita.fat_donos d where d.emissora_id = _nova_emissora and d.user_id = _n.dono_id
                                                             and d.papel = 'dono' and d.ativo) then
              _n.dono_id := case when _nova_emissora = any (_e.dono) then _e.uid end;
            end if;
          end if;
        when 'dono_id' then
          _n.dono_id := (_v #>> '{}')::uuid;
        when 'tomador_tipo' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('pj', 'pf') then raise exception 'Use pj ou pf.'; end if;
          _n.tomador_tipo := _txt;
        when 'tomador_documento' then
          _txt := receita.fat_documento_normalizar(_v #>> '{}');
          if _txt is not null and char_length(_txt) not in (11, 14) then
            raise exception 'O documento precisa ter 11 dígitos (CPF) ou 14 caracteres (CNPJ).';
          end if;
          if _txt is not null and char_length(_txt) = 11 and _txt !~ '^[0-9]{11}$' then
            raise exception 'CPF só tem dígitos.';
          end if;
          if _txt is not null and char_length(_txt) = 14 and _txt !~ '^[0-9A-Z]{12}[0-9]{2}$' then
            raise exception 'CNPJ: 12 letras ou dígitos e 2 dígitos verificadores no fim.';
          end if;
          if _txt is distinct from _p.tomador_documento then
            _n.confirmou_emissora := case when p_dados ? 'confirmou_emissora' then _n.confirmou_emissora else false end;
            _n.tomador_municipio := null; _n.tomador_uf := null; _n.tomador_situacao := null;
          end if;
          _n.tomador_documento := _txt;
        when 'tomador_nome' then _n.tomador_nome := nullif(regexp_replace(btrim(_v #>> '{}'), '\s+', ' ', 'g'), '');
        when 'emails_envio' then
          if _v is not null and jsonb_typeof(_v) <> 'null' and jsonb_typeof(_v) <> 'array' then
            raise exception 'Mande uma lista de e-mails.';
          end if;
          _n.emails_envio := coalesce((select array_agg(x.e order by x.o) from (
                               select lower(btrim(t.v)) as e, min(t.o) as o
                                 from jsonb_array_elements_text(coalesce(nullif(_v, 'null'::jsonb), '[]'::jsonb)) with ordinality t(v, o)
                                where btrim(t.v) <> '' group by lower(btrim(t.v))) x), '{}');
        when 'projeto' then _n.projeto := nullif(regexp_replace(btrim(_v #>> '{}'), '\s+', ' ', 'g'), '');
        when 'servico_id' then _n.servico_id := (_v #>> '{}')::uuid;
        when 'descricao_nf' then _n.descricao_nf := nullif(btrim(_v #>> '{}'), '');
        when 'valor' then
          _num := (_v #>> '{}')::numeric;
          if _num is not null and _num <= 0 then raise exception 'O valor precisa ser maior que zero.'; end if;
          if _num is not null and _num <> round(_num, 2) then raise exception 'O valor tem mais de 2 casas decimais.'; end if;
          _n.valor := _num;
        when 'forma' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('avulso', 'parcelado') then raise exception 'Use avulso ou parcelado.'; end if;
          _n.forma := _txt;
        when 'parcelas' then
          _num := (_v #>> '{}')::numeric;
          if _num is not null and (_num <> trunc(_num) or _num < 1 or _num > 36) then
            raise exception 'O número de parcelas vai de 1 a 36.';
          end if;
          _n.parcelas := _num::int;
        when 'primeiro_vencimento' then _n.primeiro_vencimento := (_v #>> '{}')::date;
        when 'competencia' then _n.competencia := date_trunc('month', (_v #>> '{}')::date)::date;
        when 'documento' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('nf', 'recibo', 'nd') then raise exception 'Use nf, recibo ou nd.'; end if;
          _n.documento := _txt;
        when 'meio' then
          _txt := _v #>> '{}';
          if _txt is not null and _txt not in ('boleto', 'pix') then raise exception 'Use boleto ou pix.'; end if;
          _n.meio := _txt;
        when 'departamento' then
          _txt := nullif(btrim(_v #>> '{}'), '');
          if _txt is not null and not exists (select 1 from receita.fat_departamentos d where d.nome = _txt and d.ativo) then
            raise exception 'Departamento fora da lista.';
          end if;
          _n.departamento := _txt;
        when 'observacoes' then _n.observacoes := nullif(btrim(_v #>> '{}'), '');
        when 'confirmou_emissora' then
          if jsonb_typeof(_v) <> 'boolean' then raise exception 'Use true ou false.'; end if;
          _n.confirmou_emissora := (_v)::boolean;
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlstate = 'P0001' then sqlerrm else 'Valor inválido.' end);
    end;
  end loop;

  -- Coerência entre campos
  if _n.forma = 'avulso' then _n.parcelas := 1; end if;
  if _n.tomador_tipo is null and _n.tomador_documento is not null then
    _n.tomador_tipo := case char_length(_n.tomador_documento) when 14 then 'pj' else 'pf' end;
  end if;
  if _n.tomador_documento is not null and _n.tomador_tipo is not null
     and char_length(_n.tomador_documento) <> (case _n.tomador_tipo when 'pj' then 14 else 11 end) then
    if p_dados ? 'tomador_documento' then
      _erros := _erros || receita.fat_erro('tomador_documento', case _n.tomador_tipo when 'pj' then 'CNPJ tem 14 dígitos.' else 'CPF tem 11 dígitos.' end);
    else
      _n.tomador_documento := null;  -- trocou PJ/PF: o documento antigo não serve
    end if;
  end if;
  if p_dados ? 'dono_id' and _n.dono_id is not null
     and not exists (select 1 from receita.fat_donos d where d.emissora_id = _n.emissora_id and d.user_id = _n.dono_id
                                                      and d.papel = 'dono' and d.ativo) then
    _erros := _erros || receita.fat_erro('dono_id', 'Escolha um dono da receita desta empresa.');
  end if;
  if _n.servico_id is not null
     and not exists (select 1 from receita.fat_servicos s where s.id = _n.servico_id and s.emissora_id = _n.emissora_id) then
    _erros := _erros || receita.fat_erro('servico_id', 'Esse serviço não é do catálogo desta empresa.');
  end if;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  -- Nome do tomador: sem nome digitado, vem da Receita ou da base
  if _n.tomador_nome is null and _n.tomador_documento is not null then
    _n.tomador_nome := coalesce((select r.razao_social from integracoes.receita_cnpj r where r.cnpj = _n.tomador_documento),
                                (select x.razao_social from ops.empresas x where (ops.qb_so_digitos(x.cnpj) = _n.tomador_documento
                                         or (_n.tomador_documento ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _n.tomador_documento))
                                  order by x.id limit 1));
  end if;

  -- Devolvido em correção: as parcelas da entrada anterior saem (voltam ao entrar na fila de novo)
  if _p.status = 'devolvido' then
    delete from receita.fat_pedido_parcelas where pedido_id = _p.id;
  end if;

  update receita.fat_pedidos
     set emissora_id = _n.emissora_id, dono_id = _n.dono_id, tomador_tipo = _n.tomador_tipo,
         tomador_documento = _n.tomador_documento, tomador_nome = _n.tomador_nome, emails_envio = _n.emails_envio,
         projeto = _n.projeto, servico_id = _n.servico_id, descricao_nf = _n.descricao_nf, valor = _n.valor,
         forma = _n.forma, parcelas = _n.parcelas, primeiro_vencimento = _n.primeiro_vencimento,
         competencia = _n.competencia, documento = _n.documento, meio = _n.meio, departamento = _n.departamento,
         observacoes = _n.observacoes, confirmou_emissora = _n.confirmou_emissora,
         tomador_municipio = _n.tomador_municipio, tomador_uf = _n.tomador_uf, tomador_situacao = _n.tomador_situacao
   where id = _p.id
  returning * into _n;

  _diff := receita.fat_diff(_antes, to_jsonb(_n), _campos);
  if _novo then
    perform receita.fat_evento_pedido(_n, 'criado', _diff);
  elsif _diff <> '{}'::jsonb then
    perform receita.fat_evento_pedido(_n, 'alterado', _diff);
  end if;

  if _n.valor is not null and _n.parcelas is not null and _n.primeiro_vencimento is not null then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('n', c.n, 'vencimento', c.vencimento, 'valor', c.valor) order by c.n), '[]'::jsonb)
        into _parcelas from receita.fat_parcelas_calcular(_n.valor, _n.parcelas, _n.primeiro_vencimento) c;
    exception when sqlstate '22023' then _parcelas := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object(
    'id', _n.id, 'numero', _n.numero, 'status', _n.status,
    'pendencias', receita.fat_pedido_validar(_n),
    'parcelas', _parcelas,
    'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_n.tomador_documento, _n.emissora_id),
    'bloqueio', case when receita.fat_bloqueio(_n.tomador_documento) is not null
                     then jsonb_build_object('motivo', receita.fat_bloqueio(_n.tomador_documento)) end);
end $$;

create or replace function ops.fat_pedidos(p_filtro jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _e receita.fat_escopo_t;
  _f jsonb := coalesce(p_filtro, '{}'::jsonb);
  _k text;
  _erros jsonb := '[]'::jsonb;
  _sit text[];
  _a_faturar boolean := false;
  _pend text;
  _emis uuid[];
  _dono uuid;
  _mes date;
  _fim date;
  _regua text;
  _sim boolean;
  _busca text;
  _busca_doc text;
  _ordem text;
  _dir text;
  _pag int;
  _pp int;
  _hoje date;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _hoje := receita.fat_hoje();
  if jsonb_typeof(_f) <> 'object' then perform receita.fat_recusar(receita.fat_erro(null, 'p_filtro precisa ser um objeto.')); end if;

  for _k in select jsonb_object_keys(_f) loop
    begin
      case _k
        when 'situacao' then
          _sit := array(select jsonb_array_elements_text(_f -> 'situacao'));
          _a_faturar := 'a_faturar' = any (_sit);
          if exists (select 1 from unnest(_sit) s where s not in ('a_faturar', 'rascunho', 'aguardando_ok', 'devolvido',
               'na_fila_omie', 'simulado', 'erro_omie', 'os_criada', 'em_conferencia', 'faturado', 'recebido', 'em_atraso',
               'cancelamento_pedido', 'cancelado')) then raise exception 'situacao'; end if;
        when 'pendencia' then
          _pend := _f ->> 'pendencia';
          if _pend not in ('ok', 'devolvido', 'erro') then raise exception 'pendencia'; end if;
        when 'emissoras' then _emis := array(select (jsonb_array_elements_text(_f -> 'emissoras'))::uuid);
        when 'dono' then _dono := (_f ->> 'dono')::uuid;
        when 'mes' then _mes := to_date(_f ->> 'mes' || '-01', 'YYYY-MM-DD');
                        if _f ->> 'mes' !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'mes'; end if;
        when 'regua' then
          _regua := _f ->> 'regua';
          if _regua not in ('competencia', 'nota', 'pagamento', 'atraso') then raise exception 'regua'; end if;
        when 'simulacao' then _sim := (_f -> 'simulacao')::boolean;
        when 'busca' then _busca := nullif(btrim(_f ->> 'busca'), '');
        when 'ordem' then
          _ordem := _f ->> 'ordem';
          if _ordem not in ('atualizado', 'valor', 'vencimento', 'numero') then raise exception 'ordem'; end if;
        when 'direcao' then
          _dir := _f ->> 'direcao';
          if _dir not in ('asc', 'desc') then raise exception 'direcao'; end if;
        when 'pagina' then _pag := (_f ->> 'pagina')::int; if _pag < 1 then raise exception 'pagina'; end if;
        when 'por_pagina' then _pp := (_f ->> 'por_pagina')::int; if _pp not between 1 and 200 then raise exception 'por_pagina'; end if;
        else raise exception 'desconhecido';
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlerrm = 'desconhecido' then 'Filtro desconhecido.' else 'Valor inválido.' end);
    end;
  end loop;
  if _regua in ('competencia', 'nota', 'pagamento') and _mes is null then
    _erros := _erros || receita.fat_erro('mes', 'A régua pede o mês (AAAA-MM).');
  end if;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  _fim := (_mes + interval '1 month')::date;
  _ordem := coalesce(_ordem, 'atualizado');
  _dir := coalesce(_dir, case when _ordem = 'vencimento' then 'asc' else 'desc' end);
  _pag := coalesce(_pag, 1);
  _pp := coalesce(_pp, 50);
  _busca_doc := case when char_length(coalesce(receita.fat_documento_normalizar(_busca), '')) >= 3 then receita.fat_documento_normalizar(_busca) end;

  with filt as materialized (
    select p.id, p.numero, p.valor, p.updated_at, p.primeiro_vencimento, pc.pago_mes, pc.atraso
      from receita.fat_pedidos p
      left join lateral (
        select sum(x.valor) filter (where x.situacao = 'pago' and x.pago_em >= _mes and x.pago_em < _fim) as pago_mes,
               sum(x.valor) filter (where x.situacao not in ('pago', 'cancelado') and x.vencimento < _hoje) as atraso
          from receita.fat_pedido_parcelas x where x.pedido_id = p.id) pc on true
     where receita.fat_ve(_e, p)
       and (case when _sit is null then p.status <> 'cancelado'
                 else p.status = any (_sit)
                      or (_a_faturar and not p.simulacao
                          and p.status in ('aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia')) end)
       and (_pend is null
            or (_pend = 'ok' and receita.fat_pend_ok(_e, p))
            or (_pend = 'devolvido' and receita.fat_pend_devolvido(_e, p))
            or (_pend = 'erro' and receita.fat_pend_erro(_e, p)))
       and (_emis is null or p.emissora_id = any (_emis))
       and (_dono is null or p.dono_id = _dono)
       and (_sim is null or p.simulacao = _sim)
       and (_regua is null
            or (_regua = 'competencia' and p.competencia >= _mes and p.competencia < _fim)
            or (_regua = 'nota' and not p.simulacao and p.status <> 'cancelado' and p.faturado_em is not null
                and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date >= _mes
                and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date < _fim)
            or (_regua = 'pagamento' and not p.simulacao and pc.pago_mes is not null)
            or (_regua = 'atraso' and not p.simulacao and p.status in ('faturado', 'em_atraso') and pc.atraso is not null))
       and (_busca is null
            or p.numero ilike '%' || _busca || '%' or p.tomador_nome ilike '%' || _busca || '%'
            or p.projeto ilike '%' || _busca || '%'
            or (_busca_doc is not null and p.tomador_documento like '%' || _busca_doc || '%'))
  ), ordenado as (
    select f.*, row_number() over (order by
       case when _ordem = 'atualizado' and _dir = 'asc' then f.updated_at end asc,
       case when _ordem = 'atualizado' and _dir = 'desc' then f.updated_at end desc,
       case when _ordem = 'valor' and _dir = 'asc' then f.valor end asc nulls last,
       case when _ordem = 'valor' and _dir = 'desc' then f.valor end desc nulls last,
       case when _ordem = 'vencimento' and _dir = 'asc' then f.primeiro_vencimento end asc nulls last,
       case when _ordem = 'vencimento' and _dir = 'desc' then f.primeiro_vencimento end desc nulls last,
       case when _ordem = 'numero' and _dir = 'asc' then f.numero end asc,
       case when _ordem = 'numero' and _dir = 'desc' then f.numero end desc,
       f.numero desc) as ord
      from filt f
  ), pagina as (
    select o.* from ordenado o where o.ord > (_pag - 1) * _pp and o.ord <= _pag * _pp
  )
  select jsonb_build_object(
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'status', p.status, 'simulacao', p.simulacao,
               'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
               'tomador', jsonb_build_object('tipo', p.tomador_tipo, 'documento', p.tomador_documento, 'nome', p.tomador_nome),
               'projeto', p.projeto, 'valor', p.valor,
               'dono', receita.fat_pessoa(p.dono_id), 'solicitante', receita.fat_pessoa(p.solicitante_id),
               'primeiro_vencimento', p.primeiro_vencimento, 'competencia', p.competencia,
               'proximo_passo', receita.fat_proximo_passo(_e, p),
               'atualizado_em', p.updated_at,
               'pago_no_mes', case when _regua = 'pagamento' then f.pago_mes end,
               'em_atraso', case when _regua = 'atraso' then f.atraso end)
             order by f.ord)
        from pagina f
        join receita.fat_pedidos p on p.id = f.id
        join organizacao.empresas_grupo g on g.id = p.emissora_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_recorte', (select count(*) from receita.fat_pedidos p where receita.fat_ve(_e, p)),
    'soma', (select coalesce(sum(f.valor), 0) from filt f),
    'soma_parcelas', case when _regua = 'pagamento' then (select coalesce(sum(f.pago_mes), 0) from filt f)
                          when _regua = 'atraso' then (select coalesce(sum(f.atraso), 0) from filt f) end,
    'pagina', _pag, 'por_pagina', _pp)
  into _r;
  return _r;
end $$;

create or replace function ops.fat_fila_tesouraria(p_emissora uuid default null, p_filtro jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
          if _hig not in ('erro', 'vence_3d', 'parado_1du') then raise exception 'higiene'; end if;
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
             and p.primeiro_vencimento <= _hoje + 3 as vence_3d,
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
       and (_hig is null or (_hig = 'erro' and f.status = 'erro_omie') or (_hig = 'vence_3d' and f.vence_3d)
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
                                          'vence_3d', count(*) filter (where f.vence_3d),
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
               'higiene', jsonb_build_object('erro', f.status = 'erro_omie', 'vence_3d', f.vence_3d, 'parado_1du', f.parado_1du))
             order by f.ord)
        from pagina f
        join organizacao.empresas_grupo g on g.id = f.emissora_id
        left join receita.fat_servicos s on s.id = f.servico_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_fila', (select count(*) from fila f where f.status <> 'faturado'),
    'lido_em', now())
  into _r;
  return _r;
end $$;

create or replace function integracoes.receita_cnpj_gravar(p_cnpj text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _cnpj text := coalesce(receita.fat_documento_normalizar(p_cnpj), '');
  _d jsonb := coalesce(p_dados, '{}'::jsonb);
  _r integracoes.receita_cnpj;
begin
  perform integracoes.fat_exigir_conector();
  if char_length(_cnpj) <> 14 or not receita.fat_documento_valido(_cnpj) then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(_d ->> 'fonte'), '') is null then
    raise exception 'p_dados.fonte é obrigatório.' using errcode = '22023';
  end if;
  if _d ? 'emails' and jsonb_typeof(_d -> 'emails') <> 'array' then
    raise exception 'p_dados.emails precisa ser lista.' using errcode = '22023';
  end if;
  insert into integracoes.receita_cnpj as r
    (cnpj, razao_social, nome_fantasia, situacao, situacao_desde, municipio, uf, emails, fonte, consultado_em)
  values (_cnpj, nullif(btrim(_d ->> 'razao_social'), ''), nullif(btrim(_d ->> 'nome_fantasia'), ''),
          nullif(upper(btrim(_d ->> 'situacao')), ''), nullif(_d ->> 'situacao_desde', '')::date,
          nullif(btrim(_d ->> 'municipio'), ''), nullif(upper(btrim(_d ->> 'uf')), ''),
          coalesce(array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(_d -> 'emails', '[]'::jsonb)) x
                          where receita.fat_email_valido(lower(btrim(x)))), '{}'),
          btrim(_d ->> 'fonte'), coalesce(nullif(_d ->> 'consultado_em', '')::timestamptz, now()))
  on conflict (cnpj) do update
     set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, situacao = excluded.situacao,
         situacao_desde = excluded.situacao_desde, municipio = excluded.municipio, uf = excluded.uf,
         emails = excluded.emails, fonte = excluded.fonte, consultado_em = excluded.consultado_em
  returning r.* into _r;
  return jsonb_build_object('cnpj', _r.cnpj, 'situacao', _r.situacao, 'consultado_em', _r.consultado_em);
end $$;

-- =================================================================================================================
-- 3. Passagem do conector em ops (só service_role)
-- =================================================================================================================

create or replace function ops.fat_conector_credencial(p_emissora uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.omie_credencial(p_emissora);
end $$;
comment on function ops.fat_conector_credencial is
  'Passagem do conector para integracoes.omie_credencial (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_envio_proximos(p_limite integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_envio_proximos(p_limite);
end $$;
comment on function ops.fat_conector_envio_proximos is
  'Passagem do conector para integracoes.fat_envio_proximos (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_envio_resultado(p_envio uuid, p_status text, p_resposta jsonb default null, p_erro_legivel text default null, p_codigos jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_envio_resultado(p_envio, p_status, p_resposta, p_erro_legivel, p_codigos);
end $$;
comment on function ops.fat_conector_envio_resultado is
  'Passagem do conector para integracoes.fat_envio_resultado (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_status_aplicar(p_pedido uuid, p_status jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_status_aplicar(p_pedido, p_status);
end $$;
comment on function ops.fat_conector_status_aplicar is
  'Passagem do conector para integracoes.fat_status_aplicar (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_status_enfileirar(p_emissora uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_status_enfileirar(p_emissora);
end $$;
comment on function ops.fat_conector_status_enfileirar is
  'Passagem do conector para integracoes.fat_status_enfileirar (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_servicos_aplicar(p_emissora uuid, p_catalogo jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_servicos_aplicar(p_emissora, p_catalogo);
end $$;
comment on function ops.fat_conector_servicos_aplicar is
  'Passagem do conector para integracoes.fat_servicos_aplicar (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_pipefy_proximos(p_limite integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.pipefy_envio_proximos(p_limite);
end $$;
comment on function ops.fat_conector_pipefy_proximos is
  'Passagem do conector para integracoes.pipefy_envio_proximos (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_conector_pipefy_resultado(p_envio uuid, p_status text, p_resposta jsonb default null, p_erro_legivel text default null, p_card_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.pipefy_envio_resultado(p_envio, p_status, p_resposta, p_erro_legivel, p_card_id);
end $$;
comment on function ops.fat_conector_pipefy_resultado is
  'Passagem do conector para integracoes.pipefy_envio_resultado (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

create or replace function ops.fat_receita_cnpj_gravar(p_cnpj text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.receita_cnpj_gravar(p_cnpj, p_dados);
end $$;
comment on function ops.fat_receita_cnpj_gravar is
  'Passagem do conector para integracoes.receita_cnpj_gravar (mesma assinatura e retorno), porque o schema integracoes não é exposto no '
  'PostgREST (decisão de 20/10/2026). Só o service_role executa: GRANT e conferência do papel no corpo.';

-- =================================================================================================================
-- 4. Privilégios
-- =================================================================================================================
revoke all on function receita.fat_documento_normalizar(text) from public, anon, authenticated, service_role;

do $grants$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'ops'::regnamespace and p.proname in ('fat_conector_credencial', 'fat_conector_envio_proximos', 'fat_conector_envio_resultado', 'fat_conector_status_aplicar', 'fat_conector_status_enfileirar', 'fat_conector_servicos_aplicar', 'fat_conector_pipefy_proximos', 'fat_conector_pipefy_resultado', 'fat_receita_cnpj_gravar') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $grants$;

-- =================================================================================================================
-- 5. Conferência antes do commit
-- =================================================================================================================
do $conferencia$
declare
  n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace = 'ops'::regnamespace and p.proname in ('fat_conector_credencial', 'fat_conector_envio_proximos', 'fat_conector_envio_resultado', 'fat_conector_status_aplicar', 'fat_conector_status_enfileirar', 'fat_conector_servicos_aplicar', 'fat_conector_pipefy_proximos', 'fat_conector_pipefy_resultado', 'fat_receita_cnpj_gravar') and p.prosecdef
     and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
     and has_function_privilege('service_role', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute');
  if n <> 9 then raise exception 'Ajustes T1b: % de 9 passagens do conector no formato', n; end if;
  if not receita.fat_documento_valido('12ABC34501DE35') or receita.fat_documento_valido('12ABC34501DE36')
     or not receita.fat_documento_valido('49726267000150') then
    raise exception 'Ajustes T1b: validação do CNPJ alfanumérico';
  end if;
end $conferencia$;

commit;
