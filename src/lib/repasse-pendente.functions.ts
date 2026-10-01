import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * O que a rede ainda deve à matriz, de qualquer mês.
 *
 * A abertura da área é presa ao mês do seletor: quando o mês vira, o funil
 * recomeça do zero e o título de três meses atrás some da tela sem ter sido
 * pago (em 01/10/2026: RJ com ND vencida em junho, Curitiba em julho). Esta
 * função não recebe mês. Ela responde duas perguntas, cada uma com a sua régua:
 *
 * - **Faturado e não recebido**: título da conta Partners para o CNPJ de uma
 *   unidade regional, com status diferente de RECEBIDO e CANCELADO. É fato do
 *   Omie, sem casamento nenhum: a lista de cobrança.
 * - **Apurado e não faturado**: apurado acumulado (apurações fechadas) menos o
 *   cobrado acumulado (títulos de repasse da unidade), por unidade. A conta é
 *   acumulada e não por trilho porque a categoria do título mudou ao longo do
 *   ano (CSC de Curitiba em ND sem categoria em jan-mar/26, CAC em `1.03.96`
 *   até set/26): casar trilho a trilho acusaria falta onde não há. O mês a mês
 *   (apurado de M contra títulos que vencem em M+1) só aponta onde a diferença
 *   nasceu.
 *
 * Conferido contra a planilha `tools/output/2026-10-01-repasse-pendente-meses-anteriores.xlsx`
 * do repo da wiki.
 */

/** Categorias dos títulos que cobram o repasse na conta Partners. A ND da rotina sai sem categoria. */
const CATEGORIAS_REPASSE = ["1.01.92", "1.01.94", "1.01.95", "1.01.96", "1.01.99", "1.03.96"];

const NOME_CATEGORIA: Record<string, string> = {
  "1.01.92": "CAC",
  "1.01.94": "Outras receitas",
  "1.01.95": "Royalties",
  "1.01.96": "CSC",
  "1.01.99": "Serviços (CS, Gente)",
  "1.03.96": "Mídia",
};

/** Abaixo disso é arredondamento de centavo entre apuração e nota. */
const TOLERANCIA = 1;

const PAGINA = 1000;

export interface TituloPendente {
  documento: string | null;
  /** Nome legível do que o título cobra. */
  oQue: string;
  vencimento: string;
  /** Status do Omie: ATRASADO, VENCE HOJE, A VENCER. */
  status: string;
  /** Dias desde o vencimento; 0 para o que ainda não venceu. */
  diasAtraso: number;
  valor: number;
}

export interface MesDivergente {
  /** `YYYY-MM` da competência da apuração. */
  mes: string;
  apurado: number;
  /** Títulos com vencimento no mês seguinte ao da competência. */
  cobradoNoMesSeguinte: number;
}

export interface UnidadePendente {
  unidade_id: number;
  unidade: string;
  titulos: TituloPendente[];
  vencido: number;
  aVencer: number;
  /** Primeiro mês e último mês com apuração fechada, `YYYY-MM`. */
  primeiroMes: string | null;
  ultimoMes: string | null;
  apuradoAcumulado: number;
  cobradoAcumulado: number;
  /** Apurado sem título que o cubra (> 0) ou 0. */
  faltaCobrar: number;
  /** Título sem apuração que o explique: conferir, não cobrar. */
  acimaDoApurado: number;
  mesesDivergentes: MesDivergente[];
}

export interface RepassePendente {
  /** Data da fotografia (`YYYY-MM-DD`, fuso de São Paulo). */
  hoje: string;
  unidades: UnidadePendente[];
}

const N = (v: unknown) => Number(v ?? 0);
const centavos = (v: number) => Math.round(v * 100) / 100;
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** `YYYY-MM` deslocado `delta` meses. */
function somarMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function hojeEmSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);
}

/** O PostgREST corta em 1000 linhas e `.limit()` maior não adianta: pagina por range. */
async function todas(consulta: (de: number, ate: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGINA) return out;
  }
}

export const carregarRepassePendente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RepassePendente> => {
    const sb = context.supabase as any;

    // A mesma chave do bloco de repasse da abertura.
    const { data: pode } = await sb.rpc("can", { _key: "view.unidades_rede" });
    if (pode !== true) throw new Error("Acesso negado: view.unidades_rede.");

    const hoje = hojeEmSaoPaulo();

    const [unidadesRes, apuracoes, titulos] = await Promise.all([
      sb.from("unidades").select("id,nome_da_praca,cnpj").eq("tipo", "regional"),
      todas((de, ate) =>
        sb
          .from("royalties_apuracao")
          .select("unidade_id,mes_referencia,total_fatura")
          .in("status", ["confirmado", "faturado"])
          .order("id")
          .range(de, ate),
      ),
      todas((de, ate) =>
        sb
          .from("contas_receber")
          .select(
            "codigo_omie,num_documento,codigo_categoria,cpf_cnpj,status_pagamento,data_vencimento,valor",
          )
          .eq("unidade", "Partners")
          .neq("status_pagamento", "CANCELADO")
          .or(`codigo_categoria.is.null,codigo_categoria.in.(${CATEGORIAS_REPASSE.join(",")})`)
          .order("codigo_omie")
          .range(de, ate),
      ),
    ]);
    if (unidadesRes.error) throw new Error(`Unidades: ${unidadesRes.error.message}`);

    const unidades = (unidadesRes.data ?? []) as {
      id: number;
      nome_da_praca: string;
      cnpj: string | null;
    }[];

    // Curitiba guarda quatro CNPJs no mesmo campo, um por linha.
    const unidadePorCnpj = new Map<string, number>();
    for (const u of unidades) {
      for (const c of String(u.cnpj ?? "").split("\n")) {
        const d = soDigitos(c);
        if (d) unidadePorCnpj.set(d, u.id);
      }
    }

    const titulosPorUnidade = new Map<number, any[]>();
    for (const t of titulos) {
      const id = unidadePorCnpj.get(soDigitos(t.cpf_cnpj));
      if (id == null || !t.data_vencimento) continue;
      const lista = titulosPorUnidade.get(id) ?? [];
      lista.push(t);
      titulosPorUnidade.set(id, lista);
    }

    const resultado: UnidadePendente[] = [];
    for (const u of unidades) {
      const ts = titulosPorUnidade.get(u.id) ?? [];

      const abertos: TituloPendente[] = ts
        .filter((t) => t.status_pagamento !== "RECEBIDO")
        .map((t) => ({
          documento: t.num_documento ? String(t.num_documento) : null,
          oQue: t.codigo_categoria
            ? (NOME_CATEGORIA[t.codigo_categoria] ?? t.codigo_categoria)
            : "Nota de débito",
          vencimento: t.data_vencimento,
          status: t.status_pagamento ?? "sem status",
          diasAtraso: Math.max(0, diasEntre(t.data_vencimento, hoje)),
          valor: N(t.valor),
        }))
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      const vencido = abertos.filter((t) => t.diasAtraso > 0).reduce((s, t) => s + t.valor, 0);
      const aVencer = abertos.filter((t) => t.diasAtraso === 0).reduce((s, t) => s + t.valor, 0);

      // ---- apurado acumulado × cobrado acumulado ----
      const porMes = new Map<string, number>();
      for (const a of apuracoes) {
        if (a.unidade_id !== u.id) continue;
        const mes = String(a.mes_referencia).slice(0, 7);
        porMes.set(mes, (porMes.get(mes) ?? 0) + N(a.total_fatura));
      }
      const meses = [...porMes.keys()].sort();
      const primeiroMes = meses[0] ?? null;
      const ultimoMes = meses[meses.length - 1] ?? null;

      let apuradoAcumulado = 0;
      let cobradoAcumulado = 0;
      const mesesDivergentes: MesDivergente[] = [];
      if (primeiroMes && ultimoMes) {
        // A cobrança de M vence em M+1; a de CSC e CAC às vezes em M+2. Título
        // depois disso já é do mês que ainda não fechou e taparia falta antiga.
        const de = somarMes(primeiroMes, 1);
        const ate = somarMes(ultimoMes, 2);
        const cobradoPorVencimento = new Map<string, number>();
        for (const t of ts) {
          const m = String(t.data_vencimento).slice(0, 7);
          if (m < de || m > ate) continue;
          cobradoAcumulado += N(t.valor);
          cobradoPorVencimento.set(m, (cobradoPorVencimento.get(m) ?? 0) + N(t.valor));
        }
        for (const mes of meses) {
          const apurado = porMes.get(mes)!;
          apuradoAcumulado += apurado;
          const cobrado = cobradoPorVencimento.get(somarMes(mes, 1)) ?? 0;
          if (Math.abs(apurado - cobrado) >= TOLERANCIA)
            mesesDivergentes.push({
              mes,
              apurado: centavos(apurado),
              cobradoNoMesSeguinte: centavos(cobrado),
            });
        }
      }
      const saldo = centavos(apuradoAcumulado - cobradoAcumulado);

      if (abertos.length === 0 && Math.abs(saldo) < TOLERANCIA) continue;
      resultado.push({
        unidade_id: u.id,
        unidade: u.nome_da_praca,
        titulos: abertos,
        vencido: centavos(vencido),
        aVencer: centavos(aVencer),
        primeiroMes,
        ultimoMes,
        apuradoAcumulado: centavos(apuradoAcumulado),
        cobradoAcumulado: centavos(cobradoAcumulado),
        faltaCobrar: saldo >= TOLERANCIA ? saldo : 0,
        acimaDoApurado: saldo <= -TOLERANCIA ? -saldo : 0,
        mesesDivergentes,
      });
    }

    resultado.sort(
      (a, b) => b.vencido + b.faltaCobrar - (a.vencido + a.faltaCobrar) || b.aVencer - a.aVencer,
    );
    return { hoje, unidades: resultado };
  });
