import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  calcularScore,
  cnpjDvValido,
  ESTAGIOS,
  FORCAS,
  FRENTES,
  PAPEIS_DECISAO,
  RELACIONAMENTOS,
  type CandidatoCnpj,
  type ConsumoRow,
  type EstadoFonte,
  type FilaCellaResult,
  type FilaContaRow,
  type GatilhoContaRow,
  type KpisDaily,
} from "@/lib/fila-cella.types";

// Leitura da Fila Cella (Funil B) — spec-tela-fila-cella.md v0.3 §6.
//
// Duas coisas neste arquivo destoam do resto do repo, e as duas são deliberadas:
//
// 1. `(supabase as any).from("v_fila_cella")`. As migrations 20260826090000..94000
//    foram commitadas e não aplicadas, então `types.ts` não pode ser regenerado e
//    a view não existe no tipo `Database`. Precedente do repo para o mesmo caso:
//    cac.functions.ts:410 e rede-headcount.tsx:61.
// 2. Erro de "relação não existe" NÃO vira exceção. Vira um estado nomeado
//    (`nao_migrado`), porque enquanto as migrations forem PR esse é o caminho
//    normal — e uma tela que abre em card vermelho faz o PR parecer quebrado.

/**
 * Códigos que o PostgREST devolve quando a relação não existe. PGRST205 é
 * "tabela não encontrada no schema cache"; 42P01 é o SQLSTATE cru do Postgres;
 * PGRST202 é a função/rpc equivalente.
 *
 * NÃO VERIFICADO: qual desses o projeto Ops devolve de fato. Não havia acesso
 * SQL ao banco na sessão em que isto foi escrito, e o repo tem um só precedente
 * de leitura de código de erro (roles.functions.ts:51, "23505"). O matcher é
 * defensivo de propósito — apertar depois da primeira execução real.
 */
function relacaoAusente(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

const AVISO_NAO_MIGRADO =
  "As tabelas da Fila Cella ainda não existem neste banco. As migrations " +
  "20260826090000 a 20260826094000 estão no repositório e não foram aplicadas.";

async function assertCan(supabase: any, chave: string, recado: string) {
  const { data, error } = await supabase.rpc("can", { _key: chave });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error(`Acesso negado: ${recado}`);
}

async function lerLista(supabase: any, lista: "fila" | "novos_do_mes"): Promise<FilaCellaResult> {
  const { data, error } = await supabase.from("v_fila_cella").select("*").eq("lista", lista);

  if (error) {
    if (relacaoAusente(error)) {
      return { rows: [], estado: "nao_migrado", sincronizadoEm: null, aviso: AVISO_NAO_MIGRADO };
    }
    throw new Error(`Falha ao ler v_fila_cella: ${error.message}`);
  }

  const rows = (data ?? []) as FilaContaRow[];
  if (rows.length === 0) {
    return {
      rows: [],
      estado: "nunca_sincronizado",
      sincronizadoEm: null,
      aviso: "A fila ainda não foi sincronizada. Última tentativa: nunca.",
    };
  }

  // A view não expõe sincronizado_em (é coluna de fila_cella_contas, e a view
  // projeta a camada de negócio). Uma leitura barata do máximo resolve o bloco A
  // sem carregar a tabela inteira de novo.
  const { data: sync } = await supabase
    .from("fila_cella_contas")
    .select("sincronizado_em")
    .order("sincronizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    rows,
    estado: "ok",
    sincronizadoEm: (sync?.sincronizado_em as string | null) ?? null,
    aviso: null,
  };
}

export const listarFilaCella = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FilaCellaResult> => {
    return lerLista(context.supabase as any, "fila");
  });

/**
 * Os novos contratos do mês são LISTA DISTINTA, não filtro da Fila: só 6 dos 45
 * chegam ao piso de R$ 25MM que define a Fila (spec §6.2, bloco E).
 */
export const listarNovosDoMes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FilaCellaResult> => {
    return lerLista(context.supabase as any, "novos_do_mes");
  });

/**
 * KRs da daily (13h30) + os contadores de higiene do playbook §5.6.
 *
 * Todo indicador devolve `null` — nunca `0` — quando a fonte não está de pé.
 * Zero é uma afirmação, e afirmar errado é o que spec-dash-funil-cella.md:49
 * proíbe.
 *
 * QUALIDADE não tem definição fechada na spec (é "o KR de qualidade dito em
 * cinco linhas"). Aqui é a leitura operacional: fração das contas tocadas que
 * não têm nenhuma das quatro pendências de higiene. Se a daily fechar outra
 * definição, é esta linha que muda.
 */
export const kpisDaily = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KpisDaily> => {
    const supabase = context.supabase as any;
    const vazio = (estado: EstadoFonte): KpisDaily => ({
      estado,
      kr1Abordadas: null,
      kr1Meta: 40,
      kr2TaxaResposta: null,
      kr2Reunioes: null,
      kr3Propostas: null,
      kr3Meta: 5,
      qualidade: null,
      higiene: {
        semProximoPasso: null,
        parados15d: null,
        perdidoSemMotivo: null,
        passoVencido: null,
      },
    });

    const { data: filaData, error: filaErr } = await supabase
      .from("v_fila_cella")
      .select(
        "id,estagio,proximo_passo,proximo_passo_em,motivo_perda,ciclo_id,toques,esfriando,passo_vencido",
      )
      .eq("lista", "fila");
    if (filaErr) {
      if (relacaoAusente(filaErr)) return vazio("nao_migrado");
      throw new Error(`Falha ao ler v_fila_cella: ${filaErr.message}`);
    }
    const fila = (filaData ?? []) as Pick<
      FilaContaRow,
      | "id"
      | "estagio"
      | "proximo_passo"
      | "proximo_passo_em"
      | "motivo_perda"
      | "ciclo_id"
      | "toques"
      | "esfriando"
      | "passo_vencido"
    >[];
    if (fila.length === 0) return vazio("nunca_sincronizado");

    const hoje = new Date();
    const inicioMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

    const [{ data: toquesData }, { data: ciclosData }] = await Promise.all([
      supabase.from("fila_cella_toques").select("ciclo_id,resultado,data").gte("data", inicioMes),
      supabase.from("fila_cella_ciclos").select("id,conta_id"),
    ]);
    const contaPorCiclo = new Map<number, number>(
      ((ciclosData ?? []) as { id: number; conta_id: number }[]).map((c) => [c.id, c.conta_id]),
    );
    const toques = ((toquesData ?? []) as { ciclo_id: number; resultado: string }[]).filter((t) =>
      contaPorCiclo.has(t.ciclo_id),
    );

    const contasTocadas = new Set(toques.map((t) => contaPorCiclo.get(t.ciclo_id)!));
    const responderam = toques.filter(
      (t) => t.resultado === "Respondeu" || t.resultado === "Reunião agendada",
    ).length;
    const reunioes = toques.filter((t) => t.resultado === "Reunião agendada").length;

    const ESTAGIO_PROPOSTA = ["6 Proposta enviada", "7 Em negociação", "8 Fechado"];
    const propostas = fila.filter((r) => ESTAGIO_PROPOSTA.includes(r.estagio)).length;

    const semProximoPasso = fila.filter(
      (r) => r.ciclo_id != null && (r.toques ?? 0) > 0 && !r.proximo_passo,
    ).length;
    const parados15d = fila.filter((r) => r.esfriando).length;
    const perdidoSemMotivo = fila.filter((r) => r.estagio === "Perdido" && !r.motivo_perda).length;
    const passoVencido = fila.filter((r) => r.passo_vencido).length;

    const tocadas = fila.filter((r) => contasTocadas.has(r.id));
    const comPendencia = tocadas.filter(
      (r) =>
        (r.ciclo_id != null && (r.toques ?? 0) > 0 && !r.proximo_passo) ||
        r.esfriando ||
        r.passo_vencido ||
        (r.estagio === "Perdido" && !r.motivo_perda),
    ).length;

    return {
      estado: "ok",
      kr1Abordadas: contasTocadas.size,
      kr1Meta: 40,
      kr2TaxaResposta: toques.length > 0 ? responderam / toques.length : null,
      kr2Reunioes: reunioes,
      kr3Propostas: propostas,
      kr3Meta: 5,
      qualidade: tocadas.length > 0 ? 1 - comPendencia / tocadas.length : null,
      higiene: { semProximoPasso, parados15d, perdidoSemMotivo, passoVencido },
    };
  });

/** Evidência da conta: gatilho conta contábil por conta contábil + consumo. */
export const detalheDaConta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cnpj: string | null }) => ({
    cnpj: (input?.cnpj ?? "").replace(/\D/g, "") || null,
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ gatilhos: GatilhoContaRow[]; consumo: ConsumoRow[]; grupo: string[] }> => {
      if (!data.cnpj) return { gatilhos: [], consumo: [], grupo: [] };
      const supabase = context.supabase as any;
      const raiz = data.cnpj.slice(0, 8);

      const [gat, cons, grupo] = await Promise.all([
        supabase
          .from("ecd_gatilho_conta")
          .select("gatilho,nome_conta,cod_cta,tipo,valor,ano")
          .eq("cnpj", data.cnpj)
          .order("gatilho", { ascending: true }),
        supabase
          .from("empresa_consumo")
          .select("categoria,metrica,valor_total,qtd_contas,ano")
          .eq("cnpj", data.cnpj)
          .order("valor_total", { ascending: false }),
        // grupo econômico: mesma raiz de CNPJ (spec §5.4)
        supabase.from("ecd_empresa").select("cnpj,razao_social_ecd").like("cnpj", `${raiz}%`),
      ]);

      if (relacaoAusente(gat.error) || relacaoAusente(cons.error)) {
        return { gatilhos: [], consumo: [], grupo: [] };
      }

      return {
        gatilhos: ((gat.data ?? []) as GatilhoContaRow[]).filter((g) => Math.abs(g.valor) >= 1),
        consumo: (cons.data ?? []) as ConsumoRow[],
        grupo: ((grupo.data ?? []) as { cnpj: string }[])
          .map((g) => g.cnpj)
          .filter((c) => c !== data.cnpj),
      };
    },
  );

/**
 * Camada operada. Nunca é reconstruída pelo job de sync — é o que a planilha
 * destrói a cada rebuild.
 *
 * `estagio` só muda por ação explícita: o toque NÃO avança o estágio ("funil
 * inflado é o defeito mais comum e o mais caro", playbook §5.1).
 */
export const salvarCampoOperado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      conta_id: number;
      relacionamento?: string;
      relacionamento_resposta?: string | null;
      papel_decisao?: string | null;
      urgencia?: boolean;
      estagio?: string;
      forca_override?: string | null;
      forca_motivo?: string | null;
      frente_escolhida?: string | null;
      proximo_passo?: string | null;
      proximo_passo_em?: string | null;
      motivo_perda?: string | null;
      conflito_interno?: boolean;
    }) => {
      const conta_id = Number(input.conta_id);
      if (!Number.isInteger(conta_id) || conta_id <= 0) throw new Error("Conta inválida.");

      // Domínio dos campos fechados. A tela só oferece estes valores, mas esta
      // função é um endpoint: quem chamar direto passa o que quiser, e a escrita
      // acontece com `supabaseAdmin` (service_role), onde RLS não filtra. Sem
      // isto, `estagio` era o buraco maior — a coluna não tinha CHECK no banco
      // até a correção de 25/08, e `kpisDaily` conta proposta comparando o
      // estágio com string literal: valor fora da lista dava KPI errado, calado.
      const emDominio = (campo: string, valor: unknown, permitidos: readonly string[]) => {
        if (valor === undefined || valor === null) return;
        if (typeof valor !== "string" || !permitidos.includes(valor)) {
          throw new Error(`Valor inválido para ${campo}: ${String(valor)}.`);
        }
      };
      emDominio("relacionamento", input.relacionamento, RELACIONAMENTOS);
      emDominio("estágio", input.estagio, ESTAGIOS);
      emDominio("papel na decisão", input.papel_decisao, PAPEIS_DECISAO);
      emDominio("frente", input.frente_escolhida, FRENTES);
      emDominio("força (override)", input.forca_override, FORCAS);

      // A constraint fila_cella_operacao_override_exige_motivo é
      // `forca_override is null or forca_motivo not blank` — e ela olha a LINHA
      // INTEIRA depois do upsert, não o patch. Limpar só o motivo, deixando o
      // override gravado, violava a constraint e devolvia erro de Postgres cru
      // na tela. As duas regras abaixo fecham os dois lados.
      if (input.forca_override && !(input.forca_motivo ?? "").trim()) {
        throw new Error("Override de força exige motivo.");
      }
      if (
        input.forca_motivo !== undefined &&
        !(input.forca_motivo ?? "").trim() &&
        input.forca_override === undefined
      ) {
        throw new Error(
          "Para apagar o motivo, apague o override de força junto — a linha não pode ficar com override sem motivo.",
        );
      }

      if (input.proximo_passo_em && !/^\d{4}-\d{2}-\d{2}$/.test(input.proximo_passo_em)) {
        throw new Error("Data do próximo passo inválida.");
      }
      return { ...input, conta_id };
    },
  )
  .handler(async ({ data, context }) => {
    await assertCan(
      context.supabase as any,
      "manage.fila_cella",
      "você não pode editar a Fila Cella.",
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: Record<string, unknown> = {
      conta_id: data.conta_id,
      atualizado_por: context.userId,
      atualizado_em: new Date().toISOString(),
    };
    const campos = [
      "relacionamento",
      "relacionamento_resposta",
      "papel_decisao",
      "urgencia",
      "estagio",
      "forca_override",
      "forca_motivo",
      "frente_escolhida",
      "proximo_passo",
      "proximo_passo_em",
      "motivo_perda",
      "conflito_interno",
    ] as const;
    for (const c of campos) {
      if (data[c] !== undefined) patch[c] = data[c];
    }
    // Tirar o override tem de tirar o motivo junto: motivo órfão descreve uma
    // decisão que não existe mais.
    if (data.forca_override === null && data.forca_motivo === undefined) {
      patch.forca_motivo = null;
    }
    // A constraint fila_cella_operacao_relacionamento_exige_autor obriga
    // relacionamento_em sempre que o relacionamento sai de "Não verificado".
    if (data.relacionamento && data.relacionamento !== "Não verificado") {
      patch.relacionamento_em = new Date().toISOString();
      patch.relacionamento_por = context.userId;
    }

    const { error } = await (supabaseAdmin as any)
      .from("fila_cella_conta_operacao")
      .upsert(patch, { onConflict: "conta_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Candidatos de CNPJ para uma conta sem reconciliação (§6.7 item 4). */
export const buscarCandidatosCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { termo: string }) => {
    const termo = (input?.termo ?? "").trim();
    if (termo.length < 3) throw new Error("Informe pelo menos 3 caracteres.");
    return { termo };
  })
  .handler(async ({ data, context }): Promise<{ candidatos: CandidatoCnpj[] }> => {
    const supabase = context.supabase as any;
    const termo = data.termo.replace(/[%,()]/g, " ");

    // Duas fontes, porque nenhuma sozinha resolve: `omie_clientes_cadastro` tem
    // (cnpj, razao_social) e é a base larga (10.226 linhas, legível hoje);
    // `omie_clientes` acrescenta `nome_fantasia`, que é a fonte única do CNPJ de
    // 3 das 43 contas reconciliadas (spec §5.2, estratégia f3) — e só passa a ser
    // legível com a policy criada em 20260826093000.
    const [cadastro, omie] = await Promise.all([
      supabase
        .from("omie_clientes_cadastro")
        .select("cnpj,razao_social")
        .ilike("razao_social", `%${termo}%`)
        .limit(20),
      supabase
        .from("omie_clientes")
        .select("cnpj_cpf,razao_social,nome_fantasia")
        .or(`razao_social.ilike.%${termo}%,nome_fantasia.ilike.%${termo}%`)
        .limit(20),
    ]);
    if (cadastro.error && !relacaoAusente(cadastro.error)) {
      throw new Error(cadastro.error.message);
    }

    // A similaridade fica NULL aqui: o trigram roda no job de reconciliação, não
    // na tela. O que a tela mostra é a busca literal + o DV, que é o que o
    // operador consegue conferir olhando as duas razões sociais lado a lado.
    const porCnpj = new Map<string, CandidatoCnpj>();
    const registrar = (cnpjBruto: string | null, razao: string | null, fantasia: string | null) => {
      const cnpj = (cnpjBruto ?? "").replace(/\D/g, "");
      if (cnpj.length !== 14) return;
      const atual = porCnpj.get(cnpj);
      porCnpj.set(cnpj, {
        cnpj,
        razao_social: atual?.razao_social ?? razao,
        nome_fantasia: atual?.nome_fantasia ?? fantasia,
        similaridade: null,
        dv_valido: cnpjDvValido(cnpj),
      });
    };
    for (const r of (cadastro.data ?? []) as { cnpj: string; razao_social: string | null }[]) {
      registrar(r.cnpj, r.razao_social, null);
    }
    for (const r of (omie.data ?? []) as {
      cnpj_cpf: string | null;
      razao_social: string | null;
      nome_fantasia: string | null;
    }[]) {
      registrar(r.cnpj_cpf, r.razao_social, r.nome_fantasia);
    }
    return { candidatos: [...porCnpj.values()] };
  });

/**
 * Confirma o CNPJ de uma conta. Grava `revisado_por`/`revisado_em` — e linha com
 * `revisado_por` preenchido NUNCA é sobrescrita por rotina, só completada (mesmo
 * princípio do COALESCE(keeper, loser) de DECISIONS.md:51).
 */
export const resolverCnpjConta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      pipedrive_deal_id: string;
      cnpj: string;
      papel?: "principal" | "filial" | "coligada";
      razao_social?: string | null;
      observacao?: string | null;
    }) => {
      const deal = (input.pipedrive_deal_id ?? "").trim();
      if (!deal) throw new Error("Conta sem deal do Pipedrive — não dá para gravar o de-para.");
      const cnpj = (input.cnpj ?? "").replace(/\D/g, "");
      if (cnpj.length !== 14) throw new Error("CNPJ precisa ter 14 dígitos.");
      const papel = input.papel ?? "principal";
      if (!["principal", "filial", "coligada"].includes(papel)) throw new Error("Papel inválido.");
      return {
        pipedrive_deal_id: deal,
        cnpj,
        papel,
        razao_social: (input.razao_social ?? "")?.trim() || null,
        observacao: (input.observacao ?? "")?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase as any, "manage.de_para_cnpj", "você não pode resolver CNPJ.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: existente } = await admin
      .from("empresa_cnpj_de_para")
      .select("id,revisado_por")
      .eq("pipedrive_deal_id", data.pipedrive_deal_id)
      .eq("cnpj", data.cnpj)
      .maybeSingle();
    if (existente?.revisado_por) {
      throw new Error(
        "Esse vínculo já foi revisado por alguém — linha revisada não se sobrescreve.",
      );
    }

    const linha = {
      pipedrive_deal_id: data.pipedrive_deal_id,
      cnpj: data.cnpj,
      papel: data.papel,
      razao_social: data.razao_social,
      fonte: "tela.fila_cella",
      confianca: "alta",
      similaridade: null,
      dv_valido: cnpjDvValido(data.cnpj),
      revisado_por: context.userId,
      revisado_em: new Date().toISOString(),
      observacao: data.observacao,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin
      .from("empresa_cnpj_de_para")
      .upsert(linha, { onConflict: "pipedrive_deal_id,cnpj" });
    if (error) {
      // `empresa_cnpj_de_para_principal_unico` é índice único PARCIAL em
      // (pipedrive_deal_id) where papel = 'principal'. O `onConflict` acima é a
      // constraint (deal, cnpj) — não a alcança. Então gravar um segundo CNPJ
      // como principal para o mesmo deal estoura 23505 e o operador via
      // "duplicate key value violates unique constraint …", que não diz nada.
      // O caso não é raro: é exatamente o de corrigir um CNPJ errado.
      if (error.code === "23505" && String(error.message).includes("principal_unico")) {
        throw new Error(
          "Esta conta já tem um CNPJ principal diferente. Um deal só pode ter um principal — " +
            'grave este como "filial" ou "coligada", ou corrija o principal existente primeiro.',
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

/** Reexporta o score canônico para quem só importa o módulo de server fns. */
export { calcularScore };
