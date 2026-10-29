import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { addPlanningLogo, BRAND_DARK, BRAND_GREEN } from "@/lib/pdf-marca";
import type { VendaAssinatura } from "@/lib/roas-assinaturas.functions";

// Memória de cálculo do ROAS de contrato do Inside Sales, para anexar à justificativa de
// pagamento de comissão (pedido de 29/10/2026). Gerada no navegador a partir do que a aba
// "ROAS e assinaturas" do BI Financeiro já leu; não refaz consulta. Contrato: bi-financeiro.md §7.

export interface MesMemoria {
  /** `YYYY-MM` da venda. */
  m: string;
  /** `YYYY-MM` da mídia usada (o mês anterior). */
  mesMidia: string;
  midia: number;
  vendas: VendaAssinatura[];
  vend: number;
  /** MRR assinado até o fim do mês da venda. */
  fato: number;
  /** MRR assinado em qualquer data. */
  saf: number;
}

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rot = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const roas = (v: number, md: number) =>
  md > 0
    ? (v / md).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
// 'AAAA-MM-DD' fatiado: passar por new Date imprimiria o dia anterior em UTC-3
const dia = (v: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "—");
const nMes = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
const noMes = (v: VendaAssinatura) => !!v.assinatura && nMes(v.assinatura) <= nMes(v.ganho);

type DocTabela = jsPDF & { lastAutoTable: { finalY: number } };

export async function gerarMemoriaRoasPdf({
  meses,
  lidoEm,
}: {
  meses: MesMemoria[];
  lidoEm: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" }) as DocTabela;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const periodo =
    meses.length === 1 ? rot(meses[0].m) : `${rot(meses[0].m)} a ${rot(meses[meses.length - 1].m)}`;
  const lido = new Date(lidoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const soma = (k: "midia" | "vend" | "fato" | "saf") => meses.reduce((s, x) => s + x[k], 0);
  const tot = { midia: soma("midia"), vend: soma("vend"), fato: soma("fato"), saf: soma("saf") };
  const nVendas = meses.reduce((s, x) => s + x.vendas.length, 0);

  await addPlanningLogo(doc, W);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Memória de cálculo · ROAS de contrato do Inside Sales", 40, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    `Vendas de ${periodo} · dados lidos em ${lido} · BI Financeiro, aba ROAS e assinaturas`,
    40,
    66,
  );
  doc.setDrawColor(...BRAND_GREEN);
  doc.setLineWidth(2);
  doc.line(40, 76, W - 40, 76);

  // regras do cálculo
  const regras = [
    "Venda: deal ganho no pipeline Inside Sales do Pipedrive (rede toda), no mês do ganho pelo fuso de Brasília. Valor: MRR efetivo do deal.",
    "Assinatura: data de assinatura do contrato, nesta ordem: Pipefy Central de Contratos, entrada no stage 170 do Pipedrive, Funil de CAC. A Data da Venda nunca é usada como assinatura.",
    "Mídia: investimento da finalidade Inside Sales no MÊS ANTERIOR ao da venda (a mídia de um mês gera as vendas do mês seguinte).",
    "ROAS de contrato no mês = MRR das vendas do mês assinado até o fim do mês da venda ÷ mídia do mês anterior.",
    "ROAS de contrato da safra = MRR das vendas do mês assinado até a data de leitura, em qualquer mês ÷ mídia do mês anterior. Referência: 0,80.",
  ];
  doc.setFontSize(8.5);
  doc.setTextColor(60);
  let y = 92;
  for (const r of regras) {
    const linhas = doc.splitTextToSize(`• ${r}`, W - 80) as string[];
    doc.text(linhas, 40, y);
    y += linhas.length * 11;
  }

  // números do período
  const kpis = [
    ["Mídia (mês anterior)", BRL(tot.midia)],
    [`MRR vendido (${nVendas} vendas)`, BRL(tot.vend)],
    ["Assinado no mês", BRL(tot.fato)],
    ["ROAS no mês", roas(tot.fato, tot.midia)],
    ["Assinado até a leitura", BRL(tot.saf)],
    ["ROAS da safra", roas(tot.saf, tot.midia)],
  ];
  y += 6;
  const kw = (W - 80 - 5 * 8) / 6;
  kpis.forEach(([l, v], i) => {
    const x = 40 + i * (kw + 8);
    doc.setDrawColor(220);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, kw, 46, 4, 4, "FD");
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(l.toUpperCase(), x + 7, y + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(i === 3 || i === 5 ? 14 : 10.5);
    doc.setTextColor(...BRAND_DARK);
    doc.text(v, x + 7, y + 34);
    doc.setFont("helvetica", "normal");
  });
  y += 64;

  // resumo por mês
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Resumo por mês da venda", 40, y);
  autoTable(doc, {
    startY: y + 8,
    head: [
      [
        "Mês da venda",
        "Mídia de",
        "Mídia",
        "Vendas",
        "MRR vendido",
        "Assinado no mês",
        "ROAS no mês",
        "Assinado até a leitura",
        "ROAS da safra",
        "Sem assinatura",
      ],
    ],
    body: meses.map((x) => [
      rot(x.m),
      rot(x.mesMidia),
      BRL(x.midia),
      String(x.vendas.length),
      BRL(x.vend),
      BRL(x.fato),
      roas(x.fato, x.midia),
      BRL(x.saf),
      roas(x.saf, x.midia),
      BRL(x.vend - x.saf),
    ]),
    foot: [
      [
        "Total",
        "",
        BRL(tot.midia),
        String(nVendas),
        BRL(tot.vend),
        BRL(tot.fato),
        roas(tot.fato, tot.midia),
        BRL(tot.saf),
        roas(tot.saf, tot.midia),
        BRL(tot.vend - tot.saf),
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 3.5, halign: "right" },
    headStyles: { fillColor: BRAND_GREEN, textColor: 255, halign: "right" },
    footStyles: {
      fillColor: [236, 253, 245],
      textColor: BRAND_DARK,
      fontStyle: "bold",
      halign: "right",
    },
    columnStyles: { 0: { halign: "left" }, 1: { halign: "left" } },
    didParseCell: (c) => {
      if (c.column.index <= 1) c.cell.styles.halign = "left";
    },
    margin: { left: 40, right: 40 },
  });

  // vendas de cada mês, cliente a cliente
  for (const x of meses) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...BRAND_DARK);
    doc.text(`Vendas de ${rot(x.m)}`, 40, 46);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `Mídia de ${rot(x.mesMidia)}: ${BRL(x.midia)} · ROAS no mês ${roas(x.fato, x.midia)} (${BRL(x.fato)} ÷ ${BRL(x.midia)}) · ROAS da safra ${roas(x.saf, x.midia)} (${BRL(x.saf)} ÷ ${BRL(x.midia)})`,
      40,
      62,
    );
    const ord = [...x.vendas].sort(
      (a, b) => a.ganho.localeCompare(b.ganho) || a.cliente.localeCompare(b.cliente),
    );
    autoTable(doc, {
      startY: 72,
      head: [
        [
          "Cliente",
          "Unidade",
          "Closer",
          "SDR",
          "Deal",
          "Ganho",
          "Assinatura",
          "Fonte da data",
          "MRR",
          "No mês",
          "Na safra",
        ],
      ],
      body: ord.map((v) => [
        v.cliente,
        v.unidade ?? "—",
        v.closer ?? "—",
        v.sdr ?? "—",
        String(v.deal_id),
        dia(v.ganho),
        dia(v.assinatura),
        v.fonte_assinatura ?? (v.tem_contrato ? "sem data" : "sem contrato"),
        BRL(v.mrr),
        noMes(v) ? "sim" : "não",
        v.assinatura ? "sim" : "não",
      ]),
      foot: [
        [
          `${ord.length} vendas`,
          "",
          "",
          "",
          "",
          "",
          "",
          "MRR vendido",
          BRL(x.vend),
          BRL(x.fato),
          BRL(x.saf),
        ],
      ],
      styles: { fontSize: 7.5, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: BRAND_GREEN, textColor: 255 },
      footStyles: { fillColor: [236, 253, 245], textColor: BRAND_DARK, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 170 },
        4: { halign: "right" },
        5: { halign: "center" },
        6: { halign: "center" },
        8: { halign: "right" },
        9: { halign: "center" },
        10: { halign: "center" },
      },
      didParseCell: (c) => {
        if (c.section === "foot" && c.column.index >= 8) c.cell.styles.halign = "right";
        if (
          c.section === "body" &&
          (c.column.index === 9 || c.column.index === 10) &&
          c.cell.raw === "não"
        )
          c.cell.styles.textColor = [160, 160, 160];
      },
      margin: { left: 40, right: 40, top: 40 },
    });
  }

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BRAND_GREEN);
    doc.setLineWidth(1);
    doc.line(40, H - 34, W - 40, H - 34);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      `Planning · memória de cálculo do ROAS de contrato · vendas de ${periodo} · lido em ${lido}`,
      40,
      H - 22,
    );
    doc.text(`Página ${p} de ${n}`, W - 40, H - 22, { align: "right" });
  }

  doc.save(
    `memoria-roas-inside-sales-${meses[0].m}${meses.length > 1 ? `-a-${meses[meses.length - 1].m}` : ""}.pdf`,
  );
}
