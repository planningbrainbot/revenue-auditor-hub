import { createServerFn } from "@tanstack/react-start";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertAdmin, digits } from "@/lib/server-utils";
import { unitMatches } from "@/lib/unit-names";
import {
  MOTIVOS_CHURN,
  PIPEFY_FASE_PERDIDO,
  PIPEFY_PIPE_TRATATIVAS,
  type MotivoChurn,
} from "@/lib/royalties.functions";

// Marcar churn na tela de Clientes é liberado por permissão (não só admin) —
// mesmo padrão de manage.repasses: checa direto via can(), sem has_role.
async function assertCanMarcarChurn(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc("can", { _key: "manage.clientes_churn" });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error("Acesso negado: você não pode marcar churn.");
}

// ============ atualizarCliente ============
// Corrige razão social e/ou CNPJ de um cliente direto na tela de Clientes.
// empresas é alimentado pelo sync automático (pipedrive_sync / enriquecimento
// de CNPJ) — uma edição manual aqui pode ser sobrescrita se o mesmo registro
// for resincronizado depois. Ainda assim é útil pra corrigir na hora.
export const atualizarCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number; razao_social?: string; cnpj?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const patch: { razao_social?: string; cnpj?: string } = {};
    if (data.razao_social !== undefined) {
      const nome = data.razao_social.trim();
      if (!nome) throw new Error("Razão social não pode ficar em branco.");
      patch.razao_social = nome;
    }
    if (data.cnpj !== undefined) {
      const cnpj = digits(data.cnpj);
      if (cnpj.length !== 14) throw new Error("CNPJ inválido — precisa ter 14 dígitos.");
      patch.cnpj = cnpj;
    }
    if (Object.keys(patch).length === 0) throw new Error("Nada para atualizar.");

    const { error } = await supabase.from("empresas").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, ...patch };
  });

// ============ marcarChurnCliente ============
// Mesmo mecanismo do "Marcar churn" da apuração de royalties: cria um card no
// pipe Pipefy "Tratativas" já na fase "Perdido", vinculado ao deal do
// Pipedrive. O card sincroniza de volta pra central_tratativas via
// sync_pipefy_tratativas.py (roda a cada 15min), e é isso que clientes.tsx
// usa pra marcar o cliente como churn — não existe coluna de churn em
// empresas, então a UI reflete o card assim que o próximo sync rodar.
export const marcarChurnCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      pipedrive_id: string;
      razao_social: string;
      unidade: string;
      mrr: number;
      motivo: string;
      observacao?: string;
      data_churn: string;
    }) => d,
  )
  .handler(async ({ data, context }): Promise<{ ok: true; pipefy_card_id: string }> => {
    const { supabase } = context;
    await assertCanMarcarChurn(supabase);

    if (!MOTIVOS_CHURN.includes(data.motivo as MotivoChurn)) {
      throw new Error("Selecione um motivo de churn válido.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data_churn)) throw new Error("Data do churn inválida.");
    if (!data.pipedrive_id) {
      throw new Error("Cliente sem Pipedrive ID — não é possível vincular o churn.");
    }

    // A unidade gravada no card vem de `empresas`, não do payload — a server fn
    // é chamável direto, e o payload deixaria um sócio abrir card de churn com a
    // praça de outra unidade. Por isso a busca acontece SEMPRE, não só quando o
    // usuário é escopado.
    const { data: emp, error: empErr } = await supabase
      .from("empresas")
      .select("unidade")
      .eq("pipedrive_id", data.pipedrive_id)
      .maybeSingle();
    if (empErr) throw new Error("Não foi possível localizar o cliente — tente de novo.");
    if (!emp) throw new Error("Cliente sem cadastro em empresas — não é possível marcar churn.");

    // Quem enxerga só a própria praça não pode marcar churn de cliente alheio: a
    // tela esconde o botão, mas isso é cosmético. Erro da RPC não pode virar
    // "não é escopado" (fail-open) nem "acesso negado" (acusação errada) —
    // mesmo tratamento que assertCanMarcarChurn já dá.
    const { data: escopado, error: escopoErr } = await supabase.rpc("can", {
      _key: "data.scope.own_unit_only",
    });
    if (escopoErr) throw new Error("Erro de autorização.");
    if (escopado) {
      const { data: minhaUnidade, error: uniErr } = await supabase.rpc("current_user_unidade");
      if (uniErr) throw new Error("Não foi possível validar a unidade — tente de novo.");
      if (!minhaUnidade || !unitMatches(minhaUnidade, emp.unidade)) {
        throw new Error("Acesso negado: cliente de outra unidade.");
      }
    }

    const pipefyToken = process.env.PIPEFY_TOKEN;
    if (!pipefyToken) throw new Error("PIPEFY_TOKEN não configurado no servidor.");

    const mutation = `
      mutation($fields: [FieldValueInput!]) {
        createCard(input: {
          pipe_id: "${PIPEFY_PIPE_TRATATIVAS}"
          phase_id: "${PIPEFY_FASE_PERDIDO}"
          title: ${JSON.stringify(data.razao_social || "—")}
          fields_attributes: $fields
        }) { card { id } }
      }
    `;
    const fields = [
      { field_id: "unidade_de_neg_cio", field_value: [emp.unidade ?? ""] },
      // mrr_r continua vindo do payload: é o valor que a tela calculou somando
      // `contratos` por deal, e não há fonte melhor aqui no servidor.
      { field_id: "mrr_r", field_value: [String(data.mrr ?? 0)] },
      { field_id: "categoria_do_churn", field_value: [data.motivo] },
      { field_id: "data_do_churn", field_value: [data.data_churn] },
      { field_id: "id_deal_pipedrive", field_value: [String(data.pipedrive_id)] },
    ];
    if (data.observacao?.trim()) {
      fields.push({ field_id: "motivo_do_churn", field_value: [data.observacao.trim()] });
    }

    const resp = await fetch("https://api.pipefy.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${pipefyToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables: { fields } }),
    });
    const body = await resp.json();
    if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
    const cardId: string = body.data.createCard.card.id;

    return { ok: true, pipefy_card_id: cardId };
  });

// ============ listClientesDiretorio ============
// Lê a view v_clientes_diretorio (migration 20260903150000): união de
// empresas + omie_clientes + omie_clientes_cadastro, UMA linha por documento
// (CNPJ/CPF), unidade normalizada ('Partners' → 'Matriz', 'São Luís' → 'São Luis')
// e grupo econômico resolvido nesta prioridade: cadastro (tabela grupos) >
// filiais do mesmo contrato > nome fantasia "GRUPO X" no Omie > raiz de CNPJ.
//
// Por quê: a tela lia só `empresas` com tipo_unidade='franquia' em unidade
// regional (324 linhas). A Matriz e as BUs internas ficavam de fora por
// construção, e a base do ERP (~10,2 mil registros) só aparecia na aba "Base
// Antiga". A view entrega tudo num recorte só (~11,2 mil linhas):
//   base = 'nova'   → tem deal no Pipedrive (mesmo recorte de antes, estendido
//                     à Matriz); é o que os cards Ativos/Churn continuam contando;
//   base = 'antiga' → só ERP/reconciliação.
//
// security_invoker = true: a RLS de quem consulta vale. Quem não enxerga
// contas_receber só perde `ultimo_recebimento` (vem null), o resto funciona.
//
// Leitura: UMA chamada à função SQL public.list_clientes_diretorio(), que
// devolve o diretório inteiro como jsonb. Paginar a view com `.range()` em
// blocos de 1000 reexecutava a agregação a cada bloco (~0,5 s quente / 1,7 s
// frio por bloco × 12 blocos = 6–20 s por abertura da tela).

export type ClienteDiretorio = {
  /** PK lógica: 'e:<empresa_id>' | 'o:<documento>' | 'c:<documento>' | 'o:<unidade>:<codigo_omie>' */
  chave: string;
  /** Preenchido só quando a linha vem de `empresas` (é o `id` usado por editar/churn/contatos). */
  empresa_id: number | null;
  origem: "pipedrive" | "omie" | "ambos" | "ops";
  /** nova = tem deal no Pipedrive; antiga = só ERP/reconciliação. */
  base: "nova" | "antiga";
  razao_social: string | null;
  /** Título do deal (fallback de nome), só empresas. */
  titulo: string | null;
  /** Do Omie. */
  nome_fantasia: string | null;
  /** SÓ DÍGITOS (14 = CNPJ, 11 = CPF) ou null. */
  documento: string | null;
  tipo_documento: "CNPJ" | "CPF" | null;
  uf: string | null;
  cidade: string | null;
  /** Normalizada para unidades.nome_da_praca; null = "Sem unidade". */
  unidade: string | null;
  tipo_unidade: "franquia" | "matriz" | null;
  /** Todas as contas Omie em que o documento aparece (pode ser []). */
  unidades_omie: string[];
  pipedrive_id: string | null;
  fonte_cadastro: string | null;
  status_financeiro:
    | "ATIVO"
    | "EM_ATRASO"
    | "INADIMPLENTE"
    | "SEM_ATIVIDADE"
    | "NUNCA_PAGOU"
    | "SEM_AR"
    | null;
  erp: string | null;
  segmento: string | null;
  codigo_omie: number | null;
  omie_inativo: boolean | null;
  pessoa_fisica: boolean | null;
  contrato_id: number | null;
  tem_contrato_ativo: boolean;
  /** date 'YYYY-MM-DD' */
  ultimo_recebimento: string | null;
  /** date 'YYYY-MM-DD' */
  omie_data_cadastro: string | null;
  /** 'g:<grupos.id>' | 'c:<contrato_id>' | 'n:<NOME FANTASIA>' | 'r:<raiz8>'; null = sem grupo. */
  grupo_chave: string | null;
  /** Só quando grupo_origem = 'cadastro' (tabela grupos). */
  grupo_id: number | null;
  grupo_nome: string | null;
  grupo_origem: "cadastro" | "contrato" | "nome_fantasia" | "raiz_cnpj" | null;
  /** Membros do grupo na base inteira. */
  grupo_qtd: number | null;
  /** timestamptz */
  atualizado_em: string | null;
};

type ClienteDiretorioRow = Database["public"]["Views"]["v_clientes_diretorio"]["Row"];

// O gerador do Supabase marca toda coluna de view como nullable; aqui a gente
// fecha o contrato (arrays e booleans nunca chegam null na UI) e afunila os
// enums de texto pros literais do tipo.
function normalizarClienteDiretorio(r: ClienteDiretorioRow): ClienteDiretorio {
  return {
    chave: r.chave ?? "",
    empresa_id: r.empresa_id,
    origem: (r.origem ?? "ops") as ClienteDiretorio["origem"],
    base: (r.base ?? "antiga") as ClienteDiretorio["base"],
    razao_social: r.razao_social,
    titulo: r.titulo,
    nome_fantasia: r.nome_fantasia,
    documento: r.documento,
    tipo_documento: r.tipo_documento as ClienteDiretorio["tipo_documento"],
    uf: r.uf,
    cidade: r.cidade,
    unidade: r.unidade,
    tipo_unidade: r.tipo_unidade as ClienteDiretorio["tipo_unidade"],
    unidades_omie: r.unidades_omie ?? [],
    pipedrive_id: r.pipedrive_id,
    fonte_cadastro: r.fonte_cadastro,
    status_financeiro: r.status_financeiro as ClienteDiretorio["status_financeiro"],
    erp: r.erp,
    segmento: r.segmento,
    codigo_omie: r.codigo_omie,
    omie_inativo: r.omie_inativo,
    pessoa_fisica: r.pessoa_fisica,
    contrato_id: r.contrato_id,
    tem_contrato_ativo: r.tem_contrato_ativo ?? false,
    ultimo_recebimento: r.ultimo_recebimento,
    omie_data_cadastro: r.omie_data_cadastro,
    grupo_chave: r.grupo_chave,
    grupo_id: r.grupo_id,
    grupo_nome: r.grupo_nome,
    grupo_origem: r.grupo_origem as ClienteDiretorio["grupo_origem"],
    grupo_qtd: r.grupo_qtd,
    atualizado_em: r.atualizado_em,
  };
}

type RpcClient = {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;
};

/** A função existe? PGRST202 = PostgREST não achou a rotina no schema cache. */
// Só o caso que o fallback realmente cobre: a função não existe no banco.
// Casar pelo NOME da função no texto do erro pegaria também
// "permission denied for function list_clientes_diretorio" e erros internos da
// própria função — aí o throw seria engolido e a tela cairia em silêncio no
// caminho lento (12 reexecuções da view), que é o que a RPC veio eliminar.
function rpcAusente(error: PostgrestError): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

// Fallback (obrigatório): a migration 20260903150000 pode ainda não ter sido
// aplicada no ambiente — o banco tem a view, mas não a função. Nesse caso a
// gente volta pro loop de `.range()`, lento porém correto, em vez de derrubar
// a tela. Qualquer outro erro continua subindo.
async function paginarView(supabase: SupabaseClient<Database>): Promise<ClienteDiretorioRow[]> {
  const pageSize = 1000;
  let from = 0;
  const all: ClienteDiretorioRow[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("v_clientes_diretorio")
      .select("*")
      .order("chave", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ClienteDiretorioRow[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function carregarDiretorio(
  supabase: SupabaseClient<Database>,
): Promise<ClienteDiretorioRow[]> {
  // Cast pontual: `list_clientes_diretorio` não está em
  // Database["public"]["Functions"] porque os tipos gerados só são atualizados
  // depois que a migration roda.
  const { data, error } = await (supabase as unknown as RpcClient).rpc("list_clientes_diretorio");
  if (!error) return (data ?? []) as ClienteDiretorioRow[];
  if (!rpcAusente(error)) throw new Error(error.message);
  console.warn(
    `[clientes] RPC list_clientes_diretorio indisponível (${error.code}: ${error.message}), ` +
      "usando paginação da view — aplique a migration 20260903150000",
  );
  return paginarView(supabase);
}

export const listClientesDiretorio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: ClienteDiretorio[] }> => {
    const { supabase } = context;
    let rows = (await carregarDiretorio(supabase)).map(normalizarClienteDiretorio);

    // Escopo por unidade no servidor. A tela também filtra, mas a server fn é
    // chamável direto — sem isto o recorte é só cosmético.
    //
    // Casa a praça da linha OU qualquer conta Omie em que o documento aparece,
    // a mesma regra do gate (b) da view: para as ~10 mil linhas só-ERP, a
    // `unidade` sai de um desempate por `max(updated_at)` entre contas, então
    // casar só por ela faria o cliente entrar e sair da lista do franqueado
    // conforme a conta que sincronizou por último. Ele já enxerga esses títulos
    // em contas_receber. As AÇÕES (editar, churn) continuam presas à `unidade`.
    //
    // Erro na RPC não pode virar "não é escopado": isso pularia o recorte
    // inteiro (fail-open), e o caminho de fallback `paginarView` existe
    // justamente para o ambiente onde a view ainda não tem o gate.
    const [canRes, unidadeRes] = await Promise.all([
      supabase.rpc("can", { _key: "data.scope.own_unit_only" }),
      supabase.rpc("current_user_unidade"),
    ]);
    if (canRes.error) throw new Error("Erro de autorização.");
    if (canRes.data) {
      // fail-closed: sem unidade resolvida, não vê nada (antes via a rede toda).
      if (unidadeRes.error || !unidadeRes.data) return { rows: [] };
      const minha = unidadeRes.data;
      rows = rows.filter(
        (r) => unitMatches(minha, r.unidade) || r.unidades_omie.some((u) => unitMatches(minha, u)),
      );
    }

    return { rows };
  });
