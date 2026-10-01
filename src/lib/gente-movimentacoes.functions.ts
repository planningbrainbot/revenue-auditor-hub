import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { enviarEmailAcesso as enviarEmail } from "@/lib/email-access.server";
import {
  fmtSalario,
  gerarPdf,
  gerarXlsx,
  nomeArquivo,
  type MovimentacaoDocumento,
} from "@/lib/gente-movimentacao-documento";

// Salário e movimentações do Planning People (01/10/2026, pedido do RH de
// Maceió). Tudo roda como o usuário: as tabelas só abrem com
// `manage.gente.remuneracao`, que mora na área própria `people_remuneracao`
// (migration 20261002100000), e a RESTRICTIVE prende na unidade.
//
// Fluxo: rascunho → enviada (o RH aprova ao enviar ao DP, decisão do dono) →
// aplicada no dia da vigência, por `ops.gente_aplicar_movimentacoes()`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

const CHAVE = "manage.gente.remuneracao";
const VINCULOS: Record<string, string> = {
  socio: "Sócio",
  clt: "CLT",
  pj: "PJ",
  estagio: "Estágio",
  prolabore: "Pró-labore",
  terceiro: "Terceiro",
};

export const MOTIVOS_MOVIMENTACAO = [
  "Promoção",
  "Mérito",
  "Reajuste",
  "Mudança de função",
  "Mudança de setor",
  "Mudança de gestor",
  "Efetivação",
  "Enquadramento",
  "Outro",
];

export interface PessoaRemuneracao {
  id: number;
  nome: string;
  email: string | null;
  cargo: string | null;
  departamento: string | null;
  gestorId: number | null;
  gestorNome: string | null;
  vinculo: string | null;
  unidadeId: number | null;
  unidade: string | null;
  status: string;
  admissao: string | null;
  salarioAtual: number | null;
  salarioVigencia: string | null;
}

export interface MovimentacaoRow {
  id: number;
  pessoaId: number;
  pessoaNome: string;
  unidade: string | null;
  vigencia: string;
  motivo: string | null;
  observacao: string | null;
  status: "rascunho" | "enviada" | "cancelada";
  enviadaEm: string | null;
  enviadaPara: string | null;
  aplicadaEm: string | null;
  mudancas: [string, string, string][];
  criadoPor: string | null;
}

export interface MovimentacoesResult {
  podeVer: boolean;
  unidades: { id: number; nome: string; emailDp: string | null }[];
  pessoas: PessoaRemuneracao[];
  movimentacoes: MovimentacaoRow[];
}

type MovDB = {
  id: number;
  pessoa_id: number;
  vigencia: string;
  motivo: string | null;
  observacao: string | null;
  salario_antes: number | null;
  salario_depois: number | null;
  cargo_antes: string | null;
  cargo_depois: string | null;
  departamento_antes: string | null;
  departamento_depois: string | null;
  gestor_antes_id: number | null;
  gestor_depois_id: number | null;
  vinculo_antes: string | null;
  vinculo_depois: string | null;
  status: MovimentacaoRow["status"];
  enviada_em: string | null;
  enviada_para: string | null;
  aplicada_em: string | null;
  criado_por: string | null;
};

const MOV_COLS =
  "id,pessoa_id,vigencia,motivo,observacao,salario_antes,salario_depois,cargo_antes,cargo_depois,departamento_antes,departamento_depois,gestor_antes_id,gestor_depois_id,vinculo_antes,vinculo_depois,status,enviada_em,enviada_para,aplicada_em,criado_por";

function mudancasDe(m: MovDB, nome: (id: number | null) => string): [string, string, string][] {
  const out: [string, string, string][] = [];
  if (m.salario_depois != null)
    out.push(["Salário", fmtSalario(m.salario_antes), fmtSalario(m.salario_depois)]);
  if (m.cargo_depois != null) out.push(["Cargo", m.cargo_antes ?? "—", m.cargo_depois]);
  if (m.departamento_depois != null)
    out.push(["Departamento", m.departamento_antes ?? "—", m.departamento_depois]);
  if (m.gestor_depois_id != null)
    out.push(["Gestor", nome(m.gestor_antes_id), nome(m.gestor_depois_id)]);
  if (m.vinculo_depois != null)
    out.push([
      "Vínculo",
      m.vinculo_antes ? (VINCULOS[m.vinculo_antes] ?? m.vinculo_antes) : "—",
      VINCULOS[m.vinculo_depois] ?? m.vinculo_depois,
    ]);
  return out;
}

async function temChave(supabase: Cliente, userId: string) {
  const acesso = await acessoDoUsuario(supabase, userId);
  return (acesso.permissions as string[]).includes(CHAVE);
}

/** Paginado: o PostgREST corta em 1000 linhas por resposta. */
async function todas<T>(
  consulta: (de: number, ate: number) => Promise<{ data: T[] | null; error: unknown }>,
) {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error((error as { message: string }).message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function nomesDeAutores(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as Cliente)
    .from("profiles")
    .select("user_id,nome")
    .in("user_id", ids);
  return new Map<string, string>(
    ((data ?? []) as { user_id: string; nome: string | null }[]).map((p) => [
      p.user_id,
      p.nome ?? "",
    ]),
  );
}

export const listMovimentacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MovimentacoesResult> => {
    const supabase = context.supabase as Cliente;
    if (!(await temChave(supabase, context.userId))) {
      return { podeVer: false, unidades: [], pessoas: [], movimentacoes: [] };
    }

    const [pessoasDB, salariosDB, movsDB, unidadesRes, cfgRes] = await Promise.all([
      todas<{
        id: number;
        nome_completo: string;
        email: string | null;
        cargo: string | null;
        departamento: string | null;
        gestor_id: number | null;
        tipo_vinculo: string | null;
        unidade_id: number | null;
        status: string;
        data_admissao: string | null;
      }>((de, ate) =>
        supabase
          .from("gente_pessoas")
          .select(
            "id,nome_completo,email,cargo,departamento,gestor_id,tipo_vinculo,unidade_id,status,data_admissao",
          )
          .order("nome_completo")
          .range(de, ate),
      ),
      todas<{ pessoa_id: number; salario: number; vigencia: string }>((de, ate) =>
        supabase
          .from("gente_remuneracao")
          .select("pessoa_id,salario,vigencia")
          .order("vigencia", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      ),
      todas<MovDB>((de, ate) =>
        supabase
          .from("gente_movimentacoes")
          .select(MOV_COLS)
          .order("criado_em", { ascending: false })
          .range(de, ate),
      ),
      supabase.from("unidades").select("id,nome_da_praca"),
      supabase.from("gente_config_unidade").select("unidade_id,email_dp"),
    ]);

    const nomeUnidade = new Map<number, string>(
      ((unidadesRes?.data ?? []) as { id: number; nome_da_praca: string }[]).map((u) => [
        u.id,
        u.nome_da_praca,
      ]),
    );
    const nomePessoa = new Map<number, string>(pessoasDB.map((p) => [p.id, p.nome_completo]));
    const nome = (id: number | null) => (id == null ? "—" : (nomePessoa.get(id) ?? "—"));

    // Salário atual = a vigência mais recente que já começou.
    // Data de Brasília: depois das 21h o UTC já virou o dia.
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const atual = new Map<number, { salario: number; vigencia: string }>();
    for (const s of salariosDB) {
      if (s.vigencia > hoje || atual.has(s.pessoa_id)) continue;
      atual.set(s.pessoa_id, { salario: Number(s.salario), vigencia: s.vigencia });
    }

    const pessoas: PessoaRemuneracao[] = pessoasDB
      .filter((p) => p.status !== "desligado")
      .map((p) => ({
        id: p.id,
        nome: p.nome_completo,
        email: p.email,
        cargo: p.cargo,
        departamento: p.departamento,
        gestorId: p.gestor_id,
        gestorNome: p.gestor_id != null ? (nomePessoa.get(p.gestor_id) ?? null) : null,
        vinculo: p.tipo_vinculo,
        unidadeId: p.unidade_id,
        unidade: p.unidade_id != null ? (nomeUnidade.get(p.unidade_id) ?? null) : null,
        status: p.status,
        admissao: p.data_admissao,
        salarioAtual: atual.get(p.id)?.salario ?? null,
        salarioVigencia: atual.get(p.id)?.vigencia ?? null,
      }));

    const unidadeDaPessoa = new Map(pessoasDB.map((p) => [p.id, p.unidade_id]));
    const autores = await nomesDeAutores(
      Array.from(new Set(movsDB.map((m) => m.criado_por).filter(Boolean))) as string[],
    );
    const movimentacoes: MovimentacaoRow[] = movsDB.map((m) => {
      const u = unidadeDaPessoa.get(m.pessoa_id);
      return {
        id: m.id,
        pessoaId: m.pessoa_id,
        pessoaNome: nome(m.pessoa_id),
        unidade: u != null ? (nomeUnidade.get(u) ?? null) : null,
        vigencia: m.vigencia,
        motivo: m.motivo,
        observacao: m.observacao,
        status: m.status,
        enviadaEm: m.enviada_em,
        enviadaPara: m.enviada_para,
        aplicadaEm: m.aplicada_em,
        mudancas: mudancasDe(m, nome),
        criadoPor: m.criado_por ? autores.get(m.criado_por) || null : null,
      };
    });

    const cfg = new Map<number, string | null>(
      ((cfgRes?.data ?? []) as { unidade_id: number; email_dp: string | null }[]).map((c) => [
        c.unidade_id,
        c.email_dp,
      ]),
    );
    const idsUnidade = Array.from(
      new Set(pessoas.map((p) => p.unidadeId).filter((x): x is number => x != null)),
    );
    const unidades = idsUnidade
      .map((id) => ({ id, nome: nomeUnidade.get(id) ?? String(id), emailDp: cfg.get(id) ?? null }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    return { podeVer: true, unidades, pessoas, movimentacoes };
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const salvarEmailDp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { unidadeId: number; email: string }) => {
    if (!Number.isInteger(input?.unidadeId)) throw new Error("Unidade inválida.");
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("E-mail do Departamento Pessoal inválido.");
    return { unidadeId: input.unidadeId, email };
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as Cliente).from("gente_config_unidade").upsert(
      {
        unidade_id: data.unidadeId,
        email_dp: data.email,
        atualizado_por: context.userId,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "unidade_id" },
    );
    if (error) {
      if (error.code === "42501") throw new Error("Sem permissão para esta unidade.");
      throw new Error(error.message);
    }
    return { ok: true };
  });

export interface LinhaSalario {
  linha: number;
  email: string;
  salario: number;
  vigencia: string;
}

export interface ResultadoSalario {
  linha: number;
  email: string;
  situacao: "carregado" | "nao_encontrado" | "erro";
  mensagem: string | null;
}

// Carga do salário atual por planilha (decisão do dono: carregar o de todos).
// Casa pelo e-mail do cadastro, entre as pessoas que o usuário enxerga.
export const importarSalarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { linhas: LinhaSalario[] }) => {
    const linhas = Array.isArray(input?.linhas) ? input.linhas : [];
    if (!linhas.length) throw new Error("A planilha não tem nenhuma linha válida.");
    if (linhas.length > 1000) throw new Error("Carregue no máximo 1000 pessoas por vez.");
    return {
      linhas: linhas.map((l) => ({
        linha: Number(l.linha),
        email: String(l.email ?? "")
          .trim()
          .toLowerCase(),
        salario: Number(l.salario),
        vigencia: String(l.vigencia ?? ""),
      })),
    };
  })
  .handler(async ({ data, context }): Promise<{ resultados: ResultadoSalario[] }> => {
    const supabase = context.supabase as Cliente;
    if (!(await temChave(supabase, context.userId)))
      throw new Error("Sem permissão para salários.");

    const pessoas = await todas<{ id: number; email: string | null }>((de, ate) =>
      supabase
        .from("gente_pessoas")
        .select("id,email")
        .not("email", "is", null)
        .order("id")
        .range(de, ate),
    );
    const porEmail = new Map(pessoas.map((p) => [String(p.email).trim().toLowerCase(), p.id]));

    const resultados: ResultadoSalario[] = [];
    const inserir: { pessoa_id: number; salario: number; vigencia: string; origem: string }[] = [];
    const linhaDe: number[] = [];
    for (const l of data.linhas) {
      const id = porEmail.get(l.email);
      if (!id) {
        resultados.push({
          linha: l.linha,
          email: l.email,
          situacao: "nao_encontrado",
          mensagem: "E-mail não está no cadastro da sua unidade.",
        });
        continue;
      }
      if (!Number.isFinite(l.salario) || l.salario <= 0) {
        resultados.push({
          linha: l.linha,
          email: l.email,
          situacao: "erro",
          mensagem: "Salário inválido.",
        });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.vigencia)) {
        resultados.push({
          linha: l.linha,
          email: l.email,
          situacao: "erro",
          mensagem: "Vigência inválida.",
        });
        continue;
      }
      inserir.push({
        pessoa_id: id,
        salario: Math.round(l.salario * 100) / 100,
        vigencia: l.vigencia,
        origem: "carga",
      });
      linhaDe.push(resultados.length);
      resultados.push({ linha: l.linha, email: l.email, situacao: "carregado", mensagem: null });
    }
    if (inserir.length) {
      const { error } = await supabase.from("gente_remuneracao").insert(inserir);
      if (error) {
        for (const i of linhaDe) {
          resultados[i] = { ...resultados[i], situacao: "erro", mensagem: error.message };
        }
      }
    }
    return { resultados };
  });

export interface NovaMovimentacaoInput {
  pessoaId: number;
  vigencia: string;
  motivo: string;
  observacao?: string;
  salarioDepois?: number | null;
  cargoDepois?: string | null;
  departamentoDepois?: string | null;
  gestorDepoisId?: number | null;
  vinculoDepois?: string | null;
}

export const criarMovimentacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: NovaMovimentacaoInput) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Escolha a pessoa.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.vigencia ?? "")) throw new Error("Informe a vigência.");
    const motivo = (input?.motivo ?? "").trim();
    if (!motivo) throw new Error("Informe o motivo.");
    const salario = input.salarioDepois == null ? null : Number(input.salarioDepois);
    if (salario != null && (!Number.isFinite(salario) || salario <= 0))
      throw new Error("Salário inválido.");
    const vinculo = input.vinculoDepois || null;
    if (vinculo && !VINCULOS[vinculo]) throw new Error("Vínculo inválido.");
    const out = {
      pessoaId: input.pessoaId,
      vigencia: input.vigencia,
      motivo,
      observacao: input.observacao?.trim() || null,
      salarioDepois: salario == null ? null : Math.round(salario * 100) / 100,
      cargoDepois: input.cargoDepois?.trim() || null,
      departamentoDepois: input.departamentoDepois?.trim() || null,
      gestorDepoisId: input.gestorDepoisId ?? null,
      vinculoDepois: vinculo,
    };
    if (
      out.salarioDepois == null &&
      !out.cargoDepois &&
      !out.departamentoDepois &&
      out.gestorDepoisId == null &&
      !out.vinculoDepois
    ) {
      throw new Error("Diga o que muda: salário, cargo, setor, gestor ou vínculo.");
    }
    if (out.gestorDepoisId === out.pessoaId)
      throw new Error("A pessoa não pode ser gestora de si mesma.");
    return out;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    if (!(await temChave(supabase, context.userId)))
      throw new Error("Sem permissão para movimentações.");
    const { data: p, error: eP } = await supabase
      .from("gente_pessoas")
      .select("id,cargo,departamento,gestor_id,tipo_vinculo,status")
      .eq("id", data.pessoaId)
      .maybeSingle();
    if (eP) throw new Error(eP.message);
    if (!p) throw new Error("Pessoa não encontrada no seu cadastro.");
    if (p.status === "desligado") throw new Error("Pessoa desligada não recebe movimentação.");

    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { data: sal } = await supabase
      .from("gente_remuneracao")
      .select("salario")
      .eq("pessoa_id", data.pessoaId)
      .lte("vigencia", hoje)
      .order("vigencia", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: criada, error } = await supabase
      .from("gente_movimentacoes")
      .insert({
        pessoa_id: data.pessoaId,
        vigencia: data.vigencia,
        motivo: data.motivo,
        observacao: data.observacao,
        salario_antes: data.salarioDepois != null ? (sal?.salario ?? null) : null,
        salario_depois: data.salarioDepois,
        cargo_antes: data.cargoDepois ? p.cargo : null,
        cargo_depois: data.cargoDepois,
        departamento_antes: data.departamentoDepois ? p.departamento : null,
        departamento_depois: data.departamentoDepois,
        gestor_antes_id: data.gestorDepoisId != null ? p.gestor_id : null,
        gestor_depois_id: data.gestorDepoisId,
        vinculo_antes: data.vinculoDepois ? p.tipo_vinculo : null,
        vinculo_depois: data.vinculoDepois,
        status: "rascunho",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "42501") throw new Error("Sem permissão para esta pessoa.");
      throw new Error(error.message);
    }
    return { id: criada.id as number };
  });

/** Monta o documento a partir do que a RLS deixa o usuário ler. */
async function documento(
  supabase: Cliente,
  id: number,
): Promise<{ doc: MovimentacaoDocumento; mov: MovDB; unidadeId: number | null }> {
  const { data: m, error } = await supabase
    .from("gente_movimentacoes")
    .select(MOV_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!m) throw new Error("Movimentação não encontrada.");
  const mov = m as MovDB;
  const ids = [mov.pessoa_id, mov.gestor_antes_id, mov.gestor_depois_id].filter(
    (x): x is number => x != null,
  );
  const { data: ps } = await supabase
    .from("gente_pessoas")
    .select("id,nome_completo,email,data_admissao,unidade_id")
    .in("id", ids);
  type P = {
    id: number;
    nome_completo: string;
    email: string | null;
    data_admissao: string | null;
    unidade_id: number | null;
  };
  const porId = new Map(((ps ?? []) as P[]).map((p) => [p.id, p]));
  const pessoa = porId.get(mov.pessoa_id);
  if (!pessoa) throw new Error("Pessoa da movimentação não encontrada.");
  const { data: u } = pessoa.unidade_id
    ? await supabase
        .from("unidades")
        .select("nome_da_praca")
        .eq("id", pessoa.unidade_id)
        .maybeSingle()
    : { data: null };
  const autores = await nomesDeAutores(mov.criado_por ? [mov.criado_por] : []);
  return {
    mov,
    unidadeId: pessoa.unidade_id,
    doc: {
      id: mov.id,
      unidade: u?.nome_da_praca ?? "—",
      pessoa: pessoa.nome_completo,
      email: pessoa.email,
      admissao: pessoa.data_admissao,
      vigencia: mov.vigencia,
      motivo: mov.motivo,
      observacao: mov.observacao,
      mudancas: mudancasDe(mov, (gid) =>
        gid == null ? "—" : (porId.get(gid)?.nome_completo ?? "—"),
      ),
      registradaPor: mov.criado_por ? autores.get(mov.criado_por) || null : null,
      enviadaEm: mov.enviada_em,
    },
  };
}

export const documentoMovimentacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number }) => {
    if (!Number.isInteger(input?.id)) throw new Error("Movimentação inválida.");
    return input;
  })
  .handler(
    async ({ data, context }) => (await documento(context.supabase as Cliente, data.id)).doc,
  );

const toB64 = (buf: ArrayBuffer) => Buffer.from(new Uint8Array(buf)).toString("base64");

// O RH aprova ao enviar (decisão do dono: só o RH aprova). Sem e-mail do DP
// configurado não envia, e em ambiente local também não: ele aponta para o banco
// de produção, e um teste mandaria movimentação de verdade para o DP.
export const enviarMovimentacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number }) => {
    if (!Number.isInteger(input?.id)) throw new Error("Movimentação inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    if (!(await temChave(supabase, context.userId)))
      throw new Error("Sem permissão para movimentações.");
    const { doc, mov, unidadeId } = await documento(supabase, data.id);
    if (mov.status !== "rascunho")
      throw new Error("Esta movimentação já foi enviada ou cancelada.");
    if (!unidadeId) throw new Error("A pessoa está sem unidade no cadastro.");
    const { data: cfg } = await supabase
      .from("gente_config_unidade")
      .select("email_dp")
      .eq("unidade_id", unidadeId)
      .maybeSingle();
    const para = cfg?.email_dp as string | undefined;
    if (!para)
      throw new Error("Cadastre o e-mail do Departamento Pessoal da unidade antes de enviar.");
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "No ambiente local o envio ao DP fica desligado. Use Baixar PDF para conferir.",
      );
    }

    const agora = new Date().toISOString();
    const comEnvio = { ...doc, enviadaEm: agora };
    const [pdf, xlsx] = await Promise.all([gerarPdf(comEnvio), gerarXlsx(comEnvio)]);
    const linhas = comEnvio.mudancas.map(([c, a, d]) => `${c}: ${a} → ${d}`);
    const vig = new Date(`${doc.vigencia}T12:00:00`).toLocaleDateString("pt-BR");
    const r = await enviarEmail({
      to: para,
      subject: `Movimentação de pessoal: ${doc.pessoa} (${doc.unidade}), vigência ${vig}`,
      html: `<p>Olá, Departamento Pessoal.</p><p>Segue a movimentação de <strong>${doc.pessoa}</strong>, unidade ${doc.unidade}, com vigência em <strong>${vig}</strong>.</p><ul>${linhas.map((l) => `<li>${l}</li>`).join("")}</ul><p>Motivo: ${doc.motivo ?? "—"}</p><p>PDF e Excel em anexo. Enviado pelo Planning People${doc.registradaPor ? `, registrado por ${doc.registradaPor}` : ""}.</p>`,
      text: [
        `Movimentação de ${doc.pessoa}, unidade ${doc.unidade}, vigência ${vig}.`,
        ...linhas,
        `Motivo: ${doc.motivo ?? "—"}`,
        "PDF e Excel em anexo.",
      ].join("\n"),
      anexos: [
        { nome: nomeArquivo(doc, "pdf"), conteudoBase64: toB64(pdf) },
        { nome: nomeArquivo(doc, "xlsx"), conteudoBase64: toB64(xlsx) },
      ],
    });
    if (!r.enviado)
      throw new Error(r.erro ?? "O e-mail para o DP não saiu. Nada foi marcado como enviado.");

    const { error } = await supabase
      .from("gente_movimentacoes")
      .update({ status: "enviada", enviada_em: agora, enviada_para: para, atualizado_em: agora })
      .eq("id", data.id)
      .eq("status", "rascunho");
    if (error) throw new Error(error.message);

    // Vigência que já começou entra no cadastro agora; a futura, pelo pg_cron.
    const { data: aplicadas, error: eAp } = await supabase.rpc("gente_aplicar_movimentacoes", {
      _id: data.id,
    });
    if (eAp) console.error("[gente.enviarMovimentacao] aplicar falhou:", eAp);
    return { enviadaPara: para, aplicadaAgora: Number(aplicadas ?? 0) > 0 };
  });

export const cancelarMovimentacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number }) => {
    if (!Number.isInteger(input?.id)) throw new Error("Movimentação inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await (context.supabase as Cliente)
      .from("gente_movimentacoes")
      .update({ status: "cancelada", atualizado_em: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "rascunho")
      .select("id");
    if (error) throw new Error(error.message);
    if (!ok?.length) throw new Error("Só dá para cancelar movimentação ainda em rascunho.");
    return { ok: true };
  });
