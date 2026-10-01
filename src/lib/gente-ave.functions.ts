import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enviarEmailAcesso as enviarEmail } from "@/lib/email-access.server";
import { emailAvaliacaoPendente } from "@/lib/email-templates";

// Avaliação de experiência (AVE) de 45 e 90 dias, enviada pelo RH a partir do
// radar da aba Avaliação (pedido do RH de Maceió, 01/10/2026).
//
// Cada unidade tem um ciclo por modelo (`ave45`, `ave90`), copiado do molde na
// primeira vez por `ops.gente_ave_ciclo()` (migration 20261001150000). Enviar
// é criar o participante e as avaliações: o líder sempre, a autoavaliação no
// 180° e no 360°, e os pares escolhidos no 360°. Daí em diante o motor é o de
// sempre: a avaliação cai na fila de quem responde, em Minha vez.
//
// Tudo roda como o usuário. Quem envia precisa de `manage.gente.avaliacao`, e a
// RESTRICTIVE de `gente_avaliacoes` prende o avaliado na unidade dele.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export type ModeloAve = "ave45" | "ave90";
export type Alcance = 90 | 180 | 360;
const MODELOS: ModeloAve[] = ["ave45", "ave90"];

export interface AveAvaliacaoRow {
  id: number;
  tipo: string;
  avaliadorId: number;
  avaliadorNome: string | null;
  status: string;
  concluidaEm: string | null;
  criadaEm: string;
}

export interface AveRadarResult {
  podeEnviar: boolean;
  /** pessoaId → modelo → avaliações já enviadas. */
  envios: Record<number, Partial<Record<ModeloAve, AveAvaliacaoRow[]>>>;
}

export const listAveRadar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AveRadarResult> => {
    const supabase = context.supabase as Cliente;
    const [podeRes, ciclosRes] = await Promise.all([
      supabase.rpc("can", { _key: "manage.gente.avaliacao" }),
      supabase.from("gente_ciclos").select("id,modelo").in("modelo", MODELOS).eq("e_modelo", false),
    ]);
    const podeEnviar = podeRes?.data === true;
    const ciclos = (ciclosRes?.data ?? []) as { id: number; modelo: ModeloAve }[];
    if (!ciclos.length) return { podeEnviar, envios: {} };

    const [avalRes, dirRes] = await Promise.all([
      supabase
        .from("gente_avaliacoes")
        .select("id,ciclo_id,avaliador_id,avaliado_id,tipo,status,concluida_em,created_at")
        .in(
          "ciclo_id",
          ciclos.map((c) => c.id),
        ),
      supabase.from("gente_diretorio").select("id,nome_completo"),
    ]);
    const nomes = new Map<number, string>(
      ((dirRes?.data ?? []) as { id: number; nome_completo: string }[]).map((p) => [
        p.id,
        p.nome_completo,
      ]),
    );
    const modeloDo = new Map(ciclos.map((c) => [c.id, c.modelo]));
    const envios: AveRadarResult["envios"] = {};
    for (const a of (avalRes?.data ?? []) as {
      id: number;
      ciclo_id: number;
      avaliador_id: number;
      avaliado_id: number;
      tipo: string;
      status: string;
      concluida_em: string | null;
      created_at: string;
    }[]) {
      const modelo = modeloDo.get(a.ciclo_id);
      if (!modelo) continue;
      const porModelo = (envios[a.avaliado_id] ??= {});
      (porModelo[modelo] ??= []).push({
        id: a.id,
        tipo: a.tipo,
        avaliadorId: a.avaliador_id,
        avaliadorNome: nomes.get(a.avaliador_id) ?? null,
        status: a.status,
        concluidaEm: a.concluida_em,
        criadaEm: a.created_at,
      });
    }
    return { podeEnviar, envios };
  });

export interface EnviarAveInput {
  pessoaId: number;
  modelo: ModeloAve;
  alcance: Alcance;
  /** Só no 360°: quem mais avalia, além do líder e da própria pessoa. */
  pares?: number[];
}

export interface EnviarAveResult {
  criadas: number;
  jaExistiam: number;
  /** Quem recebe e ainda não tem login: a avaliação fica esperando. */
  semLogin: string[];
  emailsEnviados: number;
}

function baseUrl() {
  return (process.env.APP_URL || "https://planningbrain.com.br").replace(/\/+$/, "");
}

export const enviarAve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: EnviarAveInput) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
    if (!MODELOS.includes(input?.modelo)) throw new Error("Modelo de avaliação inválido.");
    if (![90, 180, 360].includes(input?.alcance)) throw new Error("Escolha 90°, 180° ou 360°.");
    const pares = input.alcance === 360 ? Array.from(new Set(input.pares ?? [])) : [];
    if (pares.some((p) => !Number.isInteger(p))) throw new Error("Par inválido.");
    if (input.alcance === 360 && !pares.length) {
      throw new Error("No 360° escolha ao menos um colega para avaliar.");
    }
    return { pessoaId: input.pessoaId, modelo: input.modelo, alcance: input.alcance, pares };
  })
  .handler(async ({ data, context }): Promise<EnviarAveResult> => {
    const supabase = context.supabase as Cliente;

    const { data: pessoa, error: eP } = await supabase
      .from("gente_pessoas")
      .select("id,nome_completo,email,unidade_id,gestor_id,status,user_id")
      .eq("id", data.pessoaId)
      .maybeSingle();
    if (eP) throw new Error(eP.message);
    if (!pessoa) throw new Error("Pessoa não encontrada no seu cadastro.");
    if (pessoa.status !== "ativo") throw new Error("Só dá para avaliar quem está ativo.");
    if (!pessoa.unidade_id) throw new Error("Defina a unidade da pessoa no Cadastro.");
    if (!pessoa.gestor_id) {
      throw new Error("Defina o gestor da pessoa no Cadastro (botão Editar) antes de enviar.");
    }
    if (data.pares.includes(pessoa.id) || data.pares.includes(pessoa.gestor_id)) {
      throw new Error("Os pares não podem ser a própria pessoa nem o líder.");
    }

    const idsAvaliadores = [pessoa.gestor_id, ...data.pares];
    const { data: avaliadoresDB, error: eA } = await supabase
      .from("gente_pessoas")
      .select("id,nome_completo,email,status,user_id")
      .in("id", idsAvaliadores);
    if (eA) throw new Error(eA.message);
    type Av = {
      id: number;
      nome_completo: string;
      email: string | null;
      status: string;
      user_id: string | null;
    };
    const porId = new Map<number, Av>(((avaliadoresDB ?? []) as Av[]).map((a) => [a.id, a]));
    const lider = porId.get(pessoa.gestor_id);
    if (!lider || lider.status !== "ativo") {
      throw new Error("O gestor no cadastro não está ativo. Corrija no Cadastro antes de enviar.");
    }
    for (const p of data.pares) {
      const par = porId.get(p);
      if (!par || par.status !== "ativo")
        throw new Error("Um dos pares não está ativo no cadastro.");
    }

    const { data: cicloId, error: eC } = await supabase.rpc("gente_ave_ciclo", {
      _unidade: pessoa.unidade_id,
      _modelo: data.modelo,
    });
    if (eC) {
      if (eC.code === "42501")
        throw new Error("Sem permissão para enviar avaliação nesta unidade.");
      throw new Error(eC.message);
    }

    const { error: ePart } = await supabase
      .from("gente_ciclo_participantes")
      .upsert(
        { ciclo_id: cicloId, pessoa_id: pessoa.id },
        { onConflict: "ciclo_id,pessoa_id", ignoreDuplicates: true },
      );
    if (ePart) throw new Error(ePart.message);

    const quem: { avaliador: Av | typeof pessoa; tipo: string }[] = [
      { avaliador: lider, tipo: "gestor" },
      ...(data.alcance >= 180 ? [{ avaliador: pessoa, tipo: "auto" }] : []),
      ...data.pares.map((p) => ({ avaliador: porId.get(p)!, tipo: "par" })),
    ];

    const { data: existentes } = await supabase
      .from("gente_avaliacoes")
      .select("avaliador_id,tipo")
      .eq("ciclo_id", cicloId)
      .eq("avaliado_id", pessoa.id);
    const ja = new Set(
      ((existentes ?? []) as { avaliador_id: number; tipo: string }[]).map(
        (e) => `${e.avaliador_id}:${e.tipo}`,
      ),
    );
    const novos = quem.filter((q) => !ja.has(`${q.avaliador.id}:${q.tipo}`));

    if (novos.length) {
      const { error: eIns } = await supabase.from("gente_avaliacoes").insert(
        novos.map((q) => ({
          ciclo_id: cicloId,
          avaliador_id: q.avaliador.id,
          avaliado_id: pessoa.id,
          tipo: q.tipo,
          status: "pendente",
        })),
      );
      if (eIns) {
        if (eIns.code === "42501")
          throw new Error("Sem permissão para enviar avaliação desta pessoa.");
        throw new Error(eIns.message);
      }
    }

    const semLogin = novos
      .filter((q) => !q.avaliador.user_id)
      .map((q) => q.avaliador.nome_completo);

    // Aviso por e-mail só em produção: o ambiente local aponta para o mesmo
    // banco, e um teste mandaria e-mail de verdade para gente da unidade.
    let emailsEnviados = 0;
    if (process.env.NODE_ENV === "production") {
      const ciclo =
        data.modelo === "ave45"
          ? "Avaliação de experiência 45 dias"
          : "Avaliação de experiência 90 dias";
      const link = `${baseUrl()}/gente?tela=minha-vez`;
      for (const q of novos) {
        if (!q.avaliador.user_id || !q.avaliador.email) continue;
        try {
          const msg = emailAvaliacaoPendente({
            nomeAvaliador: q.avaliador.nome_completo,
            nomeAvaliado: pessoa.nome_completo,
            ciclo,
            autoavaliacao: q.tipo === "auto",
            link,
          });
          const r = await enviarEmail({
            to: String(q.avaliador.email).trim().toLowerCase(),
            ...msg,
          });
          if (r.enviado) emailsEnviados += 1;
        } catch (e) {
          console.error("[gente.enviarAve] e-mail falhou:", e);
        }
      }
    }

    return {
      criadas: novos.length,
      jaExistiam: quem.length - novos.length,
      semLogin,
      emailsEnviados,
    };
  });

export interface AveRespostaRow {
  tipo: string;
  avaliadorNome: string | null;
  status: string;
  concluidaEm: string | null;
  itens: {
    topico: string | null;
    titulo: string;
    resposta: string | null;
    comentario: string | null;
  }[];
}

/** As respostas de uma AVE, para o RH acompanhar e ler o que o líder decidiu. */
export const verAve = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { pessoaId: number; modelo: ModeloAve }) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
    if (!MODELOS.includes(input?.modelo)) throw new Error("Modelo inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<AveRespostaRow[]> => {
    const supabase = context.supabase as Cliente;
    // Um ciclo por unidade e modelo: quem enxerga várias unidades acharia vários.
    const { data: pessoa } = await supabase
      .from("gente_pessoas")
      .select("unidade_id")
      .eq("id", data.pessoaId)
      .maybeSingle();
    if (!pessoa?.unidade_id) return [];
    const { data: ciclo } = await supabase
      .from("gente_ciclos")
      .select("id")
      .eq("modelo", data.modelo)
      .eq("unidade_id", pessoa.unidade_id)
      .eq("e_modelo", false)
      .maybeSingle();
    if (!ciclo) return [];
    const [avalRes, ccRes, topRes, dirRes] = await Promise.all([
      supabase
        .from("gente_avaliacoes")
        .select("id,tipo,avaliador_id,status,concluida_em")
        .eq("ciclo_id", ciclo.id)
        .eq("avaliado_id", data.pessoaId),
      supabase
        .from("gente_ciclo_competencias")
        .select("competencia_id,ordem,topico_id,opcoes,titulo")
        .eq("ciclo_id", ciclo.id),
      supabase.from("gente_ciclo_topicos").select("id,nome,tipos").eq("ciclo_id", ciclo.id),
      supabase.from("gente_diretorio").select("id,nome_completo"),
    ]);
    type A = {
      id: number;
      tipo: string;
      avaliador_id: number;
      status: string;
      concluida_em: string | null;
    };
    const avals = (avalRes?.data ?? []) as A[];
    if (!avals.length) return [];
    const { data: resp } = await supabase
      .from("gente_avaliacao_respostas")
      .select("avaliacao_id,competencia_id,nota,comentario")
      .in(
        "avaliacao_id",
        avals.map((a) => a.id),
      );
    const topicos = (topRes?.data ?? []) as { id: number; nome: string; tipos: string[] | null }[];
    const vinculos = (
      (ccRes?.data ?? []) as {
        competencia_id: number;
        ordem: number;
        topico_id: number | null;
        opcoes: { nota: number; rotulo: string }[] | null;
        titulo: string | null;
      }[]
    ).sort((a, b) => a.ordem - b.ordem);
    const nomes = new Map<number, string>(
      ((dirRes?.data ?? []) as { id: number; nome_completo: string }[]).map((p) => [
        p.id,
        p.nome_completo,
      ]),
    );
    const respostas = (resp ?? []) as {
      avaliacao_id: number;
      competencia_id: number;
      nota: number | null;
      comentario: string | null;
    }[];

    return avals.map((a) => ({
      tipo: a.tipo,
      avaliadorNome: nomes.get(a.avaliador_id) ?? null,
      status: a.status,
      concluidaEm: a.concluida_em,
      itens: vinculos
        .filter((v) => {
          const t = topicos.find((x) => x.id === v.topico_id);
          return !t?.tipos || t.tipos.includes(a.tipo);
        })
        .map((v) => {
          const r = respostas.find(
            (x) => x.avaliacao_id === a.id && x.competencia_id === v.competencia_id,
          );
          return {
            topico: topicos.find((x) => x.id === v.topico_id)?.nome ?? null,
            titulo: v.titulo ?? `Pergunta ${v.ordem}`,
            resposta:
              r?.nota == null
                ? null
                : (v.opcoes?.find((o) => o.nota === r.nota)?.rotulo ?? String(r.nota)),
            comentario: r?.comentario ?? null,
          };
        }),
    }));
  });
