import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { todasAsPaginas } from "@/lib/cockpit-ceo/paginar";

/**
 * Funil da Rede (/unidades/funil-rede): da venda ao royalty, só nas unidades com
 * split ativo. Quem não tem split fica fora, inclusive o faturado do Omie
 * (decisão de 16/10/2026): sem split o royalty não é medido na fonte.
 *
 * Três leituras da mesma base, calculadas aqui porque cruzam cinco fontes e
 * dependem de agrupar contratos e títulos por CNPJ, o que a view não faz bem:
 *
 * 1. **Funil** por unidade × mês × canal: vendas, contratos, faturado, recebido
 *    e royalty. É fluxo do mês, não coorte.
 * 2. **Gap de royalty**: o que eu deveria ter recebido (MRR vendido × %) contra
 *    o que recebi, aberto em cadastro, contrato, faturamento, inadimplência e split.
 * 3. **Conciliação de MRR** cliente a cliente: Pipedrive × Pipefy × Omie, com a
 *    categoria do desvio (churn não baixado, duplicada, sem faturamento...).
 *
 * As regras foram validadas em planilha antes da tela (tools/funil_split_planilha.py,
 * gap_royalty_planilha.py e conciliacao_mrr_split.py no repo AI Projects).
 */

export type Canal = "Hunter" | "Inside Sales" | "Sem venda registrada";

export interface LinhaFunil {
  unidade: string;
  mes: string;
  canal: Canal;
  vendas: number;
  mrrVendido: number;
  contratos: number;
  mrrContratado: number;
  titulos: number;
  faturado: number;
  recebido: number;
  aReceber: number;
  atrasado: number;
  royaltyRecebido: number;
  royaltyAReceber: number;
  royaltyPerdido: number;
  /**
   * Clientes que chegaram a cada etapa. Só a safra preenche: no fato cada etapa
   * tem outros clientes e a razão entre elas não é conversão.
   */
  cliVendidos: number;
  cliContrato: number;
  cliFaturado: number;
  cliPago: number;
  cliRoyalty: number;
  cliRoyaltyAReceber: number;
}

export interface LinhaGap {
  /** Meses entre a venda e o mês do gap (0 = mês da venda, 3 = 3 ou mais); -1 = sem venda. */
  idade: number;
  unidade: string;
  mes: string;
  canal: Canal;
  potencial: number;
  gapCadastro: number;
  gapContrato: number;
  gapFaturamento: number;
  gapInadimplencia: number;
  gapSplit: number;
  noPrazo: number;
  royaltyRecebido: number;
  royaltyACreditar: number;
  extra: number;
  taxa: number;
}

export type CategoriaConc =
  | "Churn não baixado no Pipedrive"
  | "Venda duplicada (provável)"
  | "Sem faturamento"
  | "Parou de faturar"
  | "Venda recente, ainda não faturou"
  | "Fatura menos que o MRR"
  | "Fatura mais que o MRR"
  | "OK (±20%)"
  | "Mesmo cliente, CNPJ não casou"
  | "Cliente a mais no Omie"
  | "Omie da unidade ainda não cobre o mês";

export interface ClienteConc {
  chave: string;
  unidade: string;
  canal: Canal;
  categoria: CategoriaConc;
  cliente: string;
  razaoSocial: string | null;
  contratos: number;
  deals: string[];
  ganhoEm: string | null;
  mrrPipedrive: number;
  mrrPipefy: number | null;
  fasesPipefy: string[];
  faturadoRef: number;
  faturadoMedia3: number;
  ultimoVencimento: string | null;
  atrasado: number;
  churnEm: string | null;
  motivoChurn: string | null;
  observacao: string | null;
  vinculo: string;
}

export interface UnidadeSplit {
  nome: string;
  splitDesde: string;
  percentual: number;
  /** Primeiro vencimento no Omie da unidade; antes disso não dá para conciliar. */
  omieDesde: string | null;
}

export interface FunilRede {
  unidades: UnidadeSplit[];
  /** Fato: cada etapa no mês em que aconteceu. */
  funil: LinhaFunil[];
  /** Safra: tudo do cliente no mês da primeira venda dele, quando quer que aconteça. */
  funilSafra: LinhaFunil[];
  gap: LinhaGap[];
  conciliacao: ClienteConc[];
  /** Mês fechado usado na conciliação (`YYYY-MM`). */
  mesReferencia: string;
  /** Split creditado cujo título não está no Omie: fica fora do funil por mês. */
  splitsSemTitulo: { unidade: string; creditado: number; aCreditar: number }[];
  geradoEm: string;
}

const TOL = 0.2;
const N = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const digitos = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d || null;
};
const mesDe = (d: string) => d.slice(0, 7);

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa|cia|comercio|servicos|grupo)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Semelhança de nome: o maior entre Jaccard de palavras e Dice de bigramas. */
function parecido(a: string | null | undefined, b: string | null | undefined): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  const ta = new Set(x.split(" "));
  const tb = new Set(y.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jac = inter / new Set([...ta, ...tb]).size;
  const bi = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++)
      m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ba = bi(x);
  const bb = bi(y);
  let comum = 0;
  for (const [k, n] of ba) comum += Math.min(n, bb.get(k) ?? 0);
  const dice = (2 * comum) / Math.max(x.length - 1 + y.length - 1, 1);
  return Math.max(jac, dice);
}

function proximoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}
function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

async function can(sb: any, chave: string): Promise<boolean> {
  const { data } = await sb.rpc("can", { _key: chave });
  return data === true;
}

/** Union-find: contratos e títulos que dividem CNPJ viram um cliente só. */
class Grupos {
  private pai = new Map<string, string>();
  ache(x: string): string {
    if (!this.pai.has(x)) this.pai.set(x, x);
    let r = x;
    while (this.pai.get(r) !== r) {
      const p = this.pai.get(this.pai.get(r)!)!;
      this.pai.set(r, p);
      r = p;
    }
    return r;
  }
  une(a: string, b: string) {
    this.pai.set(this.ache(a), this.ache(b));
  }
}

export const carregarFunilRede = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FunilRede> => {
    // O portão é a chave da tela, checada com a sessão de quem pede. Passou, a
    // leitura é do servidor: as tabelas cruzadas aqui têm RLS por outras chaves
    // (contratos_documentos, central_tratativas, empresas...), e com a sessão
    // do usuário 11 das 18 pessoas com a chave viam número parcial sem erro
    // (medido em 16/10/2026). Mesmo padrão de dre-caixa.functions.ts.
    if (!(await can(context.supabase as any, "view.royalties_split"))) {
      throw new Error("Acesso negado: falta a chave view.royalties_split.");
    }
    const sb = supabaseAdmin as any;

    const hoje = new Date().toISOString().slice(0, 10);
    const mesAtual = mesDe(hoje);
    // Último mês fechado: a conciliação compara MRR com o faturado dele.
    const [ay, am] = mesAtual.split("-").map(Number);
    const mesReferencia = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, "0")}`;

    const { data: us, error: eu } = await sb
      .from("unidades")
      .select("id,nome_da_praca,split_ativo_desde,royalties_percentual")
      .not("split_ativo_desde", "is", null);
    if (eu) throw new Error(`Unidades: ${eu.message}`);
    const unidades = (us ?? []) as any[];
    const nomes = unidades.map((u) => u.nome_da_praca as string);
    const vazio: FunilRede = {
      unidades: [],
      funil: [],
      funilSafra: [],
      gap: [],
      conciliacao: [],
      mesReferencia,
      splitsSemTitulo: [],
      geradoEm: new Date().toISOString(),
    };
    if (nomes.length === 0) return vazio;
    const porNome = new Map(unidades.map((u) => [u.nome_da_praca as string, u]));
    const pct = (un: string) => N(porNome.get(un)?.royalties_percentual) / 100;
    const desde = (un: string) => String(porNome.get(un)?.split_ativo_desde ?? "9999-12-31");

    const COLS_CT =
      "id,unidade,origem_pipeline,titulo,produto,ganho_em,pipedrive_deal_id,empresa_id,mrr_mensal,mrr_override,cnpj,entrada_contrato_assinado_em,pipedrive_owner_email,status_contrato";

    const [
      ctUnid,
      ctSemUnid,
      socios,
      vinculos,
      grupos,
      documentos,
      tratativas,
      cadastro,
      titulos,
      splits,
    ] = await Promise.all([
      todasAsPaginas((i, f) =>
        sb
          .from("contratos")
          .select(COLS_CT)
          .in("unidade", nomes)
          .eq("status_contrato", "Ativo")
          .order("id")
          .range(i, f),
      ),
      // Venda do pipe Sócios sem unidade herda a do sócio dono (mesma regra de v_hunter_socio).
      todasAsPaginas((i, f) =>
        sb
          .from("contratos")
          .select(COLS_CT)
          .is("unidade", null)
          .eq("origem_pipeline", "socios")
          .eq("status_contrato", "Ativo")
          .not("pipedrive_owner_email", "is", null)
          .order("id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb.from("socios").select("id,email,unidade_id").order("id").range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("contrato_omie_vinculo")
          .select("contrato_id,omie_cnpj,metodo")
          .order("contrato_id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb.from("contrato_omie_grupos").select("id,contrato_id,cpf_cnpj").order("id").range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("contratos_documentos")
          .select("id,pipedrive_deal_id,fase_atual,mrr_mensal,data_assinatura")
          .in("unidade", nomes)
          .order("id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("central_tratativas")
          .select("id,empresa_id,titulo,unidade,data_churn,motivo")
          .in("unidade", nomes)
          .eq("status", "lost")
          .order("id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("omie_clientes_cadastro")
          .select("cnpj,unidade")
          .in("unidade", nomes)
          .order("unidade")
          .order("cnpj")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("contas_receber")
          .select("id,unidade,cpf_cnpj,cliente,data_vencimento,valor,status_pagamento,codigo_omie")
          .in("unidade", nomes)
          .neq("status_pagamento", "CANCELADO")
          .order("id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("asaas_splits")
          .select("id,codigo_omie,status,valor,origin_account_id")
          .order("id")
          .range(i, f),
      ),
    ]);

    // Empresas só para a razão social (texto de apoio na conciliação).
    const empresaIds = [
      ...new Set([...ctUnid, ...ctSemUnid].map((c: any) => c.empresa_id).filter(Boolean)),
    ];
    const razao = new Map<number, string>();
    for (let i = 0; i < empresaIds.length; i += 300) {
      const { data } = await sb
        .from("empresas")
        .select("id,razao_social")
        .in("id", empresaIds.slice(i, i + 300));
      for (const e of data ?? []) razao.set(e.id, e.razao_social);
    }

    const unidadeDoSocio = new Map<string, string>();
    const nomeDaUnidadeId = new Map(unidades.map((u) => [u.id, u.nome_da_praca as string]));
    for (const s of socios as any[]) {
      const un = nomeDaUnidadeId.get(s.unidade_id);
      if (s.email && un) unidadeDoSocio.set(String(s.email).toLowerCase(), un);
    }
    const vinculoDe = new Map((vinculos as any[]).map((v) => [v.contrato_id, v]));
    const gruposDe = new Map<number, string[]>();
    for (const g of grupos as any[]) {
      const d = digitos(g.cpf_cnpj);
      if (d) gruposDe.set(g.contrato_id, [...(gruposDe.get(g.contrato_id) ?? []), d]);
    }
    const docsDoDeal = new Map<string, any[]>();
    for (const d of documentos as any[]) {
      const k = String(d.pipedrive_deal_id ?? "");
      if (k) docsDoDeal.set(k, [...(docsDoDeal.get(k) ?? []), d]);
    }

    type Ct = {
      id: number;
      unid: string;
      canal: Canal;
      titulo: string;
      ganho: string | null;
      deal: string;
      empresaId: number | null;
      mrr: number;
      cnpjs: string[];
      metodo: string;
      assinado: string | null;
      razao: string | null;
    };
    const contratos: Ct[] = [];
    for (const c of [...ctUnid, ...ctSemUnid] as any[]) {
      const unid =
        c.unidade ?? unidadeDoSocio.get(String(c.pipedrive_owner_email ?? "").toLowerCase());
      if (!unid || !porNome.has(unid)) continue;
      const v = vinculoDe.get(c.id);
      const proprio = digitos(String(c.cnpj ?? "").trim() || v?.omie_cnpj);
      const cnpjs = [
        ...new Set([proprio, ...(gruposDe.get(c.id) ?? [])].filter(Boolean) as string[]),
      ];
      const docs = docsDoDeal.get(String(c.pipedrive_deal_id ?? "")) ?? [];
      const assinadoPipefy =
        docs
          .map((d) => d.data_assinatura)
          .filter(Boolean)
          .sort()[0] ?? null;
      contratos.push({
        id: c.id,
        unid,
        canal: c.origem_pipeline === "socios" ? "Hunter" : "Inside Sales",
        titulo: c.titulo ?? "—",
        ganho: c.ganho_em ? String(c.ganho_em).slice(0, 10) : null,
        deal: String(c.pipedrive_deal_id ?? ""),
        empresaId: c.empresa_id ?? null,
        mrr: N(c.mrr_override) || N(c.mrr_mensal),
        cnpjs,
        metodo: String(c.cnpj ?? "").trim() ? "cnpj" : (v?.metodo ?? "sem CNPJ"),
        assinado:
          (c.entrada_contrato_assinado_em
            ? String(c.entrada_contrato_assinado_em).slice(0, 10)
            : null) ?? (assinadoPipefy ? String(assinadoPipefy).slice(0, 10) : null),
        razao: c.empresa_id ? (razao.get(c.empresa_id) ?? null) : null,
      });
    }

    const g = new Grupos();
    for (const c of contratos) {
      g.ache(`ct:${c.id}`);
      for (const cn of c.cnpjs) g.une(`cnpj:${c.unid}:${cn}`, `ct:${c.id}`);
    }
    const splitDo = new Map<string, any>();
    for (const s of splits as any[]) if (s.codigo_omie) splitDo.set(String(s.codigo_omie), s);
    const codigosComTitulo = new Set<string>();

    type Tit = {
      unid: string;
      cnpj: string | null;
      cliente: string;
      venc: string;
      valor: number;
      st: string;
      split: any | null;
      chave: string;
    };
    const tits: Tit[] = [];
    const omieDesde = new Map<string, string>();
    for (const t of titulos as any[]) {
      const venc = String(t.data_vencimento ?? "").slice(0, 10);
      if (!venc) continue;
      if (t.codigo_omie) codigosComTitulo.add(String(t.codigo_omie));
      const atual = omieDesde.get(t.unidade);
      if (!atual || venc < atual) omieDesde.set(t.unidade, venc);
      const cnpj = digitos(t.cpf_cnpj);
      tits.push({
        unid: t.unidade,
        cnpj,
        cliente: t.cliente ?? "—",
        venc,
        valor: N(t.valor),
        st: t.status_pagamento,
        split: t.codigo_omie ? (splitDo.get(String(t.codigo_omie)) ?? null) : null,
        chave: cnpj ? g.ache(`cnpj:${t.unidade}:${cnpj}`) : `sem:${t.unidade}:${t.cliente}`,
      });
    }

    // Canal do cliente: o da venda mais antiga dele.
    const ctsDoCliente = new Map<string, Ct[]>();
    for (const c of contratos) {
      const k = g.ache(`ct:${c.id}`);
      ctsDoCliente.set(k, [...(ctsDoCliente.get(k) ?? []), c]);
    }
    const canalDo = (chave: string): Canal => {
      const cs = ctsDoCliente.get(chave);
      if (!cs) return "Sem venda registrada";
      return [...cs].sort((a, b) => (a.ganho ?? "9").localeCompare(b.ganho ?? "9"))[0].canal;
    };

    // ------------------------------------------------------------ 1. funil
    const funil = new Map<string, LinhaFunil>();
    const funilSafra = new Map<string, LinhaFunil>();
    const linhaF = (unidade: string, mes: string, canal: Canal, alvo = funil) => {
      const k = `${unidade}|${mes}|${canal}`;
      let l = alvo.get(k);
      if (!l) {
        l = {
          unidade,
          mes,
          canal,
          vendas: 0,
          mrrVendido: 0,
          contratos: 0,
          mrrContratado: 0,
          titulos: 0,
          faturado: 0,
          recebido: 0,
          aReceber: 0,
          atrasado: 0,
          royaltyRecebido: 0,
          royaltyAReceber: 0,
          royaltyPerdido: 0,
          cliVendidos: 0,
          cliContrato: 0,
          cliFaturado: 0,
          cliPago: 0,
          cliRoyalty: 0,
          cliRoyaltyAReceber: 0,
        };
        alvo.set(k, l);
      }
      return l;
    };
    /** Soma o boleto nas colunas de dinheiro da linha. */
    const somaTitulo = (l: LinhaFunil, t: Tit) => {
      l.titulos += 1;
      l.faturado += t.valor;
      if (t.st === "RECEBIDO") l.recebido += t.valor;
      else l.aReceber += t.valor;
      if (t.st === "ATRASADO") l.atrasado += t.valor;
      if (t.split?.status === "DONE") l.royaltyRecebido += N(t.split.valor);
      else if (t.split && ["PENDING", "AWAITING_CREDIT"].includes(t.split.status))
        l.royaltyAReceber += N(t.split.valor);
      else if (t.st === "RECEBIDO" && !t.split)
        l.royaltyPerdido += Math.round(t.valor * pct(t.unid) * 100) / 100;
    };
    const primeiroTitulo = new Map<string, string>();
    for (const t of tits) {
      const p = primeiroTitulo.get(t.chave);
      if (!p || t.venc < p) primeiroTitulo.set(t.chave, t.venc);
    }
    for (const c of contratos) {
      if (c.ganho && c.ganho >= desde(c.unid)) {
        const l = linhaF(c.unid, mesDe(c.ganho), c.canal);
        l.vendas += 1;
        l.mrrVendido += c.mrr;
      }
      // Contrato: data de assinatura (Pipedrive ou Pipefy); sem ela, o primeiro
      // boleto do cliente. A venda do pipe Sócios nunca tem data de assinatura.
      const contratoEm = c.assinado ?? primeiroTitulo.get(g.ache(`ct:${c.id}`)) ?? null;
      if (contratoEm && contratoEm >= desde(c.unid)) {
        const l = linhaF(c.unid, mesDe(contratoEm), c.canal);
        l.contratos += 1;
        l.mrrContratado += c.mrr;
      }
    }
    for (const t of tits) {
      if (t.venc < desde(t.unid)) continue;
      somaTitulo(linhaF(t.unid, mesDe(t.venc), canalDo(t.chave)), t);
    }

    // Safra: o cliente fica no mês da primeira venda dele, e leva junto contrato,
    // boletos e royalty de qualquer mês. Boleto sem venda não tem safra e fica fora.
    const titsDoCliente = new Map<string, Tit[]>();
    for (const t of tits) {
      if (t.venc < desde(t.unid)) continue;
      titsDoCliente.set(t.chave, [...(titsDoCliente.get(t.chave) ?? []), t]);
    }
    for (const [k, cs] of ctsDoCliente) {
      const unid = cs[0].unid;
      const ganho = cs
        .map((c) => c.ganho)
        .filter(Boolean)
        .sort()[0];
      if (!ganho || ganho < desde(unid)) continue;
      const l = linhaF(unid, mesDe(ganho), canalDo(k), funilSafra);
      l.cliVendidos += 1;
      l.vendas += cs.length;
      l.mrrVendido += cs.reduce((a, c) => a + c.mrr, 0);
      const ts = titsDoCliente.get(k) ?? [];
      const assinados = cs.filter((c) => c.assinado || ts.length > 0);
      if (assinados.length) {
        l.cliContrato += 1;
        l.contratos += assinados.length;
        l.mrrContratado += assinados.reduce((a, c) => a + c.mrr, 0);
      }
      for (const t of ts) somaTitulo(l, t);
      if (ts.length) l.cliFaturado += 1;
      if (ts.some((t) => t.st === "RECEBIDO")) l.cliPago += 1;
      if (ts.some((t) => t.split?.status === "DONE")) l.cliRoyalty += 1;
      if (ts.some((t) => t.split && ["PENDING", "AWAITING_CREDIT"].includes(t.split.status)))
        l.cliRoyaltyAReceber += 1;
    }

    // ------------------------------------------------------------ 3. conciliação
    // Antes do gap, porque o gap usa a categoria (churn e duplicada viram gap de cadastro).
    const fatPorCliente = new Map<
      string,
      {
        ref: number;
        m3: number;
        ultimo: string | null;
        atrasado: number;
        nome: string;
        unid: string;
      }
    >();
    const m3Ini = (() => {
      let m = mesReferencia;
      for (let i = 0; i < 2; i++) {
        const [a, mm] = m.split("-").map(Number);
        m = mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, "0")}`;
      }
      return m;
    })();
    for (const t of tits) {
      let f = fatPorCliente.get(t.chave);
      if (!f) {
        f = { ref: 0, m3: 0, ultimo: null, atrasado: 0, nome: t.cliente, unid: t.unid };
        fatPorCliente.set(t.chave, f);
      }
      const m = mesDe(t.venc);
      if (m === mesReferencia) f.ref += t.valor;
      if (m >= m3Ini && m <= mesReferencia) f.m3 += t.valor;
      if (t.venc <= hoje && (!f.ultimo || t.venc > f.ultimo)) f.ultimo = t.venc;
      if (t.st === "ATRASADO") f.atrasado += t.valor;
    }
    const churnPorEmpresa = new Map<number, any>();
    const churnPorNome = new Map<string, any>();
    for (const r of tratativas as any[]) {
      if (r.empresa_id) churnPorEmpresa.set(r.empresa_id, r);
      churnPorNome.set(`${r.unidade}|${norm(r.titulo)}`, r);
    }
    const porNomeNaUnidade = new Map<string, Set<string>>();
    for (const [k, cs] of ctsDoCliente) {
      for (const c of cs) {
        for (const nome of [c.titulo, c.razao]) {
          const n = norm(nome);
          if (n.length > 3) {
            const kk = `${c.unid}|${n}`;
            porNomeNaUnidade.set(kk, (porNomeNaUnidade.get(kk) ?? new Set()).add(k));
          }
        }
      }
    }

    const conciliacao: ClienteConc[] = [];
    for (const [k, cs] of ctsDoCliente) {
      const unid = cs[0].unid;
      const mrr = cs.reduce((a, c) => a + c.mrr, 0);
      const docs = cs.flatMap((c) => docsDoDeal.get(c.deal) ?? []);
      const fases = [...new Set(docs.map((d) => d.fase_atual).filter(Boolean))].sort() as string[];
      const churn = cs
        .map(
          (c) =>
            (c.empresaId && churnPorEmpresa.get(c.empresaId)) ||
            churnPorNome.get(`${unid}|${norm(c.titulo)}`),
        )
        .find(Boolean);
      const churnPf = fases.includes("Churn no Contrato");
      const f = fatPorCliente.get(k);
      const ref = f?.ref ?? 0;
      const ganho =
        cs
          .map((c) => c.ganho)
          .filter(Boolean)
          .sort()[0] ?? null;
      const homonimos = new Set<string>();
      for (const c of cs)
        for (const h of porNomeNaUnidade.get(`${unid}|${norm(c.titulo)}`) ?? [])
          if (h !== k) homonimos.add(h);
      const deals = cs.map((c) => c.deal);
      const dupDeal = new Set(deals).size !== deals.length;
      const umBate =
        cs.length > 1 &&
        Math.abs(ref - mrr) > TOL * mrr &&
        cs.some((c) => Math.abs(ref - c.mrr) <= TOL * Math.max(ref, 1));
      let categoria: CategoriaConc;
      if (churn || churnPf) categoria = "Churn não baixado no Pipedrive";
      else if (dupDeal || umBate || homonimos.size > 0) categoria = "Venda duplicada (provável)";
      else if (ref === 0 && ganho && mesDe(ganho) >= mesReferencia)
        categoria = "Venda recente, ainda não faturou";
      else if (ref === 0 && (f?.m3 ?? 0) === 0) categoria = "Sem faturamento";
      else if (ref === 0) categoria = "Parou de faturar";
      else if (Math.abs(ref - mrr) <= TOL * mrr) categoria = "OK (±20%)";
      else categoria = ref < mrr ? "Fatura menos que o MRR" : "Fatura mais que o MRR";

      conciliacao.push({
        chave: k,
        unidade: unid,
        canal: canalDo(k),
        categoria,
        cliente: cs[0].titulo,
        razaoSocial: cs[0].razao,
        contratos: cs.length,
        deals,
        ganhoEm: ganho,
        mrrPipedrive: mrr,
        mrrPipefy: docs.length ? docs.reduce((a, d) => a + N(d.mrr_mensal), 0) : null,
        fasesPipefy: fases,
        faturadoRef: ref,
        faturadoMedia3: (f?.m3 ?? 0) / 3,
        ultimoVencimento: f?.ultimo ?? null,
        atrasado: f?.atrasado ?? 0,
        churnEm: churn?.data_churn ?? null,
        motivoChurn: churn?.motivo ?? null,
        observacao: homonimos.size
          ? `Outro contrato com o mesmo nome: ${[...homonimos].map((h) => ctsDoCliente.get(h)?.[0].titulo).join(", ")}`
          : null,
        vinculo: [...new Set(cs.map((c) => c.metodo))].join(", "),
      });
    }
    // Cliente a mais: faturou no mês de referência e não tem venda ativa.
    const sobras: ClienteConc[] = [];
    for (const [k, f] of fatPorCliente) {
      if (ctsDoCliente.has(k) || f.ref === 0) continue;
      sobras.push({
        chave: k,
        unidade: f.unid,
        canal: "Sem venda registrada",
        categoria: "Cliente a mais no Omie",
        cliente: f.nome,
        razaoSocial: null,
        contratos: 0,
        deals: [],
        ganhoEm: null,
        mrrPipedrive: 0,
        mrrPipefy: null,
        fasesPipefy: [],
        faturadoRef: f.ref,
        faturadoMedia3: f.m3 / 3,
        ultimoVencimento: f.ultimo,
        atrasado: f.atrasado,
        churnEm: null,
        motivoChurn: null,
        observacao: null,
        vinculo: "",
      });
    }
    // Venda sem faturamento × cliente a mais com nome parecido: o CNPJ não casou.
    const usados = new Set<string>();
    for (const c of conciliacao) {
      if (
        c.faturadoRef ||
        !["Sem faturamento", "Parou de faturar", "Venda recente, ainda não faturou"].includes(
          c.categoria,
        )
      )
        continue;
      let melhor: { nota: number; s: ClienteConc } | null = null;
      for (const s of sobras) {
        if (s.unidade !== c.unidade || usados.has(s.chave)) continue;
        const nota = Math.max(parecido(c.cliente, s.cliente), parecido(c.razaoSocial, s.cliente));
        if (!melhor || nota > melhor.nota) melhor = { nota, s };
      }
      if (!melhor || melhor.nota < 0.6) continue;
      usados.add(melhor.s.chave);
      Object.assign(c, {
        faturadoRef: melhor.s.faturadoRef,
        faturadoMedia3: melhor.s.faturadoMedia3,
        ultimoVencimento: melhor.s.ultimoVencimento,
        atrasado: melhor.s.atrasado,
        categoria: "Mesmo cliente, CNPJ não casou" as CategoriaConc,
        observacao: `No Omie como "${melhor.s.cliente}" (nome ${Math.round(melhor.nota * 100)}% parecido)`,
      });
    }
    conciliacao.push(...sobras.filter((s) => !usados.has(s.chave)));
    // Unidade cujo Omie começa depois do mês de referência não tem como conciliar.
    for (const c of conciliacao) {
      const ini = omieDesde.get(c.unidade);
      if (
        (!ini || mesDe(ini) > mesReferencia) &&
        ["Sem faturamento", "Parou de faturar", "Venda recente, ainda não faturou"].includes(
          c.categoria,
        )
      ) {
        c.categoria = "Omie da unidade ainda não cobre o mês";
      }
    }
    const categoriaDo = new Map(conciliacao.map((c) => [c.chave, c.categoria]));

    // ------------------------------------------------------------ 2. gap
    const gap = new Map<string, LinhaGap>();
    const operando = new Set<string>();
    for (const r of cadastro as any[]) {
      const d = digitos(r.cnpj);
      if (d) operando.add(`${r.unidade}|${d}`);
    }
    for (const t of tits) if (t.cnpj) operando.add(`${t.unid}|${t.cnpj}`);

    for (const un of nomes) {
      const p = pct(un);
      const d = desde(un);
      // Só meses inteiros com split.
      let m = d.endsWith("-01") ? mesDe(d) : proximoMes(mesDe(d));
      while (m <= mesAtual) {
        const fim = ultimoDia(m);
        const clientes = new Map<
          string,
          { mrr: number; canal: Canal; contrato: boolean; tit: Tit[] }
        >();
        for (const c of contratos) {
          if (c.unid !== un || !c.ganho || c.ganho > fim) continue;
          const k = g.ache(`ct:${c.id}`);
          const cl = clientes.get(k) ?? { mrr: 0, canal: canalDo(k), contrato: false, tit: [] };
          cl.mrr += c.mrr;
          cl.contrato =
            cl.contrato || !!c.assinado || c.cnpjs.some((cn) => operando.has(`${un}|${cn}`));
          clientes.set(k, cl);
        }
        for (const t of tits) {
          if (t.unid !== un || mesDe(t.venc) !== m || t.venc < d) continue;
          const cl = clientes.get(t.chave) ?? {
            mrr: 0,
            canal: "Sem venda registrada" as Canal,
            contrato: true,
            tit: [],
          };
          cl.tit.push(t);
          clientes.set(t.chave, cl);
        }
        for (const [k, cl] of clientes) {
          // Idade da venda no mês: a tela usa para a carência (venda que ainda
          // não teve tempo de faturar não é gap, é implantação).
          const ganho = (ctsDoCliente.get(k) ?? [])
            .map((c) => c.ganho)
            .filter(Boolean)
            .sort()[0];
          let idade = -1;
          if (ganho) {
            const [ga, gm] = mesDe(ganho).split("-").map(Number);
            const [ma, mm] = m.split("-").map(Number);
            idade = Math.min(3, Math.max(0, (ma - ga) * 12 + (mm - gm)));
          }
          const kk = `${un}|${m}|${cl.canal}|${idade}`;
          const a = gap.get(kk) ?? {
            idade,
            unidade: un,
            mes: m,
            canal: cl.canal,
            potencial: 0,
            gapCadastro: 0,
            gapContrato: 0,
            gapFaturamento: 0,
            gapInadimplencia: 0,
            gapSplit: 0,
            noPrazo: 0,
            royaltyRecebido: 0,
            royaltyACreditar: 0,
            extra: 0,
            taxa: 0,
          };
          gap.set(kk, a);
          const fat = cl.tit.reduce((s, t) => s + t.valor, 0);
          const cat = categoriaDo.get(k);
          if (cl.canal !== "Sem venda registrada" || ctsDoCliente.has(k)) {
            a.potencial += cl.mrr * p;
            if (cat === "Churn não baixado no Pipedrive")
              a.gapCadastro += Math.max(cl.mrr - fat, 0) * p;
            else if (!cl.contrato) a.gapContrato += cl.mrr * p;
            else if (cat === "Venda duplicada (provável)")
              a.gapCadastro += Math.max(cl.mrr - fat, 0) * p;
            else a.gapFaturamento += Math.max(cl.mrr - fat, 0) * p;
            a.extra += Math.max(fat - cl.mrr, 0) * p;
          } else {
            a.extra += fat * p;
          }
          for (const t of cl.tit) {
            const v = t.valor * p;
            // O split creditado vale mais que o status do Omie, que atrasa no sync.
            if (t.split?.status === "DONE") {
              a.royaltyRecebido += N(t.split.valor);
              a.taxa += v - N(t.split.valor);
            } else if (t.st === "ATRASADO") a.gapInadimplencia += v;
            else if (t.st !== "RECEBIDO") a.noPrazo += v;
            else if (t.split && ["PENDING", "AWAITING_CREDIT"].includes(t.split.status)) {
              a.royaltyACreditar += N(t.split.valor);
              a.taxa += v - N(t.split.valor);
            } else a.gapSplit += v;
          }
        }
        m = proximoMes(m);
      }
    }

    // Split sem título no Omie: fora do funil por mês, mas declarado (N2).
    const contaDe = new Map<string, string>();
    {
      const { data } = await sb
        .from("unidades")
        .select("nome_da_praca,asaas_account_id")
        .in("nome_da_praca", nomes);
      for (const u of data ?? [])
        if (u.asaas_account_id) contaDe.set(u.asaas_account_id, u.nome_da_praca);
    }
    const orfaos = new Map<string, { unidade: string; creditado: number; aCreditar: number }>();
    for (const s of splits as any[]) {
      if (s.codigo_omie && codigosComTitulo.has(String(s.codigo_omie))) continue;
      const un = contaDe.get(s.origin_account_id);
      if (!un) continue;
      const o = orfaos.get(un) ?? { unidade: un, creditado: 0, aCreditar: 0 };
      if (s.status === "DONE") o.creditado += N(s.valor);
      else if (["PENDING", "AWAITING_CREDIT"].includes(s.status)) o.aCreditar += N(s.valor);
      orfaos.set(un, o);
    }

    return {
      unidades: unidades.map((u) => ({
        nome: u.nome_da_praca,
        splitDesde: u.split_ativo_desde,
        percentual: N(u.royalties_percentual),
        omieDesde: omieDesde.get(u.nome_da_praca) ?? null,
      })),
      funil: [...funil.values()],
      funilSafra: [...funilSafra.values()],
      gap: [...gap.values()],
      conciliacao,
      mesReferencia,
      splitsSemTitulo: [...orfaos.values()].filter((o) => o.creditado + o.aCreditar >= 1),
      geradoEm: new Date().toISOString(),
    };
  });
