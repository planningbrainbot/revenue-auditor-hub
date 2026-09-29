// Leitura do tema Ter · Financeiro e Operações (servidor).
//
// Duas famílias de fonte, e cada parte falha sozinha (nunca lança por uma fonte):
// - Financial Brain, com a credencial de servidor do Ops, atrás da MESMA porta do Cockpit do CEO
//   (`conferirPortaFinanceiro`: produto Financeiro + todas as empresas). Porta fechada = nenhuma
//   chamada sai, e as quatro partes voltam "acesso insuficiente" com o motivo. Sem exceção.
// - Banco único, com a sessão da pessoa (RLS): apuração de royalties, faturas do repasse e o título
//   delas na conta da Partners, e a fila de onboarding. Cada uma confere a porta antes de ler, para
//   a RLS não devolver vazio com cara de zero.
//
// Todas as unidades são lidas; o filtro de unidade é aplicado em `montarFinanceiroOperacoes`.
import type { ContextoCoo, Db } from "../contexto.server.ts";
import { clienteFinancialBrain, conferirPortaFinanceiro } from "@/lib/cockpit-ceo/financeiro-porta";
import { todasAsPaginas } from "@/lib/cockpit-ceo/paginar";
import { fontesSemAcesso, motivoSemAcesso } from "@/lib/cockpit-ceo/portas";
import {
  extrairCaixaLivre,
  extrairDre,
  extrairExposicao,
  extrairFluxo,
  fimDoMes,
  janelasFinanceiro,
  mesesAte,
  MESES_SERIE,
} from "./financeiro-operacoes.ts";
import type {
  ApuracaoLida,
  CardLido,
  DadosFinanceiroOperacoes,
  Exposicao,
  Falha,
  FaturaLida,
  MesValor,
  Parte,
  SaldoMes,
} from "./financeiro-operacoes.ts";
import { blocosDeMeses, mesAnterior } from "../montar.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codigo = (e: any) => (e?.code ? ` (código ${e.code})` : "");
const falha = (estado: Falha["estado"], motivo: string): Falha => ({ ok: false, estado, motivo });
const N = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Uma chamada ao Financial Brain: erro da RPC ou payload fora do formato viram `Falha`. */
async function parteFinanceiro<T>(
  nome: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chamada: () => PromiseLike<{ data: unknown; error: any }>,
  extrair: (cru: unknown) => T,
): Promise<{ ok: true; valor: T } | Falha> {
  try {
    const r = await chamada();
    if (r.error) {
      console.error(`[cockpit-coo] financeiro/${nome}:`, r.error);
      return falha("fonte_indisponivel", `a consulta de ${nome} no Brain Financeiro falhou${codigo(r.error)}`);
    }
    return { ok: true, valor: extrair(r.data) };
  } catch (e) {
    console.error(`[cockpit-coo] financeiro/${nome}:`, e);
    return falha("fonte_indisponivel", `a leitura de ${nome} no Brain Financeiro falhou: ${(e as Error).message}`);
  }
}

async function lerFinanceiro(
  db: Db,
  hoje: string,
  todasEmpresas: boolean,
): Promise<Pick<DadosFinanceiroOperacoes, "saldo" | "fluxo" | "exposicao" | "dre">> {
  const todas = (f: Falha) => ({ saldo: f, fluxo: f, exposicao: f, dre: f });
  const porta = await conferirPortaFinanceiro(db, todasEmpresas);
  if (!porta.aberta) return todas(falha(porta.estado, porta.motivo));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin = (await clienteFinancialBrain()) as any;
  if (!fin)
    return todas(falha("fonte_indisponivel", "a credencial do Financial Brain não está configurada neste ambiente"));

  const j = janelasFinanceiro(hoje);
  const aprovacoes = (competencia: string) =>
    parteFinanceiro<Exposicao>(
      "aprovações de caixa",
      () =>
        fin.rpc("fn_aprovacoes_caixa", {
          p_grupos: null,
          p_empresas: null,
          p_competencia: competencia,
          p_venc_ate: j.exposicao.ate,
          p_venc_de: j.exposicao.de,
        }),
      extrairExposicao,
    );
  const [saldos, fluxo, dre, exp0] = await Promise.all([
    // Um mês por chamada: a função devolve o último mês com saldo DENTRO da janela, e a série de
    // fim de mês precisa de cada um. São chamadas leves (uma linha por empresa e mês).
    Promise.all(
      j.saldoMeses.map((m) =>
        parteFinanceiro<SaldoMes>(
          `caixa livre de ${m}`,
          () =>
            fin.rpc("fn_cockpit_caixa_livre", {
              p_grupos: null,
              p_empresas: null,
              p_departamentos: null,
              p_comp_de: `${m}-01`,
              p_comp_ate: fimDoMes(m),
            }),
          (cru) => extrairCaixaLivre(m, cru),
        ),
      ),
    ),
    // Fluxo realizado pela função COM cache (`fn_dfc_matriz`), a mesma que a tela do Financeiro usa.
    // A de cálculo levou 25 s para três meses em 29/09 e estourava o limite do PostgREST (57014);
    // a com cache calcula em ~5 s na primeira vez (lê a MV de lançamentos) e guarda o resultado,
    // chaveado pelo carimbo dos lançamentos e dos saldos. Mesmo formato de resposta.
    parteFinanceiro<MesValor[]>(
      "fluxo de caixa",
      () =>
        fin.rpc("fn_dfc_matriz", {
          p_comp_de: j.fluxo.de,
          p_comp_ate: j.fluxo.ate,
          p_nivel_max: 1,
        }),
      extrairFluxo,
    ),
    // DRE do ano em blocos de até três meses, em paralelo: jan–ago numa chamada levava 7 s e
    // estourava o limite do PostgREST (57014) quando corria junto das outras; um mês leva ~2,5 s.
    // Cada bloco devolve os seus meses, e os meses não se repetem entre blocos.
    Promise.all(
      blocosDeMeses(j.dre.de, j.dre.ate, 3).map(([de, ate]) =>
        parteFinanceiro(
          `DRE de ${de.slice(0, 7)} a ${ate.slice(0, 7)}`,
          () => fin.rpc("fn_dre_comp_caixa", { p_comp_de: de, p_comp_ate: ate, p_nivel_max: 1 }),
          extrairDre,
        ),
      ),
    ).then((partes) => {
      const falhou = partes.find((x) => !x.ok);
      if (falhou) return falhou;
      const ok = partes as { ok: true; valor: { meses: MesValor[]; recortesFora: string[] } }[];
      return {
        ok: true as const,
        valor: {
          meses: ok.flatMap((x) => x.valor.meses).sort((a, b) => a.mes.localeCompare(b.mes)),
          recortesFora: [...new Set(ok.flatMap((x) => x.valor.recortesFora))],
        },
      };
    }),
    aprovacoes(j.exposicao.competencia),
  ]);

  const saldoFalho = saldos.find((s): s is Falha => !s.ok);
  // Mês que ainda não tem saldo carimbado (dia 1º, por exemplo): a exposição usa o saldo do mês
  // anterior em vez de somar "a receber − a pagar" com nome de saldo.
  let exp = exp0;
  if (exp.ok && !exp.valor.saldoDisponivel)
    exp = await aprovacoes(`${mesAnterior(j.exposicao.competencia.slice(0, 7))}-01`);

  return {
    saldo: saldoFalho ?? { ok: true, meses: saldos.map((s) => (s as { ok: true; valor: SaldoMes }).valor) },
    fluxo: fluxo.ok ? { ok: true, meses: fluxo.valor, janela: j.fluxo } : fluxo,
    exposicao: exp.ok ? { ok: true, dado: exp.valor } : exp,
    dre: dre.ok ? { ok: true, meses: dre.valor.meses, recortesFora: dre.valor.recortesFora } : dre,
  };
}

async function lerRepasse(
  db: Db,
  hoje: string,
  acesso: { roles: string[]; permissions: string[] },
  todasUnidades: boolean,
): Promise<DadosFinanceiroOperacoes["repasse"]> {
  if (!todasUnidades)
    return falha("acesso_insuficiente", "O repasse da rede exige ver todas as unidades; seu escopo é por unidade.");
  const faltam = fontesSemAcesso(["royalties_apuracao"], acesso);
  if (faltam.length) return falha("acesso_insuficiente", `Sem leitura do repasse: ${motivoSemAcesso(faltam)}.`);

  const fechado = mesAnterior(hoje.slice(0, 7));
  const de = `${mesesAte(fechado, MESES_SERIE)[0]}-01`;
  const ate = `${hoje.slice(0, 7)}-01`;
  let apuracoes: ApuracaoLida[];
  try {
    const linhas = await todasAsPaginas((i, f) =>
      db
        .from("royalties_apuracao")
        .select(
          "id, unidade_id, mes_referencia, status, royalties_valor, csc_valor_fixo, csc_base_antiga_valor, total_fatura, updated_at",
        )
        .gte("mes_referencia", de)
        .lt("mes_referencia", ate)
        .order("id")
        .range(i, f),
    );
    apuracoes = linhas.map((a) => ({
      unidadeId: Number(a.unidade_id),
      mes: String(a.mes_referencia).slice(0, 7),
      status: String(a.status ?? ""),
      royalties: N(a.royalties_valor),
      cscFixo: N(a.csc_valor_fixo),
      cscBaseAntiga: N(a.csc_base_antiga_valor),
      total: N(a.total_fatura),
      atualizadoEm: typeof a.updated_at === "string" ? a.updated_at : null,
    }));
  } catch (e) {
    console.error("[cockpit-coo] repasse:", e);
    return falha("fonte_indisponivel", `a leitura da apuração de royalties falhou${codigo(e)}`);
  }

  return { ok: true, apuracoes, faturas: await lerFaturas(db, acesso) };
}

/**
 * Faturas do repasse (nota de débito da rotina) e o título de cada uma na conta da Partners, com a
 * mesma amarração da abertura de Receita e Repasses: `cod_titulo` quando existe, senão vencimento +
 * valor. Tabelas pequenas (dezenas de linhas): lê todas as competências.
 */
async function lerFaturas(
  db: Db,
  acesso: { roles: string[]; permissions: string[] },
): Promise<Parte<{ linhas: FaturaLida[] }>> {
  if (!acesso.permissions.includes("view.unidades_rede"))
    return falha("acesso_insuficiente", "sua conta não lê as faturas do repasse (chave view.unidades_rede)");
  const faltam = fontesSemAcesso(["contas_receber"], acesso);
  if (faltam.length) return falha("acesso_insuficiente", motivoSemAcesso(faltam));
  try {
    const faturas = await todasAsPaginas((i, f) =>
      db
        .from("royalties_faturas")
        .select("id, unidade_id, competencia, status, valor_total, vence_em, cod_titulo")
        .order("id")
        .range(i, f),
    );
    const vencimentos = [...new Set(faturas.map((f) => f.vence_em).filter((v): v is string => typeof v === "string"))];
    const codigos = [...new Set(faturas.map((f) => f.cod_titulo).filter((c) => c !== null && c !== undefined))];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const titulos: any[] = [];
    const campos = "id, codigo_omie, status_pagamento, data_vencimento, data_pagamento, valor";
    for (let i = 0; i < vencimentos.length; i += 100) {
      titulos.push(
        ...(await todasAsPaginas((a, b) =>
          db
            .from("contas_receber")
            .select(campos)
            .eq("unidade", "Partners")
            .in("data_vencimento", vencimentos.slice(i, i + 100))
            .order("id")
            .range(a, b),
        )),
      );
    }
    for (let i = 0; i < codigos.length; i += 100) {
      titulos.push(
        ...(await todasAsPaginas((a, b) =>
          db
            .from("contas_receber")
            .select(campos)
            .eq("unidade", "Partners")
            .in("codigo_omie", codigos.slice(i, i + 100))
            .order("id")
            .range(a, b),
        )),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const porCodigo = new Map<number, any>(titulos.map((t) => [Number(t.codigo_omie), t] as const));
    const linhas: FaturaLida[] = faturas.map((f) => {
      const t =
        (f.cod_titulo !== null && f.cod_titulo !== undefined && porCodigo.get(Number(f.cod_titulo))) ||
        titulos.find(
          (x) =>
            x.data_vencimento === f.vence_em &&
            Number(x.valor) === Number(f.valor_total) &&
            x.status_pagamento !== "CANCELADO",
        ) ||
        null;
      return {
        unidadeId: Number(f.unidade_id),
        competencia: String(f.competencia).slice(0, 7),
        status: String(f.status ?? ""),
        valor: N(f.valor_total) ?? 0,
        venceEm: typeof f.vence_em === "string" ? f.vence_em.slice(0, 10) : null,
        titulo: t
          ? {
              status: typeof t.status_pagamento === "string" ? t.status_pagamento : null,
              vencimento: typeof t.data_vencimento === "string" ? t.data_vencimento.slice(0, 10) : null,
              pagoEm: typeof t.data_pagamento === "string" ? t.data_pagamento.slice(0, 10) : null,
            }
          : null,
      };
    });
    return { ok: true, linhas };
  } catch (e) {
    console.error("[cockpit-coo] faturas do repasse:", e);
    return falha("fonte_indisponivel", `a leitura das faturas do repasse falhou${codigo(e)}`);
  }
}

async function lerOnboarding(
  db: Db,
  acesso: { roles: string[]; permissions: string[] },
  todasUnidades: boolean,
): Promise<DadosFinanceiroOperacoes["onboarding"]> {
  if (!todasUnidades)
    return falha("acesso_insuficiente", "A fila de onboarding da rede exige ver todas as unidades; seu escopo é por unidade.");
  const faltam = fontesSemAcesso(["cs_onboarding_cards"], acesso);
  if (faltam.length) return falha("acesso_insuficiente", `Sem leitura do onboarding: ${motivoSemAcesso(faltam)}.`);
  try {
    const linhas = await todasAsPaginas((i, f) =>
      db
        .from("cs_onboarding_cards")
        .select("pipefy_card_id, fase_atual, entrou_fase_atual_em, concluido, unidade, synced_at")
        .order("pipefy_card_id")
        .range(i, f),
    );
    // Date.parse, não comparação de texto: timestamptz pode vir com "Z" ou "+00:00".
    let maior = 0;
    for (const c of linhas) {
      const t = typeof c.synced_at === "string" ? Date.parse(c.synced_at) : NaN;
      if (Number.isFinite(t) && t > maior) maior = t;
    }
    const cards: CardLido[] = linhas.map((c) => ({
      fase: String(c.fase_atual ?? "").trim(),
      unidade: typeof c.unidade === "string" ? c.unidade : null,
      entrouNaFase: typeof c.entrou_fase_atual_em === "string" ? c.entrou_fase_atual_em : null,
      concluido: c.concluido === true,
    }));
    return { ok: true, cards, atualizadoEm: maior > 0 ? new Date(maior).toISOString() : null };
  } catch (e) {
    console.error("[cockpit-coo] onboarding:", e);
    return falha("fonte_indisponivel", `a leitura da fila de onboarding falhou${codigo(e)}`);
  }
}

export async function lerFinanceiroOperacoes(ctx: ContextoCoo): Promise<DadosFinanceiroOperacoes> {
  const { db, userId, hoje, lidoEm } = ctx;
  const [escopo, papeis] = await Promise.all([
    db.from("usuario_escopo").select("todas_unidades, todas_empresas").eq("user_id", userId).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", userId),
  ]);
  if (escopo?.error || papeis?.error) {
    const f = falha("fonte_indisponivel", "a leitura do seu escopo de acesso falhou");
    return { lidoEm, saldo: f, fluxo: f, exposicao: f, dre: f, repasse: f, onboarding: f };
  }
  const acesso = {
    roles: ((papeis.data ?? []) as { role: string }[]).map((r) => r.role),
    permissions: ctx.permissoes,
  };
  const todasUnidades = Boolean(escopo.data?.todas_unidades);
  const [financeiro, repasse, onboarding] = await Promise.all([
    lerFinanceiro(db, hoje, Boolean(escopo.data?.todas_empresas)),
    lerRepasse(db, hoje, acesso, todasUnidades),
    lerOnboarding(db, acesso, todasUnidades),
  ]);
  return { lidoEm, ...financeiro, repasse, onboarding };
}
