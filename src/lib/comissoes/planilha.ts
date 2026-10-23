// Planilha para o Departamento Pessoal no formato da "Comissão time comercial" de set/26 (pedido do dono em
// 23/10/2026): Resumo geral, Resumo e Detalhamento de closer, Resumo e Detalhamento de SDR. O DP agenda o
// pagamento pelo iFood no dia 20 a partir dela.
import * as XLSX from "xlsx-js-style";
import { mesExtenso, origem, type Linha, type Revisao } from "./tipos";

export type Pendente = {
  pessoa: string;
  contrato_id: number;
  cliente: string;
  unidade: string;
  servico: string | null;
  papel: string;
  metade: number;
  base: number | null;
  percentual: number | null;
  iniciado: boolean;
  valor_estimado: number | null;
  motivo: string;
};
export type Exportacao = Revisao & {
  linhas: (Linha & { servico?: string | null })[];
  pendentes: Pendente[];
};

type Papel = "closer" | "sdr";
type Resumo = {
  pessoa: string;
  pagar: number;
  bonus: number;
  pendente: number;
  naoIniciada: number;
};

const TIPO: Record<Linha["tipo"], string> = {
  comissao: "Comissão",
  ajuste: "Ajuste",
  bonus: "Bônus",
};
const tipoDe = (l: Linha) =>
  l.tipo === "comissao" ? `Comissão ${l.metade}ª metade` : TIPO[l.tipo];
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
const vale = (l: Linha) => !l.excluida;

// Papel de cada pessoa: o da maior parte das linhas dela; bônus sem papel segue a pessoa.
function papelDasPessoas(d: Exportacao): Map<string, Papel> {
  const conta = new Map<string, { closer: number; sdr: number }>();
  const somar = (pessoa: string, papel: string | null) => {
    if (papel !== "closer" && papel !== "sdr") return;
    const c = conta.get(pessoa) ?? { closer: 0, sdr: 0 };
    c[papel] += 1;
    conta.set(pessoa, c);
  };
  d.linhas.forEach((l) => somar(l.pessoa, l.papel));
  d.pendentes.forEach((p) => somar(p.pessoa, p.papel));
  const papel = new Map<string, Papel>();
  conta.forEach((c, p) => papel.set(p, c.sdr > c.closer ? "sdr" : "closer"));
  return papel;
}

function resumos(d: Exportacao, papelDe: Map<string, Papel>, papel: Papel): Resumo[] {
  const por = new Map<string, Resumo>();
  const de = (pessoa: string) => {
    const r = por.get(pessoa) ?? { pessoa, pagar: 0, bonus: 0, pendente: 0, naoIniciada: 0 };
    por.set(pessoa, r);
    return r;
  };
  for (const l of d.linhas.filter(vale)) {
    if ((l.papel ?? papelDe.get(l.pessoa) ?? "closer") !== papel) continue;
    if (l.tipo === "bonus") de(l.pessoa).bonus += num(l.valor);
    else de(l.pessoa).pagar += num(l.valor);
  }
  for (const p of d.pendentes) {
    if (p.papel !== papel || p.valor_estimado == null) continue;
    if (p.iniciado) de(p.pessoa).pendente += num(p.valor_estimado);
    else de(p.pessoa).naoIniciada += num(p.valor_estimado);
  }
  return [...por.values()].sort((a, b) => a.pessoa.localeCompare(b.pessoa));
}

const CAB_RESUMO = [
  "Comissão a pagar",
  "Comissão pendente (não paga)",
  "Comissão não iniciada",
  "Bônus",
  "TOTAL A PAGAR AGORA",
  "Total potencial",
];
const linhaResumo = (nome: string, r: Omit<Resumo, "pessoa">) => [
  nome,
  r.pagar,
  r.pendente,
  r.naoIniciada,
  r.bonus,
  r.pagar + r.bonus,
  r.pagar + r.bonus + r.pendente + r.naoIniciada,
];
const somar = (rs: Resumo[]) =>
  rs.reduce(
    (t, r) => ({
      pagar: t.pagar + r.pagar,
      bonus: t.bonus + r.bonus,
      pendente: t.pendente + r.pendente,
      naoIniciada: t.naoIniciada + r.naoIniciada,
    }),
    { pagar: 0, bonus: 0, pendente: 0, naoIniciada: 0 },
  );

function detalhamento(d: Exportacao, papelDe: Map<string, Papel>, papel: Papel, rotulo: string) {
  const cab = [
    rotulo,
    "Unidade",
    "Cliente",
    "Serviço",
    "Tipo",
    "Valor Contrato (R$)",
    "% Comissão",
    "Status",
    "A Receber (R$)",
    "Observação",
  ];
  const pagar = d.linhas
    .filter((l) => vale(l) && (l.papel ?? papelDe.get(l.pessoa) ?? "closer") === papel)
    .map((l) => [
      l.pessoa,
      l.unidade ?? "-",
      l.cliente ?? "-",
      l.servico ?? "-",
      tipoDe(l),
      l.base == null ? "-" : num(l.base),
      l.percentual == null ? "-" : num(l.percentual) / 100,
      "Pagar",
      num(l.valor),
      l.tipo === "comissao" ? origem(l) : (l.motivo ?? ""),
    ]);
  const depois = d.pendentes
    .filter((p) => p.papel === papel)
    .map((p) => [
      p.pessoa,
      p.unidade,
      p.cliente,
      p.servico ?? "-",
      `Comissão ${p.metade}ª metade`,
      p.base == null ? "-" : num(p.base),
      p.percentual == null ? "-" : num(p.percentual) / 100,
      p.iniciado ? "Pendente" : "Não iniciada",
      p.valor_estimado == null ? "-" : num(p.valor_estimado),
      p.motivo,
    ]);
  return [cab, ...pagar, ...depois];
}

function folha(aoa: (string | number)[][], larguras: number[], porcentagem?: number) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = larguras.map((wch) => ({ wch }));
  const intervalo = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let c = intervalo.s.c; c <= intervalo.e.c; c++) {
    const cab = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cab) cab.s = { font: { bold: true } };
  }
  for (let r = 1; r <= intervalo.e.r; r++) {
    for (let c = intervalo.s.c; c <= intervalo.e.c; c++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })];
      if (cel && typeof cel.v === "number") cel.z = c === porcentagem ? "0.0%" : '"R$" #,##0.00';
    }
  }
  return ws;
}

export function baixarPlanilhaDp(mes: string, d: Exportacao) {
  const papelDe = papelDasPessoas(d);
  const closers = resumos(d, papelDe, "closer");
  const sdrs = resumos(d, papelDe, "sdr");
  const titulo = `Comissões · pagamento de ${mesExtenso(`${mes}-01`)} (iFood, dia 20)`;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    folha(
      [
        [titulo],
        [],
        ["Time", ...CAB_RESUMO],
        linhaResumo("Closers", somar(closers)),
        linhaResumo("SDR", somar(sdrs)),
        linhaResumo("TOTAL", somar([...closers, ...sdrs])),
      ],
      [28, 18, 26, 22, 14, 22, 18],
    ),
    "Resumo geral",
  );
  XLSX.utils.book_append_sheet(
    wb,
    folha(
      [
        ["Closer", ...CAB_RESUMO],
        ...closers.map((r) => linhaResumo(r.pessoa, r)),
        linhaResumo("TOTAL", somar(closers)),
      ],
      [32, 18, 26, 22, 14, 22, 18],
    ),
    "Resumo closer",
  );
  XLSX.utils.book_append_sheet(
    wb,
    folha(
      detalhamento(d, papelDe, "closer", "Closer"),
      [32, 16, 32, 24, 22, 18, 12, 14, 16, 40],
      6,
    ),
    "Detalhamento closer",
  );
  XLSX.utils.book_append_sheet(
    wb,
    folha(
      [
        ["SDR", ...CAB_RESUMO],
        ...sdrs.map((r) => linhaResumo(r.pessoa, r)),
        linhaResumo("TOTAL", somar(sdrs)),
      ],
      [32, 18, 26, 22, 14, 22, 18],
    ),
    "Resumo SDR",
  );
  XLSX.utils.book_append_sheet(
    wb,
    folha(detalhamento(d, papelDe, "sdr", "SDR"), [32, 16, 32, 24, 22, 18, 12, 14, 16, 40], 6),
    "Detalhamento SDR",
  );
  XLSX.writeFile(wb, `comissao-time-comercial-${mes}.xlsx`);
}
