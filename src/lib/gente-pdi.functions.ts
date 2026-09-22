import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// PDI, plano de desenvolvimento individual (migration 72, no repo do wiki).
//
// Entrou em 22/09/2026, depois de o inventário da conta do Qulture mostrar
// 1 ciclo ativo, 215 planos, 32 metas e 54 ações escritas por gente da rede.
// O plano original deixava PDI de fora; o dado real mudou a decisão.
//
// Régua igual à do 1:1: a pessoa e a cadeia de gestores dela, mais quem
// administra o produto. Sócio-diretor não lê o PDI do time só por ser dono da
// unidade.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export const PROGRESSO_ORDEM = [
  "nao_iniciada",
  "em_andamento",
  "avancada",
  "concluida",
  "cancelada",
] as const;

export interface AcaoRow {
  id: number;
  metaId: number;
  titulo: string;
  descricao: string | null;
  categoria: string | null;
  progresso: string;
  prazo: string | null;
  atrasada: boolean;
}

export interface MetaRow {
  id: number;
  pdiId: number;
  titulo: string;
  descricao: string | null;
  progresso: string;
  acoes: AcaoRow[];
}

export interface PdiRow {
  id: number;
  cicloId: number;
  cicloNome: string;
  pessoaId: number;
  pessoaNome: string | null;
  souEu: boolean;
  metas: MetaRow[];
}

export interface AndamentoRow {
  pdiId: number;
  pessoaNome: string;
  metas: number;
  metasConcluidas: number;
  acoes: number;
  acoesConcluidas: number;
  acoesAtrasadas: number;
}

export interface PdiResult {
  minhaPessoaId: number | null;
  podeVer: boolean;
  podeAdministrar: boolean;
  ciclos: { id: number; nome: string; status: string }[];
  planos: PdiRow[];
  andamento: AndamentoRow[];
}

async function contexto(supabase: Cliente, userId: string) {
  const acesso = await acessoDoUsuario(supabase, userId);
  const euRes = await supabase
    .from("gente_pessoas")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    chaves: acesso.permissions as string[],
    eu: (euRes?.data as { id: number } | null) ?? null,
  };
}

export const listPdi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PdiResult> => {
    const supabase = context.supabase as Cliente;
    const { chaves, eu } = await contexto(supabase, context.userId);

    const vazio: PdiResult = {
      minhaPessoaId: eu?.id ?? null,
      podeVer: chaves.includes("view.gente.pdi"),
      podeAdministrar: chaves.includes("manage.gente.pdi"),
      ciclos: [],
      planos: [],
      andamento: [],
    };
    if (!vazio.podeVer) return vazio;

    const [ciclosRes, planosRes, andamentoRes, pessoasRes] = await Promise.all([
      supabase.from("gente_pdi_ciclos").select("id,nome,status").order("id", { ascending: false }),
      supabase.from("gente_pdi").select("id,ciclo_id,pessoa_id"),
      supabase.from("v_gente_pdi_andamento").select("*"),
      supabase.from("gente_pessoas").select("id,nome_completo"),
    ]);

    const planosBrutos = (planosRes?.data ?? []) as {
      id: number;
      ciclo_id: number;
      pessoa_id: number;
    }[];
    const ids = planosBrutos.map((p) => p.id);

    const [metasRes, acoesRes] = await Promise.all([
      ids.length
        ? supabase
            .from("gente_pdi_metas")
            .select("id,pdi_id,titulo,descricao,progresso,arquivada")
            .in("pdi_id", ids)
        : Promise.resolve({ data: [] }),
      supabase
        .from("gente_pdi_acoes")
        .select("id,meta_id,titulo,descricao,categoria,progresso,prazo,arquivada"),
    ]);

    const metas = (
      (metasRes?.data ?? []) as {
        id: number;
        pdi_id: number;
        titulo: string;
        descricao: string | null;
        progresso: string;
        arquivada: boolean;
      }[]
    ).filter((m) => !m.arquivada);
    const acoes = (
      (acoesRes?.data ?? []) as {
        id: number;
        meta_id: number;
        titulo: string;
        descricao: string | null;
        categoria: string | null;
        progresso: string;
        prazo: string | null;
        arquivada: boolean;
      }[]
    ).filter((a) => !a.arquivada);

    const hoje = new Date().toISOString().slice(0, 10);
    const nomePor = new Map(
      ((pessoasRes?.data ?? []) as { id: number; nome_completo: string }[]).map((p) => [
        p.id,
        p.nome_completo,
      ]),
    );
    const ciclos = ((ciclosRes?.data ?? []) as { id: number; nome: string; status: string }[]).map(
      (c) => ({ id: c.id, nome: c.nome, status: c.status }),
    );

    const planos: PdiRow[] = planosBrutos
      .map((plano) => ({
        id: plano.id,
        cicloId: plano.ciclo_id,
        cicloNome: ciclos.find((c) => c.id === plano.ciclo_id)?.nome ?? "",
        pessoaId: plano.pessoa_id,
        pessoaNome: nomePor.get(plano.pessoa_id) ?? null,
        souEu: plano.pessoa_id === eu?.id,
        metas: metas
          .filter((m) => m.pdi_id === plano.id)
          .map((m) => ({
            id: m.id,
            pdiId: m.pdi_id,
            titulo: m.titulo,
            descricao: m.descricao,
            progresso: m.progresso,
            acoes: acoes
              .filter((a) => a.meta_id === m.id)
              .map((a) => ({
                id: a.id,
                metaId: a.meta_id,
                titulo: a.titulo,
                descricao: a.descricao,
                categoria: a.categoria,
                progresso: a.progresso,
                prazo: a.prazo,
                atrasada: Boolean(a.prazo && a.prazo < hoje && a.progresso !== "concluida"),
              })),
          })),
      }))
      // plano vazio de gente que nunca escreveu nada só polui a tela: o Qulture
      // abriu um para cada uma das 215 pessoas e só 19 têm meta.
      .filter((p) => p.souEu || p.metas.length > 0);

    const andamento = (
      (andamentoRes?.data ?? []) as {
        pdi_id: number;
        nome_completo: string;
        metas: number;
        metas_concluidas: number;
        acoes: number;
        acoes_concluidas: number;
        acoes_atrasadas: number;
      }[]
    )
      .filter((a) => a.metas > 0)
      .map((a) => ({
        pdiId: a.pdi_id,
        pessoaNome: a.nome_completo,
        metas: a.metas,
        metasConcluidas: a.metas_concluidas,
        acoes: a.acoes,
        acoesConcluidas: a.acoes_concluidas,
        acoesAtrasadas: a.acoes_atrasadas,
      }));

    return { ...vazio, ciclos, planos, andamento };
  });

export const criarPdi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { cicloId: number }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!eu) throw new Error("Seu usuário não está no cadastro de gente da rede.");
    const { error } = await supabase
      .from("gente_pdi")
      .upsert({ ciclo_id: data.cicloId, pessoa_id: eu.id }, { onConflict: "ciclo_id,pessoa_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const salvarMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (dados: {
      id?: number;
      pdiId: number;
      titulo: string;
      descricao?: string | null;
      progresso?: string;
    }) => dados,
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!data.titulo.trim()) throw new Error("A meta precisa de um título.");

    const linha = {
      pdi_id: data.pdiId,
      titulo: data.titulo.trim(),
      descricao: data.descricao || null,
      progresso: data.progresso ?? "nao_iniciada",
      autor_id: eu?.id ?? null,
    };
    const { error } = data.id
      ? await supabase.from("gente_pdi_metas").update(linha).eq("id", data.id)
      : await supabase.from("gente_pdi_metas").insert(linha);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const salvarAcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (dados: {
      id?: number;
      metaId: number;
      titulo: string;
      prazo?: string | null;
      progresso?: string;
    }) => dados,
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!data.titulo.trim()) throw new Error("A ação precisa de um título.");

    const linha = {
      meta_id: data.metaId,
      titulo: data.titulo.trim(),
      prazo: data.prazo || null,
      progresso: data.progresso ?? "nao_iniciada",
      concluida_em: data.progresso === "concluida" ? new Date().toISOString().slice(0, 10) : null,
      autor_id: eu?.id ?? null,
    };
    const { error } = data.id
      ? await supabase.from("gente_pdi_acoes").update(linha).eq("id", data.id)
      : await supabase.from("gente_pdi_acoes").insert(linha);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const mudarProgressoAcao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { id: number; progresso: string }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { error } = await supabase
      .from("gente_pdi_acoes")
      .update({
        progresso: data.progresso,
        concluida_em: data.progresso === "concluida" ? new Date().toISOString().slice(0, 10) : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
