// Atualização da base pela unidade (PRD wiki/prds/2026-10-minha-unidade-atualizacao-da-base.md, 28/10/2026).
// Tipos dos pedidos e as regras que a tela repete antes de mandar ao banco (o banco confere de novo).

/** O jsonb do pedido: as chaves dependem do tipo (`ops.base_pedido_abrir`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dados = Record<string, any>;
import type { TomStatus } from "@/components/planning";
import { fmtWhatsapp } from "@/lib/telefone";

export type TipoPedido =
  | "contato_incluir"
  | "contato_editar"
  | "contato_desativar"
  | "contato_nps"
  | "churn"
  | "nao_reconheco"
  | "cliente_incluir";
export type SituacaoPedido =
  "aberto" | "aprovado" | "enviando" | "concluido" | "erro" | "recusado" | "cancelado";

export type Pedido = {
  id: string;
  tipo: TipoPedido;
  unidade_id: number | null;
  unidade_nome?: string | null;
  conta_key: string | null;
  conta_nome: string | null;
  contato_id: number | null;
  pedido_pai: string | null;
  proposto: Dados;
  foto: Dados | null;
  agora?: Dados | null;
  situacao: SituacaoPedido;
  motivo_recusa: string | null;
  pipefy_ref: string | null;
  erro: string | null;
  tentativas: number;
  criado_por: string;
  criado_em: string;
  decidido_em: string | null;
  concluido_em: string | null;
  autor?: string | null;
  decisor?: string | null;
  filhos?: { id: string; situacao: SituacaoPedido; proposto: Dados }[];
};

export type PermissoesPedido = {
  abrir: boolean;
  decidir: boolean;
  ver_como: boolean;
  /** Unidades regionais; `minha` = no escopo de quem pede. */
  unidades: { id: number; nome: string; minha: boolean }[];
};

export type ResumoConta = {
  contatos: number;
  nps: { id: number; nome: string; whatsapp: string } | null;
  pedidos: number;
  tipos: TipoPedido[];
};
export type ResumoContatos = { contas: Record<string, ResumoConta>; declarados: Pedido[] };

export type ContatoConta = {
  id: number;
  nome: string;
  cargo: string | null;
  whatsapp: string | null;
  whatsapp_valido: boolean;
  email: string | null;
  contato_nps: boolean;
};
export type ContatosDaConta = {
  contatos: ContatoConta[];
  pedidos: Pedido[];
  tem_cadastro: boolean;
  tem_cnpj: boolean;
};

export const TIPO_PEDIDO: Record<TipoPedido, string> = {
  contato_incluir: "Incluir contato",
  contato_editar: "Editar contato",
  contato_desativar: "Desativar contato",
  contato_nps: "Contato do NPS",
  churn: "Informar churn",
  nao_reconheco: "Não reconheço",
  cliente_incluir: "Incluir cliente",
};

export const SITUACAO_PEDIDO: Record<SituacaoPedido, { rotulo: string; tom: TomStatus }> = {
  aberto: { rotulo: "Aguardando CS", tom: "atencao" },
  aprovado: { rotulo: "Aprovado, gravando", tom: "info" },
  enviando: { rotulo: "Aprovado, gravando", tom: "info" },
  concluido: { rotulo: "Concluído", tom: "sucesso" },
  erro: { rotulo: "Erro ao gravar", tom: "perigo" },
  recusado: { rotulo: "Recusado", tom: "perigo" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};
/** Churn não passa pela fila: aberto quer dizer "tratativa com o CS" (R-12). */
export function situacaoDoPedido(p: Pedido) {
  if (p.tipo === "churn" && p.situacao === "aberto")
    return { rotulo: "Tratativa com o CS", tom: "atencao" as TomStatus };
  if (p.tipo === "churn" && p.situacao === "concluido")
    return { rotulo: "Churn confirmado", tom: "sucesso" as TomStatus };
  return SITUACAO_PEDIDO[p.situacao];
}

// Opções fechadas (as mesmas do banco e do Pipefy).
export const CATEGORIAS_CHURN = [
  "Inadimplência",
  "Insatisfação com o serviço",
  "Encerramento das atividades",
  "Trocou de fornecedor/concorrente",
  "Motivo financeiro do cliente",
  "Outro",
] as const;
export const MOTIVOS_DESATIVAR = [
  "Saiu da empresa",
  "Não é mais o responsável",
  "Contato errado",
] as const;
export const CARGOS = [
  "Sócio Operador",
  "Sócio Investidor",
  "Diretor",
  "Gerente",
  "Financeiro",
  "Administrativo",
  "Contador",
  "Outro",
] as const;
export const NAO_RECONHECO = {
  nunca: "Nunca foi cliente da unidade",
  outra_unidade: "É cliente de outra unidade",
  mesma_empresa: "É a mesma empresa de outra linha da base",
} as const;

const DDDS = new Set(
  "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(
    " ",
  ),
);

/**
 * R-07: WhatsApp com DDI 55, DDD que existe, fixo de 8 dígitos começando de 2 a 8 ou celular de 9 começando com 9.
 * Igual a `ops.base_whatsapp`.
 */
export function normalizarWhatsapp(v: string): { valor: string } | { erro: string } {
  let d = (v || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11)
    return { erro: "Informe DDD e número, com 10 ou 11 dígitos." };
  if (!DDDS.has(d.slice(0, 2))) return { erro: `DDD ${d.slice(0, 2)} não existe.` };
  if (d.length === 11 && d[2] !== "9")
    return { erro: "Celular com 11 dígitos começa com 9 depois do DDD." };
  if (d.length === 10 && !"2345678".includes(d[2]))
    return { erro: "Fixo começa com 2 a 8 depois do DDD." };
  if (/^(\d)\1+$/.test(d.slice(2))) return { erro: "Número com todos os dígitos iguais." };
  return { valor: `55${d}` };
}

export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** O que o pedido muda, numa linha (Meus pedidos e a fila do CS). */
export function resumoDoPedido(p: Pedido): string {
  const x = p.proposto ?? {};
  const antes = p.foto?.contato ?? {};
  switch (p.tipo) {
    case "contato_incluir":
      return `${x.nome} · ${fmtWhatsapp(x.whatsapp)}${x.contato_nps ? " · contato do NPS" : ""}`;
    case "contato_editar": {
      const mudou = (
        [
          ["nome", "nome"],
          ["cargo", "cargo"],
          ["whatsapp", "WhatsApp"],
          ["email", "e-mail"],
        ] as const
      )
        .filter(([k]) => (antes[k] ?? null) !== (x[k] ?? null))
        .map(([, r]) => r);
      return `${x.nome}: ${mudou.join(", ") || "sem mudança de dado"}${x.contato_nps ? " · contato do NPS" : ""}`;
    }
    case "contato_desativar":
      return `Tirar ${x.nome} deste cliente · ${x.motivo}`;
    case "contato_nps":
      return `${x.nome} passa a receber o NPS`;
    case "churn":
      return `${x.categoria} · churn em ${String(x.data ?? "")
        .split("-")
        .reverse()
        .join("/")}`;
    case "nao_reconheco":
      return x.motivo === "outra_unidade"
        ? `É cliente de ${x.unidade_nome}`
        : x.motivo === "mesma_empresa"
          ? `Mesma empresa que ${x.conta_nome}`
          : NAO_RECONHECO.nunca;
    case "cliente_incluir":
      return `CNPJ ${mascararCnpj(x.cnpj)}${p.filhos?.length ? ` · ${p.filhos.length} contato(s)` : ""}`;
  }
}

export function mascararCnpj(c: string | null | undefined) {
  const d = String(c ?? "").replace(/\D/g, "");
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : String(c ?? "");
}

/** R-05: o contato mudou na base desde o pedido (a foto não bate com o espelho de agora). */
export function mudouDesdeOPedido(p: Pedido): boolean {
  const antes = p.foto?.contato,
    agora = p.agora;
  if (!antes || !agora) return false;
  return (["nome", "cargo", "whatsapp", "email", "contato_nps"] as const).some(
    (k) => (antes[k] ?? null) !== (agora[k] ?? null),
  );
}

/** P-04: a régua do cartão de cobertura e da meta é cliente de grau 3 ou 4. */
export const GRAUS_DA_META = [3, 4];

export const quando = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
