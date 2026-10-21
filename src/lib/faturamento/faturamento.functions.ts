import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fraseDaValidacao, traduzirErroBanco, type Resultado } from "./erros";
import {
  dadosDaCnpja,
  dadosNaoEncontrado,
  LimiteDeChamadas,
  naoEncontradoNaCnpja,
  URL_CNPJA,
  USER_AGENT_CNPJA,
} from "./receita";
import type {
  CatalogoServicos,
  ConfigFaturamento,
  Contexto,
  Departamentos,
  DonoRemovido,
  DonoSalvo,
  EmissoraConfigurada,
  FichaPedido,
  FilaTesouraria,
  ListaPedidos,
  PedidoEnviado,
  PedidoMudou,
  PedidoSalvo,
  PreviaParcelas,
  Resumo,
  ServicoAtivado,
  ServicoPadroesSalvo,
  SincronizacaoPedida,
  StatusEnfileirado,
  Tomador,
  TomadorConferido,
} from "./tipos";

/**
 * O validador zod de cada server function, com a recusa traduzida: sem isto o navegador recebe o JSON cru do
 * zod (achado B3 da revisão de 20/10/2026). O tipo de entrada continua o do schema.
 */
function entrada<T extends z.ZodTypeAny>(schema: T) {
  return (d: z.input<T>): z.output<T> => {
    const r = schema.safeParse(d);
    if (!r.success) throw new Error(fraseDaValidacao(r.error.issues.map((i) => i.path)));
    return r.data;
  };
}

// Server functions do Portal de Faturamento: uma por RPC de tela do contrato da API
// (`PM Work/execution/portal-faturamento-prd-20261013/e1/API.md` §1), todas com a sessão da pessoa.
//
// - Quem decide o acesso é a RPC (API.md §0.2): `security definer`, porta `view.faturamento` e papel na
//   empresa conferidos na primeira linha. Aqui não há segunda regra de permissão, para as duas não
//   discordarem; a tela só esconde ou desabilita.
// - Nenhuma lê `receita.*` nem `integracoes.*`: esses schemas não estão no PostgREST (§0.1).
// - Toda entrada passa por zod. Chave desconhecida em `p_filtro` e `p_dados` é recusada aqui (`strict`)
//   do mesmo jeito que o banco recusaria (22023), antes da ida ao banco.
// - Toda chamada devolve `Resultado<T>`: o erro do banco vira mensagem legível (§0.3, `erros.ts`) e chega
//   inteiro ao navegador, com o tipo e os campos. `desembrulhar` volta a lançar do lado de lá.

// Os tipos gerados do Supabase não conhecem as funções `ops.fat_*` (T1b, 20/10/2026).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

async function chamar<T>(
  supabase: unknown,
  rpc: string,
  args: Record<string, unknown>,
  oQue: string,
): Promise<Resultado<T>> {
  try {
    const { data, error } = await (supabase as DB).schema("ops").rpc(rpc, args);
    if (error) {
      const erro = traduzirErroBanco(error, `ops.${rpc}`, oQue);
      // Acesso, validação e transição são respostas de regra, não defeito: não poluem o log.
      if (erro.tipo === "falha" || erro.tipo === "indisponivel" || erro.tipo === "sessao")
        console.error(`[faturamento] ops.${rpc}`, { code: error.code, message: error.message });
      return { ok: false, erro };
    }
    return { ok: true, dados: data as T };
  } catch (e) {
    console.error(`[faturamento] ops.${rpc}`, e);
    return {
      ok: false,
      erro: {
        tipo: "falha",
        codigo: null,
        mensagem: `${oQue} falhou. Tente de novo em instantes.`,
        campos: [],
      },
    };
  }
}

// ------------------------------------------------------------------ validação (zod)

const uuid = z.string().uuid();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM.");
const motivo = z.string().max(2000);

const situacao = z.enum([
  "rascunho",
  "aguardando_ok",
  "devolvido",
  "na_fila_omie",
  "simulado",
  "erro_omie",
  "os_criada",
  "em_conferencia",
  "faturado",
  "recebido",
  "em_atraso",
  "cancelamento_pedido",
  "cancelado",
]);

/** `p_filtro` de `fat_pedidos` (API.md §1.3). */
const filtroPedidos = z
  .object({
    situacao: z
      .array(z.union([situacao, z.literal("a_faturar")]))
      .max(14)
      .optional(),
    pendencia: z.enum(["ok", "devolvido", "erro"]).optional(),
    emissoras: z.array(uuid).max(50).optional(),
    dono: uuid.optional(),
    mes: mes.optional(),
    regua: z.enum(["competencia", "nota", "pagamento", "atraso"]).optional(),
    simulacao: z.boolean().optional(),
    busca: z.string().trim().max(120).optional(),
    ordem: z.enum(["atualizado", "valor", "vencimento", "numero"]).optional(),
    direcao: z.enum(["asc", "desc"]).optional(),
    pagina: z.number().int().min(1).max(100_000).optional(),
    por_pagina: z.number().int().min(1).max(200).optional(),
  })
  .strict();

/** `p_filtro` de `fat_fila_tesouraria` (API.md §1.5). */
const filtroFila = z
  .object({
    situacao: z
      .enum([
        "para_faturar",
        "em_conferencia",
        "erro_omie",
        "na_fila_omie",
        "faturado",
        "cancelamento_pedido",
      ])
      .optional(),
    higiene: z.enum(["erro", "vence_2d", "parado_1du"]).optional(),
    dia: z.union([dia, z.literal("hoje")]).optional(),
    busca: z.string().trim().max(120).optional(),
    limite: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

const texto = (max: number) => z.string().max(max).nullable().optional();

/** `p_dados` de `fat_pedido_salvar` (API.md §1.10). Ausente = não muda; `null` = limpa. */
const dadosPedido = z
  .object({
    emissora_id: uuid.nullable().optional(),
    dono_id: uuid.nullable().optional(),
    tomador_tipo: z.enum(["pj", "pf"]).nullable().optional(),
    tomador_documento: texto(30),
    tomador_nome: texto(200),
    emails_envio: z.array(z.string().max(254)).max(20).nullable().optional(),
    projeto: texto(200),
    servico_id: uuid.nullable().optional(),
    descricao_nf: texto(2000),
    valor: z.number().finite().nullable().optional(),
    forma: z.enum(["avulso", "parcelado"]).nullable().optional(),
    parcelas: z.number().int().min(1).max(36).nullable().optional(),
    primeiro_vencimento: dia.nullable().optional(),
    competencia: dia.nullable().optional(),
    documento: z.enum(["nf", "recibo", "nd"]).nullable().optional(),
    meio: z.enum(["boleto", "pix"]).nullable().optional(),
    departamento: texto(120),
    observacoes: texto(4000),
    confirmou_emissora: z.boolean().nullable().optional(),
  })
  .strict();

/** `p_dados` de `fat_dono_salvar` (API.md §1.20). */
const dadosDono = z
  .object({
    id: uuid.optional(),
    emissora_id: uuid.optional(),
    user_id: uuid.optional(),
    papel: z.enum(["dono", "gestor", "solicitante"]).optional(),
    substituto_id: uuid.nullable().optional(),
    ativo: z.boolean().optional(),
  })
  .strict();

const soId = z.object({ id: uuid });

// ------------------------------------------------------------------ leituras (§1.1 a §1.9, §1.19)

/** §1.1 · Quem sou eu no portal, minhas empresas e o que pede a minha atenção. Abre toda tela da área. */
export const carregarContextoFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    chamar<Contexto>(context.supabase, "fat_contexto", {}, "A leitura do Portal de Faturamento"),
  );

/** §1.2 · Os quatro números de Meu faturamento e as etapas. `periodo`: qualquer dia do mês. */
export const carregarResumoFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z
        .object({
          periodo: dia.nullable().optional(),
          emissoras: z.array(uuid).max(50).nullable().optional(),
        })
        .strict(),
    ),
  )
  .handler(({ context, data }) =>
    chamar<Resumo>(
      context.supabase,
      "fat_resumo",
      {
        p_periodo: data.periodo ?? null,
        p_emissoras: data.emissoras?.length ? data.emissoras : null,
      },
      "A leitura dos números do faturamento",
    ),
  );

/** §1.3 · A lista de Pedidos, paginada no servidor. */
export const carregarPedidosFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ filtro: filtroPedidos }).strict()))
  .handler(({ context, data }) =>
    chamar<ListaPedidos>(
      context.supabase,
      "fat_pedidos",
      { p_filtro: data.filtro },
      "A leitura dos pedidos",
    ),
  );

/** §1.4 · A ficha de um pedido. Fora do escopo: `sem_acesso`, sem nenhum dado. */
export const carregarPedidoFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<FichaPedido>(context.supabase, "fat_pedido", { p_id: data.id }, "A leitura do pedido"),
  );

/** §1.5 · A fila da tesouraria. `emissora` nula = todas do recorte. */
export const carregarFilaTesouraria = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z.object({ emissora: uuid.nullable().optional(), filtro: filtroFila.optional() }).strict(),
    ),
  )
  .handler(({ context, data }) =>
    chamar<FilaTesouraria>(
      context.supabase,
      "fat_fila_tesouraria",
      { p_emissora: data.emissora ?? null, p_filtro: data.filtro ?? {} },
      "A leitura da fila da tesouraria",
    ),
  );

/** §1.6 · O catálogo de serviços da emissora (só liberados, no Omie e com tributação). */
export const carregarServicosFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ emissora: uuid }).strict()))
  .handler(({ context, data }) =>
    chamar<CatalogoServicos>(
      context.supabase,
      "fat_servicos",
      { p_emissora: data.emissora },
      "A leitura do catálogo de serviços",
    ),
  );

/** §1.7 · As 19 opções de Departamento (as mesmas do Contas a Pagar). */
export const carregarDepartamentosFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    chamar<Departamentos>(context.supabase, "fat_departamentos", {}, "A leitura dos departamentos"),
  );

// ------------------------------------------------------------------ Receita (CNPJá aberta)

/** No máximo 3 consultas por minuto por processo (a CNPJá aberta aguenta cerca de 4). */
const limiteCnpja = new LimiteDeChamadas(3, 60_000);
/** A mesma consulta em curso é reaproveitada: dois campos que saem juntos não gastam duas chamadas. */
const emCurso = new Map<string, Promise<"feita" | "adiada" | "falhou">>();

/**
 * Consulta a CNPJá aberta e grava com `ops.fat_receita_cnpj_gravar`, executável só pelo service_role. Só é
 * chamada depois de `fat_tomador` responder com a sessão da pessoa (a porta e o escopo já foram conferidos).
 * "feita" inclui a Receita dizer que o CNPJ não existe (grava `encontrado: false` e o banco bloqueia o envio,
 * Ana 21/10/2026); "adiada" e "falhou" não gravam nada (situação não conferida, o envio passa).
 */
async function consultarEGravarReceita(cnpj: string): Promise<"feita" | "adiada" | "falhou"> {
  const atual = emCurso.get(cnpj);
  if (atual) return atual;
  const tarefa = (async () => {
    if (!limiteCnpja.tentar()) return "adiada" as const;
    let json: unknown;
    let naoEncontrado = false;
    try {
      const r = await fetch(`${URL_CNPJA}${encodeURIComponent(cnpj)}`, {
        headers: { "User-Agent": USER_AGENT_CNPJA, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (r.status === 429) return "adiada" as const;
      if (r.status === 404) {
        const corpo: unknown = await r.json().catch(() => null);
        if (!naoEncontradoNaCnpja(r.status, corpo)) {
          console.warn("[faturamento] CNPJá respondeu 404 sem dizer que o CNPJ não existe");
          return "falhou" as const;
        }
        naoEncontrado = true;
      } else if (!r.ok) {
        console.warn(`[faturamento] CNPJá respondeu ${r.status}`);
        return "falhou" as const;
      } else {
        json = await r.json();
      }
    } catch (e) {
      console.warn("[faturamento] CNPJá não respondeu", e instanceof Error ? e.message : e);
      return "falhou" as const;
    }
    const dados = naoEncontrado ? dadosNaoEncontrado() : dadosDaCnpja(json);
    if (!dados) return "falhou" as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as DB)
      .schema("ops")
      .rpc("fat_receita_cnpj_gravar", { p_cnpj: cnpj, p_dados: dados });
    if (error) {
      console.error("[faturamento] ops.fat_receita_cnpj_gravar", {
        code: error.code,
        message: error.message,
      });
      return "falhou" as const;
    }
    return "feita" as const;
  })();
  emCurso.set(cnpj, tarefa);
  try {
    return await tarefa;
  } finally {
    emCurso.delete(cnpj);
  }
}

/**
 * §1.8 · Confere o documento do tomador e busca o cliente. Quando `fat_tomador` diz que não há consulta da
 * Receita para o CNPJ (ou ela tem mais de 30 dias), o servidor consulta a CNPJá aberta, grava e chama
 * `fat_tomador` de novo: é isso que deixa valer o bloqueio de CNPJ inapto (CA-05) e o de CNPJ que a Receita não
 * acha (Ana, 21/10/2026). Se a consulta não sair (limite, CNPJá fora), devolve a primeira resposta e diz que a
 * consulta ficou para depois.
 */
export const conferirTomadorFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  // A empresa é obrigatória: o banco confere o papel nela e não abre o cadastro a quem não pede por ela
  // (achado M5 da revisão de 20/10/2026).
  .inputValidator(
    entrada(z.object({ documento: z.string().trim().min(1).max(30), emissora: uuid }).strict()),
  )
  .handler(async ({ context, data }): Promise<Resultado<TomadorConferido>> => {
    const args = { p_documento: data.documento, p_emissora: data.emissora };
    const primeira = await chamar<Tomador>(
      context.supabase,
      "fat_tomador",
      args,
      "A busca do cliente",
    );
    if (!primeira.ok) return primeira;
    const t = primeira.dados;
    if (!(t.valido && t.tipo === "pj" && t.consultar_receita)) {
      return { ok: true, dados: { ...t, consulta_receita: "nao_precisou" } };
    }
    const consulta = await consultarEGravarReceita(t.documento);
    if (consulta !== "feita") return { ok: true, dados: { ...t, consulta_receita: consulta } };
    const segunda = await chamar<Tomador>(
      context.supabase,
      "fat_tomador",
      args,
      "A busca do cliente",
    );
    return segunda.ok
      ? { ok: true, dados: { ...segunda.dados, consulta_receita: "feita" } }
      : { ok: true, dados: { ...t, consulta_receita: "falhou" } };
  });

/** §1.9 · A prévia das parcelas, pela mesma função que grava as parcelas no envio. */
export const previaParcelasFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z
        .object({
          valor: z.number().finite().positive(),
          parcelas: z.number().int().min(1).max(36),
          primeiroVencimento: dia,
        })
        .strict(),
    ),
  )
  .handler(({ context, data }) =>
    chamar<PreviaParcelas>(
      context.supabase,
      "fat_parcelas_previa",
      {
        p_valor: data.valor,
        p_parcelas: data.parcelas,
        p_primeiro_vencimento: data.primeiroVencimento,
      },
      "O cálculo das parcelas",
    ),
  );

/** §1.19 · Configuração: emissoras do recorte (inclusive inativas), pessoas e serviços. Só controladoria. */
export const carregarConfigFaturamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    chamar<ConfigFaturamento>(
      context.supabase,
      "fat_config",
      {},
      "A leitura da configuração do faturamento",
    ),
  );

// ------------------------------------------------------------------ pedido (§1.10 a §1.18)

/** §1.10 · Cria (`id` nulo) ou altera um rascunho ou devolvido. Devolve as pendências que barram o envio. */
export const salvarPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ id: uuid.nullable(), dados: dadosPedido }).strict()))
  .handler(({ context, data }) =>
    chamar<PedidoSalvo>(
      context.supabase,
      "fat_pedido_salvar",
      { p_id: data.id, p_dados: data.dados },
      "O salvamento do pedido",
    ),
  );

/** §1.11 · Envia: dono → fila do Omie; outro → OK do dono. Enviar de novo não gera segundo envio (CA-06). */
export const enviarPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<PedidoEnviado>(
      context.supabase,
      "fat_pedido_enviar",
      { p_id: data.id },
      "O envio do pedido",
    ),
  );

/** §1.12 · Dá o OK (dono, substituto ou gestor; nunca quem enviou nem o autor). */
export const aprovarPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<PedidoMudou>(
      context.supabase,
      "fat_pedido_aprovar",
      { p_id: data.id },
      "O OK do pedido",
    ),
  );

/** §1.13 · Devolve ao autor. Motivo obrigatório: quem recusa vazio é o banco (CA-10). */
export const devolverPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ id: uuid, motivo }).strict()))
  .handler(({ context, data }) =>
    chamar<PedidoMudou>(
      context.supabase,
      "fat_pedido_devolver",
      { p_id: data.id, p_motivo: data.motivo },
      "A devolução do pedido",
    ),
  );

/** §1.14 · Erro no Omie → fila de novo, na mesma linha e com o mesmo código de integração. */
export const reenviarPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<PedidoMudou>(
      context.supabase,
      "fat_pedido_reenviar",
      { p_id: data.id },
      "O reenvio do pedido",
    ),
  );

/** §1.15 · Descarta (só o autor, rascunho ou devolvido sem OS). Vira cancelado; nada é apagado. */
export const descartarPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<PedidoMudou>(
      context.supabase,
      "fat_pedido_descartar",
      { p_id: data.id },
      "O descarte do pedido",
    ),
  );

/** §1.16 · Dono, substituto ou gestor pedem o cancelamento (motivo obrigatório); a tesouraria efetiva. */
export const cancelarPedidoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ id: uuid, motivo: motivo.nullable().optional() }).strict()))
  .handler(({ context, data }) =>
    chamar<PedidoMudou>(
      context.supabase,
      "fat_pedido_cancelar",
      { p_id: data.id, p_motivo: data.motivo ?? null },
      "O cancelamento do pedido",
    ),
  );

/**
 * §1.17 · Ação da tesouraria: conferir, faturar (enfileira `faturar_os`), devolver ou reenviar o que deu erro
 * no Pipefy (`reenviar_pipefy`, revisão de 20/10/2026).
 */
export const acaoTesourariaFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z
        .object({
          id: uuid,
          acao: z.enum(["em_conferencia", "faturar", "devolver", "reenviar_pipefy"]),
          motivo: motivo.nullable().optional(),
        })
        .strict(),
    ),
  )
  .handler(({ context, data }) =>
    chamar<PedidoMudou>(
      context.supabase,
      "fat_tesouraria_acao",
      { p_id: data.id, p_acao: data.acao, p_motivo: data.motivo ?? null },
      "A ação da tesouraria",
    ),
  );

/** §1.18 · "Atualizar agora": enfileira a leitura da situação no Omie (RF-P09). */
export const atualizarStatusFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<StatusEnfileirado>(
      context.supabase,
      "fat_atualizar_status",
      { p_id: data.id },
      "O pedido de leitura no Omie",
    ),
  );

// ------------------------------------------------------------------ configuração (§1.20 a §1.25)

/** §1.20 · Cria (sem `id`) ou altera (com `id`: substituto e ativo) dono, gestor ou solicitante. */
export const salvarDonoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ dados: dadosDono }).strict()))
  .handler(({ context, data }) =>
    chamar<DonoSalvo>(
      context.supabase,
      "fat_dono_salvar",
      { p_dados: data.dados },
      "O cadastro da pessoa",
    ),
  );

/** §1.21 · Desativa a pessoa na empresa (não apaga). */
export const removerDonoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(soId))
  .handler(({ context, data }) =>
    chamar<DonoRemovido>(
      context.supabase,
      "fat_dono_remover",
      { p_id: data.id },
      "A desativação da pessoa",
    ),
  );

/** §1.22 · Liga ou desliga "Aparece no pedido" de um serviço. */
export const ativarServicoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ id: uuid, ativo: z.boolean() }).strict()))
  .handler(({ context, data }) =>
    chamar<ServicoAtivado>(
      context.supabase,
      "fat_servico_ativar",
      { p_id: data.id, p_ativo: data.ativo },
      "A liberação do serviço",
    ),
  );

/** §1.23 · Categoria e conta corrente padrão do serviço. Nulo limpa. */
export const padroesServicoFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z
        .object({
          id: uuid,
          categoria: z.string().trim().max(40).nullable(),
          contaCorrente: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
        })
        .strict(),
    ),
  )
  .handler(({ context, data }) =>
    chamar<ServicoPadroesSalvo>(
      context.supabase,
      "fat_servico_padroes",
      { p_id: data.id, p_categoria: data.categoria, p_conta_corrente: data.contaCorrente },
      "A gravação dos padrões do serviço",
    ),
  );

/** §1.24 · Enfileira a leitura do catálogo do Omie da emissora. */
export const sincronizarServicosFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entrada(z.object({ emissora: uuid }).strict()))
  .handler(({ context, data }) =>
    chamar<SincronizacaoPedida>(
      context.supabase,
      "fat_servicos_sincronizar",
      { p_emissora: data.emissora },
      "O pedido de sincronização do catálogo",
    ),
  );

/** §1.25 · Travas da emissora. Parâmetro nulo = não muda. `gravar` só o admin do Brain (o banco confere). */
export const configurarEmissoraFaturamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    entrada(
      z
        .object({
          emissora: uuid,
          modoOmie: z.enum(["simular", "gravar"]).nullable().optional(),
          pipefySync: z.boolean().nullable().optional(),
          faturaPor: z.enum(["os", "contrato", "ambos"]).nullable().optional(),
        })
        .strict(),
    ),
  )
  .handler(({ context, data }) =>
    chamar<EmissoraConfigurada>(
      context.supabase,
      "fat_emissora_config",
      {
        p_emissora: data.emissora,
        p_modo_omie: data.modoOmie ?? null,
        p_pipefy_sync: data.pipefySync ?? null,
        p_fatura_por: data.faturaPor ?? null,
      },
      "A configuração da empresa",
    ),
  );
