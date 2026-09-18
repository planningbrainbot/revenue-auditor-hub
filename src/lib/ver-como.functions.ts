import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Ver como" uma unidade: o super admin olhando a plataforma pelos olhos do
 * sócio regional.
 *
 * Pedido do dono em 18/09/2026. O problema real é que o super admin não tem
 * como conferir o que entregou: o perfil dele não tem a área `minha_unidade`,
 * e todas as telas do sócio recortam por `scopedToOwnUnit && unidade` — duas
 * coisas que quem enxerga a rede inteira não tem. Perguntar ao sócio o que
 * está aparecendo na tela dele era a única forma de saber.
 *
 * O que a simulação troca: ÁREAS, CHAVES e a UNIDADE do recorte. O que ela não
 * troca: a identidade. A RLS continua lendo o `auth.uid()` real, e qualquer
 * gravação feita durante a simulação é do super admin, com o poder dele. Ver a
 * nota na migration `20260918160000_ver_como_unidade.sql` — trocar identidade
 * de verdade significaria emitir token de outra pessoa.
 *
 * A regra de quem pode mora no banco (`ops.ver_como_iniciar` confere o super
 * admin), não aqui. Esta camada só busca nomes e a lista de unidades.
 */

export type VerComo = {
  ativo: boolean;
  unidade_id?: number;
  unidade?: string;
  papel?: string;
  expira_em?: string;
  acesso?: { areas: string[]; permissions: string[] };
};

export type UnidadeParaVerComo = {
  id: number;
  nome: string;
  /** Quem de fato entra por esta unidade hoje, quando existe. */
  socio: string | null;
};

/** O que o app está simulando agora. `{ ativo: false }` quando nada. */
export const getVerComo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data, error } = await db.rpc("ver_como_atual");
    if (error) return { ativo: false } as VerComo;
    return (data ?? { ativo: false }) as VerComo;
  });

/**
 * As unidades que o super admin pode vestir.
 *
 * Traz junto o nome de quem hoje entra por aquela unidade. Não é enfeite: 12
 * das 14 unidades ainda não têm sócio com login, e a lista sem essa coluna faz
 * parecer que a simulação de Curitiba mostra "a tela do Fulano" quando não
 * existe Fulano nenhum — ela mostra o que o perfil de sócio regional alcança.
 */
export const listarUnidadesVerComo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [unidadesRes, escopoRes] = await Promise.all([
      db.from("unidades").select("id, nome_da_praca").order("nome_da_praca"),
      db.from("usuario_unidades").select("user_id, unidade_id"),
    ]);
    const unidades = (unidadesRes?.data ?? []) as { id: number; nome_da_praca: string }[];
    const vinculos = (escopoRes?.data ?? []) as { user_id: string; unidade_id: number }[];

    // Só conta como "o sócio da unidade" quem tem ESTA unidade e mais nenhuma:
    // quem carrega as 14 é gente da Matriz com escopo aberto, não o dono da
    // praça.
    const quantasUnidades = new Map<string, number>();
    for (const v of vinculos)
      quantasUnidades.set(v.user_id, (quantasUnidades.get(v.user_id) ?? 0) + 1);
    const soDaUnidade = vinculos.filter((v) => quantasUnidades.get(v.user_id) === 1);

    const nomes = new Map<string, string>();
    if (soDaUnidade.length) {
      const { data: perfis } = await db
        .from("profiles")
        .select("user_id, nome, email")
        .in(
          "user_id",
          soDaUnidade.map((v) => v.user_id),
        );
      for (const p of (perfis ?? []) as {
        user_id: string;
        nome: string | null;
        email: string | null;
      }[]) {
        nomes.set(p.user_id, p.nome || p.email || "");
      }
    }
    const socioPorUnidade = new Map<number, string>();
    for (const v of soDaUnidade) {
      const nome = nomes.get(v.user_id);
      if (nome) socioPorUnidade.set(v.unidade_id, nome);
    }

    return unidades.map<UnidadeParaVerComo>((u) => ({
      id: u.id,
      nome: u.nome_da_praca,
      socio: socioPorUnidade.get(u.id) ?? null,
    }));
  });

export const iniciarVerComo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { unidadeId: number; papel?: string }) => {
    const unidadeId = Number(input?.unidadeId);
    if (!Number.isInteger(unidadeId) || unidadeId <= 0) throw new Error("Unidade inválida.");
    return { unidadeId, papel: (input?.papel ?? "socio_regional").trim() };
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: atual, error } = await db.rpc("ver_como_iniciar", {
      _unidade_id: data.unidadeId,
      _papel: data.papel,
    });
    if (error) throw new Error(error.message || "Não foi possível entrar na visão da unidade.");
    return (atual ?? { ativo: false }) as VerComo;
  });

export const encerrarVerComo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { error } = await db.rpc("ver_como_encerrar");
    if (error) throw new Error(error.message || "Não foi possível sair da visão da unidade.");
    return { ativo: false } as VerComo;
  });
