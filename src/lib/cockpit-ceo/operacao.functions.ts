import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ContextoCockpit } from "./contexto";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { cnpjComMascara, docDigitos, montarCadeia, normContraparte } from "./cadeia";
import type { VendaSafra } from "./cadeia";
import { clienteFinancialBrain, conferirPortaFinanceiro } from "./financeiro-porta";
import { FASE_CONCLUIDO, lerCard, montarOnboarding } from "./operacao";
import type { Falha, RespostaOperacao } from "./operacao";
import { todasAsPaginas } from "./paginar";
import { FONTES_CADEIA, FONTES_OPERACAO, fontesSemAcesso, motivoSemAcesso } from "./portas";

// Operação (fila de onboarding) e a cadeia venda → ativação → faturamento → saída, com a sessão da
// pessoa (RLS de contratos, onboarding e Central de Tratativas). Exige todas as unidades: a fila tem
// policy RESTRICTIVE por unidade, e fila parcial seria outra população. Para a tela vão só
// contagens e medianas; nenhum card, cliente ou CNPJ.
//
// O elo do faturamento lê o Financial Brain com a credencial de servidor do Ops, atrás da mesma
// porta da leitura do grupo (produto Financeiro + todas as empresas). Sem ela, a cadeia sai com o
// elo "sem acesso", e os demais elos continuam.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codigo = (e: any) => (e?.code ? ` (código ${e.code})` : "");
const primeiroDiaDoMes = (dia: string) => `${dia.slice(0, 7)}-01`;

/** A leitura sem o transporte: a mesma regra serve a tela e as ferramentas da conversa. */
export async function lerOperacaoCockpit(context: ContextoCockpit): Promise<RespostaOperacao> {
  const { supabase, userId } = context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const lidoEm = new Date().toISOString();
  const hoje = hojeSaoPaulo();
  const [acesso, escopo] = await Promise.all([
    acessoDoUsuario(db, userId),
    db
      .from("usuario_escopo")
      .select("todas_unidades, todas_empresas")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!acesso.areas.includes("cockpit_ceo"))
    throw new Error("Acesso negado: sua conta não tem a área Cockpit do CEO.");
  const falha = (motivo: string, estado: Falha["estado"]): RespostaOperacao => ({
    lidoEm,
    onboarding: { estado, motivo },
    cadeia: { estado, motivo },
  });
  if (escopo?.error) return falha("a leitura do seu escopo de acesso falhou", "fonte_indisponivel");
  if (!escopo?.data?.todas_unidades)
    return falha(
      "A fila de onboarding da rede exige ver todas as unidades; seu escopo é por unidade.",
      "acesso_insuficiente",
    );
  const faltamOp = fontesSemAcesso(FONTES_OPERACAO, acesso);
  if (faltamOp.length)
    return falha(`Sem leitura da operação: ${motivoSemAcesso(faltamOp)}.`, "acesso_insuficiente");

  let cards: ReturnType<typeof lerCard>[];
  let atualizadoEm: string | null = null;
  let contratos: Record<string, unknown>[];
  try {
    const [c, k] = await Promise.all([
      todasAsPaginas((i, f) =>
        db
          .from("cs_onboarding_cards")
          .select(
            "pipefy_card_id, fase_atual, fase_atual_ordem, entrou_fase_atual_em, criado_em, concluido, empresa_id, fases_history, synced_at",
          )
          .order("pipefy_card_id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        db
          .from("contratos")
          .select("id, empresa_id, cnpj, ganho_em, pipedrive_deal_id, origem_pipeline")
          .eq("origem_pipeline", "inside_sales")
          .order("id")
          .range(i, f),
      ),
    ]);
    cards = c.map(lerCard);
    for (const x of c)
      if (typeof x.synced_at === "string" && (!atualizadoEm || x.synced_at > atualizadoEm))
        atualizadoEm = x.synced_at;
    contratos = k;
  } catch (e) {
    console.error("[cockpit-ceo] operação:", e);
    return falha(`a leitura da fila de onboarding falhou${codigo(e)}`, "fonte_indisponivel");
  }

  // Ganhos por empresa: o card liga à venda que o originou (último ganho até a criação dele).
  const ganhosPorEmpresa = new Map<number, string[]>();
  for (const k of contratos) {
    if (k.empresa_id === null || typeof k.ganho_em !== "string") continue;
    const id = Number(k.empresa_id);
    if (!Number.isFinite(id)) continue;
    ganhosPorEmpresa.set(id, [...(ganhosPorEmpresa.get(id) ?? []), k.ganho_em.slice(0, 10)]);
  }
  const onboarding = montarOnboarding(cards, ganhosPorEmpresa, lidoEm, {
    de: primeiroDiaDoMes(hoje),
    ate: hoje,
  });

  // ── Cadeia ──
  const faltamCadeia = fontesSemAcesso(FONTES_CADEIA, acesso);
  if (faltamCadeia.length)
    return {
      lidoEm,
      onboarding: { estado: "ok", dado: onboarding, atualizadoEm },
      cadeia: {
        estado: "acesso_insuficiente",
        motivo: `Sem leitura da cadeia: ${motivoSemAcesso(faltamCadeia)}.`,
      },
    };
  const desde = onboarding.desde;
  const vendas: VendaSafra[] = contratos
    .filter((k) => typeof k.ganho_em === "string" && desde && (k.ganho_em as string) >= desde)
    .filter((k) => (k.ganho_em as string) <= hoje)
    .map((k) => ({
      empresaId: k.empresa_id === null ? null : Number(k.empresa_id),
      cnpj: docDigitos(k.cnpj),
      ganhoEm: String(k.ganho_em).slice(0, 10),
      dealId: k.pipedrive_deal_id === null ? null : String(k.pipedrive_deal_id),
    }));
  const porEmpresa = new Map<number, { concluido: boolean }>();
  for (const c of cards)
    if (c.empresaId !== null) {
      const antes = porEmpresa.get(c.empresaId);
      porEmpresa.set(c.empresaId, {
        concluido: (antes?.concluido ?? false) || c.fase === FASE_CONCLUIDO,
      });
    }
  let churn: Record<string, unknown>[];
  const titulosUnidadePorCnpj = new Map<string, { vencimento: string; pago: boolean }[]>();
  try {
    // CNPJ da venda: o do contrato e, na falta, o do cadastro da empresa (mesmo empresa_id).
    const semCnpj = [
      ...new Set(vendas.filter((v) => !v.cnpj && v.empresaId !== null).map((v) => v.empresaId)),
    ];
    for (let i = 0; i < semCnpj.length; i += 150) {
      const r = await db
        .from("empresas")
        .select("id, cnpj")
        .in("id", semCnpj.slice(i, i + 150));
      if (r.error) throw r.error;
      const porId = new Map<number, string | null>(
        (r.data ?? []).map((x: Record<string, unknown>) => [Number(x.id), docDigitos(x.cnpj)]),
      );
      for (const v of vendas)
        if (!v.cnpj && v.empresaId !== null) v.cnpj = porId.get(v.empresaId) ?? null;
    }
    // Títulos das unidades (Omie da unidade), só dos CNPJs da safra; o formato lá é com máscara.
    const cnpjs = [...new Set(vendas.map((v) => v.cnpj).filter((x): x is string => !!x))];
    for (let i = 0; i < cnpjs.length; i += 100) {
      const r = await todasAsPaginas((a, b) =>
        db
          .from("contas_receber")
          .select("id, cpf_cnpj, data_vencimento, data_pagamento")
          .in("cpf_cnpj", cnpjs.slice(i, i + 100).map(cnpjComMascara))
          .order("id")
          .range(a, b),
      );
      for (const t of r) {
        const d = docDigitos(t.cpf_cnpj);
        if (!d || typeof t.data_vencimento !== "string") continue;
        const lista = titulosUnidadePorCnpj.get(d) ?? [];
        lista.push({ vencimento: t.data_vencimento.slice(0, 10), pago: !!t.data_pagamento });
        titulosUnidadePorCnpj.set(d, lista);
      }
    }
    churn = await todasAsPaginas((i, f) =>
      db
        .from("central_tratativas")
        .select("id, empresa_id, pipedrive_deal_id")
        .eq("status", "lost")
        .order("id")
        .range(i, f),
    );
  } catch (e) {
    return {
      lidoEm,
      onboarding: { estado: "ok", dado: onboarding, atualizadoEm },
      cadeia: {
        estado: "fonte_indisponivel",
        motivo: `a leitura de empresas, títulos das unidades ou Central de Tratativas falhou${codigo(e)}`,
      },
    };
  }

  // Elo do faturamento: Financial Brain, atrás da porta do Financeiro.
  const nomesPorCnpj = new Map<string, Set<string>>();
  const documentosPorNome = new Map<string, number>();
  const mesesFaturadosPorNome = new Map<string, Set<string>>();
  let faturamento: Falha | null = null;
  const porta = await conferirPortaFinanceiro(db, Boolean(escopo?.data?.todas_empresas));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin = porta.aberta ? ((await clienteFinancialBrain()) as any) : null;
  if (!porta.aberta) faturamento = { estado: porta.estado, motivo: porta.motivo };
  else if (!fin)
    faturamento = {
      estado: "fonte_indisponivel",
      motivo: "a credencial do Financial Brain não está configurada neste ambiente",
    };
  else if (desde) {
    try {
      const cnpjs = [...new Set(vendas.map((v) => v.cnpj).filter((x): x is string => !!x))];
      const cadastro: Record<string, unknown>[] = [];
      for (let i = 0; i < cnpjs.length; i += 150) {
        const r = await fin
          .from("omie_contraparte")
          .select("doc_digitos, nome_norm, fantasia_norm")
          .in("doc_digitos", cnpjs.slice(i, i + 150));
        if (r.error) throw r.error;
        cadastro.push(...(r.data ?? []));
      }
      for (const c of cadastro) {
        const d = String(c.doc_digitos);
        const s = nomesPorCnpj.get(d) ?? new Set<string>();
        for (const n of [c.nome_norm, c.fantasia_norm]) if (typeof n === "string" && n) s.add(n);
        nomesPorCnpj.set(d, s);
      }
      const nomes = [...new Set([...nomesPorCnpj.values()].flatMap((s) => [...s]))];
      const docs = new Map<string, Set<string>>();
      for (let i = 0; i < nomes.length; i += 100) {
        const parte = nomes.slice(i, i + 100);
        const [a, b] = await Promise.all([
          fin.from("omie_contraparte").select("doc_digitos, nome_norm").in("nome_norm", parte),
          fin
            .from("omie_contraparte")
            .select("doc_digitos, fantasia_norm")
            .in("fantasia_norm", parte),
        ]);
        if (a.error || b.error) throw a.error ?? b.error;
        for (const r of [...(a.data ?? []), ...(b.data ?? [])]) {
          const n = (r.nome_norm ?? r.fantasia_norm) as string;
          if (!r.doc_digitos) continue;
          const s = docs.get(n) ?? new Set<string>();
          s.add(String(r.doc_digitos));
          docs.set(n, s);
        }
      }
      for (const [n, s] of docs) documentosPorNome.set(n, s.size);
      const fat = await fin.rpc("fn_faturamento_mensal", {
        p_comp_de: primeiroDiaDoMes(desde),
        p_comp_ate: primeiroDiaDoMes(hoje),
      });
      if (fat.error) throw fat.error;
      for (const l of fat.data?.linhas ?? []) {
        const n = normContraparte(l?.cliente);
        if (!n) continue;
        const s = mesesFaturadosPorNome.get(n) ?? new Set<string>();
        for (const m of l.meses ?? [])
          if (m?.receita !== null && Number(m?.receita) !== 0 && typeof m?.competencia === "string")
            s.add(m.competencia.slice(0, 7));
        mesesFaturadosPorNome.set(n, s);
      }
    } catch (e) {
      console.error("[cockpit-ceo] cadeia/faturamento:", e);
      faturamento = {
        estado: "fonte_indisponivel",
        motivo: `a leitura do faturamento por cliente falhou${codigo(e)}`,
      };
    }
  }
  const cadeia = montarCadeia({
    vendas,
    onboarding: porEmpresa,
    nomesPorCnpj,
    documentosPorNome,
    mesesFaturadosPorNome,
    churnEmpresas: new Set(
      churn.filter((c) => c.empresa_id !== null).map((c) => Number(c.empresa_id)),
    ),
    churnNegocios: new Set(
      churn.filter((c) => c.pipedrive_deal_id !== null).map((c) => String(c.pipedrive_deal_id)),
    ),
    faturamentoLido: faturamento === null && !!desde,
    titulosUnidadePorCnpj,
    unidadesLidas: true,
  });
  return {
    lidoEm,
    onboarding: { estado: "ok", dado: onboarding, atualizadoEm },
    cadeia: { estado: "ok", dado: cadeia, faturamento },
  };
}

export const carregarOperacaoCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerOperacaoCockpit(context));
