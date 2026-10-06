// Documento da movimentação para o Departamento Pessoal. Desde 05/10/2026 é o
// formulário "Solicitação de Movimentação" do RH de Maceió, preenchido: dados do
// colaborador, o que muda, justificativa e os três blocos de assinatura (RH,
// gestor imediato, diretoria). Gerado no servidor para ir anexado ao e-mail e no
// navegador para o RH baixar e colher as assinaturas. Sem React: jspdf e xlsx
// rodam nos dois lados.

// As opções do formulário, na ordem em que aparecem no modelo do RH.
export const TIPOS_MOVIMENTACAO = [
  "Promoção",
  "Alteração de cargo",
  "Alteração salarial",
  "Transferência de setor",
  "Transferência de unidade",
  "Mudança de função",
  "Alteração de jornada",
  "Modelo de trabalho",
];

export const MOTIVOS_FORMULARIO = [
  "Promoção por desempenho",
  "Desenvolvimento profissional",
  "Necessidade do setor",
  "Reestruturação",
  "Alteração de responsabilidades",
  "Transferência",
  "Substituição/reposição",
  "Adequação salarial",
];

export const MODELOS_TRABALHO = [
  { v: "presencial", t: "Presencial" },
  { v: "hibrido", t: "Híbrido" },
  { v: "remoto", t: "Remoto" },
];

export interface MovimentacaoDocumento {
  id: number;
  /** "01/2026". */
  numero: string | null;
  unidade: string;
  pessoa: string;
  email: string | null;
  admissao: string | null;
  dataSolicitacao: string;
  vigencia: string;
  motivo: string | null;
  observacao: string | null;
  /** Só o que muda: [campo, antes, depois]. Usado no corpo do e-mail. */
  mudancas: [string, string, string][];
  atual: {
    salario: number | null;
    cargo: string | null;
    setor: string | null;
    gestor: string | null;
  };
  apos: {
    salario: number | null;
    cargo: string | null;
    setor: string | null;
    gestor: string | null;
  };
  tipos: string[];
  motivos: string[];
  modeloTrabalho: string | null;
  justificativa: string | null;
  responsabilidades: string | null;
  registradaPor: string | null;
  gestorImediato: string | null;
  enviadaEm: string | null;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fmtSalario = (v: number | null | undefined) =>
  v == null ? "—" : BRL.format(Number(v));
const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";

const marca = (sim: boolean) => (sim ? "( x )" : "(   )");

/** "( x ) Promoção   (   ) Alteração de cargo ..." mais o "Outro:" se houver. */
function caixas(opcoes: string[], marcadas: string[]) {
  const linhas = opcoes.map((o) => `${marca(marcadas.includes(o))} ${o}`);
  const outro = marcadas.find((m) => m.startsWith("Outro:"));
  linhas.push(`${marca(!!outro)} Outro${outro ? `: ${outro.slice(6).trim()}` : ""}`);
  return linhas.join("   ");
}

function linhas(m: MovimentacaoDocumento) {
  const depois = (v: string | null, atual: string | null) =>
    v == null ? "O mesmo" : v || atual || "—";
  return {
    identificacao: [
      ["Data da solicitação", fmtData(m.dataSolicitacao)],
      ["Nº da solicitação", m.numero ?? `#${m.id}`],
    ] as [string, string][],
    colaborador: [
      ["Nome completo", m.pessoa],
      ["Salário atual", fmtSalario(m.atual.salario)],
      ["Cargo atual", m.atual.cargo ?? "—"],
      ["Setor atual", m.atual.setor ?? "—"],
      ["Gestor imediato atual", m.atual.gestor ?? "—"],
      ["Data de admissão", fmtData(m.admissao)],
    ] as [string, string][],
    movimentacao: [
      ["Tipo de movimentação", caixas(TIPOS_MOVIMENTACAO, m.tipos)],
      ["Cargo após", depois(m.apos.cargo, m.atual.cargo)],
      ["Salário após", m.apos.salario == null ? "O mesmo" : fmtSalario(m.apos.salario)],
      ["Gestor imediato após", depois(m.apos.gestor, m.atual.gestor)],
      ["Setor após", depois(m.apos.setor, m.atual.setor)],
      [
        "Modelo de trabalho",
        MODELOS_TRABALHO.map((o) => `${marca(m.modeloTrabalho === o.v)} ${o.t}`).join("   "),
      ],
      ["Data prevista da mudança", fmtData(m.vigencia)],
    ] as [string, string][],
    justificativa: [
      ["Motivo", caixas(MOTIVOS_FORMULARIO, m.motivos)],
      ["Justificativa", m.justificativa ?? "—"],
      ["Principais responsabilidades ou alterações", m.responsabilidades ?? "—"],
      ...(m.observacao ? ([["Observação", m.observacao]] as [string, string][]) : []),
    ] as [string, string][],
  };
}

export function nomeArquivo(m: MovimentacaoDocumento, ext: "pdf" | "xlsx") {
  const limpo = m.pessoa
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const num = m.numero ? m.numero.replace("/", "-") : String(m.id);
  return `solicitacao-movimentacao-${num}-${limpo}.${ext}`;
}

export async function gerarPdf(m: MovimentacaoDocumento): Promise<ArrayBuffer> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margem = 40;
  const largura = doc.internal.pageSize.getWidth() - margem * 2;
  const fim = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const L = linhas(m);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("SOLICITAÇÃO DE MOVIMENTAÇÃO", doc.internal.pageSize.getWidth() / 2, 48, {
    align: "center",
  });
  doc.setFontSize(11);
  doc.text(`PLANNING ${m.unidade.toUpperCase()}`, doc.internal.pageSize.getWidth() / 2, 64, {
    align: "center",
  });

  let y = 76;
  const secao = (titulo: string, corpo: [string, string][]) => {
    autoTable(doc, {
      startY: y,
      margin: { left: margem, right: margem },
      head: [[{ content: titulo, colSpan: 2 }]],
      body: corpo,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 3, overflow: "linebreak", lineColor: [200, 205, 210] },
      headStyles: { fillColor: [16, 23, 28], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 }, 1: { cellWidth: largura - 150 } },
    });
    y = fim() + 6;
  };
  secao("IDENTIFICAÇÃO DA SOLICITAÇÃO", L.identificacao);
  secao("DADOS DO COLABORADOR", L.colaborador);
  secao("DADOS DA MOVIMENTAÇÃO", L.movimentacao);
  secao("JUSTIFICATIVA DA MOVIMENTAÇÃO", L.justificativa);

  const aprovacao = (titulo: string, texto: string, nome: string, extra?: string) => {
    // Bloco de assinatura não se parte entre páginas.
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      y = 50;
    }
    autoTable(doc, {
      startY: y,
      margin: { left: margem, right: margem },
      body: [
        [{ content: `${titulo}: ${texto}`, colSpan: 2, styles: { fontStyle: "bold" } }],
        ...(extra ? [[{ content: extra, colSpan: 2 }]] : []),
        [`Nome: ${nome}`, "Cargo:"],
        ["Assinatura:\n\n", "Data:"],
      ],
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 4, lineColor: [200, 205, 210] },
      columnStyles: { 0: { cellWidth: largura * 0.6 }, 1: { cellWidth: largura * 0.4 } },
    });
    y = fim() + 6;
  };
  if (y > 640) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("APROVAÇÕES", margem, y + 4);
  y += 12;
  aprovacao(
    "RH",
    "Após análise desta solicitação, registro a movimentação proposta para o colaborador acima identificado.",
    m.registradaPor ?? "",
  );
  aprovacao(
    "GESTOR IMEDIATO",
    "Declaro estar de acordo com a movimentação proposta e confirmo a necessidade e adequação da alteração apresentada.",
    m.gestorImediato ?? "",
  );
  aprovacao(
    "DIRETORIA",
    "Após análise desta solicitação, a movimentação está:",
    "",
    "(   ) Aprovada      (   ) Reprovada",
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    `Gerado pelo Planning People${m.enviadaEm ? ` · enviado ao DP em ${new Date(m.enviadaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}`,
    margem,
    doc.internal.pageSize.getHeight() - 20,
  );
  return doc.output("arraybuffer");
}

export async function gerarXlsx(m: MovimentacaoDocumento): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const L = linhas(m);
  const ws = XLSX.utils.aoa_to_sheet([
    ["SOLICITAÇÃO DE MOVIMENTAÇÃO"],
    [`PLANNING ${m.unidade.toUpperCase()}`],
    [],
    ["IDENTIFICAÇÃO DA SOLICITAÇÃO"],
    ...L.identificacao,
    [],
    ["DADOS DO COLABORADOR"],
    ...L.colaborador,
    [],
    ["DADOS DA MOVIMENTAÇÃO"],
    ...L.movimentacao,
    [],
    ["JUSTIFICATIVA DA MOVIMENTAÇÃO"],
    ...L.justificativa,
    [],
    ["APROVAÇÕES"],
    ["RH", `Nome: ${m.registradaPor ?? ""}`, "Assinatura:", "Data:"],
    ["GESTOR IMEDIATO", `Nome: ${m.gestorImediato ?? ""}`, "Assinatura:", "Data:"],
    ["DIRETORIA", "(   ) Aprovada   (   ) Reprovada", "Assinatura:", "Data:"],
  ]);
  ws["!cols"] = [{ wch: 36 }, { wch: 90 }, { wch: 16 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Solicitação de Movimentação");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
