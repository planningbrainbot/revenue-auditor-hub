import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { montarCoortes } from "./coortes";
import type { ChurnCoorte, ContratoCoorte, RespostaRetencao } from "./coortes";

// Coortes de retenção, lidas com a sessão da pessoa (RLS de contratos e da Central de Tratativas) e
// calculadas AQUI: para a tela vai só a matriz agregada, nenhum negócio nem cliente.
// Exige enxergar todas as unidades — coorte da rede com recorte parcial seria retenção de outra
// população.

const PAGINA = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = (de: number, ate: number) => PromiseLike<{ data: any[] | null; error: any }>;

async function todas(consulta: Consulta) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return linhas;
    if (linhas.length >= 50_000) throw new Error("a leitura passou de 50 mil linhas");
  }
}

export const carregarRetencaoCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RespostaRetencao> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const lidoEm = new Date().toISOString();
    const [acesso, escopo] = await Promise.all([
      acessoDoUsuario(db, userId),
      db.from("usuario_escopo").select("todas_unidades").eq("user_id", userId).maybeSingle(),
    ]);
    if (!acesso.areas.includes("cockpit_ceo"))
      throw new Error("Acesso negado: sua conta não tem a área Cockpit do CEO.");
    if (!escopo?.data?.todas_unidades)
      return {
        estado: "acesso_insuficiente",
        motivo: "A coorte da rede exige ver todas as unidades; seu escopo é por unidade.",
        lidoEm,
      };
    try {
      const [contratos, churns, unidades] = await Promise.all([
        todas((de, ate) =>
          db
            .from("contratos")
            .select("pipedrive_deal_id, ganho_em, unidade, origem_pipeline")
            .not("pipedrive_deal_id", "is", null)
            .order("id")
            .range(de, ate),
        ),
        todas((de, ate) =>
          db
            .from("central_tratativas")
            .select("pipedrive_deal_id, data_churn")
            // Mesmo critério da tela de Clientes: status derivado da fase, não do nome.
            .eq("status", "lost")
            .order("id")
            .range(de, ate),
        ),
        db.from("unidades").select("nome_da_praca").eq("tipo", "regional"),
      ]);
      if (unidades.error) throw unidades.error;
      if (!contratos.length)
        return {
          estado: "acesso_insuficiente",
          motivo: "Nenhum contrato ganho é visível para a sua conta.",
          lidoEm,
        };
      const coortes = montarCoortes({
        contratos: contratos.map((c): ContratoCoorte => ({
          deal: String(c.pipedrive_deal_id),
          ganho_em: String(c.ganho_em ?? ""),
          unidade: c.unidade ?? null,
          origem: c.origem_pipeline ?? null,
        })),
        churns: churns
          .filter((c) => c.pipedrive_deal_id !== null)
          .map((c): ChurnCoorte => ({
            deal: String(c.pipedrive_deal_id),
            data_churn: c.data_churn ?? null,
          })),
        regionais: ((unidades.data ?? []) as { nome_da_praca: string }[]).map(
          (u) => u.nome_da_praca,
        ),
        hoje: hojeSaoPaulo(),
      });
      return { estado: "ok", coortes, lidoEm };
    } catch (e) {
      console.error("[cockpit-ceo] retenção:", e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const codigo = (e as any)?.code;
      return {
        estado: "fonte_indisponivel",
        motivo: `A leitura de contratos e churn falhou${codigo ? ` (código ${codigo})` : ""}.`,
        lidoEm,
      };
    }
  });
