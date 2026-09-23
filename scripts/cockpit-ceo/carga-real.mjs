// Carga REAL de Base de clientes e Monetização, somente leitura, para homologar o Cockpit do CEO.
//
// Reproduz o que a tela recebe de `carregarMonetizacao` + `carregarContasBase` no escopo de quem vê
// a rede inteira (super admin), sem a checagem de sessão das RPCs: as mesmas tabelas, o mesmo
// `jsonb_build_object` de `ops.base_unica_catalogo` (copiado da função viva em 22/09) e o mesmo
// `aplicarBase` do app. O resultado fica em memória; quem chama grava só agregados.
import { consultar } from "./brain-ro.mjs";
import { aplicarBase } from "../../src/lib/clientes-base.ts";

const CHAVE = /^[A-Za-z0-9_-]{1,80}$/;
const lista = (chaves) => {
  if (!chaves.every((k) => CHAVE.test(k)))
    throw new Error("Chave de conta fora do formato esperado.");
  return `array[${chaves.map((k) => `'${k}'`).join(",")}]::text[]`;
};

// Cópia literal do corpo de ops.base_unica_catalogo, sem o filtro de sessão e de escopo.
const CATALOGO = (chaves) =>
  `select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end])),'[]') as base from ops.base_conta_estado a where a.key = any(${lista(chaves)})`;

export async function carregarBaseReal({ lote = 1000 } = {}) {
  const tempos = {};
  const medir = async (nome, fn) => {
    const t = performance.now();
    const r = await fn();
    tempos[nome] = (tempos[nome] ?? 0) + Math.round(performance.now() - t);
    return r;
  };
  const q = (sql, o) => consultar(sql, o);

  const [unidades, cobertura, deals, sync, planos, forecasts, envios, listas, itens] = await medir(
    "tabelas_monetizacao",
    () =>
      Promise.all([
        q(
          "select key, unidade_id, nome, classification from ops.monetizacao_unidades order by key",
        ),
        q(
          "select key, contas, cnpjs, cnpjs_pipefy, cnpjs_omie, omie_integrado from ops.monetizacao_unidade_cobertura order by key",
        ),
        q("select id, payload from ops.monetizacao_deals order by id"),
        q("select status, measured_at, catalog_at, error, stages from ops.monetizacao_sync"),
        q("select payload from ops.monetizacao_planos order by month"),
        q("select payload from ops.monetizacao_forecasts"),
        q("select account_key, product, status, deal_id from ops.monetizacao_envios"),
        q("select * from ops.monetizacao_listas order by created_at"),
        q("select * from ops.monetizacao_itens order by id"),
      ]),
  );

  const contas = [];
  for (let after = null; ;) {
    if (after && !CHAVE.test(after)) throw new Error("Chave de paginação inválida.");
    const pagina = await medir("contas", () =>
      q(
        `select key, perfil, unidade_ids from ops.monetizacao_contas ${after ? `where key > '${after}'` : ""} order by key limit ${lote}`,
      ),
    );
    contas.push(...pagina);
    if (pagina.length < lote) break;
    after = pagina.at(-1).key;
  }

  const catalogo = new Map();
  for (let i = 0; i < contas.length; i += lote) {
    const chaves = contas.slice(i, i + lote).map((c) => c.key);
    const [linha] = await medir("catalogo", () =>
      q(CATALOGO(chaves), { transacaoSomenteLeitura: true }),
    );
    for (const b of linha.base) catalogo.set(b.key, b);
  }

  const accounts = contas.map((a) => ({
    ...aplicarBase(a.perfil, catalogo.get(a.key)),
    unit_ids: a.unidade_ids ?? [],
  }));
  const sincronia = sync[0] ?? {};
  const units = unidades.map((u) => {
    const c = cobertura.find((x) => x.key === u.key);
    return {
      id: u.unidade_id,
      key: u.key,
      name: u.nome,
      classification: u.classification,
      // A mesma regra de use-monetizacao.ts.
      account_keys: accounts
        .filter((a) =>
          u.unidade_id
            ? a.unit_ids.includes(u.unidade_id)
            : a.units.includes(u.key) || a.unit_label === u.nome,
        )
        .map((a) => a.key),
      cnpjs: c?.cnpjs ?? 0,
      cnpjs_pipefy: c?.cnpjs_pipefy ?? 0,
      cnpjs_omie: c?.cnpjs_omie ?? 0,
      omie_integrado: c?.omie_integrado ?? false,
    };
  });

  const base = {
    base_count: accounts.length,
    forecasts: forecasts.map((f) => f.payload),
    reservations: envios,
    accounts,
    units,
    cards: deals.map((d) => d.payload),
    lists: listas.map((l) => ({ ...l, items: itens.filter((i) => i.list_id === l.id) })),
    plans: planos.map((p) => p.payload),
    records: [],
    measured_at: sincronia.measured_at ? new Date(sincronia.measured_at).toISOString() : null,
    catalog_at: sincronia.catalog_at ? new Date(sincronia.catalog_at).toISOString() : null,
    sync_status: sincronia.status ?? "pending",
    sync_error: sincronia.error ?? null,
    stages: sincronia.stages ?? [],
    permissions: { view: true, manage: true, send: true, all_units: true },
  };
  return {
    base,
    tempos,
    contagem: {
      contas: accounts.length,
      semCatalogo: contas.filter((c) => !catalogo.has(c.key)).length,
    },
  };
}
