// ClickUp API v2 → domínio. Puro: recebe JSON, devolve tipos. Campos resolvidos por NOME, porque
// os ids de custom field são por space e não devem viver no código.
//
// Portado do Growth (`brain-web/src/lib/okrs/normalizar.ts`). Mudança: a tarefa bruta agora
// declara também dono, prazo, datas, tags, lista e pasta, que o Growth recebia e descartava; o
// espelho do Ops precisa deles para os compromissos.
import type { Acao, DepartamentoOkr, Kr, Sentido } from "./tipos.ts";

export interface PastaBruta {
  id: string;
  name: string;
  lists: { id: string; name: string; statuses?: { status: string; orderindex?: number }[] }[];
}

export interface OpcaoBruta {
  id: string;
  name: string;
  orderindex: number;
}

export interface CampoBruto {
  id: string;
  name: string;
  type: string;
  value?: unknown;
  type_config?: { options?: OpcaoBruta[] };
}

export interface PessoaBruta {
  id: number | string;
  username?: string | null;
  email?: string | null;
}

export interface TarefaBruta {
  id: string;
  name: string;
  url: string;
  parent: string | null;
  status: { status: string; type: string };
  custom_fields?: CampoBruto[];
  orderindex?: string;
  assignees?: PessoaBruta[];
  creator?: PessoaBruta | null;
  due_date?: string | null;
  start_date?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
  date_done?: string | null;
  date_closed?: string | null;
  tags?: { name: string }[];
  priority?: { priority?: string | null } | null;
  list?: { id: string; name?: string } | null;
  folder?: { id: string; name?: string; hidden?: boolean } | null;
  space?: { id: string } | null;
  description?: string | null;
  text_content?: string | null;
}

// Direcionamentos (🗣️) e guias (📖) não são objetivos.
const LISTA_FORA = /^(🗣️|📖)/u;

export function numeroDoCampo(campos: CampoBruto[] | undefined, nome: string): number | null {
  const c = (campos ?? []).find((f) => f.name.includes(nome));
  if (c?.value == null || c.value === "") return null;
  const n = Number(c.value);
  return Number.isFinite(n) ? n : null;
}

/** Nome da opção escolhida num dropdown (a API devolve o orderindex, número, ou o id, texto). */
export function opcaoDoCampo(campos: CampoBruto[] | undefined, nome: string): string | null {
  const c = (campos ?? []).find((f) => f.name.includes(nome));
  if (!c || c.value == null || c.value === "") return null;
  const opcoes = c.type_config?.options ?? [];
  const opcao = opcoes.find((o) =>
    typeof c.value === "number" ? o.orderindex === c.value : o.id === c.value,
  );
  if (opcao) return opcao.name;
  // Campo de texto ou URL com o mesmo nome: devolve o próprio valor.
  return typeof c.value === "string" ? c.value : null;
}

function sentido(campos: CampoBruto[] | undefined): Sentido {
  return (opcaoDoCampo(campos, "Sentido") ?? "").includes("menor") ? "menor" : "maior";
}

export function concluidaStatus(tipo: string | undefined): boolean {
  return tipo === "done" || tipo === "closed";
}

function acao(t: TarefaBruta): Acao {
  return {
    id: t.id,
    nome: t.name,
    status: t.status.status,
    concluida: concluidaStatus(t.status.type),
    url: t.url,
  };
}

function porOrderindex(a: TarefaBruta, b: TarefaBruta): number {
  return Number(a.orderindex ?? "0") - Number(b.orderindex ?? "0");
}

export function normalizarOkrs(
  pastas: PastaBruta[],
  tarefasPorLista: Record<string, TarefaBruta[]>,
): DepartamentoOkr[] {
  return pastas.map((pasta) => ({
    pastaId: pasta.id,
    nome: pasta.name,
    objetivos: pasta.lists
      .filter((l) => !LISTA_FORA.test(l.name))
      .map((lista) => {
        const tarefas = tarefasPorLista[lista.id] ?? [];
        const statusDisponiveis = [...(lista.statuses ?? [])]
          .sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0))
          .map((s) => s.status);
        const posStatus = (s: string) => statusDisponiveis.indexOf(s);
        const porStatusDepoisOrdem = (a: TarefaBruta, b: TarefaBruta) =>
          posStatus(b.status.status) - posStatus(a.status.status) || porOrderindex(a, b);
        const krs: Kr[] = tarefas
          .filter((t) => t.parent == null)
          .sort(porOrderindex)
          .map((t) => ({
            id: t.id,
            nome: t.name,
            url: t.url,
            alvo: numeroDoCampo(t.custom_fields, "Alvo"),
            atual: numeroDoCampo(t.custom_fields, "Atual"),
            sentido: sentido(t.custom_fields),
            acoes: tarefas
              .filter((s) => s.parent === t.id)
              .sort(porStatusDepoisOrdem)
              .map(acao),
          }));
        return { listaId: lista.id, nome: lista.name, krs, statusDisponiveis };
      }),
  }));
}

/** Agrupa as tarefas de uma leitura por time (`/team/{id}/task`) na forma que `normalizarOkrs` pede. */
export function tarefasPorLista(tarefas: TarefaBruta[]): Record<string, TarefaBruta[]> {
  const out: Record<string, TarefaBruta[]> = {};
  for (const t of tarefas) {
    const id = t.list?.id;
    if (!id) continue;
    (out[id] ??= []).push(t);
  }
  return out;
}
