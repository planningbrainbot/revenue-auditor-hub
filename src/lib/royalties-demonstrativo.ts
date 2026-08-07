import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

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

export function gerarDemonstrativoRoyaltiesXlsx(data: DemonstrativoData) {
  const royalties = data.itens.filter((i) => i.categoria === "royalties" && !i.is_cac);
  const cac = data.itens.filter((i) => i.is_cac);
  const baseAntiga = data.itens.filter((i) => i.categoria === "csc_base_antiga");

  const itemRows = (rows: DemonstrativoItem[]) =>
    rows.map((r) => ({
      Cliente: r.razao_social,
      CNPJ: formatCnpj(r.cnpj),
      "Data do ganho": r.data_ganho ? new Date(r.data_ganho).toLocaleDateString("pt-BR") : "—",
      "Valor (R$)": Number(r.valor_confirmado ?? 0),
      "%": Number(r.royalties_percentual ?? 0),
      "Royalties (R$)": Number(r.royalties_item ?? 0),
    }));

  const itemColWidths = [{ wch: 36 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];

  const resumo: { Item: string; "Valor (R$)": number | string }[] = [
    { Item: "Base Planning", "Valor (R$)": data.receitaBase },
    { Item: `Royalties (${data.royaltiesPct}%)`, "Valor (R$)": data.royaltiesValor },
    { Item: data.cscLabel, "Valor (R$)": data.cscValor },
  ];
  if (data.cacValor > 0) resumo.push({ Item: "CAC", "Valor (R$)": data.cacValor });
  if (data.trafegoPago) resumo.push({ Item: "Tráfego pago", "Valor (R$)": data.trafegoPago });
  if (data.outrasReceitas) resumo.push({ Item: "Outras receitas", "Valor (R$)": data.outrasReceitas });
  resumo.push({ Item: "Total fatura", "Valor (R$)": data.totalFatura });

  const wb = XLSX.utils.book_new();

  const wsResumo = XLSX.utils.json_to_sheet([
    { Item: "Unidade", "Valor (R$)": data.unidadeNome },
    { Item: "Referência", "Valor (R$)": formatMesLabel(data.mes) },
    {
      Item: "Confirmado em",
      "Valor (R$)": data.confirmadoEm ? new Date(data.confirmadoEm).toLocaleString("pt-BR") : "—",
    },
    { Item: "Confirmado por", "Valor (R$)": data.confirmadoPor ?? "—" },
    ...resumo,
  ]);
  wsResumo["!cols"] = [{ wch: 28 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  if (royalties.length > 0) {
    const ws = XLSX.utils.json_to_sheet(itemRows(royalties));
    ws["!cols"] = itemColWidths;
    XLSX.utils.book_append_sheet(wb, ws, "Clientes - royalties");
  }

  if (cac.length > 0) {
    const ws = XLSX.utils.json_to_sheet(itemRows(cac));
    ws["!cols"] = itemColWidths;
    XLSX.utils.book_append_sheet(wb, ws, "Clientes - CAC");
  }

  if (baseAntiga.length > 0) {
    const ws = XLSX.utils.json_to_sheet(itemRows(baseAntiga));
    ws["!cols"] = itemColWidths;
    XLSX.utils.book_append_sheet(wb, ws, "Base antiga - CSC");
  }

  if (data.outrasReceitasItens.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.outrasReceitasItens.map((it) => ({ Item: it.nome, "Valor (R$)": Number(it.valor ?? 0) })),
    );
    ws["!cols"] = [{ wch: 36 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "Outras receitas");
  }

  XLSX.writeFile(wb, demonstrativoFilenameBase(data) + ".xlsx");
}
