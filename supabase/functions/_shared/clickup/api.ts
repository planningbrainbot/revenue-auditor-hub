// Cliente da API v2 do ClickUp, sem dependência de plataforma: roda no Deno (sincronização), no
// servidor do Ops (escritas do cockpit) e nos testes (com `fetch` falso).
//
// Duas correções em relação ao leitor do Growth:
// 1. PAGINA. O Growth pedia `/list/{id}/task` sem `page`, e tudo depois de 100 tarefas sumia sem
//    aviso. Aqui a leitura segue `page` até `last_page` e falha alto se passar do teto.
// 2. UMA consulta filtrada por time (`/team/{id}/task?space_ids[]=…`) no lugar de uma chamada por
//    lista: a cota é de 100 requisições por minuto por token, e o token é compartilhado.
import type { CampoBruto, PastaBruta, TarefaBruta } from "./normalizar.ts";
import { esperaApos429 } from "./vazao.ts";

export const CLICKUP_BASE = "https://api.clickup.com/api/v2";
/** Workspace "Expansão Nacional | Planning" (spec do Growth de 12/08/2026). */
export const TEAM_EXPANSAO = "90171400696";
/** Space "Operação | Expansão Nacional": pasta = departamento, lista = objetivo. */
export const SPACE_EXPANSAO = "90176460033";

const TENTATIVAS_429 = 3;
export const TETO_PAGINAS = 60;

export class ErroClickUp extends Error {
  status: number;
  caminho: string;
  constructor(status: number, caminho: string, detalhe?: string) {
    super(`ClickUp ${status} em ${caminho.split("?")[0]}${detalhe ? `: ${detalhe}` : ""}`);
    this.status = status;
    this.caminho = caminho;
  }
}

export interface OpcoesCliente {
  fetch?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export interface ClienteClickUp {
  ler<T>(caminho: string): Promise<T>;
  enviar<T>(caminho: string, metodo: "POST" | "PUT" | "DELETE", corpo?: unknown): Promise<T>;
}

export function clienteClickUp(token: string, opcoes: OpcoesCliente = {}): ClienteClickUp {
  if (!token) throw new Error("token do ClickUp ausente");
  const f = opcoes.fetch ?? fetch;
  const agora = opcoes.agora ?? (() => Date.now());
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));

  async function chamar<T>(caminho: string, init: RequestInit): Promise<T> {
    for (let tentativa = 0; ; tentativa++) {
      const r = await f(`${CLICKUP_BASE}${caminho}`, {
        ...init,
        headers: { Authorization: token, "Content-Type": "application/json" },
      });
      if (r.ok) {
        const texto = await r.text();
        return (texto ? JSON.parse(texto) : {}) as T;
      }
      if (r.status === 429 && tentativa < TENTATIVAS_429) {
        await dormir(esperaApos429(r.headers, tentativa, agora()));
        continue;
      }
      let detalhe = "";
      try {
        const corpo = (await r.json()) as { err?: string; ECODE?: string };
        detalhe = [corpo.err, corpo.ECODE].filter(Boolean).join(" · ");
      } catch {
        // corpo sem JSON: fica só o status
      }
      throw new ErroClickUp(r.status, caminho, detalhe);
    }
  }

  return {
    ler: <T>(caminho: string) => chamar<T>(caminho, { method: "GET" }),
    enviar: <T>(caminho: string, metodo: "POST" | "PUT" | "DELETE", corpo?: unknown) =>
      chamar<T>(caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
  };
}

/**
 * Todas as tarefas de um space, com subtarefas e fechadas, página a página. Passar do teto é
 * erro: devolver metade das tarefas como se fosse o todo é o defeito que o Growth tinha.
 */
export async function lerTarefasDoSpace(
  c: ClienteClickUp,
  { teamId = TEAM_EXPANSAO, spaceId = SPACE_EXPANSAO, tetoPaginas = TETO_PAGINAS } = {},
): Promise<TarefaBruta[]> {
  const todas: TarefaBruta[] = [];
  for (let page = 0; page < tetoPaginas; page++) {
    const qs = new URLSearchParams({
      "space_ids[]": spaceId,
      subtasks: "true",
      include_closed: "true",
      page: String(page),
      order_by: "created",
    });
    const r = await c.ler<{ tasks?: TarefaBruta[]; last_page?: boolean }>(`/team/${teamId}/task?${qs}`);
    const tarefas = r.tasks ?? [];
    todas.push(...tarefas);
    if (r.last_page === true || tarefas.length === 0) return todas;
  }
  throw new Error(`ClickUp: mais de ${tetoPaginas} páginas de tarefas no space ${spaceId}; leitura interrompida`);
}

/** Pastas com as listas (e os status de cada lista) e as listas soltas do space. */
export async function lerEstruturaDoSpace(
  c: ClienteClickUp,
  spaceId = SPACE_EXPANSAO,
): Promise<{ pastas: PastaBruta[]; listasSoltas: PastaBruta["lists"] }> {
  const [{ folders }, soltas] = await Promise.all([
    c.ler<{ folders: PastaBruta[] }>(`/space/${spaceId}/folder?archived=false`),
    c.ler<{ lists: PastaBruta["lists"] }>(`/space/${spaceId}/list?archived=false`),
  ]);
  return { pastas: folders ?? [], listasSoltas: soltas.lists ?? [] };
}

export async function lerCamposDaLista(c: ClienteClickUp, listaId: string): Promise<CampoBruto[]> {
  const r = await c.ler<{ fields?: CampoBruto[] }>(`/list/${listaId}/field`);
  return r.fields ?? [];
}

export async function lerCamposDoSpace(c: ClienteClickUp, spaceId = SPACE_EXPANSAO): Promise<CampoBruto[]> {
  const r = await c.ler<{ fields?: CampoBruto[] }>(`/space/${spaceId}/field`);
  return r.fields ?? [];
}

export interface MembroLista {
  id: number;
  username: string | null;
  email: string | null;
}

export async function lerMembrosDaLista(c: ClienteClickUp, listaId: string): Promise<MembroLista[]> {
  const r = await c.ler<{ members?: { id: number; username?: string; email?: string }[] }>(
    `/list/${listaId}/member`,
  );
  return (r.members ?? []).map((m) => ({ id: m.id, username: m.username ?? null, email: m.email ?? null }));
}
