import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAffected } from "@/lib/supabase-assert";
import { registrarAcesso } from "@/lib/acessos.server";
import {
  lerRegistroPipefy,
  normalizarEmails,
  normalizarSigla,
  validarUnidade,
  type RegistroPipefyUnidade,
  type UnidadeEntrada,
  type UnidadeLinha,
} from "@/lib/unidades-cadastro";

// Cadastro de unidade pela tela Regras da Rede (/unidades), desde 01/10/2026.
// Antes disso toda unidade nova entrava por SQL (São Bernardo, Recife e
// Sorocaba em 16/09, São Paulo em 21/09), e cada uma deixou uma lacuna que só
// apareceu semanas depois. A escrita passa pela RLS de ops.unidades
// (migration 20261001220000), que pede a mesma chave que a checagem abaixo.

/** Base "[PTRS-DB-02] Unidades" do Pipefy: a fonte do cadastro das unidades. */
const PIPEFY_TABELA_UNIDADES = "307173431";

/**
 * Serviço do CSC no Omie da Partners (SRV00004). É o das unidades que entraram
 * de 09/2026 em diante; as antigas usam dois outros, e trocar o delas não é
 * assunto desta tela.
 */
const SERVICO_OMIE_CSC = 2216132558;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exigirChave(supabase: any, chave: string, oQue: string): Promise<void> {
  const { data, error } = await supabase.rpc("can", { _key: chave });
  if (error) throw new Error("Erro de autorização. Tente novamente.");
  if (!data) throw new Error(`Acesso negado: você não pode ${oQue}.`);
}

/** A mensagem do Postgres para unicidade vira a frase que a pessoa entende. */
function erroDeGravacao(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    if (error.message.includes("nome_da_praca"))
      return new Error("Já existe uma unidade com esse nome.");
    if (error.message.includes("pipefy_id")) {
      return new Error("Esse registro do Pipefy já está ligado a outra unidade.");
    }
    if (error.message.includes("pipedrive_opcao_id")) {
      return new Error("Essa opção do Pipedrive já está ligada a outra unidade.");
    }
  }
  return new Error(error.message);
}

export type RegistroPipefyComVinculo = RegistroPipefyUnidade & {
  /** Unidade do Ops que já aponta para este registro, se houver. */
  unidade_vinculada: string | null;
};

/** Registros da base de Unidades do Pipefy, para preencher o formulário de unidade nova. */
export const listarBasePipefyUnidades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RegistroPipefyComVinculo[]> => {
    const { supabase } = context;
    await exigirChave(supabase, "manage.unidades_rede", "cadastrar unidades");

    const pipefyToken = process.env.PIPEFY_TOKEN;
    if (!pipefyToken) throw new Error("PIPEFY_TOKEN não configurado no servidor.");

    // 39 registros em 01/10/2026; a página de 100 cobre com folga, e passar
    // disso é aviso, não corte silencioso.
    const query = `{ table_records(table_id: "${PIPEFY_TABELA_UNIDADES}", first: 100) {
      pageInfo { hasNextPage }
      edges { node { id title record_fields { field { id } value } } } } }`;
    const resp = await fetch("https://api.pipefy.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${pipefyToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!resp.ok) throw new Error(`Pipefy respondeu HTTP ${resp.status}.`);
    const body = await resp.json();
    if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
    const tabela = body.data?.table_records;
    if (tabela?.pageInfo?.hasNextPage) {
      console.warn(
        "[listarBasePipefyUnidades] a base passou de 100 registros; só os 100 primeiros foram lidos",
      );
    }

    const { data: unidades, error } = await supabase
      .from("unidades")
      .select("nome_da_praca,pipefy_id")
      .not("pipefy_id", "is", null);
    if (error) throw new Error(error.message);
    const vinculo = new Map<string, string>(
      (unidades ?? []).map((u: { pipefy_id: string; nome_da_praca: string }) => [
        String(u.pipefy_id),
        u.nome_da_praca,
      ]),
    );

    return (
      (tabela?.edges ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((e: any) => lerRegistroPipefy(e.node))
        .map((r: RegistroPipefyUnidade) => ({
          ...r,
          unidade_vinculada: vinculo.get(r.pipefy_id) ?? null,
        }))
        .sort((a: RegistroPipefyComVinculo, b: RegistroPipefyComVinculo) =>
          a.titulo.localeCompare(b.titulo, "pt-BR"),
        )
    );
  });

export type CscNovo = { sigla: string; emails: string[] };

export type ResultadoSalvarUnidade = {
  id: number;
  criada: boolean;
  /** Preenchido quando a unidade foi salva mas o registro de CSC pedido não. */
  avisoCsc: string | null;
};

/**
 * Cria (sem `id`) ou atualiza (com `id`) uma unidade. Com `csc`, cria também o
 * registro em ops.csc_unidades, que é o que põe a unidade em "Emitir faturas".
 */
export const salvarUnidade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { unidade: UnidadeEntrada; csc?: CscNovo | null }) => d)
  .handler(async ({ data, context }): Promise<ResultadoSalvarUnidade> => {
    const { supabase, userId } = context;
    await exigirChave(supabase, "manage.unidades_rede", "cadastrar nem editar unidades");

    const linha = validarUnidade(data.unidade);
    const id = data.unidade.id;

    let unidadeId: number;
    let antes: Partial<UnidadeLinha> | null = null;
    if (id == null) {
      const res = await supabase.from("unidades").insert(linha).select("id");
      if (res.error) throw erroDeGravacao(res.error);
      unidadeId = assertAffected(res, "A unidade não foi criada (bloqueio de permissão).")[0].id;
    } else {
      const { data: atual, error: erroLeitura } = await supabase
        .from("unidades")
        .select(Object.keys(linha).join(","))
        .eq("id", id)
        .maybeSingle();
      if (erroLeitura) throw new Error(erroLeitura.message);
      if (!atual) throw new Error("Unidade não encontrada.");
      antes = atual as Partial<UnidadeLinha>;
      const res = await supabase.from("unidades").update(linha).eq("id", id).select("id");
      if (res.error) throw erroDeGravacao(res.error);
      assertAffected(res, `Nenhuma unidade foi atualizada (id ${id}): bloqueio de permissão.`);
      unidadeId = id;
    }

    // Só o que mudou vai para o log; numeric volta como texto do PostgREST, daí a comparação por String.
    const mudou: Record<string, { antes: unknown; depois: unknown }> = {};
    for (const [k, v] of Object.entries(linha)) {
      const anterior = antes ? (antes as Record<string, unknown>)[k] : null;
      if (antes && String(anterior ?? "") === String(v ?? "")) continue;
      mudou[k] = { antes: anterior ?? null, depois: v };
    }
    await registrarAcesso(userId, null, id == null ? "unidade_criar" : "unidade_editar", {
      unidade_id: unidadeId,
      nome: linha.nome_da_praca,
      campos: mudou,
    });

    let avisoCsc: string | null = null;
    if (data.csc) {
      try {
        await criarCsc(supabase, userId, unidadeId, linha, data.csc);
      } catch (e) {
        avisoCsc = e instanceof Error ? e.message : String(e);
      }
    }
    return { id: unidadeId, criada: id == null, avisoCsc };
  });

async function criarCsc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  unidadeId: number,
  linha: UnidadeLinha,
  csc: CscNovo,
): Promise<void> {
  await exigirChave(supabase, "edit.csc_faturamento", "editar o faturamento do CSC");
  if (!linha.id_omie)
    throw new Error("Para entrar no faturamento do CSC, informe o cliente no Omie da Partners.");
  if (!linha.csc_valor_fixo || linha.csc_valor_fixo <= 0) {
    throw new Error("Para entrar no faturamento do CSC, informe o CSC fixo (R$).");
  }
  const sigla = normalizarSigla(csc.sigla);
  const emails = normalizarEmails(csc.emails);
  if (emails.length === 0) throw new Error("Informe ao menos um e-mail para a fatura do CSC.");

  const { data: existente, error: erroLeitura } = await supabase
    .from("csc_unidades")
    .select("sigla")
    .eq("unidade_id", unidadeId)
    .maybeSingle();
  if (erroLeitura) throw new Error(erroLeitura.message);
  if (existente)
    throw new Error(`A unidade já está no faturamento do CSC (sigla ${existente.sigla}).`);

  // csc_automatico = false: a rotina mensal não emite sozinha. É o mesmo
  // tratamento de São Bernardo, Recife e Sorocaba (migration 83, 25/09), cujo
  // CSC tem condicional que muda o valor. Ligar o automático é decisão à parte.
  const res = await supabase
    .from("csc_unidades")
    .insert({
      sigla,
      nome: linha.nome_da_praca,
      unidade_id: unidadeId,
      valor_csc: linha.csc_valor_fixo,
      cliente_omie: Number(linha.id_omie),
      servico_omie: SERVICO_OMIE_CSC,
      emails,
      csc_automatico: false,
      observacao: "Criado no cadastro da unidade (Regras da Rede).",
    })
    .select("sigla");
  if (res.error) {
    if (res.error.code === "23505")
      throw new Error(`A sigla ${sigla} já é de outra unidade no CSC.`);
    throw new Error(res.error.message);
  }
  assertAffected(res, "O registro do CSC não foi criado (bloqueio de permissão).");
  await registrarAcesso(userId, null, "csc_unidade_criar", {
    unidade_id: unidadeId,
    sigla,
    emails,
  });
}
