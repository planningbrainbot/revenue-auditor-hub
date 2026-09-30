import { aplicarBase, type BaseEmpresa } from "../clientes-base";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { oferta } from "./model";
import type {
  BaseMonetizacao,
  Conta,
  DrivaRecord,
  ItemLista,
  Lista,
  Negocio,
  Plano,
  Registro,
} from "./types";

// O schema é explícito: o banco único é o único destino desta integração.
// Tipos dessas tabelas serão incorporados à próxima geração global do Database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
async function check(db: DB, key: string) {
  const { data, error } = await db.schema("ops").rpc("monetizacao_can", { _key: key });
  if (error) throw new Error("A integração do Aquário não está disponível no banco configurado.");
  return data === true;
}
async function all(db: DB, table: string, columns: string, order: string) {
  const rows: DB[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await db
      .schema("ops")
      .from(table)
      .select(columns)
      .order(order)
      .range(page * 500, page * 500 + 499);
    if (error)
      throw new Error(
        "Não foi possível carregar " +
          table.replace("monetizacao_", "") +
          ". Atualize para tentar novamente.",
      );
    rows.push(...data);
    if (data.length < 500) return rows;
  }
  throw new Error("Consulta excedeu o limite de segurança. Nenhum total parcial foi exibido.");
}
/**
 * A leitura sem o transporte: a tela e o servidor da conversa do Cockpit do CEO usam a mesma regra,
 * com a sessão da pessoa.
 */
export async function lerMonetizacao(context: { supabase: unknown }): Promise<BaseMonetizacao> {
  const db = context.supabase as DB;
  const [aquario, operation, manage, send, scope, clients] = await Promise.all([
    check(db, "view.aquario"),
    check(db, "view.monetizacao"),
    check(db, "manage.aquario"),
    check(db, "send.monetizacao"),
    (db as DB).schema("ops").rpc("monetizacao_scope", { _ids: [] }),
    check(db, "view.clientes"),
  ]);
  if (!aquario && !operation && !clients)
    throw new Error(
      "Seu acesso não inclui Clientes/Aquário ou Monetização. A administração da plataforma controla esse acesso.",
    );
  const [units, cobertura, cards, lists, items, health, plans, records, reservations, forecasts] =
    await Promise.all([
      all(db, "monetizacao_unidades", "key,unidade_id,nome,classification", "key"),
      all(
        db,
        "monetizacao_unidade_cobertura",
        "key,contas,cnpjs,cnpjs_pipefy,cnpjs_omie,omie_integrado",
        "key",
      ),
      all(db, "monetizacao_deals", "id,payload", "id"),
      all(db, "monetizacao_listas", "*", "created_at"),
      all(db, "monetizacao_itens", "*", "id"),
      all(db, "monetizacao_sync", "status,measured_at,catalog_at,error,stages", "id"),
      all(db, "monetizacao_planos", "payload", "month"),
      all(db, "monetizacao_registros", "id,kind,title,body,updated_at", "updated_at"),
      all(db, "monetizacao_envios", "account_key,product,status,deal_id", "id"),
      all(db, "monetizacao_forecasts", "payload", "id"),
    ]);
  const { data: catalog, error: catalogError } = await (db as DB)
    .schema("ops")
    .rpc("base_carteira_manifesto");
  if (catalogError) throw new Error("Não foi possível conferir a base e seu escopo atual.");
  const sync = health[0];
  return {
    base_count: catalog.count,
    catalog_pages: catalog.pages,
    scope_signature: catalog.scope_signature,
    forecasts: forecasts.map((f) => f.payload) as BaseMonetizacao["forecasts"],
    reservations: reservations as BaseMonetizacao["reservations"],
    accounts: [],
    units: units.map((u) => {
      const c = cobertura.find((x) => x.key === u.key);
      return {
        id: u.unidade_id,
        key: u.key,
        name: u.nome,
        classification: u.classification,
        account_keys: [],
        // Cobertura vem do banco (ops.monetizacao_unidade_cobertura): CNPJs distintos é o
        // tamanho da carteira; Pipefy e Omie dizem de onde ela é conhecida. Sem isso o card
        // afirma censo com um número que só cobre o que foi conciliado.
        cnpjs: (c?.cnpjs as number) ?? 0,
        cnpjs_pipefy: (c?.cnpjs_pipefy as number) ?? 0,
        cnpjs_omie: (c?.cnpjs_omie as number) ?? 0,
        omie_integrado: (c?.omie_integrado as boolean) ?? false,
      };
    }),
    cards: cards.map((d) => d.payload as Negocio),
    lists: lists.map((l) => ({
      ...l,
      items: items.filter((i) => i.list_id === l.id) as ItemLista[],
    })) as Lista[],
    plans: plans.map((p) => p.payload) as Plano[],
    records: records as Registro[],
    measured_at: sync?.measured_at || null,
    catalog_at: catalog.catalog_at,
    // Antes da migration 20260928200000 o manifesto não traz `sinais`: a tela diz "sem carga".
    sinais_at: {
      tratativas: catalog.sinais?.tratativas ?? null,
      consultoria: catalog.sinais?.consultoria ?? null,
    },
    sync_status: sync?.status || "pending",
    sync_error: sync?.error || null,
    stages: sync?.stages || [],
    permissions: { view: operation, manage, send, all_units: scope.data === true },
  };
}

export const carregarMonetizacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerMonetizacao(context));

// Paginação no transporte evita estourar o limite de resposta do servidor.
// A interface só publica a contagem depois de carregar todas as páginas.
export interface PaginaContasBase {
  accounts: (Conta & { unit_ids: number[] })[];
  next: string | null;
  catalog_at: string | null;
  scope_signature: string;
}

/** Um lote do catálogo, com a sessão da pessoa (a RPC confere usuário, permissão e unidades). */
export async function lerContasBase(
  context: { supabase: unknown },
  data: { after: string | null; through?: string | null },
): Promise<PaginaContasBase> {
  const db = (context.supabase as DB).schema("ops");
  // A RPC valida usuário ativo, permissão e unidades antes de consultar dados.
  const { data: batch, error } = await db.rpc("base_carteira_pagina", {
    _after: data.after,
    _through: data.through ?? null,
  });
  if (error)
    throw new Error("Não foi possível carregar as empresas. Nenhum total parcial foi exibido.");
  const rows = batch.rows;
  const master = batch.base;
  const by = new Map<string, BaseEmpresa>((master || []).map((m: BaseEmpresa) => [m.key, m]));
  if (rows.some((a: DB) => !by.has(a.key)))
    throw new Error("A base mudou durante a leitura. Atualize para conferir os totais.");
  return {
    accounts: rows.map((a: DB) => ({
      ...aplicarBase(a.perfil as Conta, by.get(a.key)),
      unit_ids: a.unidade_ids,
    })),
    next: batch.next,
    catalog_at: batch.catalog_at,
    scope_signature: batch.scope_signature,
  };
}

export const carregarContasBase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      after: z.string().max(80).nullable(),
      through: z.string().min(1).max(80).nullable().optional(),
    }),
  )
  .handler(({ context, data }) => lerContasBase(context, data));

export const detalheAquario = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ key: z.string().min(1).max(80) }))
  .handler(async ({ context, data }) => {
    if (
      !(await check(context.supabase, "view.aquario")) &&
      !(await check(context.supabase, "view.clientes"))
    )
      throw new Error("Sem permissão para consultar clientes.");
    const db = (context.supabase as DB).schema("ops");
    const { data: detail, error } = await db.rpc("monetizacao_detail", { _key: data.key });
    const row = detail
      ? { detalhe: detail, updated_at: detail.fields?.segmento?.at || null }
      : null;
    if (error || !row) throw new Error("Detalhes indisponíveis para esta conta no seu escopo.");
    const contactsAllowed = await check(context.supabase, "view.contatos");
    return {
      cnpjs: row.detalhe.cnpjs,
      fields: row.detalhe.fields,
      ecd_summary: row.detalhe.ecd_summary
        ? {
            available: row.detalhe.ecd_summary.available,
            exercise: row.detalhe.ecd_summary.exercise,
          }
        : undefined,
      sources: row.detalhe.sources,
      driva: row.detalhe.driva,
      contacts: contactsAllowed ? row.detalhe.contacts || [] : [],
      contacts_restricted: !contactsAllowed,
      updated_at: row.updated_at,
    } as {
      cnpjs?: string[];
      contacts: { type: string; value: string; source: string; at?: string }[];
      fields?: Record<
        string,
        {
          value: string | null;
          source: string | null;
          at: string | null;
          conflict?: boolean;
          alternatives?: { value: string; source: string }[];
        }
      >;
      ecd_summary?: { available: boolean; exercise?: string };
      sources?: Record<string, number>;
      driva?: { records: DrivaRecord[] };
      contacts_restricted: boolean;
      updated_at: string;
    };
  });

export type ContatosExportados = {
  restricted: boolean;
  byKey: Record<string, { nomes: string | null; emails: string | null; telefones: string | null }>;
};

/** Contatos do "Exportar filtro": mesmos canais da gaveta, em lotes de 500 contas por chamada. */
export const contatosParaExportar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ keys: z.array(z.string().min(1).max(80)).max(500) }))
  .handler(async ({ context, data }): Promise<ContatosExportados> => {
    if (!(await check(context.supabase, "view.contatos"))) return { restricted: true, byKey: {} };
    const db = (context.supabase as DB).schema("ops");
    const { data: byKey, error } = await db.rpc("base_contatos_exportar", { _keys: data.keys });
    if (error) throw new Error("Não foi possível ler os contatos para a exportação.");
    return { restricted: false, byKey: byKey || {} };
  });

const review = z.object({
  band: z.string().max(160).optional(),
  segment: z.string().max(160).optional(),
  regime: z.string().max(80).optional(),
  // Caminho de volta da empresa barrada pela situação na Receita (DECISIONS 19/09). Sem esta
  // chave o zod a descartava em silêncio e o servidor nunca recebia a revisão.
  situacao_receita: z.enum(["ativa", "baixada", "inapta", "suspensa"]).optional(),
  note: z.string().max(3000).optional(),
  demand: z.string().max(200).optional(),
});
export const salvarListaAquario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid().optional(),
      revision: z.number().int().positive().optional(),
      nome: z.string().trim().min(3).max(160),
      unidade_id: z.number().int().positive().nullable(),
      owner_id: z.number().int().positive(),
      partner: z.string().max(160),
      origin_confirmed: z.boolean(),
      scan_confirmed: z.boolean(),
      mode: z.enum(["draft", "validate"]),
      items: z
        .array(
          z.object({
            account_key: z.string().min(1).max(80),
            product: z.enum(["consultoria", "cella", "finance", "recon"]),
            review,
          }),
        )
        .min(1)
        .max(300),
    }),
  )
  .handler(async ({ context, data }) => {
    const { data: id, error } = await (context.supabase as DB)
      .schema("ops")
      .rpc("monetizacao_save_list", { _data: data });
    if (error) throw new Error(error.message);
    const db = (context.supabase as DB).schema("ops");
    const [list, items] = await Promise.all([
      db.from("monetizacao_listas").select("revision").eq("id", id).single(),
      db.from("monetizacao_itens").select("id,account_key,product,status").eq("list_id", id),
    ]);
    if (list.error || items.error)
      throw new Error(
        "Lista salva, mas a leitura não foi confirmada. Atualize as listas antes de enviar.",
      );
    return {
      id: id as string,
      revision: list.data.revision as number,
      items: items.data as Pick<ItemLista, "id" | "account_key" | "product" | "status">[],
    };
  });

export const acionarMonetizacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("sync") }),
      z.object({ action: z.literal("send"), items: z.array(z.string().uuid()).min(1).max(10) }),
    ]),
  )
  .handler(async ({ context, data }) => {
    if (
      !(await check(
        context.supabase,
        data.action === "send" ? "send.monetizacao" : "view.monetizacao",
      ))
    )
      throw new Error("Sem permissão para esta operação.");
    const { data: result, error } = await context.supabase.functions.invoke("monetizacao-crm", {
      body: data,
    });
    let detail = result?.error;
    if (error && "context" in error && error.context instanceof Response) {
      try {
        detail = (await error.context.json())?.error || detail;
      } catch {
        /* mantém mensagem segura */
      }
    }
    if (error || detail)
      throw new Error(
        detail ||
          "Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.",
      );
    return result as {
      status: string;
      results?: {
        item: string;
        status: string;
        deal_id?: number;
        reason?: string;
        handoff?: {
          status: string;
          people?: number;
          notes?: number;
          files?: number;
          documents?: number;
          errors?: string[];
          warnings?: string[];
        };
      }[];
    };
  });

export const salvarPlanoMonetizacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      owner_id: z.number().int().positive(),
      owner_name: z.string().min(1).max(160),
      capacity: z.number().int().min(0).max(10000),
      meetings_capacity: z.number().int().min(0).max(10000),
      target_contracts: z.number().int().min(0).max(10000),
      daily_target: z.number().int().min(0).max(1000),
      allocation: z.object({
        cella: z.number().int().nonnegative(),
        consultoria: z.number().int().nonnegative(),
        finance: z.number().int().nonnegative(),
      }),
      rates: z.object({
        cella: z.number().min(0).max(1).nullable(),
        consultoria: z.number().min(0).max(1).nullable(),
        finance: z.number().min(0).max(1).nullable(),
      }),
    }),
  )
  .handler(async ({ context, data }) => {
    const { error } = await (context.supabase as DB)
      .schema("ops")
      .rpc("monetizacao_save_plan", { _plan: data });
    if (error) throw new Error(error.message);
    return { saved: true };
  });
export const salvarRegistroMonetizacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid().optional(),
      kind: z.enum(["pdi", "roteiro", "distribuicao", "followup"]),
      title: z.string().trim().min(3).max(200),
      body: z.record(z.unknown()),
    }),
  )
  .handler(async ({ context, data }) => {
    const { data: id, error } = await (context.supabase as DB)
      .schema("ops")
      .rpc("monetizacao_save_record", {
        _id: data.id || null,
        _kind: data.kind,
        _title: data.title,
        _body: data.body,
      });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

/** Uma linha da apresentação ao sócio: só os campos da lista fechada (spec "apresentação para o sócio", 18/09, D3). */
export interface LinhaApresentacao {
  /** Id do item da lista: abre a ficha da conta na Base sem expor a chave (há chave com CNPJ). */
  item: string;
  empresa: string;
  comContato: boolean;
  produto: "consultoria" | "cella" | "finance" | "recon";
  tambemFinance: boolean;
  faturamento: string | null;
  segmento: string | null;
  regime: string | null;
  proximoPasso: string;
}
export interface ApresentacaoLista {
  id: string;
  nome: string;
  unidade: string;
  status: string;
  socio: string | null;
  atualizadaEm: string;
  contasUnicas: number;
  linhas: LinhaApresentacao[];
}

/**
 * A apresentação de UMA lista salva (tela `/apresentacao/lista/$id`), com a sessão da pessoa: a RLS
 * de listas, itens e contas decide o que ela vê. Nunca devolve CNPJ, contato, id de CRM, motivo
 * interno ou fonte — a apresentação vai para a frente do sócio.
 */
/**
 * A conta de um item de lista (link da apresentação para a ficha na Base), com a sessão da pessoa:
 * a RLS de itens decide. Devolve só a chave, que fica no navegador de quem já vê a Base.
 */
export const contaDoItemLista = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<string | null> => {
    const { data: item, error } = await (context.supabase as DB)
      .schema("ops")
      .from("monetizacao_itens")
      .select("account_key")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler o item da lista.");
    return (item?.account_key as string | undefined) ?? null;
  });

export const lerApresentacaoLista = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<ApresentacaoLista> => {
    const sb = context.supabase as DB;
    if (!(await check(sb, "view.aquario")) && !(await check(sb, "view.monetizacao")))
      throw new Error("Seu acesso não inclui as listas da Base de clientes.");
    const db = sb.schema("ops");
    const [lista, itens] = await Promise.all([
      db
        .from("monetizacao_listas")
        .select("id,nome,unidade_nome,status,partner,updated_at")
        .eq("id", data.id)
        .maybeSingle(),
      db
        .from("monetizacao_itens")
        .select("id,account_key,product,review")
        .eq("list_id", data.id)
        .order("id"),
    ]);
    if (lista.error || itens.error) throw new Error("Não foi possível ler a lista.");
    if (!lista.data) throw new Error("Lista não encontrada ou fora do seu acesso.");
    const rows = itens.data as {
      id: string;
      account_key: string;
      product: LinhaApresentacao["produto"];
      review: Record<string, string>;
    }[];
    const keys = [...new Set(rows.map((i) => i.account_key))];
    const [contas, base] = keys.length
      ? await Promise.all([
          db.from("monetizacao_contas").select("key,perfil").in("key", keys),
          db.rpc("base_unica_catalogo", { _keys: keys }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (contas.error || base.error) throw new Error("Não foi possível ler as contas da lista.");
    const catalogo: BaseEmpresa[] = Array.isArray(base.data) ? base.data : (base.data?.base ?? []);
    const porBase = new Map(catalogo.map((b) => [b.key, b]));
    const porChave = new Map<string, Conta>(
      (contas.data as { key: string; perfil: Conta }[]).map((r) => [
        r.key,
        aplicarBase(r.perfil, porBase.get(r.key)),
      ]),
    );
    const temNome = (s: string | null | undefined) =>
      !!s && /[A-Za-zÀ-ú]{2,}/.test(s) && !["NA", "N/A"].includes(s.trim().toUpperCase());
    const linhas = rows.map((i): LinhaApresentacao => {
      const a = porChave.get(i.account_key);
      const r = i.review || {};
      return {
        item: i.id,
        empresa: a && temNome(a.name) ? a.name : "(sem nome no cadastro)",
        comContato: !!a?.contact,
        produto: i.product,
        tambemFinance:
          !!a &&
          i.product !== "finance" &&
          i.product !== "recon" &&
          oferta(a, "finance").status === "elegivel",
        // Faixa estimada pela DataStone vai marcada: é a conversa com o sócio que confirma.
        faturamento:
          r.band ||
          (a?.band
            ? /^datastone/i.test(a.band_source || "")
              ? `${a.band} · estimativa, confirmar com o sócio`
              : a.band
            : null),
        segmento: r.segment || a?.segment || null,
        regime: r.regime || a?.regime || null,
        proximoPasso: r.note?.trim() || "Validar a oportunidade com o sócio",
      };
    });
    return {
      id: lista.data.id,
      nome: lista.data.nome,
      unidade: lista.data.unidade_nome || "Todas as unidades",
      status: lista.data.status,
      socio: lista.data.partner || null,
      atualizadaEm: lista.data.updated_at,
      contasUnicas: keys.length,
      linhas,
    };
  });
