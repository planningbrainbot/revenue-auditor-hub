// Fechamento do mês do CAC: o que entrou na apuração de um mês, o que deveria
// ter entrado pelo gatilho de cada parcela, e onde os dois divergem.
//
// Por que existe: a reunião de apuração com o sócio segue o demonstrativo (por
// mês e por parcela), e o Funil de CAC mostrava saldo acumulado por venda. Regras
// no PRD `wiki/prds/2026-10-minha-unidade-fechamento-de-cac.md` (R-xx abaixo).
//
// O valor da tela é sempre o da apuração (regra do usuário, 22/10/2026). A nota
// gravada no Ops não acompanha cancelamento nem pagamento avulso no Omie
// (Maceió 08/2026: nota cancelada, pago avulso o total da apuração), então
// não entra na conta.
//
// Módulo puro: recebe as linhas já lidas e devolve o fechamento. A tela lê o
// banco; aqui não há consulta, para a conta poder ser conferida por fora.

export type ApuracaoCac = {
  id: number;
  unidade_id: number;
  mes_referencia: string; // AAAA-MM-DD
  status: string;
  cac_valor: number | null;
  confirmado_em: string | null;
};

export type ItemCac = {
  id: number;
  apuracao_id: number;
  contrato_id: number | null;
  razao_social: string | null;
  cnpj: string | null;
  data_ganho: string | null;
  cac_parcela: 1 | 2 | 3 | null;
  royalties_item: number | null;
  valor_confirmado: number | null;
  excluido_em: string | null;
  motivo_exclusao: string | null;
};

export type FaturaCac = {
  apuracao_id: number;
  valor_cac: number | null;
  status: string | null;
  num_os: string | null;
};

/** O pedaço de `v_cac_funil` que o fechamento usa. */
export type VendaCac = {
  contrato_id: number | null;
  cliente: string | null;
  ganho_em: string | null;
  mrr_mensal: number | null;
  data_assinatura: string | null; // Central de Contratos: data do cliente (regra de 20/10/2026)
  fase_contrato: string | null;
  honorario: number | null; // 1º honorário do card
  elegivel: boolean;
  assinado: boolean;
  churn: boolean;
  cliente_pagou_honorario?: boolean | null;
};

export type EstornoCac = {
  cliente: string | null;
  valor_cb: number;
  mes_ref: string | null;
  observacao: string | null;
};

export type Situacao =
  | "no_mes"
  | "atrasada"
  | "antes_do_gatilho"
  | "sem_data_central"
  | "sem_pagamento_marcado"
  | "ja_cobrada"
  | "sem_cobranca"
  | "fora"
  | "historico"
  | "nao_entrou";

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  no_mes: "No mês",
  atrasada: "Entrou atrasada",
  antes_do_gatilho: "Entrou antes do gatilho",
  sem_data_central: "Sem data de assinatura na Central",
  sem_pagamento_marcado: "Sem pagamento marcado no card",
  ja_cobrada: "Já cobrada em nota anterior",
  sem_cobranca: "Registrado sem cobrança",
  fora: "Fora, com motivo",
  historico: "Sem parcela definida",
  nao_entrou: "Deveria entrar e não entrou",
};

/** Situações que pedem conversa na reunião. */
export const SITUACAO_DIVERGE: ReadonlySet<Situacao> = new Set([
  "antes_do_gatilho",
  "sem_pagamento_marcado",
  "ja_cobrada",
  "nao_entrou",
]);

export type Grupo = "p1" | "p2" | "integral" | "historico";

export const ROTULO_GRUPO: Record<Grupo, string> = {
  p1: "1ª parcela (50% na assinatura)",
  p2: "2ª parcela (50% após o 1º honorário)",
  integral: "Integral (100%, 1º honorário já recebido)",
  historico: "Sem parcela definida (histórico)",
};

export type LinhaFechamento = {
  chave: string;
  item_id: number | null;
  cliente: string;
  cnpj: string | null;
  ganho: string | null;
  assinatura: string | null;
  grupo: Grupo;
  /** Valor sobre o qual a parcela é calculada (1º honorário). */
  base: number | null;
  percentual: number | null;
  /** O que entrou na apuração; 0 quando não entrou. */
  valor: number;
  /** O que a regra espera para a parcela (R-04/R-05); nulo sem base. */
  esperado: number | null;
  situacao: Situacao;
  detalhe: string | null;
  valorDiferente: boolean;
};

export type Pendencia = {
  chave: string;
  cliente: string;
  motivo: string;
  valor: number | null;
};

export type Fechamento = {
  apuracao: ApuracaoCac;
  linhas: LinhaFechamento[];
  entrou: number;
  deveria: number;
  naApuracao: number | null;
  faturado: number | null;
  notas: string[];
  pendencias: Pendencia[];
  ajustes: EstornoCac[];
};

const mes = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);
const n = (v: number | string | null | undefined) => Number(v ?? 0);

/** Nome comparável: sem acento, caixa, parênteses e sufixo societário. */
export function nomeChave(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function parcelasDo(p: ItemCac["cac_parcela"]): (1 | 2)[] {
  if (p === 1) return [1];
  if (p === 2) return [2];
  if (p === 3) return [1, 2];
  return [];
}

function grupoDo(p: ItemCac["cac_parcela"]): Grupo {
  if (p === 1) return "p1";
  if (p === 2) return "p2";
  if (p === 3) return "integral";
  return "historico";
}

const fmtMes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Monta o fechamento de um mês de uma unidade.
 * `itens` traz os itens de CAC de TODAS as apurações da unidade: é assim que se
 * sabe se uma parcela já saiu antes (R-14) ou só depois (atrasada).
 */
export function montarFechamento(args: {
  apuracao: ApuracaoCac;
  apuracoes: ApuracaoCac[];
  itens: ItemCac[];
  faturas: FaturaCac[];
  vendas: VendaCac[];
  estornos: EstornoCac[];
  semAdiantamento?: boolean; // Recife (R-06)
}): Fechamento {
  const { apuracao, apuracoes, itens, faturas, vendas, estornos, semAdiantamento } = args;
  const mesRef = mes(apuracao.mes_referencia)!;
  const mesDe = new Map(apuracoes.map((a) => [a.id, mes(a.mes_referencia)!]));
  const comNota = new Set(faturas.filter((f) => f.status === "faturada").map((f) => f.apuracao_id));

  const porContrato = new Map<number, VendaCac>();
  const porNome = new Map<string, VendaCac>();
  for (const v of vendas) {
    if (v.contrato_id != null) porContrato.set(v.contrato_id, v);
    const k = nomeChave(v.cliente);
    if (k && !porNome.has(k)) porNome.set(k, v);
  }
  const vendaDo = (i: ItemCac) =>
    (i.contrato_id != null ? porContrato.get(i.contrato_id) : undefined) ??
    porNome.get(nomeChave(i.razao_social));
  const chaveDo = (i: ItemCac) => {
    const v = vendaDo(i);
    if (v?.contrato_id != null) return `c${v.contrato_id}`;
    if (i.contrato_id != null) return `c${i.contrato_id}`;
    return `n${nomeChave(i.razao_social)}`;
  };
  const chaveDaVenda = (v: VendaCac) =>
    v.contrato_id != null ? `c${v.contrato_id}` : `n${nomeChave(v.cliente)}`;

  // Onde cada parcela já foi cobrada com valor, em qualquer mês.
  const cobradas = new Map<string, { mes: string; apuracao_id: number; nota: boolean }[]>();
  for (const i of itens) {
    if (i.excluido_em || n(i.royalties_item) <= 0) continue;
    // Item sem parcela (histórico) fica em "*": prova que houve cobrança, sem dizer qual.
    const ps = parcelasDo(i.cac_parcela);
    for (const p of ps.length ? ps : ["*"]) {
      const k = `${chaveDo(i)}:${p}`;
      const lista = cobradas.get(k) ?? [];
      lista.push({
        mes: mesDe.get(i.apuracao_id) ?? "",
        apuracao_id: i.apuracao_id,
        nota: comNota.has(i.apuracao_id),
      });
      cobradas.set(k, lista);
    }
  }
  const cobradaFora = (k: string, p: 1 | 2, foraDe: number) =>
    (cobradas.get(`${k}:${p}`) ?? []).filter((c) => c.apuracao_id !== foraDe);

  const linhas: LinhaFechamento[] = [];
  const doMes = itens.filter((i) => i.apuracao_id === apuracao.id);

  for (const i of doMes) {
    const v = vendaDo(i);
    const k = chaveDo(i);
    const ps = parcelasDo(i.cac_parcela);
    const base = v ? (v.honorario ?? v.mrr_mensal ?? null) : null;
    const esperado = base != null && ps.length > 0 ? base * 0.5 * ps.length : null;
    const valor = i.excluido_em ? 0 : n(i.royalties_item);
    const linha: LinhaFechamento = {
      chave: `${k}:${i.id}`,
      item_id: i.id,
      cliente: i.razao_social ?? v?.cliente ?? "—",
      cnpj: i.cnpj,
      ganho: i.data_ganho ?? v?.ganho_em ?? null,
      assinatura: v?.data_assinatura ?? null,
      grupo: grupoDo(i.cac_parcela),
      base: n(i.valor_confirmado) || base,
      percentual: ps.length ? 50 * ps.length : null,
      valor,
      esperado,
      situacao: "no_mes",
      detalhe: null,
      valorDiferente: false,
    };

    if (i.excluido_em) {
      linha.situacao = "fora";
      linha.detalhe = i.motivo_exclusao;
    } else if (ps.length === 0) {
      linha.situacao = valor > 0 ? "historico" : "sem_cobranca";
    } else {
      // R-14: a mesma parcela já saiu com valor em outra apuração anterior.
      const antes = ps
        .flatMap((p) => cobradaFora(k, p, apuracao.id))
        .filter((c) => c.mes < mesRef)
        .sort((a, b) => a.mes.localeCompare(b.mes))[0];
      if (antes) {
        linha.situacao = "ja_cobrada";
        linha.detalhe = `Cobrada na apuração de ${fmtMes(antes.mes)}${antes.nota ? ", que já tem nota" : ", ainda sem nota"}`;
      } else if (valor <= 0) {
        linha.situacao = "sem_cobranca"; // R-02a
      } else if (ps.includes(1)) {
        const gat = mes(v?.data_assinatura);
        if (!gat) {
          linha.situacao = "sem_data_central"; // R-04a: informa, não diverge
          linha.detalhe = "A Central de Contratos não tem a data de assinatura do cliente";
        } else if (gat === mesRef) linha.situacao = "no_mes";
        else if (gat < mesRef) {
          linha.situacao = "atrasada";
          linha.detalhe = `Assinou em ${fmtMes(gat)}`;
        } else {
          linha.situacao = "antes_do_gatilho";
          linha.detalhe = `Assinou só em ${fmtMes(gat)}`;
        }
      } else {
        // 2ª parcela: até o campo de data entrar no card (R-05), vale o Sim marcado.
        if (v?.cliente_pagou_honorario) {
          linha.situacao = "no_mes";
          linha.detalhe = "Card com 1º honorário pago; data ainda não registrada";
        } else {
          linha.situacao = "sem_pagamento_marcado";
          linha.detalhe = "O card não marca o 1º honorário como pago";
        }
      }
    }
    if (valor > 0 && esperado != null && Math.abs(valor - esperado) > 0.5) {
      linha.valorDiferente = true;
    }
    if (
      valor <= 0 &&
      !i.excluido_em &&
      esperado != null &&
      esperado > 0 &&
      linha.situacao === "sem_cobranca"
    ) {
      linha.valorDiferente = true;
    }
    linhas.push(linha);
  }

  // R-04: contrato assinado no mês que não entrou nesta apuração.
  // Qualquer item do contrato neste mês (sem parcela, zerado ou excluído com motivo) já tem linha própria.
  const noMesComItem = new Set(
    doMes.flatMap((i) =>
      i.cac_parcela == null
        ? [`${chaveDo(i)}:1`, `${chaveDo(i)}:2`]
        : parcelasDo(i.cac_parcela).map((p) => `${chaveDo(i)}:${p}`),
    ),
  );
  if (!semAdiantamento) {
    for (const v of vendas) {
      if (v.contrato_id == null || !v.elegivel || v.churn) continue;
      if (mes(v.data_assinatura) !== mesRef) continue;
      const k = chaveDaVenda(v);
      if (noMesComItem.has(`${k}:1`)) continue;
      const outras = [...(cobradas.get(`${k}:1`) ?? []), ...(cobradas.get(`${k}:*`) ?? [])].sort(
        (a, b) => a.mes.localeCompare(b.mes),
      );
      const base = v.honorario ?? v.mrr_mensal ?? null;
      const detalhe = outras.length
        ? `Cobrada na apuração de ${fmtMes(outras[0].mes)}`
        : "Assinou no mês e a 1ª parcela não está em apuração nenhuma";
      linhas.push({
        chave: `${k}:deveria`,
        item_id: null,
        cliente: v.cliente ?? "—",
        cnpj: null,
        ganho: v.ganho_em,
        assinatura: v.data_assinatura,
        grupo: "p1",
        base,
        percentual: 50,
        valor: 0,
        esperado: base != null ? base * 0.5 : null,
        situacao: outras.length && outras[0].mes < mesRef ? "ja_cobrada" : "nao_entrou",
        detalhe,
        valorDiferente: false,
      });
    }
  }

  const entrou = linhas.reduce((a, l) => a + l.valor, 0);
  // "Deveria entrar": o esperado de tudo cujo gatilho é deste mês, tenha entrado ou não.
  const deveria = linhas
    .filter((l) => l.situacao === "no_mes" || l.situacao === "nao_entrou")
    .reduce((a, l) => a + n(l.esperado), 0);

  const faturasDoMes = faturas.filter(
    (f) => f.apuracao_id === apuracao.id && f.status === "faturada",
  );
  const faturado = faturasDoMes.length
    ? faturasDoMes.reduce((a, f) => a + n(f.valor_cac), 0)
    : null;
  const naApuracao = apuracao.cac_valor != null ? n(apuracao.cac_valor) : null;
  const notas: string[] = [];
  if (naApuracao != null && Math.abs(naApuracao - entrou) > 0.5) {
    notas.push(
      "A soma dos itens difere do total gravado na apuração: vale o total da apuração, que é o que vai na nota.",
    );
  }

  // R-08: o que tem gatilho em aberto hoje e ainda não entrou em apuração nenhuma.
  const pendencias: Pendencia[] = [];
  for (const v of vendas) {
    if (v.contrato_id == null || !v.elegivel || v.churn) continue;
    const k = chaveDaVenda(v);
    const base = v.honorario ?? v.mrr_mensal ?? null;
    // Cobrança histórica (sem parcela) conta como 1ª: era o adiantamento no modelo antigo.
    const p1 = (cobradas.get(`${k}:1`) ?? []).length + (cobradas.get(`${k}:*`) ?? []).length > 0;
    const p2 = (cobradas.get(`${k}:2`) ?? []).length > 0;
    if (!v.assinado) {
      if (v.fase_contrato === "Contrato Enviado" || v.fase_contrato === "Alterações no contrato") {
        pendencias.push({
          chave: k,
          cliente: v.cliente ?? "—",
          motivo: "Contrato enviado, o cliente ainda não assinou",
          valor: null,
        });
      }
      continue;
    }
    if (!p1 && !semAdiantamento) {
      pendencias.push({
        chave: k,
        cliente: v.cliente ?? "—",
        motivo: v.data_assinatura
          ? `Assinou em ${v.data_assinatura.split("-").reverse().join("/")}; 1ª parcela ainda não cobrada`
          : "Assinado sem data na Central; 1ª parcela ainda não cobrada",
        valor: base != null ? base * 0.5 : null,
      });
    } else if ((p1 || semAdiantamento) && !p2) {
      pendencias.push({
        chave: k,
        cliente: v.cliente ?? "—",
        motivo: v.cliente_pagou_honorario
          ? "Card marca o 1º honorário como pago; 2ª parcela a cobrar"
          : "Aguardando o cliente pagar o 1º honorário",
        valor: base != null ? base * (semAdiantamento && !p1 ? 1 : 0.5) : null,
      });
    }
  }

  return {
    apuracao,
    linhas,
    entrou,
    deveria,
    naApuracao,
    faturado,
    notas,
    pendencias,
    ajustes: estornos.filter((e) => mes(e.mes_ref) === mesRef),
  };
}
