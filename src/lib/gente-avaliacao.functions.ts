import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// Ciclo de avaliação de desempenho (migrations 56, 70 e 71, no repo do wiki).
//
// O motor é genérico: o RH cria as competências, monta o ciclo, escolhe a
// escala e diz quem avalia quem. Não há competência nem régua no código.
//
// Duas travas que são do banco e não desta camada:
//  - o avaliado não lê nota nenhuma antes da devolutiva (`devolutiva_em`);
//  - `manage.gente` (cadastro) não abre nada daqui. Quem conduz o ciclo tem
//    `manage.gente.avaliacao`, que é chave separada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface CicloRow {
  id: number;
  nome: string;
  status: string;
  origem: string;
  periodoInicio: string | null;
  escalaMin: number;
  escalaMax: number;
  participantes: number;
  avaliacoes: number;
  concluidas: number;
}

export interface CompetenciaRow {
  id: number;
  nome: string;
  categoria: string | null;
  eixo: string | null;
  topico: string | null;
  ordem: number;
}

export interface CampoRow {
  id: number;
  titulo: string;
  ordem: number;
  obrigatorio: boolean;
}

export interface FilaRow {
  id: number;
  cicloId: number;
  cicloNome: string;
  avaliadoNome: string | null;
  tipo: string;
  status: string;
  escalaMin: number;
  escalaMax: number;
  competencias: CompetenciaRow[];
  campos: CampoRow[];
  respostas: {
    competenciaId: number;
    nota: number | null;
    comentario: string | null;
    naoSeAplica: boolean;
  }[];
  discursivas: { campoId: number; texto: string | null }[];
}

export interface ResultadoRow {
  cicloId: number;
  cicloNome: string;
  competencia: string;
  topico: string | null;
  media: number | null;
  respostas: number;
}

export interface CalibracaoRow {
  cicloId: number;
  pessoaId: number;
  pessoaNome: string | null;
  mediaDesempenho: number | null;
  mediaPotencial: number | null;
  notaDesempenho: number | null;
  notaPotencial: number | null;
  caixa: string | null;
  devolutivaEm: string | null;
}

export interface AvaliacaoResult {
  minhaPessoaId: number | null;
  podeVer: boolean;
  podeAdministrar: boolean;
  ciclos: CicloRow[];
  fila: FilaRow[];
  meuResultado: ResultadoRow[];
  calibracao: CalibracaoRow[];
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

export const listAvaliacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AvaliacaoResult> => {
    const supabase = context.supabase as Cliente;
    const { chaves, eu } = await contexto(supabase, context.userId);

    const vazio: AvaliacaoResult = {
      minhaPessoaId: eu?.id ?? null,
      podeVer: chaves.includes("view.gente.avaliacao"),
      podeAdministrar: chaves.includes("manage.gente.avaliacao"),
      ciclos: [],
      fila: [],
      meuResultado: [],
      calibracao: [],
    };
    if (!vazio.podeVer) return vazio;

    const [ciclosRes, avalRes, partRes, compRes, cicloCompRes, topicosRes, camposRes, pessoasRes] =
      await Promise.all([
        supabase
          .from("gente_ciclos")
          .select("id,nome,status,origem,periodo_inicio,escala_min,escala_max")
          .order("periodo_inicio", { ascending: false, nullsFirst: false }),
        supabase
          .from("gente_avaliacoes")
          .select("id,ciclo_id,avaliador_id,avaliado_id,tipo,status"),
        supabase.from("gente_ciclo_participantes").select("ciclo_id,pessoa_id,devolutiva_em"),
        supabase.from("gente_competencias").select("id,nome,categoria,eixo"),
        supabase
          .from("gente_ciclo_competencias")
          .select("ciclo_id,competencia_id,ordem,peso,topico_id"),
        supabase.from("gente_ciclo_topicos").select("id,ciclo_id,nome,ordem"),
        supabase.from("gente_ciclo_campos").select("id,ciclo_id,titulo,ordem,obrigatorio"),
        supabase.from("gente_diretorio").select("id,nome_completo"),
      ]);

    type Aval = {
      id: number;
      ciclo_id: number;
      avaliador_id: number;
      avaliado_id: number;
      tipo: string;
      status: string;
    };
    const avaliacoes = (avalRes?.data ?? []) as Aval[];
    const participantes = (partRes?.data ?? []) as {
      ciclo_id: number;
      pessoa_id: number;
      devolutiva_em: string | null;
    }[];
    const competencias = (compRes?.data ?? []) as {
      id: number;
      nome: string;
      categoria: string | null;
      eixo: string | null;
    }[];
    const vinculos = (cicloCompRes?.data ?? []) as {
      ciclo_id: number;
      competencia_id: number;
      ordem: number;
      topico_id: number | null;
    }[];
    const topicos = (topicosRes?.data ?? []) as { id: number; ciclo_id: number; nome: string }[];
    const campos = (camposRes?.data ?? []) as {
      id: number;
      ciclo_id: number;
      titulo: string;
      ordem: number;
      obrigatorio: boolean;
    }[];
    const nomePor = new Map(
      ((pessoasRes?.data ?? []) as { id: number; nome_completo: string }[]).map((p) => [
        p.id,
        p.nome_completo,
      ]),
    );

    const ciclos: CicloRow[] = (
      (ciclosRes?.data ?? []) as {
        id: number;
        nome: string;
        status: string;
        origem: string;
        periodo_inicio: string | null;
        escala_min: number;
        escala_max: number;
      }[]
    ).map((c) => ({
      id: c.id,
      nome: c.nome,
      status: c.status,
      origem: c.origem,
      periodoInicio: c.periodo_inicio,
      escalaMin: c.escala_min,
      escalaMax: c.escala_max,
      participantes: participantes.filter((p) => p.ciclo_id === c.id).length,
      avaliacoes: avaliacoes.filter((a) => a.ciclo_id === c.id).length,
      concluidas: avaliacoes.filter((a) => a.ciclo_id === c.id && a.status === "concluida").length,
    }));

    const competenciasDoCiclo = (cicloId: number): CompetenciaRow[] =>
      vinculos
        .filter((v) => v.ciclo_id === cicloId)
        .sort((a, b) => a.ordem - b.ordem)
        .map((v) => {
          const comp = competencias.find((c) => c.id === v.competencia_id);
          return {
            id: v.competencia_id,
            nome: comp?.nome ?? `Competência ${v.competencia_id}`,
            categoria: comp?.categoria ?? null,
            eixo: comp?.eixo ?? null,
            topico: topicos.find((t) => t.id === v.topico_id)?.nome ?? null,
            ordem: v.ordem,
          };
        });

    // A fila do avaliador: o que falta ele responder, com o formulário junto.
    const minhas = eu
      ? avaliacoes.filter((a) => a.avaliador_id === eu.id && a.status !== "concluida")
      : [];
    const idsFila = minhas.map((a) => a.id);
    const [respRes, discRes] = await Promise.all([
      idsFila.length
        ? supabase
            .from("gente_avaliacao_respostas")
            .select("avaliacao_id,competencia_id,nota,comentario,nao_se_aplica")
            .in("avaliacao_id", idsFila)
        : Promise.resolve({ data: [] }),
      idsFila.length
        ? supabase
            .from("gente_avaliacao_campo_respostas")
            .select("avaliacao_id,campo_id,texto")
            .in("avaliacao_id", idsFila)
        : Promise.resolve({ data: [] }),
    ]);
    const respostas = (respRes?.data ?? []) as {
      avaliacao_id: number;
      competencia_id: number;
      nota: number | null;
      comentario: string | null;
      nao_se_aplica: boolean;
    }[];
    const discursivas = (discRes?.data ?? []) as {
      avaliacao_id: number;
      campo_id: number;
      texto: string | null;
    }[];

    const fila: FilaRow[] = minhas.map((a) => {
      const ciclo = ciclos.find((c) => c.id === a.ciclo_id);
      return {
        id: a.id,
        cicloId: a.ciclo_id,
        cicloNome: ciclo?.nome ?? "",
        avaliadoNome: nomePor.get(a.avaliado_id) ?? null,
        tipo: a.tipo,
        status: a.status,
        escalaMin: ciclo?.escalaMin ?? 1,
        escalaMax: ciclo?.escalaMax ?? 5,
        competencias: competenciasDoCiclo(a.ciclo_id),
        campos: campos
          .filter((c) => c.ciclo_id === a.ciclo_id)
          .sort((x, y) => x.ordem - y.ordem)
          .map((c) => ({ id: c.id, titulo: c.titulo, ordem: c.ordem, obrigatorio: c.obrigatorio })),
        respostas: respostas
          .filter((r) => r.avaliacao_id === a.id)
          .map((r) => ({
            competenciaId: r.competencia_id,
            nota: r.nota,
            comentario: r.comentario,
            naoSeAplica: r.nao_se_aplica,
          })),
        discursivas: discursivas
          .filter((d) => d.avaliacao_id === a.id)
          .map((d) => ({ campoId: d.campo_id, texto: d.texto })),
      };
    });

    // Meu resultado: a view já aplica o portão da devolutiva, então o que
    // voltar aqui é o que eu posso ler.
    const mediaRes = await supabase
      .from("v_gente_avaliacao_media_competencia")
      .select("ciclo_id,avaliado_id,competencia_id,media,respostas");
    const medias = (mediaRes?.data ?? []) as {
      ciclo_id: number;
      avaliado_id: number;
      competencia_id: number;
      media: number | null;
      respostas: number;
    }[];

    const meuResultado: ResultadoRow[] = eu
      ? medias
          .filter((m) => m.avaliado_id === eu.id)
          .map((m) => {
            const comp = competencias.find((c) => c.id === m.competencia_id);
            const vinculo = vinculos.find(
              (v) => v.ciclo_id === m.ciclo_id && v.competencia_id === m.competencia_id,
            );
            return {
              cicloId: m.ciclo_id,
              cicloNome: ciclos.find((c) => c.id === m.ciclo_id)?.nome ?? "",
              competencia: comp?.nome ?? "",
              topico: topicos.find((t) => t.id === vinculo?.topico_id)?.nome ?? null,
              media: m.media,
              respostas: m.respostas,
            };
          })
      : [];

    // Calibração: só para quem conduz. A média por eixo sai das competências
    // que o RH marcou, e é sugestão — o comitê decide.
    let calibracao: CalibracaoRow[] = [];
    if (vazio.podeAdministrar) {
      const calibRes = await supabase
        .from("gente_calibracao")
        .select("ciclo_id,pessoa_id,nota_desempenho,nota_potencial,caixa");
      const salvas = (calibRes?.data ?? []) as {
        ciclo_id: number;
        pessoa_id: number;
        nota_desempenho: number | null;
        nota_potencial: number | null;
        caixa: string | null;
      }[];

      const porEixo = (cicloId: number, pessoaId: number, eixo: string) => {
        const linhas = medias.filter(
          (m) =>
            m.ciclo_id === cicloId &&
            m.avaliado_id === pessoaId &&
            competencias.find((c) => c.id === m.competencia_id)?.eixo === eixo &&
            m.media != null,
        );
        if (!linhas.length) return null;
        const soma = linhas.reduce((acc, l) => acc + Number(l.media), 0);
        return Math.round((soma / linhas.length) * 100) / 100;
      };

      calibracao = participantes.map((p) => {
        const salva = salvas.find((s) => s.ciclo_id === p.ciclo_id && s.pessoa_id === p.pessoa_id);
        return {
          cicloId: p.ciclo_id,
          pessoaId: p.pessoa_id,
          pessoaNome: nomePor.get(p.pessoa_id) ?? null,
          mediaDesempenho: porEixo(p.ciclo_id, p.pessoa_id, "desempenho"),
          mediaPotencial: porEixo(p.ciclo_id, p.pessoa_id, "potencial"),
          notaDesempenho: salva?.nota_desempenho ?? null,
          notaPotencial: salva?.nota_potencial ?? null,
          caixa: salva?.caixa ?? null,
          devolutivaEm: p.devolutiva_em,
        };
      });
    }

    return { ...vazio, ciclos, fila, meuResultado, calibracao };
  });

export const responderAvaliacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (dados: {
      avaliacaoId: number;
      respostas: {
        competenciaId: number;
        nota: number | null;
        comentario?: string | null;
        naoSeAplica?: boolean;
      }[];
      discursivas?: { campoId: number; texto: string }[];
      concluir?: boolean;
    }) => dados,
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;

    if (data.respostas.length) {
      const { error } = await supabase.from("gente_avaliacao_respostas").upsert(
        data.respostas.map((r) => ({
          avaliacao_id: data.avaliacaoId,
          competencia_id: r.competenciaId,
          nota: r.naoSeAplica ? null : r.nota,
          comentario: r.comentario || null,
          nao_se_aplica: Boolean(r.naoSeAplica),
        })),
        { onConflict: "avaliacao_id,competencia_id" },
      );
      if (error) throw new Error(error.message);
    }

    if (data.discursivas?.length) {
      const { error } = await supabase.from("gente_avaliacao_campo_respostas").upsert(
        data.discursivas.map((d) => ({
          avaliacao_id: data.avaliacaoId,
          campo_id: d.campoId,
          texto: d.texto || null,
        })),
        { onConflict: "avaliacao_id,campo_id" },
      );
      if (error) throw new Error(error.message);
    }

    // A conclusão vem por último de propósito: enquanto `status <> 'concluida'`
    // a RLS deixa o avaliador escrever. Depois, tranca.
    const { error } = await supabase
      .from("gente_avaliacoes")
      .update({
        status: data.concluir ? "concluida" : "em_andamento",
        concluida_em: data.concluir ? new Date().toISOString() : null,
      })
      .eq("id", data.avaliacaoId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const salvarCalibracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (dados: {
      cicloId: number;
      pessoaId: number;
      notaDesempenho: number | null;
      notaPotencial: number | null;
      caixa?: string | null;
      justificativa?: string | null;
    }) => dados,
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { eu } = await contexto(supabase, context.userId);
    const { error } = await supabase.from("gente_calibracao").upsert(
      {
        ciclo_id: data.cicloId,
        pessoa_id: data.pessoaId,
        nota_desempenho: data.notaDesempenho,
        nota_potencial: data.notaPotencial,
        caixa: data.caixa || null,
        justificativa: data.justificativa || null,
        decidido_por: eu?.id ?? null,
        decidido_em: new Date().toISOString(),
      },
      { onConflict: "ciclo_id,pessoa_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const liberarDevolutiva = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((dados: { cicloId: number; pessoaId?: number }) => dados)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    // Este é o botão que abre a nota para o avaliado. Antes dele, ninguém do
    // lado de lá lê nada, e é isso que permite calibrar com calma.
    let consulta = supabase
      .from("gente_ciclo_participantes")
      .update({ devolutiva_em: new Date().toISOString() })
      .eq("ciclo_id", data.cicloId);
    if (data.pessoaId) consulta = consulta.eq("pessoa_id", data.pessoaId);
    const { error } = await consulta;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
