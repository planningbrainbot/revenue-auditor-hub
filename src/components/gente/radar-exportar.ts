// Exportar o radar de avaliação de experiência em PDF ou Excel (pedido do RH
// de Maceió, 01/10/2026). Sai o que está na tela, já recortado pela unidade:
// os dois grupos, com prazo e andamento de cada avaliação.
//
// As bibliotecas entram por import dinâmico: só carregam quando alguém clica.

export interface LinhaExportavel {
  grupo: string;
  pessoa: string;
  cargo: string;
  unidade: string;
  gestor: string;
  admissao: string;
  completaEm: string;
  prazo: string;
  avaliacao: string;
}

const COLUNAS: { chave: keyof LinhaExportavel; titulo: string; largura: number }[] = [
  { chave: "pessoa", titulo: "Pessoa", largura: 34 },
  { chave: "cargo", titulo: "Cargo", largura: 24 },
  { chave: "unidade", titulo: "Unidade", largura: 14 },
  { chave: "gestor", titulo: "Gestor", largura: 28 },
  { chave: "admissao", titulo: "Admissão", largura: 12 },
  { chave: "completaEm", titulo: "Completa em", largura: 12 },
  { chave: "prazo", titulo: "Prazo", largura: 18 },
  { chave: "avaliacao", titulo: "Avaliação", largura: 44 },
];

const LARGURA_TOTAL = COLUNAS.reduce((s, c) => s + c.largura, 0);

const hoje = () => new Date().toISOString().slice(0, 10);
const hojeBR = () => new Date().toLocaleDateString("pt-BR");

export async function exportarRadarExcel(linhas: LinhaExportavel[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Grupo", ...COLUNAS.map((c) => c.titulo)],
    ...linhas.map((l) => [l.grupo, ...COLUNAS.map((c) => l[c.chave])]),
  ]);
  ws["!cols"] = [{ wch: 22 }, ...COLUNAS.map((c) => ({ wch: c.largura }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Radar de experiência");
  XLSX.writeFile(wb, `radar-avaliacao-experiencia-${hoje()}.xlsx`);
}

export async function exportarRadarPdf(linhas: LinhaExportavel[], grupos: string[]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const margem = 32;
  const UTIL = doc.internal.pageSize.getWidth() - margem * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Radar de avaliação de experiência", margem, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    `Planning People · gerado em ${hojeBR()} · quem está nos primeiros 90 dias pela data de admissão do cadastro`,
    margem,
    56,
  );
  doc.setTextColor(0);

  let y = 76;
  for (const grupo of grupos) {
    const doGrupo = linhas.filter((l) => l.grupo === grupo);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${grupo} (${doGrupo.length})`, margem, y);
    autoTable(doc, {
      startY: y + 8,
      margin: { left: margem, right: margem },
      head: [COLUNAS.map((c) => c.titulo)],
      body: doGrupo.length
        ? doGrupo.map((l) => COLUNAS.map((c) => l[c.chave]))
        : [["Ninguém nesta fase agora.", "", "", "", "", "", "", ""]],
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      // Larguras fixas para as duas tabelas alinharem coluna com coluna.
      columnStyles: Object.fromEntries(
        COLUNAS.map((c, i) => [i, { cellWidth: (c.largura / LARGURA_TOTAL) * UTIL }]),
      ),
      headStyles: { fillColor: [16, 23, 28], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [244, 247, 249] },
    });
    // `lastAutoTable` é o jeito documentado de saber onde a tabela terminou.
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Página ${i} de ${paginas}`,
      doc.internal.pageSize.getWidth() - margem,
      doc.internal.pageSize.getHeight() - 16,
      { align: "right" },
    );
  }
  doc.save(`radar-avaliacao-experiencia-${hoje()}.pdf`);
}
