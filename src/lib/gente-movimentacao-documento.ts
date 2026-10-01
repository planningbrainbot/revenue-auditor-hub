// Documento da movimentação para o Departamento Pessoal (01/10/2026): o mesmo
// conteúdo em PDF e em Excel, gerado no servidor para ir anexado ao e-mail e no
// navegador para o RH baixar. Sem React: só jspdf e xlsx, que rodam nos dois.

export interface MovimentacaoDocumento {
  id: number;
  unidade: string;
  pessoa: string;
  email: string | null;
  admissao: string | null;
  vigencia: string;
  motivo: string | null;
  observacao: string | null;
  /** Só o que muda: [campo, antes, depois]. */
  mudancas: [string, string, string][];
  registradaPor: string | null;
  enviadaEm: string | null;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fmtSalario = (v: number | null | undefined) =>
  v == null ? "—" : BRL.format(Number(v));
const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";

function cabecalho(m: MovimentacaoDocumento): [string, string][] {
  return [
    ["Movimentação", `#${m.id}`],
    ["Unidade", m.unidade],
    ["Colaborador(a)", m.pessoa],
    ["E-mail", m.email ?? "—"],
    ["Admissão", fmtData(m.admissao)],
    ["Vigência", fmtData(m.vigencia)],
    ["Motivo", m.motivo ?? "—"],
    ["Registrada por", m.registradaPor ?? "—"],
    [
      "Enviada em",
      m.enviadaEm
        ? new Date(m.enviadaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : "—",
    ],
  ];
}

export function nomeArquivo(m: MovimentacaoDocumento, ext: "pdf" | "xlsx") {
  const limpo = m.pessoa
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `movimentacao-${m.id}-${limpo}.${ext}`;
}

export async function gerarPdf(m: MovimentacaoDocumento): Promise<ArrayBuffer> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margem = 40;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Movimentação de pessoal", margem, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Planning People · ${m.unidade} · para o Departamento Pessoal`, margem, 66);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 84,
    margin: { left: margem, right: margem },
    body: cabecalho(m),
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 130 } },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("O que muda", margem, y);
  autoTable(doc, {
    startY: y + 8,
    margin: { left: margem, right: margem },
    head: [["Campo", "Antes", "Depois"]],
    body: m.mudancas,
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: [16, 23, 28], textColor: 255, fontStyle: "bold" },
  });
  if (m.observacao) {
    const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Observação", margem, y2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      doc.splitTextToSize(m.observacao, doc.internal.pageSize.getWidth() - margem * 2),
      margem,
      y2 + 16,
    );
  }
  return doc.output("arraybuffer");
}

export async function gerarXlsx(m: MovimentacaoDocumento): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ...cabecalho(m),
    [],
    ["Campo", "Antes", "Depois"],
    ...m.mudancas,
    ...(m.observacao ? [[], ["Observação", m.observacao]] : []),
  ]);
  ws["!cols"] = [{ wch: 22 }, { wch: 36 }, { wch: 36 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movimentação");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
