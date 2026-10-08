import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Serviços e faturas da unidade (/meus-servicos), desde 07/10/2026. Pedido do
// Eliezek: a unidade acompanha quais serviços contratou da matriz (CSC, CS, RH,
// Compliance, mídia), quando cai o primeiro boleto e quanto, e quais faturas já
// pagou. Escopo decidido no mesmo dia: só o boleto de contas fixas
// (SIGLA-FIX-MMAAAA, `csc-faturamento-mensal`); royalties e CAC ficam fora. O
// sócio só tira a 2ª via do boleto que já existe, nunca cria cobrança.
//
// Fontes: `csc_unidades` (CSC vigente), `servicos_fixos_unidade` (os demais,
// com vigência por competência), `csc_ciclos` (um boleto por competência) e
// `contas_receber` da Partners (situação do título, pelo codigo_omie).
//
// Quem abre: a matriz (view.unidades_rede) qualquer unidade; o sócio, só a
// própria (ops.minhas_unidades) e com a área minha_unidade. Não é a
// minha_unidade_financeiro de Meus Royalties: aquela não está com nenhum sócio, e
// o boleto de contas fixas é o que a unidade paga, não a receita dela. A autorização é feita com o cliente de quem pediu; a
// leitura, com o service role, porque as três tabelas são fechadas à matriz.

export type ServicoChave = "csc" | "midia" | "cs" | "gg" | "comp";

export const NOME_SERVICO: Record<ServicoChave, string> = {
  csc: "CSC",
  midia: "Verba de mídia",
  cs: "Customer Success",
  gg: "RH (Gente e Gestão + Recrutamento)",
  comp: "Compliance",
};

export type Degrau = { competenciaInicio: string; competenciaFim: string | null; valor: number };

export type ServicoContratado = {
  servico: ServicoChave;
  nome: string;
  /** Valor da competência corrente; nulo quando ainda não começou ou já acabou. */
  valorAtual: number | null;
  /** Primeira competência cobrada. Nulo para o CSC, cuja vigência não é registrada. */
  inicio: string | null;
  /** Última competência, quando o serviço tem fim. */
  fim: string | null;
  /** Vigências que começam depois da competência corrente (os degraus do CS). */
  proximos: Degrau[];
  primeiroBoleto: { competencia: string; venceEm: string | null; valor: number | null; emitido: boolean } | null;
};

export type SituacaoFatura =
  | "pago"
  | "atrasado"
  | "vence_hoje"
  | "a_vencer"
  | "cancelado"
  | "a_emitir"
  | "sem_titulo"
  | "em_conferencia";

export type Fatura = {
  cicloId: number;
  competencia: string;
  codigo: string;
  venceEm: string | null;
  valor: number;
  itens: { servico: ServicoChave; nome: string; valor: number }[];
  situacao: SituacaoFatura;
  pagoEm: string | null;
  /** Só faturas emitidas e em aberto têm boleto para 2ª via. */
  segundaVia: boolean;
};

export type ContasFixasDaUnidade = {
  unidade: { id: number; nome: string; sigla: string | null; regraVencimento: string | null };
  /** Para a matriz: as unidades que dá para escolher. Vazio para o sócio com uma só. */
  opcoes: { id: number; nome: string }[];
  servicos: ServicoContratado[];
  faturas: Fatura[];
  competenciaAtual: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpcBool(db: any, fn: string, args?: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    console.error(`[contasFixas] ${fn} falhou:`, error.message);
    throw new Error("Erro de autorização. Tente novamente.");
  }
  return Boolean(data);
}

/** As unidades que quem pediu pode ver aqui. `null` = todas (matriz). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function unidadesPermitidas(supabase: any): Promise<number[] | null> {
  const [rede, area] = await Promise.all([
    rpcBool(supabase, "can", { _key: "view.unidades_rede" }),
    rpcBool(supabase, "tem_area", { _area: "minha_unidade" }),
  ]);
  if (rede) return null;
  if (!area) throw new Error("Acesso negado: esta tela é da área Minha Unidade.");
  // minhas_unidades não está nos tipos gerados.
  const { data, error } = await supabase.rpc("minhas_unidades");
  if (error) throw new Error("Erro de autorização. Tente novamente.");
  return ((data ?? []) as unknown[]).map(Number);
}

const mesIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

function situacaoDoTitulo(status: string | null): SituacaoFatura {
  switch ((status ?? "").toUpperCase()) {
    case "RECEBIDO":
      return "pago";
    case "ATRASADO":
      return "atrasado";
    case "VENCE HOJE":
      return "vence_hoje";
    case "A VENCER":
      return "a_vencer";
    case "CANCELADO":
      return "cancelado";
    default:
      return "sem_titulo";
  }
}

type CicloLinha = {
  id: number;
  competencia: string;
  sigla: string;
  cod_int_os: string;
  vence_em: string | null;
  valor: number;
  cod_titulo: number | null;
  status: string;
  itens: { servico: string; valor: number }[] | null;
};

/** Itens do ciclo; os de 07 e 08/2026 são anteriores ao boleto unificado e só cobravam CSC. */
function itensDoCiclo(c: CicloLinha): { servico: ServicoChave; valor: number }[] {
  if (c.itens?.length)
    return c.itens.map((i) => ({ servico: i.servico as ServicoChave, valor: Number(i.valor) }));
  return [{ servico: "csc", valor: Number(c.valor) }];
}

export const contasFixasDaUnidade = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: number | null }) => {
    const id = input?.id == null ? null : Number(input.id);
    if (id != null && (!Number.isInteger(id) || id <= 0)) throw new Error("Unidade inválida.");
    return { id };
  })
  .handler(async ({ data, context }): Promise<ContasFixasDaUnidade> => {
    const permitidas = await unidadesPermitidas(context.supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    // Só aparece quem está no faturamento de contas fixas.
    const cuRes = await db
      .from("csc_unidades")
      .select("sigla,nome,unidade_id,valor_csc,regra_vencimento,ativo")
      .not("unidade_id", "is", null);
    if (cuRes.error) throw new Error("Não foi possível ler o cadastro do CSC.");
    const cadastro = (cuRes.data ?? []).filter(
      (c: { unidade_id: number }) => permitidas == null || permitidas.includes(c.unidade_id),
    ) as { sigla: string; nome: string; unidade_id: number; valor_csc: number | null; regra_vencimento: string | null; ativo: boolean }[];

    const uRes = await db
      .from("unidades")
      .select("id,nome_da_praca")
      .in("id", cadastro.map((c) => c.unidade_id));
    if (uRes.error) throw new Error("Não foi possível ler as unidades.");
    const nomeDe = new Map<number, string>(
      (uRes.data ?? []).map((u: { id: number; nome_da_praca: string | null }) => [u.id, u.nome_da_praca ?? `Unidade ${u.id}`]),
    );
    const opcoes = cadastro
      .map((c) => ({ id: c.unidade_id, nome: nomeDe.get(c.unidade_id) ?? c.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    if (data.id != null && permitidas != null && !permitidas.includes(data.id))
      throw new Error("Acesso negado: esta não é a sua unidade.");
    const alvoId = data.id ?? opcoes[0]?.id ?? permitidas?.[0] ?? null;
    if (alvoId == null) throw new Error("Sua conta não está ligada a nenhuma unidade.");
    const cu = cadastro.find((c) => c.unidade_id === alvoId) ?? null;

    const hoje = new Date();
    const competenciaAtual = mesIso(hoje);
    const base: ContasFixasDaUnidade = {
      unidade: {
        id: alvoId,
        nome: nomeDe.get(alvoId) ?? cu?.nome ?? `Unidade ${alvoId}`,
        sigla: cu?.sigla ?? null,
        regraVencimento: cu?.regra_vencimento ?? null,
      },
      opcoes: permitidas != null && opcoes.length <= 1 ? [] : opcoes,
      servicos: [],
      faturas: [],
      competenciaAtual,
    };
    if (!cu) return base;

    const [sfRes, ccRes] = await Promise.all([
      db
        .from("servicos_fixos_unidade")
        .select("servico,valor,competencia_inicio,competencia_fim")
        .eq("sigla", cu.sigla)
        .order("competencia_inicio"),
      db
        .from("csc_ciclos")
        .select("id,competencia,sigla,cod_int_os,vence_em,valor,cod_titulo,status,itens")
        .eq("sigla", cu.sigla)
        .order("competencia", { ascending: false }),
    ]);
    if (sfRes.error) throw new Error("Não foi possível ler os serviços contratados.");
    if (ccRes.error) throw new Error("Não foi possível ler as faturas.");
    const ciclos = (ccRes.data ?? []) as CicloLinha[];

    const titulos = ciclos.map((c) => c.cod_titulo).filter((t): t is number => t != null);
    const crRes = titulos.length
      ? await db
          .from("contas_receber")
          .select("codigo_omie,status_pagamento,data_pagamento")
          .in("codigo_omie", titulos)
      : { data: [], error: null };
    if (crRes.error) throw new Error("Não foi possível ler a situação dos boletos.");
    const tituloDe = new Map<number, { status_pagamento: string | null; data_pagamento: string | null }>(
      (crRes.data ?? []).map((r: { codigo_omie: number; status_pagamento: string | null; data_pagamento: string | null }) => [
        Number(r.codigo_omie),
        r,
      ]),
    );

    base.faturas = ciclos.map((c) => {
      const t = c.cod_titulo != null ? tituloDe.get(Number(c.cod_titulo)) : undefined;
      const situacao: SituacaoFatura =
        c.status === "planejado"
          ? "a_emitir"
          : c.status !== "faturada"
            ? "em_conferencia"
            : situacaoDoTitulo(t?.status_pagamento ?? null);
      return {
        cicloId: c.id,
        competencia: c.competencia,
        codigo: c.cod_int_os,
        venceEm: c.vence_em,
        valor: Number(c.valor),
        itens: itensDoCiclo(c).map((i) => ({ ...i, nome: NOME_SERVICO[i.servico] ?? i.servico })),
        situacao,
        pagoEm: t?.data_pagamento ?? null,
        segundaVia: c.cod_titulo != null && ["atrasado", "vence_hoje", "a_vencer", "sem_titulo"].includes(situacao),
      };
    });

    // Primeiro boleto de cada serviço: o ciclo mais antigo que o cobra.
    const primeiroCiclo = (s: ServicoChave) => {
      const doMaisAntigo = [...ciclos].reverse();
      for (const c of doMaisAntigo) {
        const item = itensDoCiclo(c).find((i) => i.servico === s);
        if (item) return { competencia: c.competencia, venceEm: c.vence_em, valor: item.valor, emitido: c.status === "faturada" };
      }
      return null;
    };

    const servicos: ServicoContratado[] = [];
    if (cu.valor_csc != null && cu.valor_csc > 0) {
      servicos.push({
        servico: "csc",
        nome: NOME_SERVICO.csc,
        valorAtual: Number(cu.valor_csc),
        inicio: null,
        fim: null,
        proximos: [],
        primeiroBoleto: primeiroCiclo("csc"),
      });
    }
    const porServico = new Map<ServicoChave, Degrau[]>();
    for (const r of (sfRes.data ?? []) as { servico: ServicoChave; valor: number; competencia_inicio: string; competencia_fim: string | null }[]) {
      const lista = porServico.get(r.servico) ?? [];
      lista.push({ competenciaInicio: r.competencia_inicio, competenciaFim: r.competencia_fim, valor: Number(r.valor) });
      porServico.set(r.servico, lista);
    }
    for (const s of ["midia", "cs", "gg", "comp"] as const) {
      const vig = porServico.get(s);
      if (!vig?.length) continue;
      const atual = vig.find(
        (v) => v.competenciaInicio <= competenciaAtual && (v.competenciaFim == null || v.competenciaFim >= competenciaAtual),
      );
      const ultima = vig[vig.length - 1];
      const primeira = vig[0];
      const doCiclo = primeiroCiclo(s);
      servicos.push({
        servico: s,
        nome: NOME_SERVICO[s],
        valorAtual: atual?.valor ?? null,
        inicio: primeira.competenciaInicio,
        fim: ultima.competenciaFim,
        proximos: vig.filter((v) => v.competenciaInicio > competenciaAtual),
        // Serviço que ainda não passou por boleto: a competência de início sai no boleto do mês seguinte.
        primeiroBoleto: doCiclo ?? {
          competencia: primeira.competenciaInicio,
          venceEm: null,
          valor: primeira.valor,
          emitido: false,
        },
      });
    }
    base.servicos = servicos;
    return base;
  });

export type SegundaVia = {
  link: string;
  linhaDigitavel: string | null;
  vencimento: string | null;
  juros: number | null;
  multa: number | null;
};

// 2ª via do boleto já emitido. ObterBoleto só lê o boleto do título; não gera
// cobrança nova. O link do Omie expira em cerca de um dia, por isso é pedido na hora.
export const segundaViaBoleto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cicloId: number }) => {
    const cicloId = Number(input?.cicloId);
    if (!Number.isInteger(cicloId) || cicloId <= 0) throw new Error("Fatura inválida.");
    return { cicloId };
  })
  .handler(async ({ data, context }): Promise<SegundaVia> => {
    const permitidas = await unidadesPermitidas(context.supabase);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const cRes = await db
      .from("csc_ciclos")
      .select("id,sigla,cod_titulo,status")
      .eq("id", data.cicloId)
      .maybeSingle();
    if (cRes.error || !cRes.data) throw new Error("Fatura não encontrada.");
    const ciclo = cRes.data as { sigla: string; cod_titulo: number | null; status: string };

    const uRes = await db.from("csc_unidades").select("unidade_id").eq("sigla", ciclo.sigla).maybeSingle();
    const unidadeId = uRes.data?.unidade_id as number | undefined;
    if (permitidas != null && (unidadeId == null || !permitidas.includes(unidadeId)))
      throw new Error("Acesso negado: esta fatura não é da sua unidade.");
    if (ciclo.status !== "faturada" || ciclo.cod_titulo == null)
      throw new Error("Esta fatura ainda não foi emitida.");

    const tRes = await db
      .from("contas_receber")
      .select("status_pagamento")
      .eq("codigo_omie", ciclo.cod_titulo)
      .maybeSingle();
    const st = (tRes.data?.status_pagamento ?? "").toUpperCase();
    if (st === "RECEBIDO") throw new Error("Esta fatura já está paga.");
    if (st === "CANCELADO") throw new Error("Esta fatura foi cancelada.");

    // A conta Omie da Partners é a que emite as contas fixas (sem unidade_id, de propósito).
    const credRes = await db
      .from("omie_credentials")
      .select("unidade,app_key,app_secret")
      .is("unidade_id", null)
      .eq("ativo", true);
    const cred = (credRes.data ?? []).find((c: { unidade: string }) => /partners/i.test(c.unidade));
    if (!cred) throw new Error("A conta do Omie da matriz não está configurada.");

    const resp = await fetch("https://app.omie.com.br/api/v1/financas/contareceberboleto/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: "ObterBoleto",
        app_key: cred.app_key,
        app_secret: cred.app_secret,
        param: [{ nCodTitulo: Number(ciclo.cod_titulo) }],
      }),
    });
    const corpo = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!resp.ok || !corpo?.cLinkBoleto) {
      console.error("[segundaViaBoleto] Omie:", resp.status, corpo?.faultstring ?? corpo?.cDesStatus);
      throw new Error("O Omie não devolveu o boleto agora. Tente de novo em alguns minutos.");
    }
    const venc = typeof corpo.dDtVenc === "string" ? corpo.dDtVenc : null;
    return {
      link: String(corpo.cLinkBoleto),
      linhaDigitavel: typeof corpo.cCodBarras === "string" ? corpo.cCodBarras : null,
      vencimento: venc,
      juros: corpo.nPerJuros != null ? Number(corpo.nPerJuros) : null,
      multa: corpo.nPerMulta != null ? Number(corpo.nPerMulta) : null,
    };
  });
