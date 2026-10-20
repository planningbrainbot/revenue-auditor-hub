import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { todasAsPaginas } from "@/lib/cockpit-ceo/paginar";

/**
 * Funil da venda ao recebido (/unidades/funil-recebido): todas as unidades,
 * três etapas (vendas, contratos, recebido pela unidade), sem royalty. Pedido de
 * 20/10/2026, validado na planilha de tools/funil_rede_todas_planilha.py (repo
 * AI Projects).
 *
 * Recebido pela unidade, por mês:
 * - mês com apuração de royalties: itens da apuração sem CAC, sem excluídos e
 *   sem `csc_base_antiga` (carteira de antes da rede, que não veio de venda);
 * - mês depois da última apuração, só em quem tem split: títulos RECEBIDO do Omie
 *   da unidade com vencimento desde o split (mesma régua de v_split_cliente_mes).
 * A apuração vence o split no mesmo mês. Sem nenhum dos dois, o mês fica sem
 * recebido (não é zero): São Bernardo, Sorocaba e Recife só têm CAC na apuração.
 *
 * `receita_base` da apuração não serve como total: em Fortaleza e São Bernardo
 * ela inclui o CAC. Por isso a soma é item a item.
 *
 * CAC × recebido: o CAC cobrado são os itens `is_cac` das apurações; o recebido é
 * o de cima, dos mesmos clientes, casado por CNPJ e, sem CNPJ (Fortaleza), pelo
 * nome normalizado dentro da unidade.
 */

const INICIO = "2025-12-01"; // primeira apuração de royalties no banco

export type FonteRecebido = "apuracao" | "split";

export interface LinhaMes {
  unidade: string;
  mes: string;
  vendas: number;
  mrrVendido: number;
  contratos: number;
  mrrContratado: number;
  /** null = sem fonte no mês. */
  recebido: number | null;
  clientesPagaram: number;
  fonte: FonteRecebido | null;
}

export interface UnidadeFunil {
  nome: string;
  tipo: string | null;
  splitDesde: string | null;
  pagaCac: boolean;
  /** Último mês com apuração de royalties. */
  ultimaApuracao: string | null;
  baseAntiga: number;
  /** Clientes distintos com recebido no recorte. */
  clientesPagaram: number;
}

export interface ClienteCac {
  unidade: string;
  cliente: string;
  cnpj: string | null;
  casouPor: "CNPJ" | "nome" | null;
  primeiroCac: string;
  cacAdiantado: number;
  cacSegunda: number;
  cacIntegral: number;
  cacSemParcela: number;
  cacTotal: number;
  recebido: number;
  mesesComRecebido: number;
}

export interface FunilRecebido {
  unidades: UnidadeFunil[];
  meses: LinhaMes[];
  cac: ClienteCac[];
  inicio: string;
  geradoEm: string;
}

const N = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "") || null;
const mesDe = (d: string) => d.slice(0, 7);

/** Sem acento, pontuação nem sufixo societário: "São Luís" = "Sao Luis". */
function chaveNome(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ltda|me|epp|eireli|s ?a|cia|comercio|servicos|grupo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function can(sb: any, chave: string): Promise<boolean> {
  const { data } = await sb.rpc("can", { _key: chave });
  return data === true;
}

export const carregarFunilRecebido = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FunilRecebido> => {
    // Mesmo portão e mesmo motivo do Funil da Rede: a chave é checada com a
    // sessão; a leitura é do servidor, senão o RLS das tabelas cruzadas devolve
    // número parcial sem erro.
    if (!(await can(context.supabase as any, "view.royalties_split"))) {
      throw new Error("Acesso negado: falta a chave view.royalties_split.");
    }
    const sb = supabaseAdmin as any;

    const { data: us, error: eu } = await sb
      .from("unidades")
      .select("id,nome_da_praca,tipo,split_ativo_desde,paga_cac")
      .order("nome_da_praca");
    if (eu) throw new Error(`Unidades: ${eu.message}`);
    const cadastro = (us ?? []) as any[];
    const porId = new Map<number, any>(cadastro.map((u) => [u.id, u]));
    const porChave = new Map<string, any>(cadastro.map((u) => [chaveNome(u.nome_da_praca), u]));
    const splitMin = cadastro
      .map((u) => u.split_ativo_desde as string | null)
      .filter(Boolean)
      .sort()[0];

    const COLS_CT =
      "id,unidade,origem_pipeline,ganho_em,entrada_contrato_assinado_em,mrr_mensal,mrr_override,pipedrive_owner_email";
    const [contratos, socios, itens, titulos] = await Promise.all([
      todasAsPaginas((i, f) =>
        sb
          .from("contratos")
          .select(COLS_CT)
          .or(`ganho_em.gte.${INICIO},entrada_contrato_assinado_em.gte.${INICIO}`)
          .order("id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb.from("socios").select("id,email,unidade_id").order("id").range(i, f),
      ),
      todasAsPaginas((i, f) =>
        sb
          .from("royalties_itens")
          .select(
            "id,cnpj,razao_social,is_cac,cac_parcela,categoria,valor_confirmado,apuracao:royalties_apuracao!inner(unidade_id,mes_referencia)",
          )
          .is("excluido_em", null)
          .order("id")
          .range(i, f),
      ),
      splitMin
        ? todasAsPaginas((i, f) =>
            sb
              .from("contas_receber")
              .select("id,unidade,cpf_cnpj,cliente,data_vencimento,valor")
              .eq("status_pagamento", "RECEBIDO")
              .gte("data_vencimento", splitMin)
              .order("id")
              .range(i, f),
          )
        : Promise.resolve([]),
    ]);

    // ---- vendas e contratos por unidade × mês
    const socioUnid = new Map<string, number>(
      (socios as any[])
        .filter((s) => s.email && s.unidade_id)
        .map((s) => [String(s.email).toLowerCase(), s.unidade_id]),
    );
    const linhas = new Map<string, LinhaMes>();
    const linha = (unidade: string, mes: string): LinhaMes => {
      const k = `${unidade}|${mes}`;
      let l = linhas.get(k);
      if (!l) {
        l = {
          unidade,
          mes,
          vendas: 0,
          mrrVendido: 0,
          contratos: 0,
          mrrContratado: 0,
          recebido: null,
          clientesPagaram: 0,
          fonte: null,
        };
        linhas.set(k, l);
      }
      return l;
    };
    for (const c of contratos as any[]) {
      // Venda do pipe Sócios sem unidade herda a do sócio dono (regra de v_hunter_socio).
      let nome: string | null = c.unidade;
      if (!nome && c.origem_pipeline === "socios" && c.pipedrive_owner_email) {
        nome = porId.get(
          socioUnid.get(String(c.pipedrive_owner_email).toLowerCase()) ?? -1,
        )?.nome_da_praca;
      }
      const u = nome ? porChave.get(chaveNome(nome)) : null;
      if (!u) continue; // Matriz e unidades fora do cadastro
      const mrr = c.mrr_override != null ? N(c.mrr_override) : N(c.mrr_mensal);
      if (c.ganho_em && c.ganho_em >= INICIO) {
        const l = linha(u.nome_da_praca, mesDe(c.ganho_em));
        l.vendas += 1;
        l.mrrVendido += mrr;
      }
      if (c.entrada_contrato_assinado_em && c.entrada_contrato_assinado_em >= INICIO) {
        const l = linha(u.nome_da_praca, mesDe(c.entrada_contrato_assinado_em));
        l.contratos += 1;
        l.mrrContratado += mrr;
      }
    }

    // ---- recebido: apuração, depois split
    // O recorte do mês da apuração é aqui, não no PostgREST: filtro em recurso
    // embutido com apelido depende da versão. São poucos milhares de itens.
    const itensRecorte = (itens as any[]).filter((it) => it.apuracao.mes_referencia >= INICIO);
    const ultimaApuracao = new Map<string, string>();
    for (const it of itensRecorte) {
      const u = porId.get(it.apuracao.unidade_id);
      if (!u) continue;
      const m = mesDe(it.apuracao.mes_referencia);
      if ((ultimaApuracao.get(u.nome_da_praca) ?? "") < m) ultimaApuracao.set(u.nome_da_praca, m);
    }

    const baseAntiga = new Map<string, number>();
    // Recebido por cliente: indexado por CNPJ e por nome, para o CAC sem CNPJ achar.
    const recCli = new Map<string, Map<string, number>>();
    const clientesMes = new Map<string, Set<string>>();
    const somaCliente = (un: string, cnpj: string | null, nome: string, mes: string, v: number) => {
      const chaves = [
        cnpj ? `${un}|c:${cnpj}` : null,
        chaveNome(nome) ? `${un}|n:${chaveNome(nome)}` : null,
      ];
      for (const k of chaves) {
        if (!k) continue;
        const m = recCli.get(k) ?? new Map<string, number>();
        m.set(mes, (m.get(mes) ?? 0) + v);
        recCli.set(k, m);
      }
      if (v > 0) {
        const k = `${un}|${mes}`;
        const s = clientesMes.get(k) ?? new Set<string>();
        s.add(cnpj ?? `n:${chaveNome(nome)}`);
        clientesMes.set(k, s);
      }
    };
    const somaMes = (un: string, mes: string, v: number, fonte: FonteRecebido) => {
      const l = linha(un, mes);
      l.recebido = (l.recebido ?? 0) + v;
      l.fonte = fonte;
    };

    type Cac = Omit<ClienteCac, "casouPor" | "recebido" | "mesesComRecebido"> & {
      chaveNome: string;
    };
    const cacs = new Map<string, Cac>();
    for (const it of itensRecorte) {
      const u = porId.get(it.apuracao.unidade_id);
      if (!u) continue;
      const un = u.nome_da_praca as string;
      const mes = mesDe(it.apuracao.mes_referencia);
      const v = N(it.valor_confirmado);
      const cnpj = digitos(it.cnpj);
      if (it.is_cac) {
        const k = `${un}|${cnpj ?? ""}|${chaveNome(it.razao_social)}`;
        const c =
          cacs.get(k) ??
          ({
            unidade: un,
            cliente: it.razao_social ?? "—",
            cnpj,
            chaveNome: chaveNome(it.razao_social),
            primeiroCac: mes,
            cacAdiantado: 0,
            cacSegunda: 0,
            cacIntegral: 0,
            cacSemParcela: 0,
            cacTotal: 0,
          } as Cac);
        if (it.cac_parcela === 1) c.cacAdiantado += v;
        else if (it.cac_parcela === 2) c.cacSegunda += v;
        else if (it.cac_parcela === 3) c.cacIntegral += v;
        else c.cacSemParcela += v;
        c.cacTotal += v;
        if (mes < c.primeiroCac) c.primeiroCac = mes;
        cacs.set(k, c);
        continue;
      }
      if (it.categoria === "csc_base_antiga") {
        baseAntiga.set(un, (baseAntiga.get(un) ?? 0) + v);
        continue;
      }
      somaMes(un, mes, v, "apuracao");
      somaCliente(un, cnpj, it.razao_social, mes, v);
    }

    for (const t of titulos as any[]) {
      const u = porChave.get(chaveNome(t.unidade));
      if (!u?.split_ativo_desde || !t.data_vencimento) continue;
      if (t.data_vencimento < u.split_ativo_desde) continue;
      const mes = mesDe(t.data_vencimento);
      if (mes <= (ultimaApuracao.get(u.nome_da_praca) ?? "")) continue;
      somaMes(u.nome_da_praca, mes, N(t.valor), "split");
      somaCliente(u.nome_da_praca, digitos(t.cpf_cnpj), t.cliente, mes, N(t.valor));
    }

    for (const l of linhas.values())
      l.clientesPagaram = clientesMes.get(`${l.unidade}|${l.mes}`)?.size ?? 0;

    const cac: ClienteCac[] = [...cacs.values()].map(({ chaveNome: nk, ...c }) => {
      let rec = c.cnpj ? recCli.get(`${c.unidade}|c:${c.cnpj}`) : undefined;
      let casouPor: ClienteCac["casouPor"] = rec ? "CNPJ" : null;
      if (!rec) {
        rec = recCli.get(`${c.unidade}|n:${nk}`);
        casouPor = rec ? "nome" : null;
      }
      const valores = [...(rec?.values() ?? [])];
      return {
        ...c,
        casouPor,
        recebido: valores.reduce((a, v) => a + v, 0),
        mesesComRecebido: valores.filter((v) => v > 0).length,
      };
    });

    const meses = [...linhas.values()].sort(
      (a, b) => a.unidade.localeCompare(b.unidade) || a.mes.localeCompare(b.mes),
    );
    const comMovimento = new Set(meses.map((l) => l.unidade));
    const unidades: UnidadeFunil[] = cadastro
      .filter((u) => comMovimento.has(u.nome_da_praca))
      .map((u) => {
        const clientes = new Set<string>();
        for (const [k, s] of clientesMes)
          if (k.startsWith(`${u.nome_da_praca}|`)) s.forEach((c) => clientes.add(c));
        return {
          nome: u.nome_da_praca,
          tipo: u.tipo ?? null,
          splitDesde: u.split_ativo_desde ?? null,
          pagaCac: u.paga_cac === true,
          ultimaApuracao: ultimaApuracao.get(u.nome_da_praca) ?? null,
          baseAntiga: baseAntiga.get(u.nome_da_praca) ?? 0,
          clientesPagaram: clientes.size,
        };
      });

    return { unidades, meses, cac, inicio: mesDe(INICIO), geradoEm: new Date().toISOString() };
  });
