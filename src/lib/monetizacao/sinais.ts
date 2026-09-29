import { ESTADOS_DISTRATO, propostasAbertas, reaisCurto, valorPropostas } from "./model.ts";
import type { Conta } from "./types";

// Texto dos dois sinais externos (DECISIONS 28/09/2026) para CSV, título de selo e ficha: um
// lugar só, para a tela e a exportação não dizerem coisas diferentes.

export const dataBr = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : null;

export const FONTE_TRATATIVAS = "Pipefy · Central de Tratativas";
export const FONTE_CONSULTORIA = "Plataforma da Consultoria";

/** Texto do sinal para CSV e para o título do selo: um lugar só. */
export function textoDistrato(a: Conta): string {
  const d = a.base?.distrato;
  if (!d) return "Sem card na Central de Tratativas";
  return [
    ESTADOS_DISTRATO[d.estado],
    d.fase,
    d.data_churn ? `churn em ${dataBr(d.data_churn)}` : null,
    d.categoria,
    d.cards > 1 ? `${d.cards} cards` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const FONTE_OMIE = "Omie · tags do cadastro de clientes e fornecedores";

/** Texto das tags do Omie para CSV, ficha e título: classe e em qual Omie (Matriz é quem a Planning Partners paga). */
export function textoOmie(a: Conta): string {
  const o = a.base?.omie;
  if (!o) return "Fora do Omie";
  const rotulo = {
    cliente: "Cliente",
    cliente_e_fornecedor: "Cliente e fornecedor",
    fornecedor: "Só fornecedor",
    pessoa_interna: "Funcionário ou sócio",
    sem_tag: "No Omie, sem tag",
  }[o.classe];
  const em = (l: string[]) => l.join(", ");
  return [
    rotulo,
    o.cliente_em.length ? `cliente em ${em(o.cliente_em)}` : null,
    o.fornecedor_em.length ? `fornecedor em ${em(o.fornecedor_em)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function textoConsultoria(a: Conta): string {
  const c = a.base?.consultoria;
  if (!c) return "Sem vínculo com a Consultoria";
  const partes: string[] = [];
  if (c.cliente)
    partes.push(
      `${c.cliente.ativo === false ? "Ex-cliente" : "Cliente"} da Consultoria${c.cliente.casamento === "raiz" ? " (mesma raiz de CNPJ)" : ""}${c.cliente.valor_a_recuperar != null ? ` · ${reaisCurto(c.cliente.valor_a_recuperar)} a recuperar` : ""}`,
    );
  const certas = propostasAbertas(a);
  const incertas = propostasAbertas(a, { incertas: true }).filter((p) => p.casamento === "nome");
  if (certas.length) partes.push(`Proposta em aberto${somaTexto(certas)}`);
  if (incertas.length) partes.push(`Proposta casada pelo nome, incerta${somaTexto(incertas)}`);
  if (c.propostas.some((p) => p.categoria === "Contrato"))
    partes.push("Contrato registrado na plataforma");
  return partes.join(" · ") || "Sem vínculo com a Consultoria";
}

function somaTexto(ps: Parameters<typeof valorPropostas>[0]) {
  const v = valorPropostas(ps);
  const n = ps.length > 1 ? `${ps.length} propostas` : null;
  const total = v.total ? reaisCurto(v.total) : null;
  const sem = v.semValor ? `${v.semValor} sem valor` : null;
  const partes = [n, total, sem].filter(Boolean);
  return partes.length ? ` (${partes.join(", ")})` : "";
}
