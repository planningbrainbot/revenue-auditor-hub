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
  valor_confirmado: number;
  royalties_percentual: number;
  royalties_item: number;
  is_cac: boolean;
  categoria: "royalties" | "csc_base_antiga";
}

export interface DemonstrativoOutraReceita {
  nome: string;
  valor: number;
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
  totalFatura: number;
  itens: DemonstrativoItem[];
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

  const itemTable = (title: string, rows: DemonstrativoItem[]) => {
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
      head: [["Cliente", "CNPJ", "Data do ganho", "Valor", "%", "Royalties"]],
      body: rows.map((r) => [
        r.razao_social,
        formatCnpj(r.cnpj),
        r.data_ganho ? new Date(r.data_ganho).toLocaleDateString("pt-BR") : "—",
        BRL(r.valor_confirmado),
        `${r.royalties_percentual}%`,
        BRL(r.royalties_item),
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: BRAND_GREEN, textColor: 255 },
      columnStyles: {
        0: { cellWidth: 150 },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
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
      head: [["Item", "Valor"]],
      body: data.outrasReceitasItens.map((it) => [it.nome, BRL(it.valor)]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: BRAND_GREEN, textColor: 255 },
      columnStyles: {
        1: { halign: "right" },
      },
      margin: { left: 40, right: 40 },
      tableWidth: 260,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  itemTable("Clientes — royalties", royalties);
  itemTable("Clientes — CAC", cac);
  itemTable("Base antiga — CSC variável", baseAntiga);

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
const sTotalValue = { ...sTotalLabel, alignment: { horizontal: "right" as const }, numFmt: MONEY_FMT };

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

  const kpis: { label: string; value: number }[] = [
    { label: "Base Planning", value: data.receitaBase },
    { label: `Royalties (${data.royaltiesPct}%)`, value: data.royaltiesValor },
    { label: data.cscLabel, value: data.cscValor },
  ];
  if (data.cacValor > 0) kpis.push({ label: "CAC", value: data.cacValor });
  if (data.trafegoPago) kpis.push({ label: "Tráfego pago", value: data.trafegoPago });
  if (data.outrasReceitas) kpis.push({ label: "Outras receitas", value: data.outrasReceitas });

  type RowKind = "title" | "subtitle" | "blank" | "sectionHeader" | "info" | "kv" | "total";
  const rows: { kind: RowKind; cells: [string, string | number] }[] = [
    { kind: "title", cells: [`Demonstrativo de royalties — ${data.unidadeNome}`, ""] },
    {
      kind: "subtitle",
      cells: [
        `Referência: ${mesLabel} · Confirmado em ${confirmadoStr}${data.confirmadoPor ? ` por ${data.confirmadoPor}` : ""}`,
        "",
      ],
    },
    { kind: "blank", cells: ["", ""] },
    { kind: "sectionHeader", cells: ["Item", "Valor"] },
    { kind: "info", cells: ["Unidade", data.unidadeNome] },
    { kind: "info", cells: ["Referência", mesLabel] },
    { kind: "info", cells: ["Confirmado em", confirmadoStr] },
    { kind: "info", cells: ["Confirmado por", data.confirmadoPor ?? "—"] },
    ...kpis.map((k) => ({ kind: "kv" as const, cells: [k.label, k.value] as [string, number] })),
    { kind: "total", cells: ["Total fatura", data.totalFatura] },
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.cells));
  ws["!cols"] = [{ wch: 34 }, { wch: 26 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
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
        break;
      case "info":
        setCell(ws, i, 0, sLabel);
        setCell(ws, i, 1, sValueText);
        break;
      case "kv":
        setCell(ws, i, 0, sLabel);
        setCell(ws, i, 1, sMoney);
        break;
      case "total":
        setCell(ws, i, 0, sTotalLabel);
        setCell(ws, i, 1, sTotalValue);
        break;
    }
  });

  return ws;
}

const ITEM_HEADER = ["Cliente", "CNPJ", "Data do ganho", "Valor (R$)", "%", "Royalties (R$)"];
const ITEM_MONEY_COLS = new Set([3, 5]);
const ITEM_PCT_COLS = new Set([4]);

function buildItemSheet(rows: DemonstrativoItem[]): WorkSheet {
  const aoa: (string | number)[][] = [
    ITEM_HEADER,
    ...rows.map((r) => [
      r.razao_social,
      formatCnpj(r.cnpj),
      r.data_ganho ? new Date(r.data_ganho).toLocaleDateString("pt-BR") : "—",
      Number(r.valor_confirmado ?? 0),
      Number(r.royalties_percentual ?? 0),
      Number(r.royalties_item ?? 0),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 38 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];
  ws["!autofilter"] = { ref: `A1:F${aoa.length}` };
  ws["!views"] = [{ state: "frozen", ySplit: 1 }];

  ITEM_HEADER.forEach((_, c) => {
    setCell(ws, 0, c, ITEM_MONEY_COLS.has(c) || ITEM_PCT_COLS.has(c) ? sSectionHeaderRight : sSectionHeader);
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
    ["Item", "Valor (R$)"],
    ...itens.map((it) => [it.nome, Number(it.valor ?? 0)]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 38 }, { wch: 16 }];
  ws["!autofilter"] = { ref: `A1:B${aoa.length}` };
  ws["!views"] = [{ state: "frozen", ySplit: 1 }];

  setCell(ws, 0, 0, sSectionHeader);
  setCell(ws, 0, 1, sSectionHeaderRight);
  itens.forEach((_, i) => {
    const zebra = i % 2 === 1;
    setCell(ws, i + 1, 0, zebra ? sCellZebra : sCell);
    setCell(ws, i + 1, 1, zebra ? sCellMoneyZebra : sCellMoney);
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
    XLSX.utils.book_append_sheet(wb, buildItemSheet(royalties), "Clientes - royalties");
  }
  if (cac.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildItemSheet(cac), "Clientes - CAC");
  }
  if (baseAntiga.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildItemSheet(baseAntiga), "Base antiga - CSC");
  }
  if (data.outrasReceitasItens.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildOutrasReceitasSheet(data.outrasReceitasItens), "Outras receitas");
  }

  XLSX.writeFile(wb, demonstrativoFilenameBase(data) + ".xlsx");
}
