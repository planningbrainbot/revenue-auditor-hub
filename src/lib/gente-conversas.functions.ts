import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// 1:1 e feedback contínuo (migration 54, no repo do wiki).
//
// Como no cadastro, O ISOLAMENTO NÃO MORA AQUI. Quem recorta é a RLS, e aqui a
// régua é mais estreita que a do cadastro: `manage.gente` NÃO dá leitura de 1:1.
// Quem administra o cadastro precisa ver as pessoas, não a conversa entre um
// coordenador e um analista. Conferido em produção: o admin enxerga as 215
// pessoas e zero 1:1.
//
// A nota privada do gestor vive em tabela separada (`gente_um_a_um_nota_privada`)
// porque RLS esconde linha, não coluna. Assim "só o autor lê" é garantia do
// banco, e não de um `select` que alguém pode esquecer de filtrar numa tela nova.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface UmAUmRow {
  id: number;
  data: string;
  pauta: string | null;
  notas: string | null;
  proximosPassos: string | null;
  status: string;
  gestorId: number;
  lideradoId: number;
  gestorNome: string | null;
  lideradoNome: string | null;
  souGestor: boolean;
  notaPrivada: string | null;
}

export interface CoberturaRow {
  pessoaId: number;
  nome: string;
  ultimo1a1: string | null;
  diasSem1a1: number | null;
  totalRealizados: number;
}

export interface PessoaOpcao {
  id: number;
  nome: string;
  cargo: string | null;
}

export interface FeedbackRow {
  id: number;
  tipo: string;
  texto: string;
  visibilidade: string;
  competencia: string | null;
  criadoEm: string;
  deNome: string | null;
  paraNome: string | null;
  souAutor: boolean;
}

export interface ConversasResult {
  minhaPessoaId: number | null;
  podeUmAUm: boolean;
  podeFeedback: boolean;
  podeRegistrar: boolean;
  umAUm: UmAUmRow[];
  cobertura: CoberturaRow[];
  meuTime: PessoaOpcao[];
  pessoasDaUnidade: PessoaOpcao[];
  feedbackRecebido: FeedbackRow[];
  feedbackEnviado: FeedbackRow[];
}

// Lia `role_permissions`, que está congelada desde 15/09/2026 como retrato de
// rollback. A fonte é a mesma do resto do app.
async function chavesDoUsuario(supabase: Cliente, userId: string): Promise<string[]> {
  const acesso = await acessoDoUsuario(supabase, userId);
  return acesso.permissions;
}

export const listConversas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversasResult> => {
    const supabase = context.supabase as Cliente;
    const chaves = await chavesDoUsuario(supabase, context.userId);

    const euRes = await supabase
      .from("gente_pessoas")
      .select("id,unidade_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const eu = euRes?.data as { id: number; unidade_id: number | null } | null;

    const vazio: ConversasResult = {
      minhaPessoaId: eu?.id ?? null,
      podeUmAUm: chaves.includes("view.gente.um_a_um"),
      podeFeedback: chaves.includes("view.gente.feedback"),
      // Ver e registrar são chaves diferentes desde 17/09/2026. A RLS já barra
      // o INSERT sem esta; o campo existe para a tela esconder o formulário.
      podeRegistrar: chaves.includes("edit.gente.conversas"),
      umAUm: [],
      cobertura: [],
      meuTime: [],
      pessoasDaUnidade: [],
      feedbackRecebido: [],
      feedbackEnviado: [],
    };

    // Sem linha em `gente_pessoas` a pessoa não participa de 1:1 nem de
    // feedback, por mais permissão que tenha. Isso é intencional: quem não está
    // no cadastro da rede não tem gestor nem liderado.
    if (!eu) return vazio;

    const [conversasRes, notasRes, coberturaRes, timeRes, unidadeRes, fbRes] = await Promise.all([
      supabase
        .from("gente_um_a_um")
        .select("id,data,pauta,notas,proximos_passos,status,gestor_id,liderado_id")
        .order("data", { ascending: false })
        .limit(200),
      supabase.from("gente_um_a_um_nota_privada").select("um_a_um_id,texto"),
      supabase.from("v_gente_1a1_cobertura").select("*"),
      supabase
        .from("gente_diretorio")
        .select("id,nome_completo,cargo")
        .eq("gestor_id", eu.id)
        .eq("status", "ativo")
        .order("nome_completo"),
      eu.unidade_id
        ? supabase
            .from("gente_diretorio")
            .select("id,nome_completo,cargo")
            .eq("unidade_id", eu.unidade_id)
            .eq("status", "ativo")
            .neq("id", eu.id)
            .order("nome_completo")
        : Promise.resolve({ data: [] }),
      supabase
        .from("gente_feedback")
        .select("id,tipo,texto,visibilidade,competencia,created_at,de_id,para_id")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    type P = { id: number; nome_completo: string; cargo: string | null };
    const nomes = new Map<number, string>();
    for (const lista of [timeRes?.data ?? [], unidadeRes?.data ?? []] as P[][]) {
      for (const p of lista) nomes.set(p.id, p.nome_completo);
    }
    for (const c of (coberturaRes?.data ?? []) as { pessoa_id: number; nome_completo: string }[]) {
      nomes.set(c.pessoa_id, c.nome_completo);
    }

    const notaPorConversa = new Map<number, string>(
      ((notasRes?.data ?? []) as { um_a_um_id: number; texto: string | null }[]).map((n) => [
        n.um_a_um_id,
        n.texto ?? "",
      ]),
    );

    type C = {
      id: number;
      data: string;
      pauta: string | null;
      notas: string | null;
      proximos_passos: string | null;
      status: string;
      gestor_id: number;
      liderado_id: number;
    };
    const umAUm: UmAUmRow[] = ((conversasRes?.data ?? []) as C[]).map((c) => ({
      id: c.id,
      data: c.data,
      pauta: c.pauta,
      notas: c.notas,
      proximosPassos: c.proximos_passos,
      status: c.status,
      gestorId: c.gestor_id,
      lideradoId: c.liderado_id,
      gestorNome: nomes.get(c.gestor_id) ?? null,
      lideradoNome: nomes.get(c.liderado_id) ?? null,
      souGestor: c.gestor_id === eu.id,
      notaPrivada: notaPorConversa.get(c.id) ?? null,
    }));

    type F = {
      id: number;
      tipo: string;
      texto: string;
      visibilidade: string;
      competencia: string | null;
      created_at: string;
      de_id: number;
      para_id: number;
    };
    const todosFb = (fbRes?.data ?? []) as F[];
    const mapFb = (f: F): FeedbackRow => ({
      id: f.id,
      tipo: f.tipo,
      texto: f.texto,
      visibilidade: f.visibilidade,
      competencia: f.competencia,
      criadoEm: f.created_at,
      deNome: nomes.get(f.de_id) ?? null,
      paraNome: nomes.get(f.para_id) ?? null,
      souAutor: f.de_id === eu.id,
    });

    return {
      ...vazio,
      umAUm,
      cobertura: (
        (coberturaRes?.data ?? []) as {
          pessoa_id: number;
          nome_completo: string;
          ultimo_1a1: string | null;
          dias_sem_1a1: number | null;
          total_realizados: number;
        }[]
      )
        .map((c) => ({
          pessoaId: c.pessoa_id,
          nome: c.nome_completo,
          ultimo1a1: c.ultimo_1a1,
          diasSem1a1: c.dias_sem_1a1,
          totalRealizados: Number(c.total_realizados ?? 0),
        }))
        // quem nunca teve 1:1 vem primeiro: é a lista de trabalho, não um ranking
        .sort((a, b) => (b.diasSem1a1 ?? 99999) - (a.diasSem1a1 ?? 99999)),
      meuTime: ((timeRes?.data ?? []) as P[]).map((p) => ({
        id: p.id,
        nome: p.nome_completo,
        cargo: p.cargo,
      })),
      pessoasDaUnidade: ((unidadeRes?.data ?? []) as P[]).map((p) => ({
        id: p.id,
        nome: p.nome_completo,
        cargo: p.cargo,
      })),
      feedbackRecebido: todosFb.filter((f) => f.para_id === eu.id).map(mapFb),
      feedbackEnviado: todosFb.filter((f) => f.de_id === eu.id).map(mapFb),
    };
  });

export const salvarUmAUm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      lideradoId: number;
      data: string;
      pauta?: string;
      notas?: string;
      proximosPassos?: string;
      status?: string;
      notaPrivada?: string;
    }) => {
      if (!input?.lideradoId) throw new Error("Escolha com quem é o 1:1.");
      if (!input?.data) throw new Error("Informe a data.");
      const status = input.status ?? "realizado";
      if (!["agendado", "realizado", "cancelado"].includes(status)) {
        throw new Error("Status inválido.");
      }
      return { ...input, status };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const euRes = await supabase
      .from("gente_pessoas")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const euId = (euRes?.data as { id: number } | null)?.id;
    if (!euId) throw new Error("Seu usuário não está no cadastro de gente da rede.");
    if (euId === data.lideradoId) throw new Error("Não dá para marcar 1:1 consigo mesmo.");

    // O `select()` depois do insert exige policy de SELECT, que existe aqui.
    // Sem ela o erro 42501 culparia a policy de INSERT e despistaria.
    const { data: criado, error } = await supabase
      .from("gente_um_a_um")
      .insert({
        gestor_id: euId,
        liderado_id: data.lideradoId,
        data: data.data,
        pauta: data.pauta || null,
        notas: data.notas || null,
        proximos_passos: data.proximosPassos || null,
        status: data.status,
        criado_por: euId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const texto = (data.notaPrivada ?? "").trim();
    if (texto) {
      const { error: errNota } = await supabase
        .from("gente_um_a_um_nota_privada")
        .upsert({ um_a_um_id: criado.id, autor_id: euId, texto });
      if (errNota) throw new Error(errNota.message);
    }
    return { id: criado.id as number };
  });

export const enviarFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      paraId: number;
      tipo?: string;
      texto: string;
      visibilidade?: string;
      competencia?: string;
    }) => {
      if (!input?.paraId) throw new Error("Escolha para quem é o feedback.");
      const texto = (input.texto ?? "").trim();
      if (texto.length < 3) throw new Error("Escreva o feedback.");
      const tipo = input.tipo ?? "elogio";
      if (!["elogio", "ponto_atencao", "pedido"].includes(tipo)) throw new Error("Tipo inválido.");
      const visibilidade = input.visibilidade ?? "gestor";
      if (!["destinatario", "gestor", "publico"].includes(visibilidade)) {
        throw new Error("Visibilidade inválida.");
      }
      return { ...input, texto, tipo, visibilidade };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const euRes = await supabase
      .from("gente_pessoas")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const euId = (euRes?.data as { id: number } | null)?.id;
    if (!euId) throw new Error("Seu usuário não está no cadastro de gente da rede.");
    if (euId === data.paraId) throw new Error("Feedback é para outra pessoa.");

    const { error } = await supabase.from("gente_feedback").insert({
      de_id: euId,
      para_id: data.paraId,
      tipo: data.tipo,
      texto: data.texto,
      visibilidade: data.visibilidade,
      competencia: data.competencia || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
