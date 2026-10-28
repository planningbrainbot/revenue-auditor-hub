import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PIPEFY_PIPE_TRATATIVAS } from "@/lib/royalties.functions";
import type {
  Pedido,
  PermissoesPedido,
  ResumoContatos,
  ContatosDaConta,
  TipoPedido,
} from "./pedidos";

// Atualização da base pela unidade (PRD de 28/10/2026). As regras e o escopo moram nas funções do banco
// (`ops.base_pedido_*`); aqui só a chamada e o que precisa do servidor: o card de churn (token do Pipefy) e a
// consulta do CNPJ na BrasilAPI.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ops = (supabase: unknown) => (supabase as any).schema("ops");
async function rpc<T>(supabase: unknown, nome: string, args: Record<string, unknown> = {}) {
  const { data, error } = await ops(supabase).rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const permissoesPedido = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    rpc<PermissoesPedido>(context.supabase, "base_pedido_permissoes"),
  );

export const resumoContatos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => rpc<ResumoContatos>(context.supabase, "base_contatos_resumo"));

export const contatosDaConta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ key: z.string().max(80).nullable(), pai: z.string().uuid().nullable() }),
  )
  .handler(async ({ data, context }) =>
    rpc<ContatosDaConta>(context.supabase, "base_conta_contatos", {
      _key: data.key,
      _pai: data.pai,
    }),
  );

const TIPOS = [
  "contato_incluir",
  "contato_editar",
  "contato_desativar",
  "contato_nps",
  "nao_reconheco",
  "cliente_incluir",
] as const;

export const abrirPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      tipo: z.enum(TIPOS),
      key: z.string().max(80).nullable(),
      contato: z.number().int().nullable(),
      proposto: z.record(z.string(), z.unknown()),
      pai: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data, context }) =>
    rpc<Pedido>(context.supabase, "base_pedido_abrir", {
      _tipo: data.tipo satisfies TipoPedido,
      _conta_key: data.key,
      _contato_id: data.contato,
      _proposto: data.proposto,
      _pai: data.pai,
    }),
  );

// Opções do campo "Unidade de Negócio" da fase Contatar ASAP (conferidas em 28/10/2026). Unidade fora da lista vai
// no título e no relato; o CS completa na tratativa.
const UNIDADES_TRATATIVAS: Record<string, string> = {
  matriz: "Matriz",
  goiania: "Matriz",
  "rio de janeiro": "Rio de Janeiro",
  "patos de minas": "Patos de Minas",
  belem: "Belém",
  curitiba: "Curitiba",
  fortaleza: "Fortaleza",
  "campo novo": "Campo Novo",
  "sao luis": "São Luis",
  maceio: "Maceió",
};
const FASE_CONTATAR_ASAP = "343394573";
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

async function pipefy(query: string, variables: Record<string, unknown>) {
  const token = process.env.PIPEFY_TOKEN;
  if (!token) throw new Error("PIPEFY_TOKEN não configurado no servidor.");
  const resp = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await resp.json();
  if (body.errors?.length)
    throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
  return body.data;
}

/**
 * Informar churn (R-12): abre o pedido e cria na hora o card no pipe Tratativas, em Contatar ASAP. É a única
 * escrita no Pipefy antes do CS. Se o card falha, o pedido fica em erro e a chave é liberada para tentar de novo.
 */
export const informarChurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      key: z.string().min(1).max(80),
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      categoria: z.string().min(1),
      relato: z.string().trim().min(10).max(4000),
    }),
  )
  .handler(async ({ data, context }) => {
    const pedido = await rpc<Pedido & { card: Record<string, unknown> & { cnpjs?: string[] } }>(
      context.supabase,
      "base_pedido_abrir",
      {
        _tipo: "churn",
        _conta_key: data.key,
        _contato_id: null,
        _proposto: { data: data.data, categoria: data.categoria, relato: data.relato },
        _pai: null,
      },
    );
    const c = pedido.card ?? {};
    const unidade = UNIDADES_TRATATIVAS[semAcento(String(c.unidade ?? ""))];
    const relato = [
      `Informado pela unidade ${c.unidade ?? ""} no Planning Ops em ${new Date().toLocaleDateString("pt-BR")}.`,
      `Categoria: ${data.categoria}. Data: ${data.data.split("-").reverse().join("/")}.`,
      c.cnpjs?.length ? `CNPJ: ${c.cnpjs.join(", ")}.` : "",
      "",
      data.relato,
    ].join("\n");
    try {
      const fields: { field_id: string; field_value: unknown }[] = [
        { field_id: "mrr_r", field_value: String(c.mrr ?? 0) },
      ];
      if (unidade) fields.push({ field_id: "unidade_de_neg_cio", field_value: unidade });
      if (c.empresa_pipefy)
        fields.push({ field_id: "cliente", field_value: [String(c.empresa_pipefy)] });
      const criado = await pipefy(
        `mutation($pipe:ID!,$fase:ID!,$title:String,$fields:[FieldValueInput]){
          createCard(input:{pipe_id:$pipe,phase_id:$fase,title:$title,fields_attributes:$fields}){ card { id } } }`,
        {
          pipe: PIPEFY_PIPE_TRATATIVAS,
          fase: FASE_CONTATAR_ASAP,
          title: `${c.nome || "Cliente"} · ${c.unidade ?? ""}`.trim(),
          fields,
        },
      );
      const card: string = criado.createCard.card.id;
      // Os campos da fase Perdido já nascem preenchidos: o CS não redigita quando a tratativa terminar em churn.
      const extras: [string, unknown][] = [
        ["categoria_do_churn", data.categoria],
        ["data_do_churn", data.data],
        ["motivo_do_churn", relato],
      ];
      if (c.deal) extras.push(["id_deal_pipedrive", String(c.deal)]);
      for (const [campo, valor] of extras) {
        await pipefy(
          `mutation($card:ID!,$campo:ID!,$valor:[UndefinedInput]){
            updateCardField(input:{card_id:$card,field_id:$campo,new_value:$valor}){ success } }`,
          { card, campo, valor: [valor] },
        ).catch(() => null);
      }
      await rpc(context.supabase, "base_pedido_churn_card", {
        _id: pedido.id,
        _card: card,
        _erro: null,
      });
      return { ok: true as const, card };
    } catch (e) {
      await rpc(context.supabase, "base_pedido_churn_card", {
        _id: pedido.id,
        _card: null,
        _erro: (e as Error).message,
      });
      throw new Error(`O card não foi criado no Pipefy (${(e as Error).message}). Tente de novo.`);
    }
  });

export const cancelarPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "base_pedido_cancelar", { _id: data.id });
    return { ok: true };
  });

export const meusPedidos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => rpc<Pedido[]>(context.supabase, "base_pedidos_meus"));

export const filaPedidos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ situacao: z.enum(["abertos", "andamento", "decididos"]) }))
  .handler(async ({ data, context }) =>
    rpc<Pedido[]>(context.supabase, "base_pedidos_fila", { _situacao: data.situacao }),
  );

export const decidirPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      aprovar: z.boolean(),
      motivo: z.string().max(2000).nullable(),
      corrigido: z.record(z.string(), z.unknown()).nullable(),
    }),
  )
  .handler(async ({ data, context }) =>
    rpc<Pedido>(context.supabase, "base_pedido_decidir", {
      _id: data.id,
      _aprovar: data.aprovar,
      _motivo: data.motivo,
      _corrigido: data.corrigido,
    }),
  );

export type ConsultaCnpj =
  | { estado: "na_sua_base"; nome: string }
  | { estado: "cliente_rede" | "pedido" }
  | {
      estado: "livre";
      cnpj: string;
      razao_social: string;
      nome_fantasia: string | null;
      uf: string | null;
      cidade: string | null;
      situacao_receita: string | null;
    };

/** R-17: o banco confere a Base e o limite de 30 por hora; a BrasilAPI só é chamada para CNPJ livre. */
export const consultarCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ cnpj: z.string().max(20) }))
  .handler(async ({ data, context }): Promise<ConsultaCnpj> => {
    const r = await rpc<{ estado: string; nome?: string; cnpj?: string }>(
      context.supabase,
      "base_cnpj_checar",
      {
        _cnpj: data.cnpj,
      },
    );
    if (r.estado !== "livre") return r as ConsultaCnpj;
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${r.cnpj}`, {
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!resp || resp.status === 404) throw new Error("CNPJ não encontrado na Receita Federal.");
    if (!resp.ok)
      throw new Error("A consulta à Receita (BrasilAPI) falhou. Tente de novo em instantes.");
    const b = await resp.json();
    return {
      estado: "livre",
      cnpj: r.cnpj!,
      razao_social: b.razao_social,
      nome_fantasia: b.nome_fantasia || null,
      uf: b.uf || null,
      cidade: b.municipio || null,
      situacao_receita: b.descricao_situacao_cadastral || null,
    };
  });
