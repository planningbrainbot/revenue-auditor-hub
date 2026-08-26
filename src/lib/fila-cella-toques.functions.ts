import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CicloRow, ToqueRow } from "@/lib/fila-cella.types";

// Escrita da cadência da Fila Cella — spec-tela-fila-cella.md v0.3 §6.5.
//
// A trava real é do banco (check toque_num between 1 and 4, unique (ciclo_id,
// toque_num), FK composta (ciclo_id, frente), índice parcial de ciclo aberto).
// Este arquivo existe para traduzir cada uma delas em mensagem de negócio antes
// que o Postgres devolva erro de constraint cru na cara do operador — e para
// numerar o toque no servidor, que é a única maneira de o contador "3 de 4" não
// ser negociável pelo cliente.

const CANAIS = ["WhatsApp", "Ligação", "E-mail", "Reunião"];
const RESULTADOS = ["Sem resposta", "Respondeu", "Reunião agendada", "Não explícito"];
const FRENTES = ["Tese", "Contencioso", "Transação"];

async function assertCan(supabase: any, chave: string, recado: string) {
  const { data, error } = await supabase.rpc("can", { _key: chave });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error(`Acesso negado: ${recado}`);
}

async function podeOverride(supabase: any): Promise<boolean> {
  const { data } = await supabase.rpc("can", { _key: "manage.fila_cella_override" });
  return !!data;
}

const hojeISO = () => new Date().toISOString().slice(0, 10);

export const listarToques = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conta_id: number }) => {
    const conta_id = Number(input?.conta_id);
    if (!Number.isInteger(conta_id) || conta_id <= 0) throw new Error("Conta inválida.");
    return { conta_id };
  })
  .handler(
    async ({ data, context }): Promise<{ ciclos: CicloRow[]; toques: ToqueRow[] }> => {
      const supabase = context.supabase as any;
      const { data: ciclos, error } = await supabase
        .from("fila_cella_ciclos")
        .select("*")
        .eq("conta_id", data.conta_id)
        .order("numero", { ascending: false });
      if (error) return { ciclos: [], toques: [] };

      const ids = ((ciclos ?? []) as CicloRow[]).map((c) => c.id);
      if (ids.length === 0) return { ciclos: [], toques: [] };

      const { data: toques } = await supabase
        .from("fila_cella_toques")
        .select("*")
        .in("ciclo_id", ids)
        .order("data", { ascending: false })
        .order("toque_num", { ascending: false });
      return { ciclos: (ciclos ?? []) as CicloRow[], toques: (toques ?? []) as ToqueRow[] };
    },
  );

/**
 * Abre um ciclo. A regra dos dois relógios do playbook §4.6 mora aqui:
 * `bloqueado_ate` já traz 60 dias (sem resposta) ou 180 (recusa explícita), e
 * furar a data exige fato novo + `manage.fila_cella_override`.
 *
 * NOTA HONESTA: a spec §4.4 regra 1 manda essa checagem virar TRIGGER no banco,
 * mas nunca escreve o corpo dele — então ela vive só aqui por enquanto. Quem
 * escrever direto no banco com service_role contorna. Está registrado em
 * DECISIONS.md como pendência de schema, não como "resolvido".
 */
export const abrirCiclo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { conta_id: number; frente: string; motivo_entrada: string; fato_novo?: string }) => {
      const conta_id = Number(input?.conta_id);
      if (!Number.isInteger(conta_id) || conta_id <= 0) throw new Error("Conta inválida.");
      if (!FRENTES.includes(input.frente)) throw new Error("Frente inválida.");
      const motivo = (input.motivo_entrada ?? "").trim();
      if (!motivo) throw new Error("Motivo de entrada obrigatório — a cada ciclo, motivo novo.");
      return {
        conta_id,
        frente: input.frente,
        motivo_entrada: motivo,
        fato_novo: (input.fato_novo ?? "").trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await assertCan(supabase, "manage.fila_cella", "você não pode operar a Fila Cella.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: ciclos, error } = await admin
      .from("fila_cella_ciclos")
      .select("id,numero,status,bloqueado_ate,recusa_explicita")
      .eq("conta_id", data.conta_id)
      .order("numero", { ascending: false });
    if (error) throw new Error(error.message);

    const lista = (ciclos ?? []) as CicloRow[];
    if (lista.some((c) => c.status === "aberto")) {
      throw new Error("Esta conta já tem um ciclo aberto. Encerre-o antes de abrir outro.");
    }

    const ultimo = lista[0];
    if (ultimo?.bloqueado_ate && ultimo.bloqueado_ate > hojeISO()) {
      const prazo = ultimo.recusa_explicita ? "180 dias" : "60 dias";
      const dataBr = new Date(`${ultimo.bloqueado_ate}T12:00:00`).toLocaleDateString("pt-BR");
      if (!data.fato_novo) {
        throw new Error(
          `A reentrada só é permitida a partir de ${dataBr} (${prazo}). ` +
            (ultimo.recusa_explicita
              ? "Este ciclo fechou com \"Não\" explícito: reabrir antes disso exige fato novo relevante — fiscalização ou mudança de decisor."
              : "Reabrir antes disso exige fato novo e motivo diferente: repetir a mesma oferta com outra palavra é o que caracteriza insistência."),
        );
      }
      if (!(await podeOverride(supabase))) {
        throw new Error(
          `Reabrir antes de ${dataBr} exige a permissão manage.fila_cella_override. Peça a um admin.`,
        );
      }
    }

    const numero = (ultimo?.numero ?? 0) + 1;
    const { data: novo, error: insErr } = await admin
      .from("fila_cella_ciclos")
      .insert({
        conta_id: data.conta_id,
        numero,
        frente: data.frente,
        motivo_entrada: data.motivo_entrada,
        fato_novo: data.fato_novo,
        aberto_por: context.userId,
      })
      .select("id,numero")
      .single();
    if (insErr) throw new Error(insErr.message);
    return { ciclo_id: novo.id as number, numero: novo.numero as number };
  });

/**
 * Registra um toque. Append-only: não existe atualizar nem excluir — correção é
 * linha nova apontando `corrige_toque_id`.
 */
export const registrarToque = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      ciclo_id: number;
      data: string;
      canal: string;
      gatilho_ref: string;
      literal: string;
      atesto_sem_citar_cliente: boolean;
      resposta?: string | null;
      resultado: string;
      proximo_passo?: string | null;
      proximo_passo_em?: string | null;
      motivo?: string | null;
      corrige_toque_id?: number | null;
      override_motivo?: string | null;
    }) => {
      const ciclo_id = Number(input?.ciclo_id);
      if (!Number.isInteger(ciclo_id) || ciclo_id <= 0) throw new Error("Ciclo inválido.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data ?? "")) throw new Error("Data inválida.");
      if (input.data > hojeISO()) throw new Error("Toque não aceita data futura.");
      if (!CANAIS.includes(input.canal)) throw new Error("Canal obrigatório.");
      const gatilho = (input.gatilho_ref ?? "").trim();
      if (!gatilho) {
        throw new Error(
          "Gatilho obrigatório: nenhum cliente entra na fila sem gatilho identificado e registrado (playbook §3.6).",
        );
      }
      const literal = (input.literal ?? "").trim();
      if (!literal) throw new Error("O literal do que foi dito é obrigatório — é registro de compliance.");
      if (!RESULTADOS.includes(input.resultado)) throw new Error("Resultado obrigatório.");

      const proximo = (input.proximo_passo ?? "").trim() || null;
      const proximoEm = input.proximo_passo_em || null;
      if (input.resultado !== "Não explícito") {
        if (!proximo || !proximoEm) throw new Error("Próximo passo e data são obrigatórios.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(proximoEm)) throw new Error("Data do próximo passo inválida.");
      }
      const motivo = (input.motivo ?? "").trim() || null;
      if (input.resultado === "Não explícito" && !motivo) {
        throw new Error('Motivo é obrigatório quando o resultado é "Não" explícito.');
      }
      return {
        ciclo_id,
        data: input.data,
        canal: input.canal,
        gatilho_ref: gatilho,
        literal,
        atesto_sem_citar_cliente: !!input.atesto_sem_citar_cliente,
        resposta: (input.resposta ?? "").trim() || null,
        resultado: input.resultado,
        proximo_passo: proximo,
        proximo_passo_em: proximoEm,
        motivo,
        corrige_toque_id: input.corrige_toque_id ?? null,
        override_motivo: (input.override_motivo ?? "").trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await assertCan(supabase, "manage.fila_cella", "você não pode registrar toques.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: ciclo, error: cicloErr } = await admin
      .from("fila_cella_ciclos")
      .select("id,frente,status,conta_id,bloqueado_ate")
      .eq("id", data.ciclo_id)
      .single();
    if (cicloErr) throw new Error(cicloErr.message);
    if (ciclo.status !== "aberto") throw new Error("Este ciclo está encerrado.");

    const { count } = await admin
      .from("fila_cella_toques")
      .select("id", { count: "exact", head: true })
      .eq("ciclo_id", data.ciclo_id);
    const jaFeitos = count ?? 0;

    if (jaFeitos >= 4) {
      // §6.5: mensagem de negócio, não erro de constraint cru.
      const base =
        "Este ciclo já teve 4 toques (playbook §4.6). Encerre o ciclo com motivo — " +
        "repetir a mesma oferta com outra palavra é o que caracteriza insistência.";
      if (await podeOverride(supabase)) {
        // O escape hatch do §6.5 existe na spec, mas o schema o proíbe:
        // `check (toque_num between 1 and 4)` recusaria o 5º mesmo com override.
        // Contradição declarada — não se resolve por código de aplicação.
        throw new Error(
          `${base} O 5º toque com override ainda não é possível: a constraint ` +
            "fila_cella_toques.toque_num (1 a 4) o recusa. Resolver a contradição da spec §6.5 " +
            "exige migration nova — está em DECISIONS.md como pendência.",
        );
      }
      throw new Error(base);
    }

    const { error } = await admin.from("fila_cella_toques").insert({
      ciclo_id: data.ciclo_id,
      toque_num: jaFeitos + 1,
      frente: ciclo.frente, // copia a do ciclo; a FK composta recusa divergência
      data: data.data,
      canal: data.canal,
      gatilho_ref: data.gatilho_ref,
      literal: data.literal,
      atesto_sem_citar_cliente: data.atesto_sem_citar_cliente,
      resposta: data.resposta,
      resultado: data.resultado,
      proximo_passo: data.proximo_passo,
      proximo_passo_em: data.proximo_passo_em,
      motivo: data.motivo,
      corrige_toque_id: data.corrige_toque_id,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    // O toque NÃO avança o estágio (playbook §5.1). Só espelha o próximo passo
    // na camada operada, que é o que a coluna 15 e o bloco de higiene leem.
    if (data.proximo_passo) {
      await admin.from("fila_cella_conta_operacao").upsert(
        {
          conta_id: ciclo.conta_id,
          proximo_passo: data.proximo_passo,
          proximo_passo_em: data.proximo_passo_em,
          atualizado_por: context.userId,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "conta_id" },
      );
    }
    return { ok: true, toque_num: jaFeitos + 1 };
  });

/**
 * Encerra o ciclo. `recusa_explicita` é o que separa 60 de 180 dias — e a tela
 * nunca oferece o mesmo botão para os dois casos: o operador precisa ver que
 * negar é diferente de não responder.
 */
export const encerrarCiclo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ciclo_id: number; motivo_saida: string; recusa_explicita: boolean }) => {
    const ciclo_id = Number(input?.ciclo_id);
    if (!Number.isInteger(ciclo_id) || ciclo_id <= 0) throw new Error("Ciclo inválido.");
    const motivo = (input.motivo_saida ?? "").trim();
    if (!motivo) throw new Error("Motivo de saída obrigatório.");
    return { ciclo_id, motivo_saida: motivo, recusa_explicita: !!input.recusa_explicita };
  })
  .handler(async ({ data, context }) => {
    await assertCan(
      context.supabase as any,
      "manage.fila_cella",
      "você não pode encerrar ciclos.",
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const encerrado = new Date();
    const bloqueio = new Date(encerrado);
    bloqueio.setDate(bloqueio.getDate() + (data.recusa_explicita ? 180 : 60));

    const { error } = await admin
      .from("fila_cella_ciclos")
      .update({
        status: "encerrado",
        encerrado_em: encerrado.toISOString().slice(0, 10),
        motivo_saida: data.motivo_saida,
        recusa_explicita: data.recusa_explicita,
        bloqueado_ate: bloqueio.toISOString().slice(0, 10),
      })
      .eq("id", data.ciclo_id)
      .eq("status", "aberto");
    if (error) throw new Error(error.message);
    return { ok: true, bloqueado_ate: bloqueio.toISOString().slice(0, 10) };
  });
