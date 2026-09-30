// Carga do tema Qua · CS e RH no servidor: lê as fontes com a sessão da pessoa (RLS) e devolve as
// linhas cruas para `montarCsRh`. Cada fonte falha sozinha: uma leitura que dá erro vira
// "fonte indisponível" naquela parte, e o resto do tema segue.
//
// Porta antes de ler (espelho das policies de SELECT lidas em 29/09/2026): a RLS devolve tabela
// VAZIA a quem não pode ler, e "0 tratativas" ou "nenhum detrator sem ligação" com cara de dado é
// pior que "sem acesso". Só entram papéis e chaves que liberam a tabela inteira; escopo por unidade
// fecha tudo, porque o cockpit soma a rede.
import type { ContextoCoo, Db } from "../contexto.server.ts";
import { motivoDoErro } from "../contexto.server.ts";
import { todasAsPaginas } from "@/lib/cockpit-ceo/paginar";
import { inicioDoTrimestre } from "./cs-rh.ts";
import type {
  DadosCsRh,
  FalhaParte,
  LinhaAuditoria,
  LinhaCarteira,
  LinhaContratoDeal,
  LinhaPesquisa,
  LinhaPessoa,
  LinhaTratativa,
} from "./cs-rh.ts";

type Fonte =
  | "central_tratativas"
  | "contratos"
  | "nps_pesquisas"
  | "nps_ligacoes"
  | "auditorias_internas"
  | "gente_pessoas"
  | "idu_metas_padrao";

const PORTAS: Record<Fonte, { papeis: string[]; chaves: string[]; nome: string }> = {
  central_tratativas: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.clientes", "view.painel_cs", "view.fila_cella"],
    nome: "a Central de Tratativas",
  },
  // `v_mrr_por_unidade` roda como dono da view (sem security_invoker): a porta dela é a de
  // `contratos`, para a view não abrir o que a RLS fecha.
  contratos: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.clientes", "view.painel_cs", "view.reconciliacao", "view.rede_ltv", "view.fila_cella"],
    nome: "os contratos ganhos",
  },
  nps_pesquisas: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.painel_cs", "view.rede_realizado", "view.nps", "view.disparos_whatsapp"],
    nome: "as pesquisas de NPS",
  },
  nps_ligacoes: { papeis: [], chaves: ["view.disparos_whatsapp"], nome: "as ligações do NPS" },
  // `view.minhas_auditorias` lê só a própria unidade: fica de fora de propósito.
  auditorias_internas: { papeis: ["admin", "diretor", "auditor"], chaves: [], nome: "a Auditoria Interna" },
  gente_pessoas: { papeis: [], chaves: ["view.gente.individual", "manage.gente"], nome: "o cadastro de pessoas" },
  idu_metas_padrao: { papeis: [], chaves: ["view.idu"], nome: "as metas do IDU" },
};

const ESCOPO_POR_UNIDADE = "data.scope.own_unit_only";

function semAcesso(fonte: Fonte): FalhaParte {
  return {
    ok: false,
    estado: "acesso_insuficiente",
    motivo: `sua conta não lê ${PORTAS[fonte].nome} por inteiro`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function falhou(nome: string, e: any): FalhaParte {
  console.error(`[cockpit-coo] cs-rh · ${nome}:`, e);
  // 42501: permissão negada no Postgres (grant ou RLS que recusa em vez de filtrar).
  if (e?.code === "42501") return { ok: false, estado: "acesso_insuficiente", motivo: motivoDoErro(nome, e) };
  return { ok: false, estado: "fonte_indisponivel", motivo: motivoDoErro(nome, e) };
}

/** Maior valor de uma coluna de data/hora (texto ISO compara na ordem certa). */
function maisRecente<T>(linhas: T[], campo: (l: T) => string | null | undefined): string | null {
  let max: string | null = null;
  for (const l of linhas) {
    const v = campo(l);
    if (v && (!max || v > max)) max = v;
  }
  return max;
}

export async function lerCsRh(ctx: ContextoCoo): Promise<DadosCsRh> {
  const db: Db = ctx.db;

  // Papéis: o contexto guarda só as chaves, e a Auditoria Interna é liberada por papel.
  let papeis: string[] = [];
  try {
    const { data, error } = await db.from("user_roles").select("role").eq("user_id", ctx.userId);
    if (error) throw error;
    papeis = ((data ?? []) as { role: string }[]).map((r) => r.role);
  } catch (e) {
    console.error("[cockpit-coo] cs-rh · papéis:", e);
  }
  const porUnidade = ctx.permissoes.includes(ESCOPO_POR_UNIDADE);
  const pode = (f: Fonte) =>
    !porUnidade &&
    (PORTAS[f].papeis.some((p) => papeis.includes(p)) || PORTAS[f].chaves.some((k) => ctx.permissoes.includes(k)));
  const porta = (f: Fonte): FalhaParte | null =>
    pode(f)
      ? null
      : porUnidade
        ? {
            ok: false,
            estado: "acesso_insuficiente",
            motivo: "a leitura da rede exige ver todas as unidades; seu acesso é por unidade",
          }
        : semAcesso(f);

  const tratativas = async (): Promise<DadosCsRh["tratativas"]> => {
    const fechada = porta("central_tratativas");
    if (fechada) return fechada;
    try {
      const linhas = await todasAsPaginas((de, ate) =>
        db
          .from("central_tratativas")
          .select("id, status, unidade, data_churn, pipedrive_deal_id, pipefy_criado_em, created_at, sincronizado_em")
          .order("id")
          .range(de, ate),
      );
      return {
        ok: true,
        linhas: linhas as LinhaTratativa[],
        atualizadoEm: maisRecente(linhas as { sincronizado_em: string | null }[], (l) => l.sincronizado_em),
      };
    } catch (e) {
      return falhou("tratativas", e);
    }
  };

  const carteira = async (): Promise<DadosCsRh["carteira"]> => {
    const fechada = porta("contratos");
    if (fechada) return fechada;
    try {
      const linhas = await todasAsPaginas((de, ate) =>
        db.from("v_mrr_por_unidade").select("unidade, num_contratos, mrr_total").order("unidade").range(de, ate),
      );
      return { ok: true, linhas: linhas as LinhaCarteira[] };
    } catch (e) {
      return falhou("carteira de MRR", e);
    }
  };

  const metaChurn = async (): Promise<DadosCsRh["metaChurn"]> => {
    const fechada = porta("idu_metas_padrao");
    if (fechada) return fechada;
    try {
      const { data, error } = await db
        .from("idu_metas_padrao")
        .select("meta")
        .eq("escopo", "rede")
        .eq("indicador", "churn")
        .eq("periodo_inicio", inicioDoTrimestre(ctx.hoje))
        .maybeSingle();
      if (error) throw error;
      const v = data?.meta === null || data?.meta === undefined ? null : Number(data.meta);
      return { ok: true, valor: v !== null && Number.isFinite(v) ? v : null };
    } catch (e) {
      return falhou("metas do IDU", e);
    }
  };

  const nps = async (): Promise<DadosCsRh["nps"]> => {
    const fechada = porta("nps_pesquisas");
    if (fechada) return fechada;
    try {
      const linhas = await todasAsPaginas((de, ate) =>
        db
          .from("nps_pesquisas")
          .select("id, unidade, nps_recomendacao, data_envio, created_at, updated_at, canal_resposta")
          .order("id")
          .range(de, ate),
      );
      return {
        ok: true,
        linhas: linhas as LinhaPesquisa[],
        atualizadoEm: maisRecente(linhas as { updated_at: string | null }[], (l) => l.updated_at),
      };
    } catch (e) {
      return falhou("pesquisas de NPS", e);
    }
  };

  const ligacoes = async (): Promise<DadosCsRh["ligacoes"]> => {
    const fechada = porta("nps_ligacoes");
    if (fechada) return fechada;
    try {
      const linhas = (await todasAsPaginas((de, ate) =>
        db.from("nps_ligacoes").select("id, nps_pesquisa_id, created_at").order("id").range(de, ate),
      )) as { nps_pesquisa_id: number | null; created_at: string | null }[];
      return {
        ok: true,
        pesquisaIds: [
          ...new Set(linhas.map((l) => l.nps_pesquisa_id).filter((x): x is number => x !== null)),
        ],
        atualizadoEm: maisRecente(linhas, (l) => l.created_at),
      };
    } catch (e) {
      return falhou("ligações do NPS", e);
    }
  };

  const auditorias = async (): Promise<DadosCsRh["auditorias"]> => {
    const fechada = porta("auditorias_internas");
    if (fechada) return fechada;
    try {
      const linhas = await todasAsPaginas((de, ate) =>
        db
          .from("auditorias_internas")
          .select("pipefy_card_id, unidade, fase_atual, auditoria_finalizada, prazo_atual, synced_at")
          .order("pipefy_card_id")
          .range(de, ate),
      );
      return {
        ok: true,
        linhas: linhas as LinhaAuditoria[],
        atualizadoEm: maisRecente(linhas as { synced_at: string | null }[], (l) => l.synced_at),
      };
    } catch (e) {
      return falhou("Auditoria Interna", e);
    }
  };

  const pessoas = async (): Promise<DadosCsRh["pessoas"]> => {
    const fechada = porta("gente_pessoas");
    if (fechada) return fechada;
    try {
      // Só lotação e admissão: nada de nome, CPF ou contato sai do banco para o cockpit.
      const linhas = await todasAsPaginas((de, ate) =>
        db.from("gente_pessoas").select("id, unidade_id, data_admissao, updated_at").order("id").range(de, ate),
      );
      return {
        ok: true,
        linhas: linhas as LinhaPessoa[],
        atualizadoEm: maisRecente(linhas as { updated_at: string | null }[], (l) => l.updated_at),
      };
    } catch (e) {
      return falhou("cadastro de pessoas", e);
    }
  };

  const [t, c, m, n, l, a, p] = await Promise.all([
    tratativas(),
    carteira(),
    metaChurn(),
    nps(),
    ligacoes(),
    auditorias(),
    pessoas(),
  ]);

  // O MRR perdido sai do contrato do negócio: depende dos negócios que têm card na Central.
  const contratos = async (): Promise<DadosCsRh["contratos"]> => {
    const fechada = porta("contratos");
    if (fechada) return fechada;
    if (!t.ok) return { ok: true, linhas: [] };
    const deals = [
      ...new Set(
        t.linhas
          .map((x) => x.pipedrive_deal_id)
          .filter((x): x is number | string => x !== null && x !== undefined && x !== "")
          .map(String),
      ),
    ];
    try {
      const linhas: LinhaContratoDeal[] = [];
      // `contratos.pipedrive_deal_id` é texto; lotes de 150 para a URL não estourar.
      for (let i = 0; i < deals.length; i += 150) {
        const lote = deals.slice(i, i + 150);
        const parte = await todasAsPaginas((de, ate) =>
          db
            .from("contratos")
            .select("id, pipedrive_deal_id, mrr_mensal")
            .in("pipedrive_deal_id", lote)
            .order("id")
            .range(de, ate),
        );
        linhas.push(...(parte as LinhaContratoDeal[]));
      }
      return { ok: true, linhas };
    } catch (e) {
      return falhou("contratos", e);
    }
  };

  return {
    tratativas: t,
    contratos: await contratos(),
    carteira: c,
    metaChurn: m,
    nps: n,
    ligacoes: l,
    auditorias: a,
    pessoas: p,
  };
}
