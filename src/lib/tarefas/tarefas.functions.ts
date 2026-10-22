import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BUCKET_ANEXOS,
  hojeSaoPaulo,
  LIMITE_ANEXO,
  PRIORIDADES,
  type Prioridade,
  type TarefaBase,
} from "./regras";

// A área Tarefas (contrato docs/design/contratos/tarefas.md).
//
// A REGRA NÃO MORA AQUI. Quem vê e quem escreve é o banco: RLS por ser membro do quadro e
// as funções `ops.tarefas_*` (migration 20261022120000). Toda leitura e escrita usa o
// cliente de quem está logado. O cliente de serviço só busca NOME e e-mail, e só das
// pessoas que a RLS já devolveu (membros dos quadros que a pessoa enxerga), como em
// equipe.functions.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function uuid(v: unknown, campo = "id"): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`${campo} inválido.`);
  return v;
}
function uuidOuNulo(v: unknown, campo: string): string | null {
  return v == null || v === "" ? null : uuid(v, campo);
}
function texto(v: unknown, campo: string, max: number, obrigatorio = true): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) {
    if (obrigatorio) throw new Error(`${campo} é obrigatório.`);
    return null;
  }
  if (s.length > max) throw new Error(`${campo} passa de ${max} caracteres.`);
  return s;
}

function falhou(error: { message?: string } | null, padrao: string): void {
  // As funções do banco já explicam o motivo em português; erro de RLS vira frase.
  if (!error) return;
  const m = error.message ?? "";
  if (/row-level security|permission denied/i.test(m))
    throw new Error("Você não tem acesso a este quadro.");
  throw new Error(m || padrao);
}

async function rpc(db: Cliente, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  falhou(error, "Não foi possível salvar.");
  return data;
}

export type Pessoa = { userId: string; nome: string; email: string };

async function nomes(ids: string[]): Promise<Map<string, Pessoa>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, Pessoa>();
  if (!unicos.length) return mapa;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as Cliente)
    .from("profiles")
    .select("user_id, nome, email")
    .in("user_id", unicos);
  for (const p of (data ?? []) as {
    user_id: string;
    nome: string | null;
    email: string | null;
  }[]) {
    mapa.set(p.user_id, {
      userId: p.user_id,
      nome: p.nome || p.email || "Sem nome",
      email: p.email ?? "",
    });
  }
  for (const id of unicos)
    if (!mapa.has(id)) mapa.set(id, { userId: id, nome: "Sem nome", email: "" });
  return mapa;
}

// ------------------------------------------------------------------ tipos

export type Coluna = { id: string; nome: string; ordem: number; concluida: boolean };
export type Projeto = { id: string; nome: string; arquivado: boolean };
export type Departamento = { id: string; nome: string; ativo: boolean };
export type Membro = Pessoa & { papel: "dono" | "membro" };
export type Tarefa = TarefaBase & {
  colunaId: string;
  ordem: number;
  criadoPor: string;
  criadoEm: string;
  concluidaEm: string | null;
  comentarios: number;
};
export type QuadroResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  meuPapel: "dono" | "membro";
  membros: number;
  abertas: number;
  atrasadas: number;
};
export type QuadroCompleto = {
  quadro: { id: string; nome: string; descricao: string | null; meuPapel: "dono" | "membro" };
  colunas: Coluna[];
  membros: Membro[];
  projetos: Projeto[];
  departamentos: Departamento[];
  tarefas: Tarefa[];
};

type LinhaTarefa = {
  id: string;
  quadro_id: string;
  coluna_id: string;
  ordem: number;
  titulo: string;
  descricao: string | null;
  responsavel_id: string | null;
  prazo: string | null;
  prioridade: Prioridade;
  projeto_id: string | null;
  departamento_id: string | null;
  criado_por: string;
  criado_em: string;
  concluida_em: string | null;
  tarefas_comentarios?: { count: number }[];
};

const COLUNAS_TAREFA =
  "id, quadro_id, coluna_id, ordem, titulo, descricao, responsavel_id, prazo, prioridade, projeto_id, departamento_id, criado_por, criado_em, concluida_em, tarefas_comentarios(count)";

function paraTarefa(l: LinhaTarefa, concluidas: Set<string>): Tarefa {
  return {
    id: l.id,
    quadroId: l.quadro_id,
    colunaId: l.coluna_id,
    ordem: Number(l.ordem),
    titulo: l.titulo,
    descricao: l.descricao,
    responsavelId: l.responsavel_id,
    prazo: l.prazo,
    prioridade: l.prioridade,
    projetoId: l.projeto_id,
    departamentoId: l.departamento_id,
    criadoPor: l.criado_por,
    criadoEm: l.criado_em,
    concluidaEm: l.concluida_em,
    concluida: concluidas.has(l.coluna_id),
    comentarios: l.tarefas_comentarios?.[0]?.count ?? 0,
  };
}

async function departamentos(db: Cliente): Promise<Departamento[]> {
  const { data, error } = await db
    .from("tarefas_departamentos")
    .select("id, nome, ativo")
    .order("nome");
  falhou(error, "Não foi possível ler os departamentos.");
  return ((data ?? []) as Departamento[]).map((d) => ({ id: d.id, nome: d.nome, ativo: d.ativo }));
}

// ------------------------------------------------------------------ leitura

/** Os quadros de que sou membro, com as contagens do cartão. */
export const listarQuadros = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QuadroResumo[]> => {
    const db = context.supabase as Cliente;
    const eu = context.userId;
    const { data: qs, error } = await db
      .from("tarefas_quadros")
      .select("id, nome, descricao, tarefas_membros(user_id, papel)")
      .is("arquivado_em", null)
      .order("nome");
    falhou(error, "Não foi possível ler os quadros.");
    const quadros = (qs ?? []) as {
      id: string;
      nome: string;
      descricao: string | null;
      tarefas_membros: { user_id: string; papel: "dono" | "membro" }[];
    }[];
    if (!quadros.length) return [];
    const ids = quadros.map((q) => q.id);
    const [{ data: cols }, { data: ts }] = await Promise.all([
      db.from("tarefas_colunas").select("id, concluida").in("quadro_id", ids),
      db.from("tarefas").select("quadro_id, coluna_id, prazo").in("quadro_id", ids),
    ]);
    const concluidas = new Set(
      ((cols ?? []) as { id: string; concluida: boolean }[])
        .filter((c) => c.concluida)
        .map((c) => c.id),
    );
    const hoje = hojeSaoPaulo();
    return quadros.map((q) => {
      const abertas = (
        (ts ?? []) as { quadro_id: string; coluna_id: string; prazo: string | null }[]
      ).filter((t) => t.quadro_id === q.id && !concluidas.has(t.coluna_id));
      return {
        id: q.id,
        nome: q.nome,
        descricao: q.descricao,
        meuPapel: q.tarefas_membros.find((m) => m.user_id === eu)?.papel ?? "membro",
        membros: q.tarefas_membros.length,
        abertas: abertas.length,
        atrasadas: abertas.filter((t) => t.prazo && t.prazo < hoje).length,
      };
    });
  });

/** Um quadro inteiro: colunas, membros, projetos, departamentos e tarefas. */
export const carregarQuadro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { quadroId: string }) => ({ quadroId: uuid(input?.quadroId, "Quadro") }))
  .handler(async ({ data, context }): Promise<QuadroCompleto | null> => {
    const db = context.supabase as Cliente;
    const { data: q, error } = await db
      .from("tarefas_quadros")
      .select("id, nome, descricao, arquivado_em")
      .eq("id", data.quadroId)
      .maybeSingle();
    falhou(error, "Não foi possível ler o quadro.");
    // Não é membro, ou o quadro não existe: a RLS não diz qual, e a tela também não.
    if (!q || q.arquivado_em) return null;

    const [colsR, membrosR, projR, deps, tsR] = await Promise.all([
      db
        .from("tarefas_colunas")
        .select("id, nome, ordem, concluida")
        .eq("quadro_id", q.id)
        .order("ordem"),
      db.from("tarefas_membros").select("user_id, papel").eq("quadro_id", q.id),
      db
        .from("tarefas_projetos")
        .select("id, nome, arquivado_em")
        .eq("quadro_id", q.id)
        .order("nome"),
      departamentos(db),
      db.from("tarefas").select(COLUNAS_TAREFA).eq("quadro_id", q.id).order("ordem").limit(1000),
    ]);
    falhou(
      colsR.error ?? membrosR.error ?? projR.error ?? tsR.error,
      "Não foi possível ler o quadro.",
    );
    const colunas = (colsR.data ?? []) as Coluna[];
    const concluidas = new Set(colunas.filter((c) => c.concluida).map((c) => c.id));
    const ms = (membrosR.data ?? []) as { user_id: string; papel: "dono" | "membro" }[];
    const pessoas = await nomes(ms.map((m) => m.user_id));
    const membros = ms
      .map((m) => ({ ...(pessoas.get(m.user_id) as Pessoa), papel: m.papel }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return {
      quadro: {
        id: q.id,
        nome: q.nome,
        descricao: q.descricao,
        meuPapel: ms.find((m) => m.user_id === context.userId)?.papel ?? "membro",
      },
      colunas,
      membros,
      projetos: (
        (projR.data ?? []) as { id: string; nome: string; arquivado_em: string | null }[]
      ).map((p) => ({
        id: p.id,
        nome: p.nome,
        arquivado: !!p.arquivado_em,
      })),
      departamentos: deps,
      tarefas: ((tsR.data ?? []) as LinhaTarefa[]).map((l) => paraTarefa(l, concluidas)),
    };
  });

export type MinhasTarefas = {
  tarefas: Tarefa[];
  quadros: { id: string; nome: string }[];
  colunas: (Coluna & { quadroId: string })[];
  projetos: (Projeto & { quadroId: string })[];
  departamentos: Departamento[];
};

/** Tudo o que está comigo, em todos os quadros de que sou membro. */
export const carregarMinhasTarefas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MinhasTarefas> => {
    const db = context.supabase as Cliente;
    const [qsR, tsR, deps] = await Promise.all([
      db.from("tarefas_quadros").select("id, nome").is("arquivado_em", null).order("nome"),
      db.from("tarefas").select(COLUNAS_TAREFA).eq("responsavel_id", context.userId).limit(2000),
      departamentos(db),
    ]);
    falhou(qsR.error ?? tsR.error, "Não foi possível ler as tarefas.");
    const quadros = (qsR.data ?? []) as { id: string; nome: string }[];
    const ativos = new Set(quadros.map((q) => q.id));
    const ids = [...ativos];
    const [colsR, projR] = ids.length
      ? await Promise.all([
          db
            .from("tarefas_colunas")
            .select("id, quadro_id, nome, ordem, concluida")
            .in("quadro_id", ids)
            .order("ordem"),
          db
            .from("tarefas_projetos")
            .select("id, quadro_id, nome, arquivado_em")
            .in("quadro_id", ids)
            .order("nome"),
        ])
      : [{ data: [] }, { data: [] }];
    const colunas = ((colsR.data ?? []) as (Coluna & { quadro_id: string })[]).map((c) => ({
      id: c.id,
      quadroId: c.quadro_id,
      nome: c.nome,
      ordem: c.ordem,
      concluida: c.concluida,
    }));
    const concluidas = new Set(colunas.filter((c) => c.concluida).map((c) => c.id));
    return {
      // Quadro arquivado some de Minhas tarefas (contrato: Arquivar quadro).
      tarefas: ((tsR.data ?? []) as LinhaTarefa[])
        .filter((l) => ativos.has(l.quadro_id))
        .map((l) => paraTarefa(l, concluidas)),
      quadros,
      colunas,
      projetos: (
        (projR.data ?? []) as {
          id: string;
          quadro_id: string;
          nome: string;
          arquivado_em: string | null;
        }[]
      ).map((p) => ({
        id: p.id,
        quadroId: p.quadro_id,
        nome: p.nome,
        arquivado: !!p.arquivado_em,
      })),
      departamentos: deps,
    };
  });

export type Comentario = {
  id: string;
  autor: Pessoa;
  texto: string;
  criadoEm: string;
  editadoEm: string | null;
  meu: boolean;
};
export type Evento = {
  id: number;
  autor: Pessoa | null;
  campo: string;
  de: string | null;
  para: string | null;
  criadoEm: string;
};

/** Comentários e histórico de uma tarefa (a ficha). */
export const carregarConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tarefaId: string }) => ({ tarefaId: uuid(input?.tarefaId, "Tarefa") }))
  .handler(async ({ data, context }): Promise<{ comentarios: Comentario[]; eventos: Evento[] }> => {
    const db = context.supabase as Cliente;
    const [cR, eR] = await Promise.all([
      db
        .from("tarefas_comentarios")
        .select("id, autor_id, texto, criado_em, editado_em")
        .eq("tarefa_id", data.tarefaId)
        .is("apagado_em", null)
        .order("criado_em"),
      db
        .from("tarefas_eventos")
        .select("id, autor_id, campo, de, para, criado_em")
        .eq("tarefa_id", data.tarefaId)
        .order("criado_em"),
    ]);
    falhou(cR.error ?? eR.error, "Não foi possível ler a conversa.");
    const cs = (cR.data ?? []) as {
      id: string;
      autor_id: string;
      texto: string;
      criado_em: string;
      editado_em: string | null;
    }[];
    const es = (eR.data ?? []) as {
      id: number;
      autor_id: string | null;
      campo: string;
      de: string | null;
      para: string | null;
      criado_em: string;
    }[];
    const pessoas = await nomes([...cs.map((c) => c.autor_id), ...es.map((e) => e.autor_id ?? "")]);
    return {
      comentarios: cs.map((c) => ({
        id: c.id,
        autor: pessoas.get(c.autor_id) as Pessoa,
        texto: c.texto,
        criadoEm: c.criado_em,
        editadoEm: c.editado_em,
        meu: c.autor_id === context.userId,
      })),
      eventos: es.map((e) => ({
        id: e.id,
        autor: e.autor_id ? (pessoas.get(e.autor_id) ?? null) : null,
        campo: e.campo,
        de: e.de,
        para: e.para,
        criadoEm: e.criado_em,
      })),
    };
  });

// ------------------------------------------------------------------ quadro e membros

export const criarQuadro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nome: string; descricao?: string }) => ({
    nome: texto(input?.nome, "Nome", 120) as string,
    descricao: texto(input?.descricao, "Descrição", 2000, false),
  }))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const id = await rpc(context.supabase, "tarefas_criar_quadro", {
      _nome: data.nome,
      _descricao: data.descricao,
    });
    return { id: String(id) };
  });

export const editarQuadro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      quadroId: string;
      nome?: string;
      descricao?: string | null;
      arquivar?: boolean;
    }) => ({
      quadroId: uuid(input?.quadroId, "Quadro"),
      nome: input?.nome === undefined ? undefined : (texto(input.nome, "Nome", 120) as string),
      descricao:
        input?.descricao === undefined
          ? undefined
          : texto(input.descricao, "Descrição", 2000, false),
      arquivar: input?.arquivar === true,
    }),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.descricao !== undefined) patch.descricao = data.descricao;
    if (data.arquivar) patch.arquivado_em = new Date().toISOString();
    const { data: linhas, error } = await (context.supabase as Cliente)
      .from("tarefas_quadros")
      .update(patch)
      .eq("id", data.quadroId)
      .select("id");
    falhou(error, "Não foi possível salvar o quadro.");
    if (!linhas?.length) throw new Error("Só o dono do quadro muda nome, descrição ou arquiva.");
    return { ok: true };
  });

export const buscarPessoas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { quadroId: string; texto: string }) => ({
    quadroId: uuid(input?.quadroId, "Quadro"),
    texto: String(input?.texto ?? "").slice(0, 80),
  }))
  .handler(async ({ data, context }): Promise<Pessoa[]> => {
    const linhas = (await rpc(context.supabase, "tarefas_buscar_pessoas", {
      _quadro: data.quadroId,
      _texto: data.texto,
    })) as { user_id: string; nome: string | null; email: string }[] | null;
    return (linhas ?? []).map((l) => ({
      userId: l.user_id,
      nome: l.nome || l.email,
      email: l.email,
    }));
  });

export const convidar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { quadroId: string; userId: string }) => ({
    quadroId: uuid(input?.quadroId, "Quadro"),
    userId: uuid(input?.userId, "Pessoa"),
  }))
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "tarefas_convidar", { _quadro: data.quadroId, _user: data.userId });
    return { ok: true };
  });

export const mudarPapel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { quadroId: string; userId: string; papel: string }) => {
    if (input?.papel !== "dono" && input?.papel !== "membro") throw new Error("Papel inválido.");
    return {
      quadroId: uuid(input.quadroId, "Quadro"),
      userId: uuid(input.userId, "Pessoa"),
      papel: input.papel,
    };
  })
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "tarefas_mudar_papel", {
      _quadro: data.quadroId,
      _user: data.userId,
      _papel: data.papel,
    });
    return { ok: true };
  });

export const removerMembro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { quadroId: string; userId: string }) => ({
    quadroId: uuid(input?.quadroId, "Quadro"),
    userId: uuid(input?.userId, "Pessoa"),
  }))
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "tarefas_remover_membro", {
      _quadro: data.quadroId,
      _user: data.userId,
    });
    return { ok: true };
  });

// ------------------------------------------------------------------ colunas e projetos

export const salvarColuna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      quadroId: string;
      id?: string;
      nome?: string;
      ordem?: number;
      concluida?: boolean;
    }) => ({
      quadroId: uuid(input?.quadroId, "Quadro"),
      id: input?.id ? uuid(input.id, "Coluna") : undefined,
      nome:
        input?.nome === undefined ? undefined : (texto(input.nome, "Nome da coluna", 60) as string),
      ordem:
        typeof input?.ordem === "number" && Number.isFinite(input.ordem)
          ? Math.round(input.ordem)
          : undefined,
      concluida: typeof input?.concluida === "boolean" ? input.concluida : undefined,
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    const patch: Record<string, unknown> = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.ordem !== undefined) patch.ordem = data.ordem;
    if (data.concluida !== undefined) patch.concluida = data.concluida;
    if (!data.id) {
      if (!data.nome) throw new Error("Nome da coluna é obrigatório.");
      const { error } = await db
        .from("tarefas_colunas")
        .insert({ quadro_id: data.quadroId, ...patch });
      falhou(error, "Não foi possível criar a coluna.");
      return { ok: true };
    }
    const { data: linhas, error } = await db
      .from("tarefas_colunas")
      .update(patch)
      .eq("id", data.id)
      .eq("quadro_id", data.quadroId)
      .select("id");
    falhou(error, "Não foi possível salvar a coluna.");
    if (!linhas?.length) throw new Error("Só o dono do quadro mexe nas colunas.");
    return { ok: true };
  });

export const apagarColuna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { colunaId: string; destinoId?: string | null }) => ({
    colunaId: uuid(input?.colunaId, "Coluna"),
    destinoId: uuidOuNulo(input?.destinoId, "Coluna de destino"),
  }))
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "tarefas_apagar_coluna", {
      _coluna: data.colunaId,
      _destino: data.destinoId,
    });
    return { ok: true };
  });

export const salvarProjeto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { quadroId: string; id?: string; nome?: string; arquivar?: boolean }) => ({
      quadroId: uuid(input?.quadroId, "Quadro"),
      id: input?.id ? uuid(input.id, "Projeto") : undefined,
      nome:
        input?.nome === undefined
          ? undefined
          : (texto(input.nome, "Nome do projeto", 80) as string),
      arquivar: typeof input?.arquivar === "boolean" ? input.arquivar : undefined,
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    if (!data.id) {
      if (!data.nome) throw new Error("Nome do projeto é obrigatório.");
      const { error } = await db
        .from("tarefas_projetos")
        .insert({ quadro_id: data.quadroId, nome: data.nome });
      falhou(error, "Não foi possível criar o projeto.");
      return { ok: true };
    }
    const patch: Record<string, unknown> = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.arquivar !== undefined)
      patch.arquivado_em = data.arquivar ? new Date().toISOString() : null;
    const { data: linhas, error } = await db
      .from("tarefas_projetos")
      .update(patch)
      .eq("id", data.id)
      .eq("quadro_id", data.quadroId)
      .select("id");
    falhou(error, "Não foi possível salvar o projeto.");
    if (!linhas?.length) throw new Error("Só o dono do quadro mexe nos projetos.");
    return { ok: true };
  });

// ------------------------------------------------------------------ departamentos

export const listarDepartamentos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Departamento[]> => departamentos(context.supabase));

export const salvarDepartamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; nome?: string; ativo?: boolean }) => ({
    id: input?.id ? uuid(input.id, "Departamento") : undefined,
    nome:
      input?.nome === undefined
        ? undefined
        : (texto(input.nome, "Nome do departamento", 80) as string),
    ativo: typeof input?.ativo === "boolean" ? input.ativo : undefined,
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    if (!data.id) {
      if (!data.nome) throw new Error("Nome do departamento é obrigatório.");
      const { error } = await db.from("tarefas_departamentos").insert({ nome: data.nome });
      if (error?.code === "23505") throw new Error("Já existe um departamento com esse nome.");
      falhou(error, "Não foi possível criar o departamento.");
      return { ok: true };
    }
    const patch: Record<string, unknown> = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.ativo !== undefined) patch.ativo = data.ativo;
    const { data: linhas, error } = await db
      .from("tarefas_departamentos")
      .update(patch)
      .eq("id", data.id)
      .select("id");
    if (error?.code === "23505") throw new Error("Já existe um departamento com esse nome.");
    falhou(error, "Não foi possível salvar o departamento.");
    if (!linhas?.length) throw new Error("Só a administração mexe nos departamentos.");
    return { ok: true };
  });

// ------------------------------------------------------------------ tarefas

type EntradaTarefa = {
  titulo?: string;
  descricao?: string | null;
  responsavelId?: string | null;
  prazo?: string | null;
  prioridade?: string;
  projetoId?: string | null;
  departamentoId?: string | null;
  colunaId?: string;
  ordem?: number;
};

// Prazo e responsável são obrigatórios (DECISIONS 22/10): não nascem vazios e não se apagam.
// O banco confere o mesmo (migration 20261022193000); aqui é só para a mensagem chegar antes.
function patchDaTarefa(input: EntradaTarefa): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (input.titulo !== undefined) p.titulo = texto(input.titulo, "Título", 200);
  if (input.descricao !== undefined)
    p.descricao = texto(input.descricao, "Descrição", 10000, false);
  if (input.responsavelId !== undefined) {
    if (!input.responsavelId) throw new Error("Toda tarefa precisa de responsável.");
    p.responsavel_id = uuid(input.responsavelId, "Responsável");
  }
  if (input.prazo !== undefined) {
    if (!input.prazo) throw new Error("Toda tarefa precisa de prazo de entrega.");
    if (!DATA_RE.test(input.prazo)) throw new Error("Prazo inválido.");
    p.prazo = input.prazo;
  }
  if (input.prioridade !== undefined) {
    if (!PRIORIDADES.includes(input.prioridade as Prioridade))
      throw new Error("Prioridade inválida.");
    p.prioridade = input.prioridade;
  }
  if (input.projetoId !== undefined) p.projeto_id = uuidOuNulo(input.projetoId, "Projeto");
  if (input.departamentoId !== undefined)
    p.departamento_id = uuidOuNulo(input.departamentoId, "Departamento");
  if (input.colunaId !== undefined) p.coluna_id = uuid(input.colunaId, "Coluna");
  if (input.ordem !== undefined) {
    if (typeof input.ordem !== "number" || !Number.isFinite(input.ordem))
      throw new Error("Ordem inválida.");
    p.ordem = input.ordem;
  }
  return p;
}

export const criarTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EntradaTarefa & { quadroId: string }) => ({
    quadroId: uuid(input?.quadroId, "Quadro"),
    patch: patchDaTarefa({
      ...input,
      titulo: input?.titulo ?? "",
      prazo: input?.prazo ?? "",
      responsavelId: input?.responsavelId ?? "",
    }),
  }))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    if (!data.patch.coluna_id) throw new Error("Coluna é obrigatória.");
    const { data: linha, error } = await (context.supabase as Cliente)
      .from("tarefas")
      .insert({ ...data.patch, quadro_id: data.quadroId, criado_por: context.userId })
      .select("id")
      .single();
    falhou(error, "Não foi possível criar a tarefa.");
    return { id: linha.id };
  });

export const editarTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EntradaTarefa & { id: string }) => ({
    id: uuid(input?.id, "Tarefa"),
    patch: patchDaTarefa(input ?? {}),
  }))
  .handler(async ({ data, context }) => {
    if (!Object.keys(data.patch).length) return { ok: true };
    const { data: linhas, error } = await (context.supabase as Cliente)
      .from("tarefas")
      .update(data.patch)
      .eq("id", data.id)
      .select("id");
    falhou(error, "Não foi possível salvar a tarefa.");
    if (!linhas?.length) throw new Error("Você não tem acesso a esta tarefa.");
    return { ok: true };
  });

export const apagarTarefa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: uuid(input?.id, "Tarefa") }))
  .handler(async ({ data, context }) => {
    const { data: linhas, error } = await (context.supabase as Cliente)
      .from("tarefas")
      .delete()
      .eq("id", data.id)
      .select("id");
    falhou(error, "Não foi possível apagar a tarefa.");
    if (!linhas?.length) throw new Error("Só quem criou a tarefa ou o dono do quadro apaga.");
    return { ok: true };
  });

// ------------------------------------------------------------------ comentários

export const comentar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tarefaId: string; texto: string }) => ({
    tarefaId: uuid(input?.tarefaId, "Tarefa"),
    texto: texto(input?.texto, "Comentário", 5000) as string,
  }))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as Cliente)
      .from("tarefas_comentarios")
      .insert({ tarefa_id: data.tarefaId, autor_id: context.userId, texto: data.texto });
    falhou(error, "Não foi possível comentar.");
    return { ok: true };
  });

export const editarComentario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; texto?: string; apagar?: boolean }) => ({
    id: uuid(input?.id, "Comentário"),
    texto: input?.apagar ? undefined : (texto(input?.texto, "Comentário", 5000) as string),
    apagar: input?.apagar === true,
  }))
  .handler(async ({ data, context }) => {
    const agora = new Date().toISOString();
    const patch = data.apagar ? { apagado_em: agora } : { texto: data.texto, editado_em: agora };
    const { data: linhas, error } = await (context.supabase as Cliente)
      .from("tarefas_comentarios")
      .update(patch)
      .eq("id", data.id)
      .select("id");
    falhou(error, "Não foi possível salvar o comentário.");
    if (!linhas?.length) throw new Error("Só quem escreveu edita ou apaga o comentário.");
    return { ok: true };
  });

// ------------------------------------------------------------------ anexos
//
// O navegador sobe o arquivo direto no bucket `tarefas-anexos` (a policy do Storage confere se é
// membro do quadro, pela primeira pasta do caminho) e depois registra a linha aqui. Baixar é por
// link assinado de 1 minuto, gerado com o cliente de quem está logado.

export type Anexo = {
  id: string;
  nome: string;
  tamanho: number;
  tipo: string | null;
  enviadoPor: Pessoa | null;
  criadoEm: string;
  meu: boolean;
};

export const listarAnexos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tarefaId: string }) => ({ tarefaId: uuid(input?.tarefaId, "Tarefa") }))
  .handler(async ({ data, context }): Promise<Anexo[]> => {
    const { data: linhas, error } = await (context.supabase as Cliente)
      .from("tarefas_anexos")
      .select("id, nome, tamanho, tipo, enviado_por, criado_em")
      .eq("tarefa_id", data.tarefaId)
      .order("criado_em");
    falhou(error, "Não foi possível ler os anexos.");
    const as = (linhas ?? []) as {
      id: string;
      nome: string;
      tamanho: number;
      tipo: string | null;
      enviado_por: string;
      criado_em: string;
    }[];
    const pessoas = await nomes(as.map((a) => a.enviado_por));
    return as.map((a) => ({
      id: a.id,
      nome: a.nome,
      tamanho: Number(a.tamanho),
      tipo: a.tipo,
      enviadoPor: pessoas.get(a.enviado_por) ?? null,
      criadoEm: a.criado_em,
      meu: a.enviado_por === context.userId,
    }));
  });

export const registrarAnexo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      tarefaId: string;
      quadroId: string;
      caminho: string;
      nome: string;
      tamanho: number;
      tipo?: string | null;
    }) => {
      const tarefaId = uuid(input?.tarefaId, "Tarefa");
      const quadroId = uuid(input?.quadroId, "Quadro");
      const caminho = texto(input?.caminho, "Caminho", 1024) as string;
      if (!caminho.startsWith(`${quadroId}/${tarefaId}/`))
        throw new Error("Caminho do anexo inválido.");
      const tamanho = Number(input?.tamanho);
      if (!Number.isFinite(tamanho) || tamanho < 0 || tamanho > LIMITE_ANEXO)
        throw new Error("O arquivo passa de 25 MB.");
      return {
        tarefaId,
        quadroId,
        caminho,
        nome: texto(input?.nome, "Nome do arquivo", 255) as string,
        tamanho,
        tipo: texto(input?.tipo, "Tipo", 255, false),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as Cliente).from("tarefas_anexos").insert({
      tarefa_id: data.tarefaId,
      quadro_id: data.quadroId,
      caminho: data.caminho,
      nome: data.nome,
      tamanho: data.tamanho,
      tipo: data.tipo,
      enviado_por: context.userId,
    });
    falhou(error, "Não foi possível registrar o anexo.");
    return { ok: true };
  });

export const linkAnexo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: uuid(input?.id, "Anexo") }))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const db = context.supabase as Cliente;
    const { data: a, error } = await db
      .from("tarefas_anexos")
      .select("caminho, nome")
      .eq("id", data.id)
      .maybeSingle();
    falhou(error, "Não foi possível abrir o anexo.");
    if (!a) throw new Error("Anexo não encontrado.");
    const { data: assinado, error: sErr } = await db.storage
      .from(BUCKET_ANEXOS)
      .createSignedUrl(a.caminho, 60, { download: a.nome });
    if (sErr || !assinado?.signedUrl)
      throw new Error(sErr?.message ?? "Não foi possível abrir o anexo.");
    return { url: assinado.signedUrl };
  });

export const apagarAnexo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: uuid(input?.id, "Anexo") }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    const { data: linhas, error } = await db
      .from("tarefas_anexos")
      .delete()
      .eq("id", data.id)
      .select("caminho");
    falhou(error, "Não foi possível apagar o anexo.");
    if (!linhas?.length) throw new Error("Só quem anexou ou o dono do quadro apaga o anexo.");
    // A linha já saiu; se o arquivo não sair, sobra só o objeto no bucket (sem link para ninguém).
    await db.storage.from(BUCKET_ANEXOS).remove([linhas[0].caminho]);
    return { ok: true };
  });
