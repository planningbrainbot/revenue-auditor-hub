import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// Produto de liderança do Planning People (migration 69, no repo do wiki):
// pulso de sentimento, prioridades da semana, elogios e cadência de 1:1.
//
// Como no resto do módulo, O ISOLAMENTO NÃO MORA AQUI. Quem recorta é a RLS:
// unidade em policy RESTRICTIVE, hierarquia por `e_gestor_de()`. A tela faz
// `select` simples e confia no banco, para não existirem duas réguas que podem
// divergir.
//
// Por que estes quatro vieram juntos: são o que a rede de fato usa. No
// inventário da conta do Qulture, em 22/09/2026, havia 1.237 sentimentos
// respondidos e 360 grupos de prioridade preenchidos, contra 3 ciclos de
// avaliação. Uso manda mais do que valor percebido.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface SentimentoRow {
  id: number;
  pessoaId: number;
  pessoaNome: string | null;
  periodoEm: string;
  rate: string | null;
  comentario: string | null;
  souEu: boolean;
}

export interface PrioridadeRow {
  id: number;
  pessoaId: number;
  pessoaNome: string | null;
  periodoEm: string;
  prioridades: string[];
  souEu: boolean;
}

export interface CadenciaRow {
  gestorId: number;
  lideradoId: number;
  lideradoNome: string | null;
  intervaloDias: number;
  ultimoEm: string | null;
  diasDesde: number | null;
  atrasado: boolean;
}

export interface ElogioRow {
  id: number;
  texto: string;
  criadoEm: string;
  deNome: string | null;
  paraNomes: string[];
  souAutor: boolean;
}

export interface PessoaOpcao {
  id: number;
  nome: string;
  cargo: string | null;
}

export interface LiderancaResult {
  minhaPessoaId: number | null;
  podeLideranca: boolean;
  podeElogios: boolean;
  meusSentimentos: SentimentoRow[];
  sentimentosDoTime: SentimentoRow[];
  minhasPrioridades: PrioridadeRow[];
  prioridadesDoTime: PrioridadeRow[];
  cadencias: CadenciaRow[];
  elogios: ElogioRow[];
  meuTime: PessoaOpcao[];
  pessoasDaUnidade: PessoaOpcao[];
}

// Segunda-feira da semana de uma data. O pulso é semanal: sem uma âncora, cada
// pessoa responderia num dia e o mesmo humor viraria duas linhas.
export function segundaDaSemana(base = new Date()): string {
  const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
  const diaDaSemana = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (diaDaSemana - 1));
  return d.toISOString().slice(0, 10);
}

async function contexto(supabase: Cliente, userId: string) {
  const acesso = await acessoDoUsuario(supabase, userId);
  const euRes = await supabase
    .from("gente_pessoas")
    .select("id,unidade_id")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    chaves: acesso.permissions as string[],
    eu: (euRes?.data as { id: number; unidade_id: number | null } | null) ?? null,
  };
}

export const listLideranca = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LiderancaResult> => {
    const supabase = context.supabase as Cliente;
    const { chaves, eu } = await contexto(supabase, context.userId);

    const vazio: LiderancaResult = {
      minhaPessoaId: eu?.id ?? null,
      podeLideranca: chaves.includes("view.gente.lideranca"),
      podeElogios: chaves.includes("view.gente.elogios"),
      meusSentimentos: [],
      sentimentosDoTime: [],
      minhasPrioridades: [],
      prioridadesDoTime: [],
      cadencias: [],
      elogios: [],
      meuTime: [],
      pessoasDaUnidade: [],
    };
    if (!eu) return vazio;

    const [sentRes, priRes, cadRes, eloRes, destRes, pessoasRes] = await Promise.all([
      supabase
        .from("gente_sentimentos")
        .select("id,pessoa_id,periodo_em,rate,comentario")
        .order("periodo_em", { ascending: false })
        .limit(400),
      supabase
        .from("gente_prioridades")
        .select("id,pessoa_id,periodo_em,prioridades")
        .order("periodo_em", { ascending: false })
        .limit(400),
      supabase.from("v_gente_1a1_atraso").select("*"),
      supabase
        .from("gente_elogios")
        .select("id,de_id,texto,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("gente_elogio_destinatarios").select("elogio_id,pessoa_id"),
      supabase
        .from("gente_diretorio")
        .select("id,nome_completo,cargo,gestor_id,status")
        .eq("status", "ativo")
        .order("nome_completo"),
    ]);

    type PessoaLinha = {
      id: number;
      nome_completo: string;
      cargo: string | null;
      gestor_id: number | null;
    };
    const pessoas = (pessoasRes?.data ?? []) as PessoaLinha[];
    const nomePor = new Map(pessoas.map((p) => [p.id, p.nome_completo]));

    const paraSentimento = (linha: {
      id: number;
      pessoa_id: number;
      periodo_em: string;
      rate: string | null;
      comentario: string | null;
    }): SentimentoRow => ({
      id: linha.id,
      pessoaId: linha.pessoa_id,
      pessoaNome: nomePor.get(linha.pessoa_id) ?? null,
      periodoEm: linha.periodo_em,
      rate: linha.rate,
      comentario: linha.comentario,
      souEu: linha.pessoa_id === eu.id,
    });

    const sentimentos = ((sentRes?.data ?? []) as Parameters<typeof paraSentimento>[0][]).map(
      paraSentimento,
    );

    const paraPrioridade = (linha: {
      id: number;
      pessoa_id: number;
      periodo_em: string;
      prioridades: string[] | null;
    }): PrioridadeRow => ({
      id: linha.id,
      pessoaId: linha.pessoa_id,
      pessoaNome: nomePor.get(linha.pessoa_id) ?? null,
      periodoEm: linha.periodo_em,
      prioridades: linha.prioridades ?? [],
      souEu: linha.pessoa_id === eu.id,
    });

    const prioridades = ((priRes?.data ?? []) as Parameters<typeof paraPrioridade>[0][]).map(
      paraPrioridade,
    );

    const destinatarios = (eloRes?.data ? (destRes?.data ?? []) : []) as {
      elogio_id: number;
      pessoa_id: number;
    }[];
    const elogios = (
      (eloRes?.data ?? []) as {
        id: number;
        de_id: number;
        texto: string;
        created_at: string;
      }[]
    ).map((linha) => ({
      id: linha.id,
      texto: linha.texto,
      criadoEm: linha.created_at,
      deNome: nomePor.get(linha.de_id) ?? null,
      paraNomes: destinatarios
        .filter((d) => d.elogio_id === linha.id)
        .map((d) => nomePor.get(d.pessoa_id) ?? "")
        .filter(Boolean),
      souAutor: linha.de_id === eu.id,
    }));

    const cadencias = (
      (cadRes?.data ?? []) as {
        gestor_id: number;
        liderado_id: number;
        intervalo_dias: number;
        ultimo_em: string | null;
        dias_desde: number | null;
        atrasado: boolean;
      }[]
    ).map((linha) => ({
      gestorId: linha.gestor_id,
      lideradoId: linha.liderado_id,
      lideradoNome: nomePor.get(linha.liderado_id) ?? null,
      intervaloDias: linha.intervalo_dias,
      ultimoEm: linha.ultimo_em,
      diasDesde: linha.dias_desde,
      atrasado: linha.atrasado,
    }));

    const opcao = (p: PessoaLinha): PessoaOpcao => ({
      id: p.id,
      nome: p.nome_completo,
      cargo: p.cargo,
    });

    return {
      ...vazio,
      meusSentimentos: sentimentos.filter((s) => s.souEu).slice(0, 12),
      sentimentosDoTime: sentimentos.filter((s) => !s.souEu),
      minhasPrioridades: prioridades.filter((p) => p.souEu).slice(0, 8),
      prioridadesDoTime: prioridades.filter((p) => !p.souEu),
      cadencias,
      elogios,
      meuTime: pessoas.filter((p) => p.gestor_id === eu.id).map(opcao),
      pessoasDaUnidade: pessoas.filter((p) => p.id !== eu.id).map(opcao),
    };
  });

export const registrarSentimento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { rate: string; comentario?: string | null; periodoEm?: string }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!eu) throw new Error("Seu usuário não está no cadastro de gente da rede.");

    // `upsert` na chave natural: responder de novo na mesma semana corrige a
    // resposta, não cria uma segunda.
    const { error } = await supabase.from("gente_sentimentos").upsert(
      {
        pessoa_id: eu.id,
        periodo_em: data.periodoEm ?? segundaDaSemana(),
        respondido_em: new Date().toISOString().slice(0, 10),
        rate: data.rate,
        comentario: data.comentario || null,
      },
      { onConflict: "pessoa_id,periodo_em" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const salvarPrioridades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { pessoaId?: number; prioridades: string[]; periodoEm?: string }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!eu) throw new Error("Seu usuário não está no cadastro de gente da rede.");

    const limpas = data.prioridades
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 5);
    const { error } = await supabase.from("gente_prioridades").upsert(
      {
        pessoa_id: data.pessoaId ?? eu.id,
        periodo_em: data.periodoEm ?? segundaDaSemana(),
        prioridades: limpas,
        maximo: 3,
        atualizado_por_id: eu.id,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "pessoa_id,periodo_em" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const salvarCadencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { lideradoId: number; intervaloDias: number; ativa?: boolean }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!eu) throw new Error("Seu usuário não está no cadastro de gente da rede.");

    const { error } = await supabase.from("gente_um_a_um_cadencia").upsert(
      {
        gestor_id: eu.id,
        liderado_id: data.lideradoId,
        intervalo_dias: Math.min(365, Math.max(1, Math.round(data.intervaloDias))),
        ativa: data.ativa ?? true,
      },
      { onConflict: "gestor_id,liderado_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const publicarElogio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { paraIds: number[]; texto: string }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    if (!eu) throw new Error("Seu usuário não está no cadastro de gente da rede.");
    if (!data.texto.trim()) throw new Error("Escreva o elogio.");
    if (!data.paraIds.length) throw new Error("Escolha pelo menos uma pessoa.");

    // O INSERT com `.select()` exige policy de SELECT além da de INSERT, e aqui
    // ela existe (o autor sempre lê o próprio elogio).
    const { data: criado, error } = await supabase
      .from("gente_elogios")
      .insert({ de_id: eu.id, texto: data.texto.trim(), publico: true })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const vinculos = data.paraIds.map((pessoaId) => ({
      elogio_id: (criado as { id: number }).id,
      pessoa_id: pessoaId,
    }));
    const { error: erroVinculo } = await supabase
      .from("gente_elogio_destinatarios")
      .insert(vinculos);
    if (erroVinculo) throw new Error(erroVinculo.message);
    return { ok: true };
  });
