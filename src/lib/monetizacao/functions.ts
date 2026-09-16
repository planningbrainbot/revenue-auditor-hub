import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BaseMonetizacao, Conta, ItemLista, Lista, Negocio, Plano, Registro } from "./types";

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
export const carregarMonetizacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaseMonetizacao> => {
    const db = context.supabase;
    const [aquario, operation, manage, send, scope] = await Promise.all([
      check(db, "view.aquario"),
      check(db, "view.monetizacao"),
      check(db, "manage.aquario"),
      check(db, "send.monetizacao"),
      (db as DB).schema("ops").rpc("monetizacao_scope", { _ids: [] }),
    ]);
    if (!aquario && !operation)
      throw new Error(
        "Seu acesso não inclui Clientes/Aquário ou Monetização. A administração da plataforma controla esse acesso.",
      );
    const [accounts, units, cards, lists, items, health, plans, records, reservations, forecasts] =
      await Promise.all([
        all(db, "monetizacao_contas", "key,perfil,source_at,unidade_ids", "key"),
        all(db, "monetizacao_unidades", "key,unidade_id,nome,classification", "key"),
        all(db, "monetizacao_deals", "id,payload", "id"),
        all(db, "monetizacao_listas", "*", "created_at"),
        all(db, "monetizacao_itens", "*", "id"),
        all(db, "monetizacao_sync", "status,measured_at,catalog_at,error,stages", "id"),
        all(db, "monetizacao_planos", "payload", "month"),
        all(db, "monetizacao_registros", "id,kind,title,body,updated_at", "updated_at"),
        all(db, "monetizacao_envios", "account_key,product,status,deal_id", "id"),
        all(db, "monetizacao_forecasts", "payload", "id"),
      ]);
    const { data: origins, error: originError } = await (db as DB)
      .schema("ops")
      .rpc("monetizacao_base_origins");
    if (originError)
      throw new Error(
        "Não foi possível conferir a origem das carteiras. Atualize para tentar novamente.",
      );
    const originBy = new Map(
      (origins || []).map((o: { account_key: string; origin: Conta["base_origin"] }) => [
        o.account_key,
        o.origin,
      ]),
    );
    const profiles = accounts.map(
        (a) => ({ ...a.perfil, base_origin: originBy.get(a.key) }) as Conta,
      ),
      sync = health[0];
    return {
      forecasts: forecasts.map((f) => f.payload) as BaseMonetizacao["forecasts"],
      reservations: reservations as BaseMonetizacao["reservations"],
      accounts: profiles,
      units: units.map((u) => ({
        id: u.unidade_id,
        key: u.key,
        name: u.nome,
        classification: u.classification,
        account_keys: accounts
          .filter((a) =>
            u.unidade_id
              ? a.unidade_ids.includes(u.unidade_id)
              : a.perfil.units.includes(u.key) || a.perfil.unit_label === u.nome,
          )
          .map((a) => a.key),
      })),
      cards: cards.map((d) => d.payload as Negocio),
      lists: lists.map((l) => ({
        ...l,
        items: items.filter((i) => i.list_id === l.id) as ItemLista[],
      })) as Lista[],
      plans: plans.map((p) => p.payload) as Plano[],
      records: records as Registro[],
      measured_at: sync?.measured_at || null,
      catalog_at: sync?.catalog_at || null,
      sync_status: sync?.status || "pending",
      sync_error: sync?.error || null,
      stages: sync?.stages || [],
      permissions: { view: operation, manage, send, all_units: scope.data === true },
    };
  });

export const detalheAquario = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ key: z.string().min(1).max(80) }))
  .handler(async ({ context, data }) => {
    if (!(await check(context.supabase, "view.aquario")))
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
      contacts_restricted: boolean;
      updated_at: string;
    };
  });

const review = z.object({
  band: z.string().max(160).optional(),
  segment: z.string().max(160).optional(),
  regime: z.string().max(80).optional(),
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
            product: z.enum(["consultoria", "cella", "finance"]),
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
    if (error || result?.error)
      throw new Error(
        result?.error ||
          "Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.",
      );
    return result as {
      status: string;
      results?: { item: string; status: string; deal_id?: number; reason?: string }[];
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
