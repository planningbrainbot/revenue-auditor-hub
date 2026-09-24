import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Search,
  TriangleAlert,
  Users,
  UserX,
  X,
} from "lucide-react";
import type { BuscaClientes } from "@/components/clientes/busca";
import { toast } from "sonner";
import { exportRowsToXlsx } from "@/lib/xlsx-export";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import {
  ContatosClienteDialog,
  type ClienteSelecionado,
} from "@/components/clientes/contatos-cliente-dialog";
import { atualizarCliente, marcarChurnCliente } from "@/lib/clientes.functions";
import { MOTIVOS_CHURN, type MotivoChurn } from "@/lib/royalties.functions";
import { digits } from "@/lib/server-utils";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { BotaoComMotivo, FOCO_VISIVEL } from "@/components/monetizacao/common";

type StatusFinanceiro =
  "ATIVO" | "EM_ATRASO" | "INADIMPLENTE" | "SEM_ATIVIDADE" | "NUNCA_PAGOU" | "SEM_AR";

type Cliente = {
  id: number;
  razao_social: string | null;
  titulo: string | null;
  cnpj: string | null;
  uf: string | null;
  unidade: string | null;
  pipedrive_id: string | null;
  fonte_cadastro: string | null;
  status_financeiro: StatusFinanceiro | null;
  erp: string | null;
  segmento: string | null;
};

type ContratoInfo = {
  ganho_em: string | null;
  regime_tributario: string | null;
  entrada_contrato_assinado_em: string | null;
  closer: string | null;
};

// Uma linha da view v_cliente_mrr. `mrr_fonte` é exibida na tela: sem ela o
// número fica sem procedência e a primeira pergunta de quem olha ("de onde
// saiu esse valor?") não tem resposta.
type ClienteMrr = {
  empresa_id: number;
  mrr_mensal: number | null;
  mrr_fonte: "omie" | "pipefy" | "pipedrive" | null;
  data_assinatura: string | null;
};

// O PostgREST deste projeto tem `max-rows` em 1000 e **ignora `.limit()` acima
// disso**: pedir 5000 ou 20000 devolve as mesmas 1000 linhas, com HTTP 200 e sem
// aviso nenhum. Era o que acontecia aqui em 22/09/2026 — a página listava 1000
// de 3219 clientes de unidade regional, e o "MRR total" do cabeçalho somava só
// essa fatia. A cascata de MRR (`v_cliente_mrr`, 1120 linhas) também vinha
// cortada, e os 120 clientes da cauda apareciam sem MRR e sem data de
// assinatura mesmo tendo os dois no banco.
//
// Paginar por `range` é o padrão do resto do app (ver `contatos-cs.functions.ts`).
// A ordenação por chave única é o que torna a paginação estável — ordenar por
// `razao_social`, que repete, pularia e duplicaria linhas entre as páginas.
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  pagina: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] }> {
  const todas: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await pagina(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < PAGE_SIZE) return { data: todas };
  }
}

// Cliente que existe no ERP (Omie) mas ainda não foi reconciliado em `empresas`
// (sem pipedrive_id/contrato vinculado) — não entra em cards, contagem ou MRR total.
type OmieMatch = {
  cnpj: string;
  razao_social: string | null;
  unidade: string | null;
};

// razao_social às vezes vem de um enriquecimento de CNPJ que grava placeholders
// em vez de deixar nulo quando não encontra a razão social oficial.
const GARBAGE_RAZAO_SOCIAL = new Set([
  ".",
  "0",
  "-",
  "--",
  "---",
  "n/a",
  "N/A",
  "NA",
  "o",
  "a",
  "n",
  "c",
  "cc",
  "xx",
]);
function displayName(r: Pick<Cliente, "razao_social" | "titulo">): string {
  const rs = r.razao_social?.trim();
  if (rs && !GARBAGE_RAZAO_SOCIAL.has(rs)) return rs;
  return r.titulo?.trim() || "";
}

const ALL = "__all__";

const STATUS_ORDER: StatusFinanceiro[] = [
  "ATIVO",
  "INADIMPLENTE",
  "NUNCA_PAGOU",
  "EM_ATRASO",
  "SEM_ATIVIDADE",
  "SEM_AR",
];

// Situação financeira da empresa (`empresas.status_financeiro`). Sai em StatusBadge (ícone +
// palavra, V7). "ATIVO" é "pagou nos últimos 90 dias", e não "cliente ativo": na mesma tela o
// cartão "Clientes sem churn" mede outra coisa (N11), e os dois se chamavam "Ativo".
const STATUS_META: Record<
  StatusFinanceiro,
  { label: string; tom: TomStatus; description: string }
> = {
  ATIVO: {
    label: "Pagou nos últimos 90 dias",
    tom: "sucesso",
    description: "Pagou nos últimos 90 dias",
  },
  EM_ATRASO: {
    label: "Em atraso",
    tom: "atencao",
    description: "Título vencido, mas pagou recentemente",
  },
  INADIMPLENTE: {
    label: "Inadimplente",
    tom: "perigo",
    description: "Vencido + sem pagamento há mais de 90 dias",
  },
  SEM_ATIVIDADE: {
    label: "Sem atividade",
    tom: "atencao",
    description: "Sem pagamento >90 dias, sem título em aberto",
  },
  NUNCA_PAGOU: {
    label: "Nunca pagou",
    tom: "neutro",
    description: "Sem nenhum pagamento registrado",
  },
  SEM_AR: {
    label: "Sem AR",
    tom: "neutro",
    description: "Sem histórico de faturamento (Pipedrive sem Omie)",
  },
};
const statusDaUrl = (v: string): StatusFinanceiro | null =>
  (STATUS_ORDER as string[]).includes(v) ? (v as StatusFinanceiro) : null;
// Paginação na tela (DESIGN.md §9): antes eram ~3.200 linhas de uma vez.
const POR_PAGINA = 100;
const NUM = new Intl.NumberFormat("pt-BR");

export function ContratosClientes({
  unidadeParam = "",
  unidadesUrl = [],
}: {
  /**
   * Unidade já resolvida em NOME (`empresas.unidade`). A URL guarda a chave da Base, e quem
   * traduz é a casca; vazio = todas.
   */
  unidadeParam?: string;
  /** As unidades como estão na URL (chave ou nome), para quando a casca não pôde resolver. */
  unidadesUrl?: string[];
} = {}) {
  const perms = usePermissions();
  // Filtros na URL (N7): recarregar ou colar o link reproduz o recorte. A busca é a mesma chave
  // `q` do topo das outras visões.
  const search = useSearch({ from: "/_authenticated/clientes" }),
    navigate = useNavigate({ from: "/clientes" });
  const mudar = (patch: Partial<BuscaClientes>) =>
    void navigate({ search: { ...search, pagina: undefined, ...patch }, replace: true });
  const [rows, setRows] = useState<Cliente[]>([]);
  const [mrrByPipedriveId, setMrrByPipedriveId] = useState<Map<string, number>>(new Map());
  // Cascata de MRR resolvida no banco (view v_cliente_mrr): Omie, depois
  // Pipefy, depois Pipedrive. Existe porque o mapa acima só alcança cliente
  // com deal — e a maior parte da lista entrou pelo pipe de Onboarding, sem
  // deal nenhum, aparecendo zerada. Chaveada por empresa, não por deal.
  const [cascataByEmpresaId, setCascataByEmpresaId] = useState<Map<number, ClienteMrr>>(new Map());
  const [contratoInfoByPipedriveId, setContratoInfoByPipedriveId] = useState<
    Map<string, ContratoInfo>
  >(new Map());
  const [churnedIds, setChurnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Falha de carga vira EstadoErro (antes a tela ficava em "Carregando…" para sempre).
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const q = search.q;
  const statusFilter = statusDaUrl(search.status);
  const churnFilter = search.churn === "sim" ? true : search.churn === "nao" ? false : null;
  const erpFilter = search.erp ?? ALL;
  const segmentoFilter = search.segmentoContrato ?? ALL;
  const contratoAssinadoFilter =
    search.assinatura === "com" ? true : search.assinatura === "sem" ? false : null;
  const setQ = (v: string) => mudar({ q: v });
  const setUnidade = (v: string) => mudar({ unidade: v === ALL ? undefined : [v] });
  const setStatusFilter = (v: StatusFinanceiro | null) => mudar({ status: v ?? "" });
  const setErpFilter = (v: string) => mudar({ erp: v === ALL ? undefined : v });
  const setSegmentoFilter = (v: string) => mudar({ segmentoContrato: v === ALL ? undefined : v });
  const setContratoAssinadoFilter = (v: boolean | null) =>
    mudar({ assinatura: v === null ? undefined : v ? "com" : "sem" });
  // O clique no cartão de churn só mexe no churn: a situação financeira escolhida continua.
  const alternarChurn = (v: boolean) =>
    mudar({ churn: churnFilter === v ? undefined : v ? "sim" : "nao" });
  const [omieMatches, setOmieMatches] = useState<OmieMatch[]>([]);
  const [omieLoading, setOmieLoading] = useState(false);
  // Cliente cujo painel de contatos está aberto (null = fechado).
  const [contatoCliente, setContatoCliente] = useState<ClienteSelecionado | null>(null);
  // Quantos contatos cada empresa tem, pra sinalizar na linha antes do clique.
  const [contatosCount, setContatosCount] = useState<Map<number, number>>(new Map());
  type SortKey =
    | "razao_social"
    | "unidade"
    | "mrr"
    | "cnpj"
    | "uf"
    | "status_financeiro"
    | "pipedrive_id"
    | "fonte_cadastro"
    | "erp"
    | "segmento"
    | "ganho_em"
    | "regime_tributario"
    | "entrada_contrato_assinado_em"
    | "closer";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const atualizarClienteFn = useServerFn(atualizarCliente);
  const marcarChurnClienteFn = useServerFn(marcarChurnCliente);

  const salvarEdicaoCliente = async (
    r: Cliente,
    patch: { razao_social?: string; cnpj?: string },
  ) => {
    const res = await atualizarClienteFn({ data: { id: r.id, ...patch } });
    if (res.status === "pending")
      toast.success("Correção solicitada. O cadastro será atualizado após confirmação no Pipefy.");
    else {
      setRows((prev) => prev.map((row) => (row.id === r.id ? { ...row, ...patch } : row)));
      toast.success("Cliente atualizado.");
    }
    return res;
  };

  const marcarChurnDoCliente = async (
    r: Cliente,
    motivo: string,
    observacao: string,
    dataChurn: string,
  ) => {
    await marcarChurnClienteFn({
      data: {
        pipedrive_id: r.pipedrive_id ?? "",
        razao_social: displayName(r),
        unidade: r.unidade ?? "",
        mrr: mrrOf(r),
        motivo,
        observacao,
        data_churn: dataChurn,
      },
    });
    setChurnedIds((prev) => new Set(prev).add(r.pipedrive_id ?? ""));
    toast.success("Churn registrado — pode levar até 15min pra refletir no Pipefy/Tratativas.");
  };

  useEffect(() => {
    let mounted = true;
    setErro(null);
    setLoading(true);
    (async () => {
      const [unidadesRes, empRes, contRes, tratRes, cascataRes] = await Promise.all([
        supabase.from("unidades").select("nome_da_praca").eq("tipo", "regional"),
        fetchAll((from, to) =>
          supabase
            .from("empresas")
            .select(
              "id,razao_social,titulo,cnpj,uf,unidade,pipedrive_id,fonte_cadastro,status_financeiro,erp,segmento",
            )
            .eq("tipo_unidade", "franquia")
            .order("id", { ascending: true })
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("contratos")
            .select(
              "mrr_mensal,pipedrive_deal_id,status_contrato,unidade,ganho_em,regime_tributario,entrada_contrato_assinado_em,closer",
            )
            .eq("status_contrato", "Ativo")
            .order("id", { ascending: true })
            .range(from, to),
        ),
        supabase
          .from("central_tratativas")
          .select("pipedrive_deal_id")
          // status="lost" é derivado do id da fase no Pipefy (ver PHASE_STATUS em
          // tratativas.functions.ts), não do nome — resiliente a rename de fase.
          // A fase "Perdido" virou "Churn Confirmado (Perdido)" em ago/2026 e um
          // filtro por nome (.eq("estagio","Perdido")) zerava o churn aqui.
          .eq("status", "lost")
          .limit(2000),
        // A view já resolve a ordem Omie > Pipefy > Pipedrive por cliente.
        fetchAll((from, to) =>
          supabase
            .from("v_cliente_mrr")
            .select("empresa_id,mrr_mensal,mrr_fonte,data_assinatura")
            .not("mrr_mensal", "is", null)
            .order("empresa_id", { ascending: true })
            .range(from, to),
        ),
      ]);
      if (!mounted) return;
      // As duas leituras sem paginação devolvem o erro no objeto: sem elas a lista sairia vazia
      // (sem unidades regionais) ou com churn zerado, com cara de dado.
      const falha = unidadesRes.error ?? tratRes.error;
      if (falha) throw new Error(falha.message);
      // Unidades regionais ativas (fonte de verdade: tabela `unidades`, tipo='regional').
      // Alinha com v_funil_mensal / v_reconciliacao_mensal — exclui unidades desativadas
      // como Itaúna mesmo que ainda estejam marcadas tipo_unidade='franquia' em contratos/empresas.
      const regionais = new Set((unidadesRes.data ?? []).map((u) => u.nome_da_praca));
      if (empRes.data) {
        setRows((empRes.data as Cliente[]).filter((r) => regionais.has(r.unidade ?? "")));
      }
      const m = new Map<string, number>();
      const info = new Map<string, ContratoInfo>();
      for (const c of contRes.data ?? []) {
        if (!regionais.has(c.unidade ?? "")) continue;
        const id = c.pipedrive_deal_id != null ? String(c.pipedrive_deal_id) : null;
        if (!id) continue;
        // contratos.mrr_mensal já é o valor mensal (coluna gerada = mrr/12)
        m.set(id, (m.get(id) ?? 0) + Number(c.mrr_mensal ?? 0));
        // um pipedrive_deal_id não deveria ter mais de um contrato, mas por segurança
        // mantém o primeiro valor não nulo encontrado para cada campo
        const prev = info.get(id);
        info.set(id, {
          ganho_em: prev?.ganho_em ?? c.ganho_em ?? null,
          regime_tributario: prev?.regime_tributario ?? c.regime_tributario ?? null,
          entrada_contrato_assinado_em:
            prev?.entrada_contrato_assinado_em ?? c.entrada_contrato_assinado_em ?? null,
          closer: prev?.closer ?? c.closer ?? null,
        });
      }
      setMrrByPipedriveId(m);
      setContratoInfoByPipedriveId(info);
      setCascataByEmpresaId(
        new Map((cascataRes.data ?? []).map((c) => [Number(c.empresa_id), c as ClienteMrr])),
      );
      const churned = new Set<string>(
        (tratRes.data ?? []).map((t) => String(t.pipedrive_deal_id)).filter(Boolean),
      );
      setChurnedIds(churned);
      setLoading(false);
    })().catch((e: unknown) => {
      if (!mounted) return;
      setErro(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [tentativa]);

  // Contagem de contatos por empresa, carregada de uma vez só (a tabela toda é ~1k linhas).
  // Sem `view.contatos` a RLS devolve vazio — nesse caso nem consulta, e a linha não vira
  // clicável, pra não abrir um painel que sempre apareceria vazio.
  const podeVerContatos = perms.can("view.contatos");
  // Admin sempre pode; manage.clientes_churn libera "Marcar churn" pra outros papéis
  // sem dar acesso a editar razão social/CNPJ (que continua admin-only).
  const podeMarcarChurn = perms.isAdmin || perms.can("manage.clientes_churn");
  useEffect(() => {
    if (!podeVerContatos) {
      setContatosCount(new Map());
      return;
    }
    let mounted = true;
    (async () => {
      // 2575 contatos vinculados em 22/09/2026, contra o teto de 1000 por
      // resposta — sem paginar, o balão de contatos sumia da maior parte da lista.
      const { data } = await fetchAll<{ empresa_id: number | null }>((from, to) =>
        supabase
          .from("contatos")
          .select("empresa_id")
          .not("empresa_id", "is", null)
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (!mounted) return;
      const counts = new Map<number, number>();
      for (const c of data ?? []) {
        const id = c.empresa_id as number;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      setContatosCount(counts);
    })();
    return () => {
      mounted = false;
    };
  }, [podeVerContatos]);

  const cnpjsReconciliados = useMemo(
    () => new Set(rows.map((r) => digits(r.cnpj)).filter(Boolean)),
    [rows],
  );

  // Busca complementar na Omie (fonte: ERP, não Pipedrive) pra achar clientes que existem
  // no faturamento mas nunca foram reconciliados em `empresas` — não conta em nenhum card
  // nem no MRR total, é só um sinal pra reconciliação manual.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setOmieMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setOmieLoading(true);
      const termDigits = digits(term);
      const orParts = [`razao_social.ilike.%${term}%`];
      if (termDigits.length >= 3) orParts.push(`cnpj.ilike.%${termDigits}%`);
      // omie_clientes_cadastro (não omie_clientes) porque só ela tem policy de SELECT
      // pra role authenticated — omie_clientes é RLS-enabled sem nenhuma policy,
      // então fica inacessível pro client-side supabase mesmo logado.
      const { data } = await supabase
        .from("omie_clientes_cadastro")
        .select("cnpj,razao_social,unidade")
        .or(orParts.join(","))
        .limit(15);
      if (cancelled) return;
      const naoReconciliados = (data ?? []).filter((m) => !cnpjsReconciliados.has(digits(m.cnpj)));
      setOmieMatches(naoReconciliados);
      setOmieLoading(false);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, cnpjsReconciliados]);

  const fmtBRL = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  const fmtDate = (v: string | null | undefined) => {
    if (!v) return null;
    const [y, m, d] = v.split("-");
    return y && m && d ? `${d}/${m}/${y}` : v;
  };

  const unidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [rows],
  );

  // A casca só resolve a chave da unidade em nome quando a carga da Base chega (derivar, sem
  // estado local, segue a mudança sozinho). Antes disso, ou se a carga da Base falhou, o valor
  // cru da URL vale quando é o nome de uma unidade desta lista: é o que esta visão grava.
  const unidadeCrua =
    unidadesUrl.length === 1 ? unidades.find((u) => unitMatches(unidadesUrl[0], u)) : undefined;
  const unidade = unidadeParam || unidadeCrua || ALL;

  const erps = useMemo(
    () => Array.from(new Set(rows.map((r) => r.erp).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const segmentos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.segmento).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const visiveis = useMemo(() => {
    if (perms.scopedToOwnUnit && perms.unidade) {
      return rows.filter((r) => unitMatches(perms.unidade, r.unidade));
    }
    return rows;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  // churn status derived from central_tratativas (estagio=Perdido)
  const isChurn = (r: Cliente) => !!r.pipedrive_id && churnedIds.has(r.pipedrive_id);

  // MRR e data de assinatura passam pela cascata primeiro. O mapa por deal
  // continua como rede: cobre o caso em que a view ainda não enxergou o
  // cliente (empresa criada entre um refresh e outro).
  const cascataOf = (r: Cliente) => cascataByEmpresaId.get(r.id);
  const mrrOf = (r: Cliente) =>
    cascataOf(r)?.mrr_mensal ?? mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0;
  const mrrFonteOf = (r: Cliente) =>
    cascataOf(r)?.mrr_fonte ?? (mrrByPipedriveId.get(r.pipedrive_id ?? "") ? "pipedrive" : null);
  const assinaturaOf = (r: Cliente) =>
    cascataOf(r)?.data_assinatura ??
    contratoInfoByPipedriveId.get(r.pipedrive_id ?? "")?.entrada_contrato_assinado_em ??
    null;

  // Todos os filtros da UI (busca, unidade, ERP, segmento, status, contrato assinado)
  // exceto o próprio filtro de churn — serve de base tanto pros cards de resumo
  // (que precisam contar ativo/churn dentro do recorte atual) quanto pra tabela.
  const baseFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visiveis.filter((r) => {
      if (statusFilter && r.status_financeiro !== statusFilter) return false;
      // Comparação tolerante a acento e caixa: o nome que chega pela URL pode vir
      // de outra tabela (`monetizacao_unidades.nome`) e não bater caractere a caractere.
      if (!perms.scopedToOwnUnit && unidade !== ALL && !unitMatches(unidade, r.unidade))
        return false;
      if (erpFilter !== ALL && r.erp !== erpFilter) return false;
      if (segmentoFilter !== ALL && r.segmento !== segmentoFilter) return false;
      if (contratoAssinadoFilter !== null) {
        const assinado = !!assinaturaOf(r);
        if (contratoAssinadoFilter !== assinado) return false;
      }
      if (term) {
        const hay = [r.razao_social, r.titulo, r.cnpj]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [
    visiveis,
    q,
    unidade,
    statusFilter,
    erpFilter,
    segmentoFilter,
    contratoAssinadoFilter,
    perms.scopedToOwnUnit,
    contratoInfoByPipedriveId,
  ]);

  const churnCounts = useMemo(
    () => ({
      churn: baseFiltered.filter(isChurn).length,
      ativo: baseFiltered.filter((r) => !isChurn(r)).length,
    }),
    [baseFiltered, churnedIds],
  );

  const filtered = useMemo(() => {
    const out = baseFiltered.filter((r) => {
      // churn filter: null = all, true = only churn, false = only active
      if (churnFilter === true && !isChurn(r)) return false;
      if (churnFilter === false && isChurn(r)) return false;
      return true;
    });
    const rank = new Map<string, number>();
    STATUS_ORDER.forEach((s, i) => rank.set(s, i));
    const infoOf = (r: Cliente) => contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
    if (!sort) {
      return out.sort((a, b) => {
        const ra = rank.get(a.status_financeiro ?? "") ?? 99;
        const rb = rank.get(b.status_financeiro ?? "") ?? 99;
        if (ra !== rb) return ra - rb;
        return displayName(a).localeCompare(displayName(b), "pt-BR");
      });
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmpStr = (a: string | null | undefined, b: string | null | undefined) => {
      const av = a ?? "";
      const bv = b ?? "";
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      if (!av && !bv) return 0;
      return av.localeCompare(bv, "pt-BR");
    };
    const cmpNum = (a: number, b: number) => a - b;
    return out.sort((a, b) => {
      let c = 0;
      switch (sort.key) {
        case "razao_social":
          c = cmpStr(displayName(a), displayName(b));
          break;
        case "unidade":
          c = cmpStr(a.unidade, b.unidade);
          break;
        case "mrr":
          c = cmpNum(mrrOf(a), mrrOf(b));
          break;
        case "cnpj":
          c = cmpStr(a.cnpj, b.cnpj);
          break;
        case "uf":
          c = cmpStr(a.uf, b.uf);
          break;
        case "status_financeiro": {
          const ra = rank.get(a.status_financeiro ?? "") ?? 99;
          const rb = rank.get(b.status_financeiro ?? "") ?? 99;
          c = ra - rb;
          break;
        }
        case "pipedrive_id":
          c = cmpNum(Number(a.pipedrive_id ?? 0), Number(b.pipedrive_id ?? 0));
          break;
        case "fonte_cadastro":
          c = cmpStr(a.fonte_cadastro, b.fonte_cadastro);
          break;
        case "erp":
          c = cmpStr(a.erp, b.erp);
          break;
        case "segmento":
          c = cmpStr(a.segmento, b.segmento);
          break;
        case "ganho_em":
          c = cmpStr(infoOf(a)?.ganho_em, infoOf(b)?.ganho_em);
          break;
        case "regime_tributario":
          c = cmpStr(infoOf(a)?.regime_tributario, infoOf(b)?.regime_tributario);
          break;
        case "entrada_contrato_assinado_em":
          c = cmpStr(assinaturaOf(a), assinaturaOf(b));
          break;
        case "closer":
          c = cmpStr(infoOf(a)?.closer, infoOf(b)?.closer);
          break;
      }
      if (c !== 0) return c * dir;
      return (a.razao_social ?? "").localeCompare(b.razao_social ?? "", "pt-BR");
    });
  }, [baseFiltered, churnFilter, churnedIds, sort, mrrByPipedriveId, contratoInfoByPipedriveId]);

  // Quem só vê a própria unidade não tem filtro de unidade (o recorte é da permissão): a unidade
  // da URL não conta como filtro aplicado.
  const hasFilters =
    q !== "" ||
    (!perms.scopedToOwnUnit && unidade !== ALL) ||
    statusFilter !== null ||
    churnFilter !== null ||
    erpFilter !== ALL ||
    segmentoFilter !== ALL ||
    contratoAssinadoFilter !== null;
  const clearFilters = () =>
    mudar({
      q: "",
      unidade: undefined,
      status: "",
      churn: undefined,
      erp: undefined,
      segmentoContrato: undefined,
      assinatura: undefined,
    });
  const paginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const pagina = Math.min(search.pagina ?? 1, paginas);
  const naPagina = filtered.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const irParaPagina = (p: number) =>
    void navigate({
      search: { ...search, pagina: p > 1 ? p : undefined },
      replace: true,
    });
  const mrrTotal = filtered.reduce((soma, r) => soma + mrrOf(r), 0);

  const abrirContatos = (r: Cliente) =>
    setContatoCliente({ id: r.id, nome: displayName(r) || "—", unidade: r.unidade });

  if (erro)
    return (
      <EstadoErro
        detalhe={`Fonte: empresas, contratos, v_cliente_mrr e Central de Tratativas. ${erro}`}
        tentarNovamente={() => setTentativa((t) => t + 1)}
      />
    );

  return (
    <div className="space-y-4">
      {/* Filtros primeiro (Lista, ARQUETIPOS §3): os cartões abaixo contam dentro deles. */}
      <BarraFiltros className="sticky top-0 z-20">
        <label className="relative min-w-[240px] flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Buscar por razão social ou CNPJ"
            placeholder="Buscar por razão social ou CNPJ..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </label>
        {perms.scopedToOwnUnit && perms.unidade ? (
          <Badge variant="secondary" className="h-9 px-3 text-sm">
            Unidade: {perms.unidade}
          </Badge>
        ) : (
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="w-[200px]" aria-label="Unidade">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as unidades</SelectItem>
              {/* A unidade da URL pode ainda não estar na lista (carga em curso): ela aparece
                  mesmo assim, para o seletor não mostrar "Todas" com o filtro aplicado. */}
              {(unidade !== ALL && !unidades.includes(unidade)
                ? [unidade, ...unidades]
                : unidades
              ).map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={erpFilter} onValueChange={setErpFilter}>
          <SelectTrigger className="w-[180px]" aria-label="ERP">
            <SelectValue placeholder="ERP" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os ERPs</SelectItem>
            {(erpFilter !== ALL && !erps.includes(erpFilter) ? [erpFilter, ...erps] : erps).map(
              (e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Select value={segmentoFilter} onValueChange={setSegmentoFilter}>
          <SelectTrigger className="w-[200px]" aria-label="Segmento">
            <SelectValue placeholder="Segmento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os segmentos</SelectItem>
            {(segmentoFilter !== ALL && !segmentos.includes(segmentoFilter)
              ? [segmentoFilter, ...segmentos]
              : segmentos
            ).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={contratoAssinadoFilter === null ? ALL : contratoAssinadoFilter ? "com" : "sem"}
          onValueChange={(v) => setContratoAssinadoFilter(v === ALL ? null : v === "com")}
        >
          <SelectTrigger className="w-[220px]" aria-label="Contrato assinado">
            <SelectValue placeholder="Contrato Assinado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Contrato assinado: todos</SelectItem>
            <SelectItem value="com">Com data de assinatura</SelectItem>
            <SelectItem value="sem">Sem data de assinatura</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter && (
          <ChipFiltro
            rotulo="Situação financeira"
            valor={STATUS_META[statusFilter].label}
            aoRemover={() => setStatusFilter(null)}
          />
        )}
        {churnFilter !== null && (
          <ChipFiltro
            rotulo="Churn"
            valor={churnFilter ? "só com churn" : "só sem churn"}
            aoRemover={() => mudar({ churn: undefined })}
          />
        )}
        {/* Sempre montado (desabilitado sem filtro): sumir no clique jogava o foco no body. */}
        <BotaoComMotivo
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={!hasFilters}
          motivo={hasFilters ? null : "Nenhum filtro aplicado."}
          onClick={clearFilters}
        >
          <X className="size-4" aria-hidden />
          Limpar filtros
        </BotaoComMotivo>
        <BotaoComMotivo
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={loading || filtered.length === 0}
          motivo={
            loading ? "Aguarde a carga" : filtered.length === 0 ? "Nenhum cliente no recorte" : null
          }
          onClick={() => {
            const data = filtered.map((r) => {
              const info = contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
              return {
                "Razão Social": displayName(r),
                Unidade: r.unidade || "",
                MRR: mrrOf(r),
                "MRR vem de": mrrFonteOf(r) ?? "",
                CNPJ: r.cnpj || "",
                Estado: r.uf || "",
                "Status Financeiro": r.status_financeiro
                  ? STATUS_META[r.status_financeiro].label
                  : "",
                "Pipedrive ID": r.pipedrive_id || "",
                "Fonte Cadastro": r.fonte_cadastro || "",
                ERP: r.erp || "",
                Segmento: r.segmento || "",
                "Regime Tributário": info?.regime_tributario || "",
                "Data do Ganho": fmtDate(info?.ganho_em) || "",
                "Contrato Assinado em": fmtDate(assinaturaOf(r)) || "",
                Vendedor: info?.closer || "",
              };
            });
            exportRowsToXlsx(
              data,
              "clientes-planning",
              "Planning",
              [40, 18, 14, 20, 10, 18, 14, 18, 18, 20, 20, 16, 18, 18],
            );
          }}
        >
          <FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden /> Exportar Excel
        </BotaoComMotivo>
      </BarraFiltros>

      {/* Sem churn × churn, dentro dos filtros acima (menos o próprio filtro de churn). O
          clique filtra a tabela; clicar de novo no aplicado tira o filtro. */}
      {loading ? (
        <Carregando variante="kpis" />
      ) : (
        <KpiGrade colunas={2}>
          <KpiCard
            rotulo="Clientes sem churn"
            valor={NUM.format(churnCounts.ativo)}
            nota={`Sem card de churn na Central de Tratativas${churnFilter === false ? " · filtro aplicado" : ""}`}
            abrir={{
              rotulo: churnFilter === false ? "Tirar o filtro" : "Filtrar",
              onClick: () => alternarChurn(false),
            }}
            className={churnFilter === false ? "border-primary-text" : undefined}
          />
          <KpiCard
            rotulo="Churn"
            valor={NUM.format(churnCounts.churn)}
            tom="perigo"
            tomRotulo="churn"
            nota={`Card de churn na Central de Tratativas, lido em até 1.000 cards${churnFilter === true ? " · filtro aplicado" : ""}`}
            abrir={{
              rotulo: churnFilter === true ? "Tirar o filtro" : "Filtrar",
              onClick: () => alternarChurn(true),
            }}
            className={churnFilter === true ? "border-primary-text" : undefined}
          />
        </KpiGrade>
      )}

      <Secao
        titulo="Quais clientes estão neste recorte?"
        descricao="Recorte operacional das unidades regionais. Estes números medem contratos e situação financeira, não o total da base. Clique na linha para ver os contatos."
      >
        {loading ? (
          <Carregando variante="tabela" />
        ) : filtered.length === 0 ? (
          <EstadoVazio
            titulo={hasFilters ? "Nenhum cliente neste recorte" : "Nenhum cliente com contrato"}
            total={hasFilters ? visiveis.length : undefined}
            descricao={
              hasFilters
                ? undefined
                : "Nenhuma empresa de unidade regional com contrato no seu escopo."
            }
            acao={
              hasFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <span className="text-sm font-medium">
                <span className="num">{NUM.format(filtered.length)}</span>
                {hasFilters && (
                  <>
                    {" "}
                    de <span className="num">{NUM.format(visiveis.length)}</span>
                  </>
                )}{" "}
                {filtered.length === 1 ? "cliente" : "clientes"}
              </span>
              <span className="text-sm">
                <span className="font-semibold text-foreground">
                  MRR total: <span className="num">{fmtBRL(mrrTotal)}</span>
                </span>
                {/* Sem filtro de churn, o total soma quem deu churn: dizer, para não ser lido
                    como MRR da carteira ativa (N11). */}
                {churnFilter === null && churnCounts.churn > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    inclui clientes com churn
                  </span>
                )}
              </span>
            </div>
            <div className="max-h-[calc(100vh-360px)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm shadow-[inset_0_-1px_0_var(--border)]">
                  <TableRow>
                    {(
                      [
                        { key: "razao_social", label: "Razão Social", align: "left" },
                        { key: "unidade", label: "Unidade", align: "left" },
                        { key: "mrr", label: "MRR", align: "right" },
                        { key: "cnpj", label: "CNPJ", align: "left" },
                        { key: "uf", label: "Estado", align: "left" },
                        { key: "status_financeiro", label: "Situação financeira", align: "left" },
                        { key: "pipedrive_id", label: "Pipedrive ID", align: "left" },
                        { key: "fonte_cadastro", label: "Fonte Cadastro", align: "left" },
                        { key: "erp", label: "ERP", align: "left" },
                        { key: "segmento", label: "Segmento", align: "left" },
                        { key: "regime_tributario", label: "Regime Tributário", align: "left" },
                        { key: "ganho_em", label: "Data do Ganho", align: "left" },
                        {
                          key: "entrada_contrato_assinado_em",
                          label: "Contrato Assinado em",
                          align: "left",
                        },
                        { key: "closer", label: "Vendedor", align: "left" },
                      ] as { key: SortKey; label: string; align: "left" | "right" }[]
                    ).map((col) => {
                      const active = sort?.key === col.key;
                      const Icon = !active
                        ? ArrowUpDown
                        : sort?.dir === "asc"
                          ? ArrowUp
                          : ArrowDown;
                      return (
                        <TableHead
                          key={col.key}
                          aria-sort={
                            active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined
                          }
                          className={cn(
                            "sticky top-0 bg-card/95 backdrop-blur-sm",
                            col.align === "right" && "text-right",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
                              FOCO_VISIVEL,
                              col.align === "right" && "ml-auto",
                              active ? "text-foreground font-semibold" : "text-muted-foreground",
                            )}
                          >
                            {col.label}
                            <Icon
                              aria-hidden
                              className={cn(
                                "h-3.5 w-3.5",
                                active ? "text-primary-text" : "text-muted-foreground",
                              )}
                            />
                          </button>
                        </TableHead>
                      );
                    })}
                    {podeMarcarChurn && (
                      <TableHead className="sticky top-0 bg-card/95 backdrop-blur-sm text-right">
                        Ações
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {naPagina.map((r) => {
                    const meta = r.status_financeiro ? STATUS_META[r.status_financeiro] : null;
                    const churned = isChurn(r);
                    const info = contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(
                          podeVerContatos &&
                            // Foco de linha: o mesmo das filas de Monetização (outline em <tr>, onde o ring
                            // do FOCO_VISIVEL não desenha).
                            "cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        )}
                        // A linha abre os contatos: com teclado também (Enter ou espaço).
                        tabIndex={podeVerContatos ? 0 : undefined}
                        onKeyDown={
                          podeVerContatos
                            ? (e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  abrirContatos(r);
                                }
                              }
                            : undefined
                        }
                        onClick={podeVerContatos ? () => abrirContatos(r) : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {displayName(r) || "—"}
                            {/* Churn com ícone e palavra (V7); a linha não esmaece mais, porque
                              opacidade derrubava o contraste do texto (V20). */}
                            {churned && <StatusBadge tom="perigo">churn</StatusBadge>}
                            {podeVerContatos && (contatosCount.get(r.id) ?? 0) > 0 && (
                              <Badge
                                variant="secondary"
                                className="gap-1 px-1.5 py-0 text-xs font-normal"
                                title="Contatos vinculados — clique na linha para ver"
                              >
                                <Users className="h-3 w-3" />
                                {contatosCount.get(r.id)}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.unidade ? <Badge variant="secondary">{r.unidade}</Badge> : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {(() => {
                            const v = mrrOf(r);
                            if (!(v > 0)) return <span className="text-muted-foreground">—</span>;
                            // A procedência fica visível na própria célula: o
                            // mesmo cliente pode ter número no Omie e no
                            // Pipedrive, e saber qual está na tela é o que
                            // permite conferir a divergência na origem.
                            const fonte = mrrFonteOf(r);
                            return (
                              <span title={fonte ? `MRR vem do ${fonte}` : undefined}>
                                {fmtBRL(v)}
                                {fonte ? (
                                  <span className="ml-1 text-xs uppercase text-muted-foreground">
                                    {fonte}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.cnpj || "—"}</TableCell>
                        <TableCell>{r.uf || "—"}</TableCell>

                        <TableCell>
                          {meta ? (
                            <span title={meta.description}>
                              <StatusBadge tom={meta.tom}>{meta.label}</StatusBadge>
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.pipedrive_id ? (
                            <a
                              href={`https://app.pipedrive.com/deal/${r.pipedrive_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className={`inline-flex items-center gap-1 text-primary-text hover:underline ${FOCO_VISIVEL}`}
                            >
                              {r.pipedrive_id}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{r.fonte_cadastro || "—"}</TableCell>
                        <TableCell>{r.erp || "—"}</TableCell>
                        <TableCell>{r.segmento || "—"}</TableCell>
                        <TableCell>{info?.regime_tributario || "—"}</TableCell>
                        <TableCell>{fmtDate(info?.ganho_em) || "—"}</TableCell>
                        <TableCell>{fmtDate(assinaturaOf(r)) || "—"}</TableCell>
                        <TableCell>{info?.closer || "—"}</TableCell>
                        {podeMarcarChurn && (
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {perms.isAdmin && (
                                <EditarClienteButton r={r} onSave={salvarEdicaoCliente} />
                              )}
                              <MarcarChurnClienteButton
                                r={r}
                                churned={churned}
                                onConfirm={marcarChurnDoCliente}
                              />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                Página <span className="num">{pagina}</span> de{" "}
                <span className="num">{paginas}</span> · {POR_PAGINA} por página
              </span>
              <div className="flex gap-2">
                <BotaoComMotivo
                  variant="outline"
                  size="sm"
                  disabled={pagina === 1}
                  motivo={pagina === 1 ? "Já é a primeira página" : null}
                  onClick={() => irParaPagina(pagina - 1)}
                >
                  Anterior
                </BotaoComMotivo>
                <BotaoComMotivo
                  variant="outline"
                  size="sm"
                  disabled={pagina === paginas}
                  motivo={pagina === paginas ? "Já é a última página" : null}
                  onClick={() => irParaPagina(pagina + 1)}
                >
                  Próxima
                </BotaoComMotivo>
              </div>
            </footer>
          </Card>
        )}
      </Secao>

      {q.trim().length >= 3 && (omieLoading || omieMatches.length > 0) && (
        <Card className="border-warning/40">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <TriangleAlert className="h-4 w-4 text-warning" />
            <span className="text-sm font-medium">
              {omieLoading
                ? "Buscando na Omie..."
                : `${omieMatches.length} resultado(s) na Omie, não reconciliado(s) na Base Nova`}
            </span>
          </div>
          {!omieLoading && (
            <div className="max-h-64 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Razão Social</TableHead>
                    <TableHead>Unidade (Omie)</TableHead>
                    <TableHead>CNPJ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {omieMatches.map((m) => (
                    <TableRow key={m.cnpj}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {m.razao_social || "—"}
                          <Badge
                            variant="outline"
                            className="border-warning text-warning text-xs px-1.5 py-0"
                          >
                            não reconciliado
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {m.unidade ? <Badge variant="secondary">{m.unidade}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.cnpj}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            Encontrado no cadastro de clientes da Omie (ERP), mas sem vínculo com deal/contrato em
            `empresas`. Não conta nos cards, na contagem ou no MRR total acima — reconciliar
            manualmente se for um cliente ativo.
          </div>
        </Card>
      )}

      <ContatosClienteDialog
        cliente={contatoCliente}
        onOpenChange={(open) => {
          if (!open) setContatoCliente(null);
        }}
      />
    </div>
  );
}

function EditarClienteButton({
  r,
  onSave,
}: {
  r: Cliente;
  onSave: (r: Cliente, patch: { razao_social?: string; cnpj?: string }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [nome, setNome] = useState(displayName(r));
  const [cnpj, setCnpj] = useState(r.cnpj ?? "");

  const cnpjDigits = cnpj.replace(/\D/g, "");
  const nomeValido = nome.trim().length > 0;
  const cnpjValido = cnpjDigits.length === 0 || cnpjDigits.length === 14;
  const nomeMudou = nome.trim() !== (r.razao_social ?? "").trim();
  const cnpjMudou = cnpjDigits !== (r.cnpj ?? "").replace(/\D/g, "") && cnpjDigits.length === 14;

  const submit = async () => {
    if (!nomeValido) {
      toast.error("Razão social não pode ficar em branco.");
      return;
    }
    if (!cnpjValido) {
      toast.error("CNPJ precisa ter 14 dígitos.");
      return;
    }
    if (!nomeMudou && !cnpjMudou) {
      setOpen(false);
      return;
    }
    setPending(true);
    try {
      const patch: { razao_social?: string; cnpj?: string } = {};
      if (nomeMudou) patch.razao_social = nome.trim();
      if (cnpjMudou) patch.cnpj = cnpjDigits;
      await onSave(r, patch);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar cliente");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setNome(displayName(r));
          setCnpj(r.cnpj ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Editar cliente"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente — {displayName(r)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Razão social</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label>CNPJ</Label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Este registro vem do sync automático (Pipedrive/Omie) — se o mesmo cliente for
            resincronizado, o valor pode ser sobrescrito novamente.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !nomeValido || !cnpjValido}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarcarChurnClienteButton({
  r,
  churned,
  onConfirm,
}: {
  r: Cliente;
  churned: boolean;
  onConfirm: (
    r: Cliente,
    motivo: string,
    observacao: string,
    dataChurn: string,
  ) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [motivo, setMotivo] = useState<MotivoChurn | "">("");
  const [observacao, setObservacao] = useState("");
  const [dataChurn, setDataChurn] = useState(() => new Date().toISOString().slice(0, 10));

  if (churned) return null;
  if (!r.pipedrive_id) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className="h-7 w-7 text-muted-foreground"
        title="Sem Pipedrive ID — não é possível vincular o churn"
      >
        <UserX className="h-3.5 w-3.5" />
      </Button>
    );
  }

  const submit = async () => {
    if (!motivo) {
      toast.error("Selecione o motivo do churn.");
      return;
    }
    setPending(true);
    try {
      await onConfirm(r, motivo, observacao.trim(), dataChurn);
      setOpen(false);
      setMotivo("");
      setObservacao("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao marcar churn");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-danger hover:text-danger"
          title="Marcar churn"
        >
          <UserX className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar churn — {displayName(r)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Data do churn</Label>
            <Input type="date" value={dataChurn} onChange={(e) => setDataChurn(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoChurn)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_CHURN.map((opcao) => (
                  <SelectItem key={opcao} value={opcao}>
                    {opcao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Observação</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Detalhes adicionais (opcional)"
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Isso cria um card no pipe Tratativas do Pipefy já na fase "Perdido". Pode levar até
            15min pra refletir aqui depois do sync. Não é possível desfazer por aqui.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "Enviando…" : "Confirmar churn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
