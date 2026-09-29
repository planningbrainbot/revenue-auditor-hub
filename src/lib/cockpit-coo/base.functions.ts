// Carga comum do Cockpit do COO: o que todo tema mostra além dos próprios números.
// - unidades (o perímetro);
// - a foto diária de OKR (growth.okr_snapshot), para a evolução por departamento;
// - os compromissos da Rotina Semanal (espelho do ClickUp) e o histórico de mudanças;
// - a saúde da integração com o ClickUp (monitor e última rodada).
//
// Leitura com a sessão da pessoa (RLS). O espelho só é legível por quem tem a área cockpit_coo.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { todasAsPaginas } from "../cockpit-ceo/paginar.ts";
import { abrirContextoCoo, motivoDoErro } from "./contexto.server.ts";
import type { ContextoCoo } from "./contexto.server.ts";
import type { LinhaEspelho, LinhaEvento } from "./compromissos.ts";
import type { LinhaSnapshot } from "./okrs.ts";
import type { UnidadeCoo } from "./unidades.ts";
import type { Estado } from "./contrato.ts";

export type Parte<T> = { ok: true; dado: T } | { ok: false; estado: Estado; motivo: string };

export interface SaudeClickUp {
  /** Última rodada da sincronização com sucesso há menos de uma hora. */
  conectado: boolean;
  ultimaRodada: { em: string; status: string; tarefas: number | null; erro: string | null } | null;
}

export interface BaseCoo {
  hoje: string;
  lidoEm: string;
  unidades: UnidadeCoo[];
  okrs: Parte<LinhaSnapshot[]>;
  compromissos: Parte<{ linhas: LinhaEspelho[]; eventos: LinhaEvento[] }>;
  clickup: SaudeClickUp;
}

/** Janela da evolução de OKR: o ciclo começou em 01/08/2026. */
export const OKR_DESDE = "2026-08-01";

/** A leitura sem o transporte: a tela e o tema de sexta usam a mesma. */
export async function lerBaseCoo(ctx: ContextoCoo): Promise<BaseCoo> {
    const { db } = ctx;

    const [okrs, linhas, eventos, rodada] = await Promise.all([
      todasAsPaginas((de, ate) =>
        db
          .schema("growth")
          .from("okr_snapshot")
          .select("dia, kr_id, departamento, objetivo, kr_nome, progresso, origem")
          .gte("dia", OKR_DESDE)
          .order("dia")
          .order("kr_id")
          .range(de, ate),
      ).then(
        (d) => ({ ok: true as const, dado: d as LinhaSnapshot[] }),
        (e) => ({ ok: false as const, estado: "fonte_indisponivel" as Estado, motivo: motivoDoErro("OKRs", e) }),
      ),
      todasAsPaginas((de, ate) =>
        db
          .from("clickup_tarefas")
          .select("*")
          .is("ausente_desde", null)
          .ilike("pasta_nome", "Rotina Semanal%")
          .order("id")
          .range(de, ate),
      ).then(
        (d) => ({ ok: true as const, dado: d as LinhaEspelho[] }),
        (e) => ({ ok: false as const, erro: e }),
      ),
      todasAsPaginas((de, ate) =>
        db
          .from("clickup_eventos")
          .select("tarefa_id, tipo, de, para, em")
          .in("tipo", ["prazo", "concluida", "reaberta", "dono"])
          .order("id")
          .range(de, ate),
      ).then(
        (d) => ({ ok: true as const, dado: d as LinhaEvento[] }),
        (e) => ({ ok: false as const, erro: e }),
      ),
      db
        // integracoes_config não é legível por quem não é admin; o log da sincronização é.
        .from("sync_log")
        .select("executado_em, status, total_registros, detalhes")
        .eq("fonte", "clickup")
        .order("executado_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const compromissos: BaseCoo["compromissos"] =
      linhas.ok && eventos.ok
        ? { ok: true, dado: { linhas: linhas.dado, eventos: eventos.dado } }
        : {
            ok: false,
            estado: "fonte_indisponivel",
            motivo: motivoDoErro("compromissos", (linhas.ok ? null : linhas.erro) ?? (eventos.ok ? null : eventos.erro)),
          };

    const r = rodada?.data as
      | { executado_em: string; status: string; total_registros: number | null; detalhes: { erro?: string } | null }
      | null
      | undefined;
    return {
      hoje: ctx.hoje,
      lidoEm: ctx.lidoEm,
      unidades: ctx.unidades,
      okrs,
      compromissos,
      clickup: {
        conectado:
          r?.status === "sucesso" && Date.now() - Date.parse(r.executado_em) < 60 * 60_000,
        ultimaRodada: r
          ? { em: r.executado_em, status: r.status, tarefas: r.total_registros, erro: r.detalhes?.erro ?? null }
          : null,
      },
    };
}

export const carregarBaseCoo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaseCoo> => lerBaseCoo(await abrirContextoCoo(context)));
