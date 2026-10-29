import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enviarEmailAcesso as enviarEmail } from "@/lib/email-access.server";
import { emailAvaliacaoPendente } from "@/lib/email-templates";

// Avaliação de desempenho (AVD), decidida pelo RH da Expansão com o RH de Maceió em
// 29/10/2026 (migration 20261029100000). Dois formulários do documento "Avaliação de
// desempenho 2/2024": Colaboradores e especialistas, e Liderança. Por semestre: cada
// unidade tem um ciclo por formulário e período ("2/2026"), criado do molde por
// `ops.gente_avd_ciclo()`.
//
// Graus: 180° (autoavaliação e gestor) e 360° (mais pares e, para líderes, liderados).
// O 360° só vale na unidade que a Matriz liberou; o banco também recusa par e liderado
// sem a liberação. Tudo roda como o usuário: quem envia precisa de
// `manage.gente.avaliacao`, e a RLS prende na unidade.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export type FormularioAvd = "avd_colab" | "avd_lider";
const FORMULARIOS: FormularioAvd[] = ["avd_colab", "avd_lider"];
export const ROTULO_FORMULARIO: Record<FormularioAvd, string> = {
  avd_colab: "Colaboradores e especialistas",
  avd_lider: "Liderança",
};

const PERIODO = /^[12]\/20\d{2}$/;

export interface AvdEnvioRow {
  tipo: string;
  avaliadorNome: string | null;
  status: string;
}

export interface AvdResult {
  podeEnviar: boolean;
  /** Matriz: conduz avaliação e não está presa a uma unidade. */
  podeLiberar360: boolean;
  /** Unidades com o 360° liberado pela Matriz. */
  liberadas: number[];
  /** pessoaId → formulário e avaliações já enviadas no período. */
  envios: Record<number, { formulario: FormularioAvd; avaliacoes: AvdEnvioRow[] }>;
}

export const listAvd = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { periodo: string }) => {
    if (!PERIODO.test(input?.periodo ?? "")) throw new Error("Período no formato 2/2026.");
    return { periodo: input.periodo };
  })
  .handler(async ({ data, context }): Promise<AvdResult> => {
    const supabase = context.supabase as Cliente;
    const [podeRes, presoRes, libRes, ciclosRes] = await Promise.all([
      supabase.rpc("can", { _key: "manage.gente.avaliacao" }),
      supabase.rpc("can", { _key: "data.scope.own_unit_only" }),
      supabase.from("gente_avd_liberacao_360").select("unidade_id"),
      supabase
        .from("gente_ciclos")
        .select("id,modelo")
        .in(
          "modelo",
          FORMULARIOS.map((f) => `${f}:${data.periodo}`),
        )
        .eq("e_modelo", false),
    ]);
    const podeEnviar = podeRes?.data === true;
    const resultado: AvdResult = {
      podeEnviar,
      podeLiberar360: podeEnviar && presoRes?.data !== true,
      liberadas: ((libRes?.data ?? []) as { unidade_id: number }[]).map((l) => l.unidade_id),
      envios: {},
    };
    const ciclos = (ciclosRes?.data ?? []) as { id: number; modelo: string }[];
    if (!ciclos.length) return resultado;

    const [avalRes, dirRes] = await Promise.all([
      supabase
        .from("gente_avaliacoes")
        .select("ciclo_id,avaliador_id,avaliado_id,tipo,status")
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
    const formularioDo = new Map(
      ciclos.map((c) => [c.id, c.modelo.split(":")[0] as FormularioAvd]),
    );
    for (const a of (avalRes?.data ?? []) as {
      ciclo_id: number;
      avaliador_id: number;
      avaliado_id: number;
      tipo: string;
      status: string;
    }[]) {
      const formulario = formularioDo.get(a.ciclo_id);
      if (!formulario) continue;
      const e = (resultado.envios[a.avaliado_id] ??= { formulario, avaliacoes: [] });
      e.avaliacoes.push({
        tipo: a.tipo,
        avaliadorNome: nomes.get(a.avaliador_id) ?? null,
        status: a.status,
      });
    }
    return resultado;
  });

export interface EnviarAvdInput {
  periodo: string;
  alcance: 180 | 360;
  /** Pessoa → formulário. No 360° vai uma pessoa por vez. */
  envios: { pessoaId: number; formulario: FormularioAvd }[];
  /** Só no 360°. */
  pares?: number[];
  liderados?: number[];
}

export interface EnviarAvdResult {
  criadas: number;
  pessoas: number;
  /** Quem ficou de fora e por quê (sem gestor, inativo...). */
  puladas: { nome: string; motivo: string }[];
  semLogin: string[];
  emailsEnviados: number;
}

function baseUrl() {
  return (process.env.APP_URL || "https://planningbrain.com.br").replace(/\/+$/, "");
}

type Pessoa = {
  id: number;
  nome_completo: string;
  email: string | null;
  unidade_id: number | null;
  gestor_id: number | null;
  status: string;
  user_id: string | null;
};

export const enviarAvd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: EnviarAvdInput) => {
    if (!PERIODO.test(input?.periodo ?? "")) throw new Error("Período no formato 2/2026.");
    if (input?.alcance !== 180 && input?.alcance !== 360) throw new Error("Escolha 180° ou 360°.");
    const envios = Array.isArray(input.envios) ? input.envios : [];
    if (!envios.length) throw new Error("Escolha ao menos uma pessoa.");
    if (envios.length > 300) throw new Error("No máximo 300 pessoas por vez.");
    for (const e of envios) {
      if (!Number.isInteger(e.pessoaId)) throw new Error("Pessoa inválida.");
      if (!FORMULARIOS.includes(e.formulario)) throw new Error("Formulário inválido.");
    }
    const pares = input.alcance === 360 ? Array.from(new Set(input.pares ?? [])) : [];
    const liderados = input.alcance === 360 ? Array.from(new Set(input.liderados ?? [])) : [];
    if ([...pares, ...liderados].some((p) => !Number.isInteger(p))) {
      throw new Error("Avaliador inválido.");
    }
    if (input.alcance === 360) {
      if (envios.length !== 1) throw new Error("O 360° é enviado uma pessoa por vez.");
      if (!pares.length && !liderados.length) {
        throw new Error("No 360° escolha ao menos um par ou liderado.");
      }
    }
    return { periodo: input.periodo, alcance: input.alcance, envios, pares, liderados };
  })
  .handler(async ({ data, context }): Promise<EnviarAvdResult> => {
    const supabase = context.supabase as Cliente;
    const ids = Array.from(
      new Set([...data.envios.map((e) => e.pessoaId), ...data.pares, ...data.liderados]),
    );
    const { data: lidas, error: eP } = await supabase
      .from("gente_pessoas")
      .select("id,nome_completo,email,unidade_id,gestor_id,status,user_id")
      .in("id", ids);
    if (eP) throw new Error(eP.message);
    const porId = new Map<number, Pessoa>(((lidas ?? []) as Pessoa[]).map((p) => [p.id, p]));
    // Gestores que não vieram na lista.
    const faltam = Array.from(
      new Set(
        [...porId.values()]
          .map((p) => p.gestor_id)
          .filter((g): g is number => g != null && !porId.has(g)),
      ),
    );
    if (faltam.length) {
      const { data: gestores } = await supabase
        .from("gente_pessoas")
        .select("id,nome_completo,email,unidade_id,gestor_id,status,user_id")
        .in("id", faltam);
      for (const g of (gestores ?? []) as Pessoa[]) porId.set(g.id, g);
    }

    const resultado: EnviarAvdResult = {
      criadas: 0,
      pessoas: 0,
      puladas: [],
      semLogin: [],
      emailsEnviados: 0,
    };
    const novosParaEmail: { avaliador: Pessoa; avaliado: Pessoa; tipo: string; ciclo: string }[] =
      [];
    const cicloDe = new Map<string, number>();

    for (const e of data.envios) {
      const pessoa = porId.get(e.pessoaId);
      if (!pessoa) {
        resultado.puladas.push({ nome: `#${e.pessoaId}`, motivo: "fora do seu cadastro" });
        continue;
      }
      if (pessoa.status !== "ativo") {
        resultado.puladas.push({ nome: pessoa.nome_completo, motivo: "não está ativa" });
        continue;
      }
      if (!pessoa.unidade_id) {
        resultado.puladas.push({ nome: pessoa.nome_completo, motivo: "sem unidade no cadastro" });
        continue;
      }
      const lider = pessoa.gestor_id != null ? porId.get(pessoa.gestor_id) : undefined;
      if (!lider || lider.status !== "ativo") {
        resultado.puladas.push({
          nome: pessoa.nome_completo,
          motivo: "sem gestor ativo no cadastro (defina em Editar)",
        });
        continue;
      }

      const chave = `${pessoa.unidade_id}:${e.formulario}`;
      let cicloId = cicloDe.get(chave);
      if (cicloId == null) {
        const { data: id, error: eC } = await supabase.rpc("gente_avd_ciclo", {
          _unidade: pessoa.unidade_id,
          _modelo: e.formulario,
          _periodo: data.periodo,
        });
        if (eC) {
          if (eC.code === "42501")
            throw new Error("Sem permissão para enviar avaliação nesta unidade.");
          throw new Error(eC.message);
        }
        cicloId = id as number;
        cicloDe.set(chave, cicloId);
      }

      const { error: ePart } = await supabase
        .from("gente_ciclo_participantes")
        .upsert(
          { ciclo_id: cicloId, pessoa_id: pessoa.id },
          { onConflict: "ciclo_id,pessoa_id", ignoreDuplicates: true },
        );
      if (ePart) throw new Error(ePart.message);

      const quem: { avaliador: Pessoa; tipo: string }[] = [
        { avaliador: lider, tipo: "gestor" },
        { avaliador: pessoa, tipo: "auto" },
      ];
      for (const p of data.pares) {
        const par = porId.get(p);
        if (par && par.status === "ativo" && par.id !== pessoa.id && par.id !== lider.id) {
          quem.push({ avaliador: par, tipo: "par" });
        }
      }
      for (const l of data.liderados) {
        const lid = porId.get(l);
        if (lid && lid.status === "ativo" && lid.gestor_id === pessoa.id) {
          quem.push({ avaliador: lid, tipo: "liderado" });
        }
      }

      const { data: existentes } = await supabase
        .from("gente_avaliacoes")
        .select("avaliador_id,tipo")
        .eq("ciclo_id", cicloId)
        .eq("avaliado_id", pessoa.id);
      const ja = new Set(
        ((existentes ?? []) as { avaliador_id: number; tipo: string }[]).map(
          (x) => `${x.avaliador_id}:${x.tipo}`,
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
          // 23514: o banco recusou par ou liderado sem a liberação do 360° da Matriz.
          if (eIns.code === "23514" || eIns.code === "42501") throw new Error(eIns.message);
          throw new Error(eIns.message);
        }
      }
      resultado.pessoas += 1;
      resultado.criadas += novos.length;
      for (const q of novos) {
        if (!q.avaliador.user_id) resultado.semLogin.push(q.avaliador.nome_completo);
        novosParaEmail.push({
          avaliador: q.avaliador,
          avaliado: pessoa,
          tipo: q.tipo,
          ciclo: `Avaliação de desempenho ${data.periodo} · ${ROTULO_FORMULARIO[e.formulario]}`,
        });
      }
    }
    resultado.semLogin = Array.from(new Set(resultado.semLogin));

    // Aviso por e-mail só em produção (o ambiente local usa o mesmo banco).
    if (process.env.NODE_ENV === "production") {
      const link = `${baseUrl()}/gente?tela=minha-vez`;
      for (const n of novosParaEmail) {
        if (!n.avaliador.user_id || !n.avaliador.email) continue;
        try {
          const msg = emailAvaliacaoPendente({
            nomeAvaliador: n.avaliador.nome_completo,
            nomeAvaliado: n.avaliado.nome_completo,
            ciclo: n.ciclo,
            autoavaliacao: n.tipo === "auto",
            link,
          });
          const r = await enviarEmail({
            to: String(n.avaliador.email).trim().toLowerCase(),
            ...msg,
          });
          if (r.enviado) resultado.emailsEnviados += 1;
        } catch (err) {
          console.error("[gente.enviarAvd] e-mail falhou:", err);
        }
      }
    }
    return resultado;
  });

/** Matriz libera ou trava o 360° da AVD para uma unidade. A RLS só deixa a Matriz. */
export const liberarAvd360 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { unidadeId: number; liberar: boolean }) => {
    if (!Number.isInteger(input?.unidadeId)) throw new Error("Unidade inválida.");
    return { unidadeId: input.unidadeId, liberar: Boolean(input.liberar) };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { error } = data.liberar
      ? await supabase
          .from("gente_avd_liberacao_360")
          .upsert(
            { unidade_id: data.unidadeId },
            { onConflict: "unidade_id", ignoreDuplicates: true },
          )
      : await supabase.from("gente_avd_liberacao_360").delete().eq("unidade_id", data.unidadeId);
    if (error) {
      if (error.code === "42501") throw new Error("Só a Matriz libera o 360°.");
      throw new Error(error.message);
    }
    return { ok: true };
  });
