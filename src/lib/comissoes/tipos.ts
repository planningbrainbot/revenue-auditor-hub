// Formato das respostas das funções ops.comissoes_* (PRD wiki/prds/2026-10-comissoes-v1.md) e as regras
// de apresentação que as telas dividem.
export type Linha = {
  id: number;
  tipo: "comissao" | "ajuste" | "bonus";
  origem_id: number | null;
  contrato_id: number | null;
  cliente: string | null;
  unidade: string | null;
  pessoa_id: number;
  pessoa: string;
  papel: "closer" | "sdr" | null;
  metade: 1 | 2 | null;
  base: number | null;
  percentual: number | null;
  valor: number;
  valor_vigente: number;
  fonte: "cac" | "assinatura" | "pagamento_cliente" | "manual" | "bonus" | "ajuste";
  apuracao_id: number | null;
  mes_referencia: string | null;
  motivo: string | null;
  excluida: boolean;
  ajustada: boolean;
  mes: string;
};

export type Mes = {
  mes: string;
  situacao: "previa" | "liberado" | "pago";
  prazo: string;
  pagamento_em: string;
  editavel: boolean;
  envio_dp_em: string;
  liberado_em: string | null;
  pago_em: string | null;
};

export type Perfil = {
  leitura: boolean;
  lider: boolean;
  financeiro: boolean;
  pessoa: string | null;
  hoje: string;
};

export type Depois = {
  contrato_id: number;
  cliente: string;
  unidade: string;
  papel: string;
  metade: number;
  valor_estimado: number | null;
  motivo: string;
};

export type Minhas =
  | { vinculado: false }
  | {
      vinculado: true;
      pessoa: string;
      proximo: (Mes & { total: number | null; linhas: Linha[] }) | null;
      historico: (Mes & { total: number; linhas: Linha[] })[];
      depois: Depois[];
    };

export type Pendencias = {
  sem_parcela: {
    item_id: number;
    contrato_id: number;
    cliente: string;
    unidade: string;
    mes_referencia: string;
    cac: number;
  }[];
  regra_antiga: {
    item_id: number;
    contrato_id: number;
    cliente: string;
    unidade: string;
    ganho_em: string;
    parcela: number | null;
    mes_referencia: string;
  }[];
  sem_closer: { contrato_id: number; cliente: string; unidade: string; falta: string }[];
  aguardando_data: {
    contrato_id: number;
    cliente: string;
    unidade: string;
    ganho_em: string;
    tipo: "assinatura" | "pagamento_cliente";
  }[];
  sem_vinculo: { pessoa_id: number; nome: string }[];
  pipe_a_confirmar: { contrato_id: number; cliente: string; unidade: string }[];
  pessoa_trocada: {
    contrato_id: number;
    cliente: string;
    papel: string;
    na_linha: string;
    no_pipedrive: string | null;
  }[];
};

export type Revisao = Mes & {
  total: number;
  pessoas: { pessoa_id: number; nome: string; vinculado: boolean; total: number }[];
  todas_pessoas: { pessoa_id: number; nome: string }[];
  linhas: Linha[];
  apuracoes: { apuracao_id: number; unidade: string; status: string; cac: number }[];
  pendencias: Pendencias;
  meses: string[];
};

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// "2026-11-01" -> "novembro de 2026"
export function mesExtenso(iso: string): string {
  const [a, m] = iso.split("-");
  return `${MESES[Number(m) - 1]} de ${a}`;
}

// "2026-10-01" -> "10/2026"
export const mesCurto = (iso: string | null) =>
  iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "-";

// Mês de pagamento que a revisão abre por padrão: o deste mês até o dia 20, depois o seguinte.
export function mesPadrao(hoje: string): string {
  const [a = 0, m = 1, d = 1] = hoje.split("-").map(Number);
  const seguinte = d > 20;
  const ano = seguinte && m === 12 ? a + 1 : a;
  const mes = seguinte ? (m % 12) + 1 : m;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

// "2026-11" -> "2026-10-01": a apuração que alimenta o pagamento do mês.
export function mesAnterior(mes: string): string {
  const [a = 0, m = 1] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
}

export function origem(l: Linha): string {
  switch (l.fonte) {
    case "cac":
      return `Apuração de ${mesCurto(l.mes_referencia)}`;
    case "assinatura":
      return "Assinatura (sem adiantamento)";
    case "pagamento_cliente":
      return "Cliente pagou (unidade sem CAC)";
    case "manual":
      return "Incluída pelo líder";
    case "bonus":
      return "Bônus";
    default:
      return "Ajuste";
  }
}

export const papelTexto = (p: string | null) =>
  p === "closer" ? "Closer" : p === "sdr" ? "SDR" : "-";
export const metadeTexto = (m: number | null) => (m ? `${m}ª` : "-");

export const SITUACAO: Record<
  Mes["situacao"],
  { texto: string; tom: "info" | "sucesso" | "neutro" }
> = {
  previa: { texto: "Em revisão", tom: "info" },
  liberado: { texto: "Liberado", tom: "sucesso" },
  pago: { texto: "Pago", tom: "neutro" },
};
