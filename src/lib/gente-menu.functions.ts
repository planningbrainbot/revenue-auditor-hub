import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// Quais módulos do Planning People fazem sentido para esta pessoa.
//
// Por que não dá para resolver isso com permissão: desde 15/09/2026 a ÁREA
// concede todas as chaves dela. Quem tem `people` tem `view.gente.pdi`,
// `manage.gente.avaliacao` e o resto, então `can()` responde `true` para todo
// mundo e não filtra nada.
//
// O que separa um colaborador da pessoa que implanta o módulo na rede não é
// permissão, é FATO: ela lidera alguém? está em algum ciclo? tem PDI aberto?
// enxerga mais de uma unidade? É isso que este resumo responde, e é ele que
// decide o que aparece no menu.
//
// Pedido da Heloísa em 22/09/2026: voltar a ver os módulos separados na lateral,
// como no Qulture, para entrar direto no que quer. Ela usa os oito; o
// colaborador usa três. Os dois são atendidos pelo mesmo menu porque o menu
// deixou de ser igual para todo mundo.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface ResumoMenuGente {
  /** Tem linha em `gente_pessoas`. Sem isso quase nada do módulo funciona. */
  noCadastro: boolean;
  lideraAlguem: boolean;
  emCiclo: boolean;
  temPdi: boolean;
  /** Conduz ciclo, pesquisa ou PDI: vê os módulos de operação. */
  administra: boolean;
  /** Enxerga mais de uma unidade: é quem implanta e acompanha adoção. */
  redeInteira: boolean;
}

export const resumoMenuGente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResumoMenuGente> => {
    const supabase = context.supabase as Cliente;
    const acesso = await acessoDoUsuario(supabase, context.userId);
    const chaves = acesso.permissions as string[];

    const euRes = await supabase
      .from("gente_pessoas")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const eu = (euRes?.data as { id: number } | null) ?? null;

    const vazio: ResumoMenuGente = {
      noCadastro: false,
      lideraAlguem: false,
      emCiclo: false,
      temPdi: false,
      administra:
        chaves.includes("manage.gente.avaliacao") ||
        chaves.includes("manage.gente.clima") ||
        chaves.includes("manage.gente.pdi"),
      // `data.scope.own_unit_only` é a trava de unidade. Quem não a tem enxerga
      // a rede, e é para essa pessoa que a tabela de adoção existe.
      redeInteira: !chaves.includes("data.scope.own_unit_only"),
    };
    if (!eu) return vazio;

    // `head: true` com `count` não traz linha, só o número: o menu não precisa
    // do dado, precisa do sim ou não.
    const [timeRes, cicloRes, pdiRes] = await Promise.all([
      supabase
        .from("gente_pessoas")
        .select("id", { count: "exact", head: true })
        .eq("gestor_id", eu.id)
        .eq("status", "ativo"),
      supabase
        .from("gente_avaliacoes")
        .select("id", { count: "exact", head: true })
        .or(`avaliador_id.eq.${eu.id},avaliado_id.eq.${eu.id}`),
      supabase
        .from("gente_pdi")
        .select("id", { count: "exact", head: true })
        .eq("pessoa_id", eu.id),
    ]);

    return {
      ...vazio,
      noCadastro: true,
      lideraAlguem: (timeRes?.count ?? 0) > 0,
      emCiclo: (cicloRes?.count ?? 0) > 0,
      temPdi: (pdiRes?.count ?? 0) > 0,
    };
  });
