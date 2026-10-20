import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
// xlsx-js-style (não o pacote "xlsx" comum): fork da SheetJS Community Edition
// com suporte a estilo de célula (cor, negrito, borda), que a "xlsx" não tem.
import * as XLSX from "xlsx-js-style";
import type { CellObject, WorkSheet } from "xlsx-js-style";

function formatCnpj(s: string | null | undefined): string {
  const d = (s ?? "").replace(/\D+/g, "");
  if (d.length !== 14) return s ?? "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Datas vêm do Postgres como 'AAAA-MM-DD' (coluna `date`, sem hora). Passar por
// `new Date` interpreta como meia-noite UTC e, em UTC-3, imprime o dia anterior.
// Fatiar a string devolve exatamente o dia que está gravado.
function formatData(v: string | null | undefined): string {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : v;
}

const BRL = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

function formatMesLabel(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

const BRAND_GREEN: [number, number, number] = [16, 185, 129];
const BRAND_DARK: [number, number, number] = [31, 41, 55];
const LOGO_ASPECT_RATIO = 1163.3 / 239.6;

async function addPlanningLogo(doc: jsPDF, pageWidth: number) {
  try {
    const res = await fetch("/brand/planning-logo-dark.png");
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
    const dataUrl = `data:image/png;base64,${btoa(binary)}`;
    const w = 100;
    const h = w / LOGO_ASPECT_RATIO;
    doc.addImage(dataUrl, "PNG", pageWidth - 40 - w, 26, w, h);
  } catch {
    // logo é decorativo — segue gerando o PDF sem ele
  }
}

export interface DemonstrativoItem {
  razao_social: string;
  cnpj: string | null;
  data_ganho: string | null;
  data_assinatura: string | null;
  valor_confirmado: number;
  royalties_percentual: number;
  royalties_item: number;
  is_cac: boolean;
  /** 1 = adiantamento na assinatura; 2 = após o recebimento do 1º honorário; 3 = integral. */
  cac_parcela?: 1 | 2 | 3 | null;
  categoria: "royalties" | "csc_base_antiga";
}

/**
 * O CAC aparece para a unidade separado pelo gatilho de cada metade: a que é
 * adiantada na assinatura e a que só vem depois do 1º honorário recebido.
 * Item sem parcela definida (histórico) fica num grupo à parte, sem rótulo.
 */
function gruposCac(cac: DemonstrativoItem[]) {
  return [
    {
      titulo: "CAC — 1ª parcela (50% de adiantamento na assinatura)",
      aba: "CAC - 1a parcela",
      itens: cac.filter((i) => i.cac_parcela === 1),
    },
    {
      titulo: "CAC — 2ª parcela (50% após o recebimento do 1º honorário)",
      aba: "CAC - 2a parcela",
      itens: cac.filter((i) => i.cac_parcela === 2),
    },
    {
      titulo: "CAC — integral (1ª + 2ª parcela, 100%, 1º honorário já recebido)",
      aba: "CAC - integral",
      itens: cac.filter((i) => i.cac_parcela === 3),
    },
    {
      titulo: "Clientes — CAC",
      aba: "Clientes - CAC",
      itens: cac.filter((i) => i.cac_parcela == null),
    },
  ].filter((g) => g.itens.length > 0);
}

export interface DemonstrativoOutraReceita {
  nome: string;
  valor: number;
  categoria: string; // "Reembolso de ferramentas", "Serviços contratados", ...
}

/**
 * Situação de um dos dois títulos que cobram a fatura do mês. A parte fixa (CSC,
 * mídia, CS/RH/Compliance) vai no boleto de contas fixas, que sai no começo do
 * mês; royalties, CAC e outras receitas vão na nota de débito, depois do fechamento.
 */
export interface SituacaoCobranca {
  documento: string;
  status: "pago" | "em_aberto" | "a_emitir";
  pagoEm?: string | null;
  vencimento?: string | null;
}

export interface DemonstrativoData {
  unidadeNome: string;
  mes: string; // AAAA-MM
  confirmadoEm: string | null;
  confirmadoPor: string | null;
  receitaBase: number;
  royaltiesPct: number;
  royaltiesValor: number;
  cacValor: number;
  cscLabel: string;
  cscValor: number;
  trafegoPago: number | null;
  outrasReceitas: number;
  outrasReceitasItens: DemonstrativoOutraReceita[];
  /** CS, RH e Compliance do boleto de contas fixas; já somado em `outrasReceitas`. */
  servicosFixos: number;
  totalFatura: number;
  itens: DemonstrativoItem[];
  /**
   * Por onde cada parte é cobrada. `contasFixas` nulo = mês sem boleto de contas
   * fixas (antes de 09/2026), e a parte fixa fica sem status.
   */
  cobranca: {
    contasFixas: SituacaoCobranca | null;
    notaDebito: SituacaoCobranca;
  };
}

function statusTexto(s: SituacaoCobranca | null): string {
  if (!s) return "";
  if (s.status === "pago")
    return `Pago${s.pagoEm ? ` em ${formatData(s.pagoEm)}` : ""} (${s.documento})`;
  if (s.status === "em_aberto")
    return `Em aberto${s.vencimento ? `, vence ${formatData(s.vencimento)}` : ""} (${s.documento})`;
  return `A cobrar (${s.documento})`;
}

type LinhaResumo = { label: string; value: number; cobranca: SituacaoCobranca | null };

/**
 * As linhas do resumo com o título que cobra cada uma. "Outras receitas" se
 * divide em duas quando o boleto de contas fixas traz CS/RH/Compliance: essa
 * parte já foi cobrada, o resto vai na nota de débito.
 */
function linhasResumo(data: DemonstrativoData) {
  const { contasFixas, notaDebito } = data.cobranca;
  const servicos = contasFixas ? data.servicosFixos : 0;
  const outrasNd = data.outrasReceitas - servicos;
  const linhas: LinhaResumo[] = [
    {
      label: `Royalties (${data.royaltiesPct}%)`,
      value: data.royaltiesValor,
      cobranca: notaDebito,
    },
    { label: data.cscLabel, value: data.cscValor, cobranca: contasFixas },
  ];
  if (data.cacValor > 0) linhas.push({ label: "CAC", value: data.cacValor, cobranca: notaDebito });
  if (data.trafegoPago)
    linhas.push({ label: "Tráfego pago", value: data.trafegoPago, cobranca: contasFixas });
  if (servicos)
    linhas.push({ label: "CS, RH e Compliance", value: servicos, cobranca: contasFixas });
  if (Math.abs(outrasNd) > 0.004)
    linhas.push({ label: "Outras receitas", value: outrasNd, cobranca: notaDebito });

  const jaPago = linhas
    .filter((l) => l.cobranca?.status === "pago")
    .reduce((s, l) => s + l.value, 0);
  return { linhas, jaPago, aPagar: data.totalFatura - jaPago };
}

export async function gerarDemonstrativoRoyaltiesPdf(data: DemonstrativoData) {
  const mesLabel = formatMesLabel(data.mes);
  const royalties = data.itens.filter((i) => i.categoria === "royalties" && !i.is_cac);
  const cac = data.itens.filter((i) => i.is_cac);
  const baseAntiga = data.itens.filter((i) => i.categoria === "csc_base_antiga");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  await addPlanningLogo(doc, pageWidth);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]);
  doc.text(`Demonstrativo de royalties — ${data.unidadeNome}`, 40, 50);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  const confirmadoStr = data.confirmadoEm
    ? new Date(data.confirmadoEm).toLocaleString("pt-BR")
    : "—";
  doc.text(
    `Referência: ${mesLabel} · Confirmado em ${confirmadoStr}${data.confirmadoPor ? ` por ${data.confirmadoPor}` : ""}`,
    40,
    66,
  );
  doc.setTextColor(0);

  doc.setDrawColor(BRAND_GREEN[0], BRAND_GREEN[1], BRAND_GREEN[2]);
  doc.setLineWidth(2);
  doc.line(40, 76, pageWidth - 40, 76);

  const kpiY = 90;
  const kpis: { label: string; value: string }[] = [
    { label: "Base Planning", value: BRL(data.receitaBase) },
    { label: `Royalties (${data.royaltiesPct}%)`, value: BRL(data.royaltiesValor) },
    { label: data.cscLabel, value: BRL(data.cscValor) },
  ];
  if (data.cacValor > 0) kpis.push({ label: "CAC", value: BRL(data.cacValor) });
  if (data.trafegoPago) kpis.push({ label: "Tráfego pago", value: BRL(data.trafegoPago) });
  if (data.outrasReceitas) kpis.push({ label: "Outras receitas", value: BRL(data.outrasReceitas) });
  kpis.push({ label: "Total fatura", value: BRL(data.totalFatura) });

  // Máximo 4 boxes por linha — com 5+ (tráfego/outras somam ao Base/Royalties/
  // CSC/CAC/Total) os rótulos maiores ("Outras receitas") ficam apertados
  // demais numa linha só.
  const KPIS_POR_LINHA = 4;
  const kpiRows: { label: string; value: string }[][] = [];
  for (let i = 0; i < kpis.length; i += KPIS_POR_LINHA) {
    kpiRows.push(kpis.slice(i, i + KPIS_POR_LINHA));
  }
  const kpiRowHeight = 64;
  kpiRows.forEach((row, rowIdx) => {
    const y = kpiY + rowIdx * kpiRowHeight;
    const kpiW = (pageWidth - 80 - (row.length - 1) * 10) / row.length;
    row.forEach((k, i) => {
      const x = 40 + i * (kpiW + 10);
      const globalIdx = rowIdx * KPIS_POR_LINHA + i;
      const isTotal = globalIdx === kpis.length - 1;
      doc.setDrawColor(220);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(x, y, kpiW, 54, 4, 4, "FD");
      if (isTotal) {
        doc.setFillColor(BRAND_GREEN[0], BRAND_GREEN[1], BRAND_GREEN[2]);
        doc.roundedRect(x, y, 4, 54, 2, 2, "F");
      }
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(k.label.toUpperCase(), x + 8, y + 16);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      if (isTotal) doc.setTextColor(BRAND_GREEN[0], BRAND_GREEN[1], BRAND_GREEN[2]);
      else doc.setTextColor(BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]);
      doc.text(k.value, x + 8, y + 38);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0);
    });
  });

  let cursorY = kpiY + kpiRows.length * kpiRowHeight + 26;

  const resumo = linhasResumo(data);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Situação da cobrança", 40, cursorY);
  autoTable(doc, {
    startY: cursorY + 8,
    head: [["Item", "Valor", "Status"]],
    body: resumo.linhas.map((l) => [l.label, BRL(l.value), statusTexto(l.cobranca) || "—"]),
    foot: [
      ["Total fatura", BRL(data.totalFatura), ""],
      ["Já pago", BRL(resumo.jaPago), ""],
      ["Saldo a pagar", BRL(resumo.aPagar), ""],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: BRAND_GREEN, textColor: 255 },
    footStyles: { fillColor: [236, 253, 245], textColor: BRAND_DARK, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 150 },
      1: { cellWidth: 90, halign: "right" },
    },
    didParseCell: (c) => {
      if (c.column.index === 1 && c.section === "head") c.cell.styles.halign = "right";
      if (c.column.index === 1 && c.section === "foot") c.cell.styles.halign = "right";
      if (c.section === "body" && c.column.index === 2) {
        const st = resumo.linhas[c.row.index]?.cobranca?.status;
        if (st === "pago") c.cell.styles.textColor = BRAND_GREEN;
      }
    },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;

  const itemTable = (title: string, rows: DemonstrativoItem[], valorLabel: string) => {
    if (rows.length === 0) return;
    if (cursorY > 680) {
      doc.addPage();
      cursorY = 50;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(title, 40, cursorY);
    autoTable(doc, {
      startY: cursorY + 8,
      head: [
        ["Cliente", "CNPJ", "Data do ganho", "Assinatura do contrato", "Valor", "%", valorLabel],
      ],
      body: rows.map((r) => [
        r.razao_social,
        formatCnpj(r.cnpj),
        formatData(r.data_ganho),
        formatData(r.data_assinatura),
        BRL(r.valor_confirmado),
        `${r.royalties_percentual}%`,
        BRL(r.royalties_item),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: BRAND_GREEN, textColor: 255 },
      columnStyles: {
        0: { cellWidth: 118 },
        1: { cellWidth: 82 },
        2: { cellWidth: 54, halign: "center" },
        3: { cellWidth: 54, halign: "center" },
        4: { halign: "right" },
        5: { cellWidth: 30, halign: "right" },
        6: { halign: "right" },
      },
      margin: { left: 40, right: 40 },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  };

  if (data.outrasReceitasItens.length > 0) {
    if (cursorY > 680) {
      doc.addPage();
      cursorY = 50;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Outras receitas — detalhamento", 40, cursorY);
    autoTable(doc, {
      startY: cursorY + 8,
      head: [["Categoria", "Item", "Valor"]],
      body: data.outrasReceitasItens.map((it) => [it.categoria, it.nome, BRL(it.valor)]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: BRAND_GREEN, textColor: 255 },
      columnStyles: {
        2: { halign: "right" },
      },
      margin: { left: 40, right: 40 },
      tableWidth: 400,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  itemTable("Clientes — royalties", royalties, "Royalties");
  for (const g of gruposCac(cac)) itemTable(g.titulo, g.itens, "Total a cobrar");
  itemTable("Base antiga — CSC variável", baseAntiga, "CSC variável");

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(BRAND_GREEN[0], BRAND_GREEN[1], BRAND_GREEN[2]);
    doc.setLineWidth(1);
    doc.line(40, pageHeight - 34, pageWidth - 40, pageHeight - 34);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.setFont("helvetica", "normal");
    doc.text("Planning", 40, pageHeight - 22);
    doc.text(`Página ${p} de ${pageCount}`, pageWidth - 40, pageHeight - 22, { align: "right" });
  }

  doc.save(demonstrativoFilenameBase(data) + ".pdf");
}

function demonstrativoFilenameBase(data: DemonstrativoData) {
  return `demonstrativo-royalties-${data.unidadeNome.replace(/\s+/g, "-").toLowerCase()}-${data.mes}`;
}

// ---- Estilo do Excel — mesma paleta do PDF (verde da marca + cinza-escuro) ----

const GREEN = "10B981";
const GREEN_LIGHT = "ECFDF5";
const DARK = "1F2937";
const GRAY = "6B7280";
const BORDER = "E5E7EB";
const ZEBRA = "F9FAFB";
const MONEY_FMT = '"R$" #,##0.00';
const PCT_FMT = '0.00"%"';

const thinBorder = {
  top: { style: "thin", color: { rgb: BORDER } },
  bottom: { style: "thin", color: { rgb: BORDER } },
  left: { style: "thin", color: { rgb: BORDER } },
  right: { style: "thin", color: { rgb: BORDER } },
} as const;

const sTitle = { font: { bold: true, sz: 14, color: { rgb: DARK } } };
const sSubtitle = { font: { italic: true, sz: 9, color: { rgb: GRAY } } };
const sSectionHeader = {
  font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: GREEN } },
  alignment: { vertical: "center" as const },
  border: thinBorder,
};
const sSectionHeaderRight = {
  ...sSectionHeader,
  alignment: { vertical: "center" as const, horizontal: "right" as const },
};
const sLabel = { font: { sz: 10, color: { rgb: DARK } }, border: thinBorder };
const sValueText = {
  font: { sz: 10, color: { rgb: DARK } },
  border: thinBorder,
  alignment: { horizontal: "right" as const },
};
const sMoney = { ...sValueText, numFmt: MONEY_FMT };
const sTotalLabel = {
  font: { bold: true, sz: 10, color: { rgb: GREEN } },
  fill: { fgColor: { rgb: GREEN_LIGHT } },
  border: thinBorder,
};
const sTotalValue = {
  ...sTotalLabel,
  alignment: { horizontal: "right" as const },
  numFmt: MONEY_FMT,
};

const sStatusPago = { font: { sz: 10, color: { rgb: GREEN } }, border: thinBorder };

const sCell = { font: { sz: 10, color: { rgb: DARK } }, border: thinBorder };
const sCellZebra = { ...sCell, fill: { fgColor: { rgb: ZEBRA } } };
const sCellMoney = { ...sCell, alignment: { horizontal: "right" as const }, numFmt: MONEY_FMT };
const sCellMoneyZebra = { ...sCellMoney, fill: { fgColor: { rgb: ZEBRA } } };
const sCellPct = { ...sCell, alignment: { horizontal: "right" as const }, numFmt: PCT_FMT };
const sCellPctZebra = { ...sCellPct, fill: { fgColor: { rgb: ZEBRA } } };

function setCell(ws: WorkSheet, r: number, c: number, style: object) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = ws[ref] as CellObject | undefined;
  if (cell) cell.s = style;
}

function buildResumoSheet(data: DemonstrativoData): WorkSheet {
  const mesLabel = formatMesLabel(data.mes);
  const confirmadoStr = data.confirmadoEm
    ? new Date(data.confirmadoEm).toLocaleString("pt-BR")
    : "—";

  const resumo = linhasResumo(data);

  type RowKind =
    "title" | "subtitle" | "blank" | "sectionHeader" | "info" | "kv" | "kvPago" | "total";
  const rows: { kind: RowKind; cells: [string, string | number, string] }[] = [
    { kind: "title", cells: [`Demonstrativo de royalties — ${data.unidadeNome}`, "", ""] },
    {
      kind: "subtitle",
      cells: [
        `Referência: ${mesLabel} · Confirmado em ${confirmadoStr}${data.confirmadoPor ? ` por ${data.confirmadoPor}` : ""}`,
        "",
        "",
      ],
    },
    { kind: "blank", cells: ["", "", ""] },
    { kind: "sectionHeader", cells: ["Item", "Valor", "Status"] },
    { kind: "info", cells: ["Unidade", data.unidadeNome, ""] },
    { kind: "info", cells: ["Referência", mesLabel, ""] },
    { kind: "info", cells: ["Confirmado em", confirmadoStr, ""] },
    { kind: "info", cells: ["Confirmado por", data.confirmadoPor ?? "—", ""] },
    { kind: "kv", cells: ["Base Planning", data.receitaBase, ""] },
    ...resumo.linhas.map((l) => ({
      kind: (l.cobranca?.status === "pago" ? "kvPago" : "kv") as RowKind,
      cells: [l.label, l.value, statusTexto(l.cobranca)] as [string, number, string],
    })),
    { kind: "total", cells: ["Total fatura", data.totalFatura, ""] },
    { kind: "kv", cells: ["Já pago", resumo.jaPago, ""] },
    { kind: "total", cells: ["Saldo a pagar", resumo.aPagar, ""] },
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.cells));
  ws["!cols"] = [{ wch: 34 }, { wch: 20 }, { wch: 52 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
  ];

  rows.forEach((row, i) => {
    switch (row.kind) {
      case "title":
        setCell(ws, i, 0, sTitle);
        break;
      case "subtitle":
        setCell(ws, i, 0, sSubtitle);
        break;
      case "blank":
        break;
      case "sectionHeader":
        setCell(ws, i, 0, sSectionHeader);
        setCell(ws, i, 1, sSectionHeaderRight);
        setCell(ws, i, 2, sSectionHeader);
        break;
      case "info":
        setCell(ws, i, 0, sLabel);
        setCell(ws, i, 1, sValueText);
        setCell(ws, i, 2, sLabel);
        break;
      case "kv":
        setCell(ws, i, 0, sLabel);
        setCell(ws, i, 1, sMoney);
        setCell(ws, i, 2, sLabel);
        break;
      case "kvPago":
        setCell(ws, i, 0, sLabel);
        setCell(ws, i, 1, sMoney);
        setCell(ws, i, 2, sStatusPago);
        break;
      case "total":
        setCell(ws, i, 0, sTotalLabel);
        setCell(ws, i, 1, sTotalValue);
        setCell(ws, i, 2, sTotalLabel);
        break;
    }
  });

  return ws;
}

const ITEM_MONEY_COLS = new Set([4, 6]);
const ITEM_PCT_COLS = new Set([5]);

function buildItemSheet(rows: DemonstrativoItem[], valorLabel: string): WorkSheet {
  const ITEM_HEADER = [
    "Cliente",
    "CNPJ",
    "Data do ganho",
    "Assinatura do contrato",
    "Valor (R$)",
    "%",
    `${valorLabel} (R$)`,
  ];
  const aoa: (string | number)[][] = [
    ITEM_HEADER,
    ...rows.map((r) => [
      r.razao_social,
      formatCnpj(r.cnpj),
      formatData(r.data_ganho),
      formatData(r.data_assinatura),
      Number(r.valor_confirmado ?? 0),
      Number(r.royalties_percentual ?? 0),
      Number(r.royalties_item ?? 0),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 38 },
    { wch: 20 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
    { wch: 18 },
  ];
  ws["!autofilter"] = { ref: `A1:G${aoa.length}` };
  ws["!views"] = [{ state: "frozen", ySplit: 1 }];

  ITEM_HEADER.forEach((_, c) => {
    setCell(
      ws,
      0,
      c,
      ITEM_MONEY_COLS.has(c) || ITEM_PCT_COLS.has(c) ? sSectionHeaderRight : sSectionHeader,
    );
  });

  rows.forEach((_, i) => {
    const zebra = i % 2 === 1;
    for (let c = 0; c < ITEM_HEADER.length; c++) {
      const style = ITEM_MONEY_COLS.has(c)
        ? zebra
          ? sCellMoneyZebra
          : sCellMoney
        : ITEM_PCT_COLS.has(c)
          ? zebra
            ? sCellPctZebra
            : sCellPct
          : zebra
            ? sCellZebra
            : sCell;
      setCell(ws, i + 1, c, style);
    }
  });

  return ws;
}

function buildOutrasReceitasSheet(itens: DemonstrativoOutraReceita[]): WorkSheet {
  const aoa: (string | number)[][] = [
    ["Categoria", "Item", "Valor (R$)"],
    ...itens.map((it) => [it.categoria, it.nome, Number(it.valor ?? 0)]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 38 }, { wch: 16 }];
  ws["!autofilter"] = { ref: `A1:C${aoa.length}` };
  ws["!views"] = [{ state: "frozen", ySplit: 1 }];

  setCell(ws, 0, 0, sSectionHeader);
  setCell(ws, 0, 1, sSectionHeader);
  setCell(ws, 0, 2, sSectionHeaderRight);
  itens.forEach((_, i) => {
    const zebra = i % 2 === 1;
    setCell(ws, i + 1, 0, zebra ? sCellZebra : sCell);
    setCell(ws, i + 1, 1, zebra ? sCellZebra : sCell);
    setCell(ws, i + 1, 2, zebra ? sCellMoneyZebra : sCellMoney);
  });

  return ws;
}

export function gerarDemonstrativoRoyaltiesXlsx(data: DemonstrativoData) {
  const royalties = data.itens.filter((i) => i.categoria === "royalties" && !i.is_cac);
  const cac = data.itens.filter((i) => i.is_cac);
  const baseAntiga = data.itens.filter((i) => i.categoria === "csc_base_antiga");

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildResumoSheet(data), "Resumo");
  if (royalties.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildItemSheet(royalties, "Royalties"),
      "Clientes - royalties",
    );
  }
  for (const g of gruposCac(cac)) {
    XLSX.utils.book_append_sheet(wb, buildItemSheet(g.itens, "Total a cobrar"), g.aba);
  }
  if (baseAntiga.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildItemSheet(baseAntiga, "CSC variável"),
      "Base antiga - CSC",
    );
  }
  if (data.outrasReceitasItens.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildOutrasReceitasSheet(data.outrasReceitasItens),
      "Outras receitas",
    );
  }

  XLSX.writeFile(wb, demonstrativoFilenameBase(data) + ".xlsx");
}
