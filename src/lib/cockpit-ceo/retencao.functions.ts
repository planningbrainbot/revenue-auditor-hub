import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { montarCoortes } from "./coortes";
import type { ChurnCoorte, ContratoCoorte, RespostaRetencao } from "./coortes";
import { todasAsPaginas } from "./paginar";
import { FONTES_COORTES, fontesSemAcesso, motivoSemAcesso } from "./portas";

// Coortes de retenção, lidas com a sessão da pessoa (RLS de contratos e da Central de Tratativas) e
// calculadas AQUI: para a tela vai só a matriz agregada, nenhum negócio nem cliente.
// Exige enxergar todas as unidades — coorte da rede com recorte parcial seria retenção de outra
// população — e passar na porta das três fontes: quem lê contratos mas não a Central de Tratativas
// veria "nenhum churn registrado", que é falta de acesso com cara de dado.

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
    if (escopo?.error) {
      console.error("[cockpit-ceo] escopo de acesso:", escopo.error);
      return {
        estado: "fonte_indisponivel",
        motivo: "Não foi possível ler seu escopo de acesso.",
        lidoEm,
      };
    }
    if (!escopo?.data?.todas_unidades)
      return {
        estado: "acesso_insuficiente",
        motivo: "A coorte da rede exige ver todas as unidades; seu escopo é por unidade.",
        lidoEm,
      };
    const faltam = fontesSemAcesso(FONTES_COORTES, acesso);
    if (faltam.length)
      return {
        estado: "acesso_insuficiente",
        motivo: `Sem coorte: ${motivoSemAcesso(faltam)}.`,
        lidoEm,
      };
    try {
      const [contratos, churns, unidades] = await Promise.all([
        todasAsPaginas(
          (de, ate) =>
            db
              .from("contratos")
              .select("id, pipedrive_deal_id, ganho_em, unidade, origem_pipeline")
              .not("pipedrive_deal_id", "is", null)
              .order("id")
              .range(de, ate),
          50_000,
        ),
        todasAsPaginas(
          (de, ate) =>
            db
              .from("central_tratativas")
              .select("id, pipedrive_deal_id, data_churn")
              // Mesmo critério da tela de Clientes: status derivado da fase, não do nome.
              .eq("status", "lost")
              .order("id")
              .range(de, ate),
          50_000,
        ),
        todasAsPaginas((de, ate) =>
          db.from("unidades").select("id, nome_da_praca, tipo").order("id").range(de, ate),
        ),
      ]);
      const nomes = (tipo: string) =>
        (unidades as { nome_da_praca: string | null; tipo: string | null }[])
          .filter((u) => u.tipo === tipo && u.nome_da_praca)
          .map((u) => u.nome_da_praca as string);
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
        regionais: nomes("regional"),
        internas: nomes("interna"),
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
