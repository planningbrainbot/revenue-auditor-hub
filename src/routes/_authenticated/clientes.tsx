import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ExternalLink,
  FileSpreadsheet,
  Layers,
  Pencil,
  Search,
  Users,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { exportRowsToXlsx } from "@/lib/xlsx-export";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { useClientesDiretorio } from "@/hooks/use-clientes-diretorio";
import { PrePlanningTab } from "@/components/clientes/pre-planning-tab";
import {
  ContatosClienteDialog,
  type ClienteSelecionado,
} from "@/components/clientes/contatos-cliente-dialog";
import {
  atualizarCliente,
  marcarChurnCliente,
  type ClienteDiretorio,
} from "@/lib/clientes.functions";
import { MOTIVOS_CHURN, type MotivoChurn } from "@/lib/royalties.functions";
import { digits } from "@/lib/server-utils";

// A aba "Base nova" lê a view v_clientes_diretorio (empresas + omie_clientes +
// omie_clientes_cadastro, UMA linha por documento, unidade normalizada e grupo
// econômico resolvido) via listClientesDiretorio — ver cabeçalho em
// clientes.functions.ts e na migration 20260903150000_v_clientes_diretorio.sql.
// Só linhas vindas de `empresas` têm `empresa_id`; é ele que editar/churn/contatos usam.
type Cliente = ClienteDiretorio;
type StatusFinanceiro = NonNullable<Cliente["status_financeiro"]>;
type Origem = Cliente["origem"];
type Base = Cliente["base"];

type ContratoInfo = {
  ganho_em: string | null;
  regime_tributario: string | null;
  entrada_contrato_assinado_em: string | null;
  closer: string | null;
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
// Razão social → título do deal (só empresas) → nome fantasia (Omie).
function displayName(r: Pick<Cliente, "razao_social" | "titulo" | "nome_fantasia">): string {
  const rs = r.razao_social?.trim();
  if (rs && !GARBAGE_RAZAO_SOCIAL.has(rs)) return rs;
  return r.titulo?.trim() || r.nome_fantasia?.trim() || "";
}

// `documento` vem da view só com dígitos; a máscara é só de exibição.
function fmtDocumento(v: string | null | undefined): string {
  if (!v) return "";
  const d = digits(v);
  if (d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

// 'YYYY-MM-DD' (ou timestamp) → 'dd/mm/aaaa'.
function fmtDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const [y, m, d] = v.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : v;
}

const ALL = "__all__";
// Valor sentinela do select de unidade pra linhas com `unidade` nula.
const SEM_UNIDADE = "__none__";
const PAGE_SIZE = 100;

const ORIGEM_LABEL: Record<Origem, string> = {
  pipedrive: "Pipedrive",
  omie: "Omie",
  ambos: "Pipedrive + Omie",
  ops: "Ops",
};

const BASE_LABEL: Record<Base, string> = {
  nova: "Base nova (Pipedrive)",
  antiga: "Base antiga (só ERP)",
};

function grupoOrigemLabel(r: Pick<Cliente, "grupo_origem" | "grupo_id">): string {
  switch (r.grupo_origem) {
    case "cadastro":
      return `Grupo cadastrado (id ${r.grupo_id ?? "?"})`;
    case "contrato":
      return "Filiais do mesmo contrato";
    case "nome_fantasia":
      return "Mesmo nome fantasia no Omie";
    case "raiz_cnpj":
      return "Mesma raiz de CNPJ";
    default:
      return "";
  }
}

// Uma linha "pertence" à unidade selecionada se é a unidade normalizada dela OU se o
// documento aparece na conta Omie daquela unidade (ex.: cliente da Matriz faturado
// também em Curitiba). "Sem unidade" casa só `unidade` nula.
function matchUnidade(r: Pick<Cliente, "unidade" | "unidades_omie">, u: string): boolean {
  if (u === SEM_UNIDADE) return r.unidade == null;
  return r.unidade === u || r.unidades_omie.includes(u);
}

const STATUS_ORDER: StatusFinanceiro[] = [
  "ATIVO",
  "INADIMPLENTE",
  "NUNCA_PAGOU",
  "EM_ATRASO",
  "SEM_ATIVIDADE",
  "SEM_AR",
];

const STATUS_META: Record<
  StatusFinanceiro,
  { label: string; card: string; badge: string; description: string }
> = {
  ATIVO: {
    label: "Ativo",
    card: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-100",
    badge: "bg-emerald-500 text-white hover:bg-emerald-500",
    description: "Pagou nos últimos 90 dias",
  },
  EM_ATRASO: {
    label: "Em atraso",
    card: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-900 dark:text-amber-100",
    badge: "bg-amber-400 text-amber-950 hover:bg-amber-400",
    description: "Título vencido, mas pagou recentemente",
  },
  INADIMPLENTE: {
    label: "Inadimplente",
    card: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-900 dark:text-red-100",
    badge: "bg-red-600 text-white hover:bg-red-600",
    description: "Vencido + sem pagamento há mais de 90 dias",
  },
  SEM_ATIVIDADE: {
    label: "Sem atividade",
    card: "bg-orange-50 border-orange-200 text-orange-900 dark:bg-orange-950 dark:border-orange-900 dark:text-orange-100",
    badge: "bg-orange-500 text-white hover:bg-orange-500",
    description: "Sem pagamento >90 dias, sem título em aberto",
  },
  NUNCA_PAGOU: {
    label: "Nunca pagou",
    card: "bg-slate-700 border-slate-800 text-white dark:bg-slate-800 dark:border-slate-900",
    badge: "bg-slate-700 text-white hover:bg-slate-700",
    description: "Sem nenhum pagamento registrado",
  },
  SEM_AR: {
    label: "Sem AR",
    card: "bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200",
    badge: "bg-slate-300 text-slate-800 hover:bg-slate-300",
    description: "Sem histórico de faturamento (Pipedrive sem Omie)",
  },
};

type SortKey =
  | "razao_social"
  | "unidade"
  | "grupo_nome"
  | "mrr"
  | "documento"
  | "uf"
  | "status_financeiro"
  | "ultimo_recebimento"
  | "origem"
  | "pipedrive_id"
  | "fonte_cadastro"
  | "erp"
  | "segmento"
  | "ganho_em"
  | "regime_tributario"
  | "entrada_contrato_assinado_em"
  | "closer";

const COLUNAS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "razao_social", label: "Razão Social", align: "left" },
  { key: "unidade", label: "Unidade", align: "left" },
  { key: "grupo_nome", label: "Grupo", align: "left" },
  { key: "mrr", label: "MRR", align: "right" },
  { key: "documento", label: "CNPJ / CPF", align: "left" },
  { key: "uf", label: "Estado", align: "left" },
  { key: "status_financeiro", label: "Status Financeiro", align: "left" },
  { key: "ultimo_recebimento", label: "Último receb.", align: "left" },
  { key: "origem", label: "Origem", align: "left" },
  { key: "pipedrive_id", label: "Pipedrive ID", align: "left" },
  { key: "fonte_cadastro", label: "Fonte Cadastro", align: "left" },
  { key: "erp", label: "ERP", align: "left" },
  { key: "segmento", label: "Segmento", align: "left" },
  { key: "regime_tributario", label: "Regime Tributário", align: "left" },
  { key: "ganho_em", label: "Data do Ganho", align: "left" },
  { key: "entrada_contrato_assinado_em", label: "Contrato Assinado em", align: "left" },
  { key: "closer", label: "Vendedor", align: "left" },
];

export const Route = createFileRoute("/_authenticated/clientes")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" ? search.status : "",
    unidade: typeof search.unidade === "string" ? search.unidade : "",
  }),
  component: ClientesPage,
});

function ClientesPage() {
  // O id vem do contexto da rota (o `beforeLoad` de /_authenticated já resolveu a
  // sessão), não de um useAuth() local: é o padrão documentado em usePermissions e
  // evita que a busca de ~11 mil linhas só comece no segundo render.
  // A mesma chave alimenta o cache do diretório e a edição otimista abaixo.
  const { user } = Route.useRouteContext();
  const perms = usePermissions(user.id);
  const queryClient = useQueryClient();
  const { status: statusParam, unidade: unidadeParam } = Route.useSearch();
  const { data, isPending, error } = useClientesDiretorio(user.id);
  const rows = useMemo<Cliente[]>(() => data?.rows ?? [], [data]);
  // Tabela `unidades` inteira (regionais + internas), pra montar o select agrupado.
  const [unidadesTabela, setUnidadesTabela] = useState<{ nome: string; tipo: string | null }[]>([]);
  const [mrrByPipedriveId, setMrrByPipedriveId] = useState<Map<string, number>>(new Map());
  const [contratoInfoByPipedriveId, setContratoInfoByPipedriveId] = useState<
    Map<string, ContratoInfo>
  >(new Map());
  const [churnedIds, setChurnedIds] = useState<Set<string>>(new Set());
  // Fetches client-side (unidades, contratos, churn) — a view vem pelo hook.
  const [auxLoading, setAuxLoading] = useState(true);
  // Erro das consultas auxiliares, guardado POR CONSULTA. Antes o `?? []` engolia a
  // falha e a tela afirmava "MRR total: R$ 0" e churn 0 como se fossem verdade; um
  // erro só, concatenado, degradava apenas o MRR e deixava os cards mentirem.
  const [auxErro, setAuxErro] = useState<{
    unidades?: string;
    contratos?: string;
    tratativas?: string;
  }>({});
  // `isPending` (e não `isLoading`): no react-query v5 `isLoading` é
  // `isPending && isFetching`, então com a query ainda parada ele é false e a tabela
  // chegaria a renderizar "Nenhum cliente encontrado." antes da busca começar.
  const loading = isPending || auxLoading;
  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState(unidadeParam || ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFinanceiro | null>(
    statusParam ? (statusParam as StatusFinanceiro) : null,
  );
  const [churnFilter, setChurnFilter] = useState<boolean | null>(null);
  const [erpFilter, setErpFilter] = useState(ALL);
  const [segmentoFilter, setSegmentoFilter] = useState(ALL);
  const [contratoAssinadoFilter, setContratoAssinadoFilter] = useState<boolean | null>(null);
  const [baseFilter, setBaseFilter] = useState<Base | typeof ALL>(ALL);
  const [docFilter, setDocFilter] = useState<"CNPJ" | "CPF" | typeof ALL>(ALL);
  // grupo_chave selecionado ao clicar na badge de grupo (null = sem filtro).
  const [grupoFilter, setGrupoFilter] = useState<string | null>(null);
  // "Só quem está em grupo" — acionado pelo card Grupos.
  const [soGrupos, setSoGrupos] = useState(false);
  // Cliente cujo painel de contatos está aberto (null = fechado).
  const [contatoCliente, setContatoCliente] = useState<ClienteSelecionado | null>(null);
  // Quantos contatos cada empresa tem, pra sinalizar na linha antes do clique.
  const [contatosCount, setContatosCount] = useState<Map<number, number>>(new Map());
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const atualizarClienteFn = useServerFn(atualizarCliente);
  const marcarChurnClienteFn = useServerFn(marcarChurnCliente);

  const salvarEdicaoCliente = async (
    r: Cliente,
    patch: { razao_social?: string; cnpj?: string },
  ) => {
    if (r.empresa_id == null) {
      throw new Error("Este registro vem só do ERP — não há cadastro em `empresas` para editar.");
    }
    const res = await atualizarClienteFn({ data: { id: r.empresa_id, ...patch } });
    // Reflete na hora no cache do react-query; a view só muda no próximo refetch.
    queryClient.setQueryData<{ rows: Cliente[] }>(["clientes-diretorio", user?.id], (old) => {
      if (!old) return old;
      return {
        ...old,
        rows: old.rows.map((row) => {
          if (row.chave !== r.chave) return row;
          const patched: Cliente = { ...row };
          if (patch.razao_social !== undefined) patched.razao_social = patch.razao_social;
          if (patch.cnpj !== undefined) {
            patched.documento = digits(patch.cnpj);
            patched.tipo_documento = "CNPJ";
          }
          return patched;
        }),
      };
    });
    toast.success("Cliente atualizado.");
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
        mrr: mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0,
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
    (async () => {
      try {
        const [unidadesRes, contRes, tratRes] = await Promise.all([
          // Todas as unidades (regionais E internas): a Matriz e as BUs entram no diretório.
          supabase.from("unidades").select("nome_da_praca,tipo"),
          supabase
            .from("contratos")
            .select(
              "mrr_mensal,pipedrive_deal_id,status_contrato,ganho_em,regime_tributario,entrada_contrato_assinado_em,closer",
            )
            .eq("status_contrato", "Ativo")
            .limit(20000),
          supabase
            .from("central_tratativas")
            .select("pipedrive_deal_id")
            // status="lost" é derivado do id da fase no Pipefy (ver PHASE_STATUS em
            // tratativas.functions.ts), não do nome — resiliente a rename de fase.
            // A fase "Perdido" virou "Churn Confirmado (Perdido)" em ago/2026 e um
            // filtro por nome (.eq("estagio","Perdido")) zerava o churn aqui.
            .eq("status", "lost")
            .limit(2000),
        ]);
        if (!mounted) return;
        // Falha aqui não pode passar em silêncio: sem contratos o MRR total vira R$ 0 e sem
        // central_tratativas o churn vira 0 — números que a tela apresentaria como fato.
        // Guardado por consulta porque cada uma degrada uma parte diferente da tela.
        const erros = {
          unidades: unidadesRes.error?.message,
          contratos: contRes.error?.message,
          tratativas: tratRes.error?.message,
        };
        setAuxErro(erros);
        const msgAux = [erros.unidades, erros.contratos, erros.tratativas]
          .filter(Boolean)
          .join(" · ");
        if (msgAux) toast.error("Falha ao carregar dados auxiliares: " + msgAux);
        setUnidadesTabela(
          (unidadesRes.data ?? []).map((u) => ({ nome: u.nome_da_praca, tipo: u.tipo ?? null })),
        );
        // Sem filtro por unidade regional aqui: o MRR da Matriz precisa entrar.
        const m = new Map<string, number>();
        const info = new Map<string, ContratoInfo>();
        for (const c of contRes.data ?? []) {
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
        const churned = new Set<string>(
          (tratRes.data ?? []).map((t) => String(t.pipedrive_deal_id)).filter(Boolean),
        );
        setChurnedIds(churned);
      } finally {
        if (mounted) setAuxLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
      const { data, error } = await supabase
        .from("contatos")
        .select("empresa_id")
        .not("empresa_id", "is", null)
        .limit(20000);
      if (!mounted) return;
      // Erro aqui zerava em silêncio o selo de contatos da linha.
      if (error) {
        toast.error("Falha ao carregar contatos vinculados: " + error.message);
        return;
      }
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

  // Opções do select de unidade: regionais → internas (Matriz, BUs) → qualquer outra
  // unidade que apareça nas linhas e não esteja na tabela (Agronegócio, ROIT, "1055"…)
  // → "Sem unidade".
  const unidadeOptions = useMemo(() => {
    const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR");
    const regionais = unidadesTabela
      .filter((u) => u.tipo === "regional")
      .map((u) => u.nome)
      .sort(cmp);
    const internas = unidadesTabela
      .filter((u) => u.tipo === "interna")
      .map((u) => u.nome)
      .sort(cmp);
    const conhecidas = new Set([...regionais, ...internas]);
    const outras = new Set<string>();
    for (const r of rows) {
      if (r.unidade && !conhecidas.has(r.unidade)) outras.add(r.unidade);
    }
    return { regionais, internas, outras: Array.from(outras).sort(cmp) };
  }, [unidadesTabela, rows]);

  const erps = useMemo(
    () => Array.from(new Set(rows.map((r) => r.erp).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const segmentos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.segmento).filter(Boolean) as string[])).sort(),
    [rows],
  );

  // Usuário restrito à própria unidade: vê a carteira da praça dele OU as linhas em
  // que o documento aparece numa conta Omie da praça — a mesma regra do gate da view.
  // Para as ~10 mil linhas só-ERP a `unidade` sai de um desempate por `max(updated_at)`
  // entre contas, então casar só por ela faria o cliente entrar e sair da lista
  // conforme a conta que sincronizou por último. As AÇÕES continuam presas a
  // `r.unidade` (ver `daMinhaUnidade` na tabela). Fail-closed: sem unidade (sócio sem
  // linha em `socios`), lista vazia; antes esse caso mostrava a rede inteira.
  const visiveis = useMemo(() => {
    if (perms.scopedToOwnUnit) {
      if (!perms.unidade) return [];
      const minha = perms.unidade;
      return rows.filter(
        (r) => unitMatches(minha, r.unidade) || r.unidades_omie.some((u) => unitMatches(minha, u)),
      );
    }
    return rows;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  // Export sai bloqueado quando um dado que ele carrega não pôde ser lido: a planilha
  // vai embora sozinha e ninguém revisita a origem dela.
  const exportBloqueado = auxErro.contratos
    ? "MRR indisponível: " + auxErro.contratos
    : auxErro.tratativas
      ? "Churn indisponível: " + auxErro.tratativas
      : undefined;

  // Sócio cujo usuário não está vinculado a nenhuma linha de `socios`: `visiveis` é
  // vazio de propósito, mas sem este sinal a tela monta inteira com um select de
  // unidade inerte e um "Nenhum cliente encontrado." que não diz o que fazer.
  const semUnidadeVinculada = !perms.loading && perms.scopedToOwnUnit && !perms.unidade;

  // Contador do grupo para usuário escopado: `grupo_qtd` conta os membros na base
  // inteira e a badge revelaria quantos existem em outras praças. Conta DOCUMENTOS
  // distintos, como o `count(distinct coalesce(documento, chave))` da view — contar
  // linhas traria de volta o inflado de dois deals para o mesmo CNPJ.
  // null = usuário sem recorte, usa `grupo_qtd` da view.
  const grupoQtdVisivel = useMemo(() => {
    if (!perms.scopedToOwnUnit) return null;
    const m = new Map<string, Set<string>>();
    for (const r of visiveis) {
      if (!r.grupo_chave) continue;
      const s = m.get(r.grupo_chave) ?? new Set<string>();
      s.add(r.documento ?? r.chave);
      m.set(r.grupo_chave, s);
    }
    return m;
  }, [visiveis, perms.scopedToOwnUnit]);

  // churn status derived from central_tratativas (status=lost)
  const isChurn = useCallback(
    (r: Cliente) => !!r.pipedrive_id && churnedIds.has(r.pipedrive_id),
    [churnedIds],
  );

  // Nome do grupo filtrado, pro chip na barra de filtros.
  const grupoFilterNome = useMemo(() => {
    if (!grupoFilter) return null;
    return rows.find((r) => r.grupo_chave === grupoFilter)?.grupo_nome ?? null;
  }, [rows, grupoFilter]);

  // Todos os filtros da UI (busca, unidade, base, documento, grupo, ERP, segmento, status,
  // contrato assinado) exceto churn e "só grupos" — serve de base tanto pros cards de
  // resumo (que precisam contar dentro do recorte atual) quanto pra tabela.
  const baseFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    // Termo "com cara de documento" (só dígitos, com ou sem máscara) compara pelos dígitos;
    // texto normal continua batendo em razão social / título / nome fantasia / documento.
    const termSemMascara = term.replace(/[\s.\-/]/g, "");
    const termDigits = /^\d+$/.test(termSemMascara) ? termSemMascara : "";
    return visiveis.filter((r) => {
      if (statusFilter && r.status_financeiro !== statusFilter) return false;
      if (!perms.scopedToOwnUnit && unidade !== ALL && !matchUnidade(r, unidade)) return false;
      if (baseFilter !== ALL && r.base !== baseFilter) return false;
      if (docFilter !== ALL && r.tipo_documento !== docFilter) return false;
      if (grupoFilter && r.grupo_chave !== grupoFilter) return false;
      if (erpFilter !== ALL && r.erp !== erpFilter) return false;
      if (segmentoFilter !== ALL && r.segmento !== segmentoFilter) return false;
      if (contratoAssinadoFilter !== null) {
        const assinado = !!contratoInfoByPipedriveId.get(r.pipedrive_id ?? "")
          ?.entrada_contrato_assinado_em;
        if (contratoAssinadoFilter !== assinado) return false;
      }
      if (term) {
        const hay = [r.razao_social, r.titulo, r.nome_fantasia, r.documento]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        const bateTexto = hay.includes(term);
        const bateDoc = !!termDigits && !!r.documento && r.documento.includes(termDigits);
        if (!bateTexto && !bateDoc) return false;
      }
      return true;
    });
  }, [
    visiveis,
    q,
    unidade,
    statusFilter,
    baseFilter,
    docFilter,
    grupoFilter,
    erpFilter,
    segmentoFilter,
    contratoAssinadoFilter,
    perms.scopedToOwnUnit,
    contratoInfoByPipedriveId,
  ]);

  // Cards de resumo, sempre dentro do recorte atual. Ativos + Churn = base nova
  // (churn só existe pra quem tem deal no Pipedrive); Base antiga = o resto.
  const resumo = useMemo(() => {
    let ativo = 0;
    let churn = 0;
    let antiga = 0;
    const grupos = new Set<string>();
    for (const r of baseFiltered) {
      if (isChurn(r)) churn++;
      else if (r.base === "nova") ativo++;
      if (r.base === "antiga") antiga++;
      if (r.grupo_chave) grupos.add(r.grupo_chave);
    }
    return { ativo, churn, antiga, grupos: grupos.size };
  }, [baseFiltered, isChurn]);

  const filtered = useMemo(() => {
    const out = baseFiltered.filter((r) => {
      // churn filter: null = all, true = only churn, false = only active
      // (ativo = base nova sem churn, mesma semântica do card "Clientes Ativos")
      if (churnFilter === true && !isChurn(r)) return false;
      if (churnFilter === false && (r.base !== "nova" || isChurn(r))) return false;
      if (soGrupos && !r.grupo_chave) return false;
      return true;
    });
    const rank = new Map<string, number>();
    STATUS_ORDER.forEach((s, i) => rank.set(s, i));
    const mrrOf = (r: Cliente) => mrrByPipedriveId.get(r.pipedrive_id ?? "") ?? 0;
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
    // Linha sem valor ("—") vai SEMPRE pro fim, nas duas direções: quando um dos lados é
    // vazio a decisão é marcada como `absoluta` e escapa do `* dir`. Antes o comparador
    // devolvia +1 pro vazio e o `* dir` invertia: "mais recente primeiro" abria com as ~10
    // mil linhas sem último recebimento (e ~10,4 mil sem grupo) antes de qualquer dado.
    type Cmp = { c: number; absoluta: boolean };
    const IGUAL: Cmp = { c: 0, absoluta: false };
    const cmpStr = (a: string | null | undefined, b: string | null | undefined): Cmp => {
      const av = a ?? "";
      const bv = b ?? "";
      if (!av && !bv) return IGUAL;
      if (!av) return { c: 1, absoluta: true };
      if (!bv) return { c: -1, absoluta: true };
      return { c: av.localeCompare(bv, "pt-BR"), absoluta: false };
    };
    const cmpNum = (a: number, b: number): Cmp => ({ c: a - b, absoluta: false });
    return out.sort((a, b) => {
      let cmp: Cmp = IGUAL;
      switch (sort.key) {
        case "razao_social":
          cmp = cmpStr(displayName(a), displayName(b));
          break;
        case "unidade":
          cmp = cmpStr(a.unidade, b.unidade);
          break;
        case "grupo_nome":
          cmp = cmpStr(a.grupo_nome, b.grupo_nome);
          break;
        case "mrr":
          // MRR é número: zero é valor de verdade, não "vazio".
          cmp = cmpNum(mrrOf(a), mrrOf(b));
          break;
        case "documento":
          cmp = cmpStr(a.documento, b.documento);
          break;
        case "uf":
          cmp = cmpStr(a.uf, b.uf);
          break;
        case "status_financeiro":
          // Sem status conta como vazio: fica no fim também na ordem decrescente.
          cmp =
            !a.status_financeiro || !b.status_financeiro
              ? cmpStr(a.status_financeiro, b.status_financeiro)
              : cmpNum(rank.get(a.status_financeiro) ?? 99, rank.get(b.status_financeiro) ?? 99);
          break;
        case "ultimo_recebimento":
          // ISO 'YYYY-MM-DD' ordena certo como string
          cmp = cmpStr(a.ultimo_recebimento, b.ultimo_recebimento);
          break;
        case "origem":
          cmp = cmpStr(ORIGEM_LABEL[a.origem], ORIGEM_LABEL[b.origem]);
          break;
        case "pipedrive_id":
          // Sem id não é "id zero": vai pro fim, e só os presentes comparam numericamente.
          cmp =
            !a.pipedrive_id || !b.pipedrive_id
              ? cmpStr(a.pipedrive_id, b.pipedrive_id)
              : cmpNum(Number(a.pipedrive_id), Number(b.pipedrive_id));
          break;
        case "fonte_cadastro":
          cmp = cmpStr(a.fonte_cadastro, b.fonte_cadastro);
          break;
        case "erp":
          cmp = cmpStr(a.erp, b.erp);
          break;
        case "segmento":
          cmp = cmpStr(a.segmento, b.segmento);
          break;
        case "ganho_em":
          cmp = cmpStr(infoOf(a)?.ganho_em, infoOf(b)?.ganho_em);
          break;
        case "regime_tributario":
          cmp = cmpStr(infoOf(a)?.regime_tributario, infoOf(b)?.regime_tributario);
          break;
        case "entrada_contrato_assinado_em":
          cmp = cmpStr(
            infoOf(a)?.entrada_contrato_assinado_em,
            infoOf(b)?.entrada_contrato_assinado_em,
          );
          break;
        case "closer":
          cmp = cmpStr(infoOf(a)?.closer, infoOf(b)?.closer);
          break;
      }
      if (cmp.c !== 0) return cmp.absoluta ? cmp.c : cmp.c * dir;
      return displayName(a).localeCompare(displayName(b), "pt-BR");
    });
  }, [
    baseFiltered,
    churnFilter,
    soGrupos,
    isChurn,
    sort,
    mrrByPipedriveId,
    contratoInfoByPipedriveId,
  ]);

  // Paginação client-side. A página é guardada junto com uma "assinatura" dos filtros e
  // da ordenação: se qualquer um mudar, a assinatura muda e a página volta pra 1 sem
  // precisar de effect nem de mexer em cada setter.
  const filtrosKey = JSON.stringify([
    q,
    unidade,
    statusFilter,
    churnFilter,
    erpFilter,
    segmentoFilter,
    contratoAssinadoFilter,
    baseFilter,
    docFilter,
    grupoFilter,
    soGrupos,
    sort,
    perms.unidade,
  ]);
  const [pageState, setPageState] = useState({ key: filtrosKey, page: 1 });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pageState.key === filtrosKey ? pageState.page : 1, totalPages);
  // A assinatura guardada precisa ACOMPANHAR os filtros, não só ser comparada com eles:
  // guardando a assinatura antiga, desfazer um filtro fazia a chave voltar a bater e a tela
  // pulava de volta pra página antiga. Sincroniza durante o render, sem effect.
  if (pageState.key !== filtrosKey) setPageState({ key: filtrosKey, page: 1 });
  const setPage = (p: number) => {
    setPageState({ key: filtrosKey, page: Math.min(Math.max(1, p), totalPages) });
    tableScrollRef.current?.scrollTo({ top: 0 });
  };
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const totais = useMemo(() => {
    let cnpjs = 0;
    let cpfs = 0;
    let mrr = 0;
    for (const r of filtered) {
      if (r.tipo_documento === "CNPJ") cnpjs++;
      else if (r.tipo_documento === "CPF") cpfs++;
      // MRR só de quem tem deal no Pipedrive (contratos são indexados por deal)
      if (r.pipedrive_id) mrr += mrrByPipedriveId.get(r.pipedrive_id) ?? 0;
    }
    return { cnpjs, cpfs, mrr };
  }, [filtered, mrrByPipedriveId]);

  // Só serve ao cabeçalho quando "Só quem está em grupo" está ligado.
  const gruposNoRecorte = useMemo(() => {
    if (!soGrupos) return 0;
    const chaves = new Set<string>();
    for (const r of filtered) if (r.grupo_chave) chaves.add(r.grupo_chave);
    return chaves.size;
  }, [filtered, soGrupos]);

  const hasFilters =
    q !== "" ||
    unidade !== ALL ||
    statusFilter !== null ||
    churnFilter !== null ||
    erpFilter !== ALL ||
    segmentoFilter !== ALL ||
    contratoAssinadoFilter !== null ||
    baseFilter !== ALL ||
    docFilter !== ALL ||
    grupoFilter !== null ||
    soGrupos;
  const clearFilters = () => {
    setQ("");
    setUnidade(ALL);
    setStatusFilter(null);
    setChurnFilter(null);
    setErpFilter(ALL);
    setSegmentoFilter(ALL);
    setContratoAssinadoFilter(null);
    setBaseFilter(ALL);
    setDocFilter(ALL);
    setGrupoFilter(null);
    setSoGrupos(false);
  };

  // Exporta TODAS as linhas filtradas (não só a página).
  const exportar = () => {
    const dados = filtered.map((r) => {
      const info = contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
      return {
        "Razão Social": displayName(r),
        "Nome fantasia": r.nome_fantasia || "",
        Unidade: r.unidade || "",
        Grupo: r.grupo_nome || "",
        "Origem do grupo": grupoOrigemLabel(r),
        Origem: ORIGEM_LABEL[r.origem],
        Base: BASE_LABEL[r.base],
        MRR: r.pipedrive_id ? (mrrByPipedriveId.get(r.pipedrive_id) ?? 0) : 0,
        "CNPJ / CPF": fmtDocumento(r.documento),
        "Tipo doc": r.tipo_documento || "",
        Estado: r.uf || "",
        Cidade: r.cidade || "",
        "Status Financeiro": r.status_financeiro ? STATUS_META[r.status_financeiro].label : "",
        "Último recebimento": fmtDate(r.ultimo_recebimento) || "",
        "Pipedrive ID": r.pipedrive_id || "",
        "Código Omie": r.codigo_omie ?? "",
        "Fonte Cadastro": r.fonte_cadastro || "",
        ERP: r.erp || "",
        Segmento: r.segmento || "",
        "Regime Tributário": info?.regime_tributario || "",
        "Data do Ganho": fmtDate(info?.ganho_em) || "",
        "Contrato Assinado em": fmtDate(info?.entrada_contrato_assinado_em) || "",
        Vendedor: info?.closer || "",
      };
    });
    exportRowsToXlsx(
      dados,
      "clientes-diretorio",
      "Clientes",
      [40, 30, 18, 28, 26, 16, 22, 14, 20, 8, 8, 20, 18, 16, 14, 12, 18, 18, 20, 20, 16, 18, 18],
    );
  };

  const cardBase = "rounded-lg border p-4 text-left shadow-sm transition-all hover:shadow-md";
  const colSpanTabela = COLUNAS.length + (podeMarcarChurn ? 1 : 0);
  // Mesma navegação renderizada no cabeçalho do Card (sempre visível) e no rodapé.
  const navegacaoPaginas =
    !loading && totalPages > 1 ? (
      <div className="flex items-center gap-1 text-sm">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ‹ Anterior
        </Button>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          página {page} de {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          Próxima ›
        </Button>
      </div>
    ) : null;

  // Gate de permissão da página inteira: antes só o item do menu sumia e a rota continuava
  // acessível pela URL. `perms.loading` evita piscar o aviso enquanto as permissões chegam.
  if (!perms.loading && !perms.can("view.clientes") && !perms.isAdmin) {
    return (
      <div className="p-6">
        <Card className="p-6 text-sm text-muted-foreground">
          Você não tem permissão para ver esta página.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Diretório da rede com status financeiro consolidado — Pipedrive + ERP (Omie), incluindo
            Matriz.
          </p>
        </div>
      </div>

      <Tabs defaultValue="planning" className="space-y-6">
        <TabsList>
          <TabsTrigger value="planning">Base nova</TabsTrigger>
          <TabsTrigger value="pre-planning">Base antiga</TabsTrigger>
        </TabsList>

        <TabsContent value="planning" className="space-y-6">
          {error ? (
            <Card className="p-6 text-sm text-destructive">
              Erro ao carregar o diretório de clientes: {(error as Error).message}
            </Card>
          ) : (
            <>
              {/* Resumo: Ativos / Churn / Base antiga / Grupos — todos clicáveis */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <button
                  type="button"
                  disabled={!!auxErro.tratativas}
                  title={auxErro.tratativas}
                  onClick={() => {
                    setChurnFilter(churnFilter === false ? null : false);
                    setStatusFilter(null);
                  }}
                  className={cn(
                    cardBase,
                    "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-100",
                    churnFilter === false && "ring-2 ring-offset-2 ring-primary",
                    auxErro.tratativas && "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                    Clientes Ativos
                  </div>
                  {/* Sem central_tratativas não dá pra separar ativo de churn: o número
                      seria a base nova inteira, com os churnados dentro. */}
                  <div className="mt-1 text-3xl font-bold">
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : auxErro.tratativas ? (
                      "—"
                    ) : (
                      resumo.ativo.toLocaleString("pt-BR")
                    )}
                  </div>
                  <div className="mt-1 text-[11px] opacity-75">
                    {auxErro.tratativas
                      ? "Indisponível — falha ao ler tratativas"
                      : "Base nova, sem card de churn em tratativas"}
                  </div>
                </button>
                <button
                  type="button"
                  disabled={!!auxErro.tratativas}
                  title={auxErro.tratativas}
                  onClick={() => {
                    setChurnFilter(churnFilter === true ? null : true);
                    setStatusFilter(null);
                  }}
                  className={cn(
                    cardBase,
                    "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-900 dark:text-red-100",
                    churnFilter === true && "ring-2 ring-offset-2 ring-primary",
                    auxErro.tratativas && "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                    Churn
                  </div>
                  <div className="mt-1 text-3xl font-bold">
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : auxErro.tratativas ? (
                      "—"
                    ) : (
                      resumo.churn.toLocaleString("pt-BR")
                    )}
                  </div>
                  <div className="mt-1 text-[11px] opacity-75">
                    Card de churn (fase Perdido) em Tratativas
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setBaseFilter(baseFilter === "antiga" ? ALL : "antiga")}
                  className={cn(
                    cardBase,
                    "bg-slate-100 border-slate-200 text-slate-800 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200",
                    baseFilter === "antiga" && "ring-2 ring-offset-2 ring-primary",
                  )}
                >
                  <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                    Base antiga (só ERP)
                  </div>
                  <div className="mt-1 text-3xl font-bold">
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      resumo.antiga.toLocaleString("pt-BR")
                    )}
                  </div>
                  <div className="mt-1 text-[11px] opacity-75">
                    Só no ERP/reconciliação, sem deal no Pipedrive
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSoGrupos(!soGrupos)}
                  className={cn(
                    cardBase,
                    "bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-950 dark:border-indigo-900 dark:text-indigo-100",
                    soGrupos && "ring-2 ring-offset-2 ring-primary",
                  )}
                >
                  <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide opacity-80">
                    <Layers className="h-3.5 w-3.5" />
                    Grupos
                  </div>
                  <div className="mt-1 text-3xl font-bold">
                    {loading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      resumo.grupos.toLocaleString("pt-BR")
                    )}
                  </div>
                  <div className="mt-1 text-[11px] opacity-75">
                    Grupos econômicos no recorte atual
                  </div>
                </button>
              </div>

              {/* Filters */}
              <Card className="sticky top-0 z-20 flex flex-wrap items-center gap-2 p-3 shadow-sm">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por razão social, nome fantasia ou CNPJ/CPF..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {semUnidadeVinculada ? (
                  <Badge variant="destructive" className="h-9 px-3 text-sm">
                    Sem unidade vinculada
                  </Badge>
                ) : perms.scopedToOwnUnit && perms.unidade ? (
                  <Badge variant="secondary" className="h-9 px-3 text-sm">
                    Unidade: {perms.unidade}
                  </Badge>
                ) : (
                  <Select value={unidade} onValueChange={setUnidade}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Unidade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as unidades</SelectItem>
                      {unidadeOptions.regionais.length > 0 && (
                        <>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel className="text-xs text-muted-foreground">
                              Regionais
                            </SelectLabel>
                            {unidadeOptions.regionais.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </>
                      )}
                      {unidadeOptions.internas.length > 0 && (
                        <>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel className="text-xs text-muted-foreground">
                              Internas
                            </SelectLabel>
                            {unidadeOptions.internas.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </>
                      )}
                      {unidadeOptions.outras.length > 0 && (
                        <>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel className="text-xs text-muted-foreground">
                              Outras
                            </SelectLabel>
                            {unidadeOptions.outras.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </>
                      )}
                      <SelectSeparator />
                      <SelectItem value={SEM_UNIDADE}>Sem unidade</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Select
                  value={baseFilter}
                  onValueChange={(v) => setBaseFilter(v as Base | typeof ALL)}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Base" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas as bases</SelectItem>
                    <SelectItem value="nova">{BASE_LABEL.nova}</SelectItem>
                    <SelectItem value="antiga">{BASE_LABEL.antiga}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={docFilter}
                  onValueChange={(v) => setDocFilter(v as "CNPJ" | "CPF" | typeof ALL)}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Documento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos os documentos</SelectItem>
                    <SelectItem value="CNPJ">CNPJ</SelectItem>
                    <SelectItem value="CPF">CPF</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={erpFilter} onValueChange={setErpFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="ERP" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos os ERPs</SelectItem>
                    {erps.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={segmentoFilter} onValueChange={setSegmentoFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Segmento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos os segmentos</SelectItem>
                    {segmentos.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={
                    contratoAssinadoFilter === null ? ALL : contratoAssinadoFilter ? "com" : "sem"
                  }
                  onValueChange={(v) => setContratoAssinadoFilter(v === ALL ? null : v === "com")}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Contrato Assinado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Contrato assinado: todos</SelectItem>
                    <SelectItem value="com">Com data de assinatura</SelectItem>
                    <SelectItem value="sem">Sem data de assinatura</SelectItem>
                  </SelectContent>
                </Select>
                {statusFilter && (
                  <Badge className={cn("gap-1", STATUS_META[statusFilter].badge)}>
                    {STATUS_META[statusFilter].label}
                    <button onClick={() => setStatusFilter(null)} aria-label="Limpar status">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {grupoFilter && (
                  <Badge
                    variant="secondary"
                    className="gap-1"
                    title={`Filtrando pelo grupo ${grupoFilterNome ?? grupoFilter}`}
                  >
                    <Layers className="h-3 w-3 shrink-0" />
                    <span className="max-w-[220px] truncate">{grupoFilterNome ?? grupoFilter}</span>
                    <button onClick={() => setGrupoFilter(null)} aria-label="Limpar grupo">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="mr-1 h-4 w-4" /> Limpar
                  </Button>
                )}
                {/* Com contratos ou tratativas faltando, a planilha sairia com MRR zerado
                    ou sem nenhum churn marcado — e uma planilha errada circula sozinha. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={loading || filtered.length === 0 || !!exportBloqueado}
                  title={exportBloqueado}
                  onClick={exportar}
                >
                  <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Excel
                </Button>
              </Card>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <span className="text-sm font-medium">
                    {loading
                      ? "Carregando..."
                      : `${filtered.length.toLocaleString("pt-BR")} cliente(s)${soGrupos ? ` em ${gruposNoRecorte.toLocaleString("pt-BR")} grupos` : ""} · ${totais.cnpjs.toLocaleString("pt-BR")} CNPJ · ${totais.cpfs.toLocaleString("pt-BR")} CPF`}
                  </span>
                  {/* Navegação repetida aqui porque o rodapé da tabela nasce abaixo da dobra. */}
                  {navegacaoPaginas}
                  {!loading && (
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        auxErro.contratos
                          ? "text-muted-foreground"
                          : "text-indigo-600 dark:text-indigo-300",
                      )}
                      title={auxErro.contratos}
                    >
                      {auxErro.contratos ? "MRR indisponível" : `MRR total: ${fmtBRL(totais.mrr)}`}
                    </span>
                  )}
                </div>
                <div ref={tableScrollRef} className="max-h-[calc(100vh-430px)] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <TableRow>
                        {COLUNAS.map((col) => {
                          const active = sort?.key === col.key;
                          const Icon = !active
                            ? ArrowUpDown
                            : sort?.dir === "asc"
                              ? ArrowUp
                              : ArrowDown;
                          return (
                            <TableHead
                              key={col.key}
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
                                  col.align === "right" && "ml-auto",
                                  active
                                    ? "text-foreground font-semibold"
                                    : "text-muted-foreground",
                                )}
                              >
                                {col.label}
                                <Icon
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    active ? "text-primary" : "text-muted-foreground/60",
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
                      {pageRows.map((r) => {
                        const meta = r.status_financeiro ? STATUS_META[r.status_financeiro] : null;
                        const churned = isChurn(r);
                        const info = contratoInfoByPipedriveId.get(r.pipedrive_id ?? "");
                        const empresaId = r.empresa_id;
                        // Ações (contatos, editar, churn) só na carteira do próprio usuário
                        // quando ele é escopado por unidade. Casa SÓ `r.unidade`, e não
                        // `unidades_omie` como a visibilidade: ver o cliente porque ele é
                        // faturado pela conta Omie da praça é uma coisa, editar o cadastro
                        // ou abrir card de churn com a praça dele é outra.
                        const daMinhaUnidade =
                          !perms.scopedToOwnUnit || unitMatches(perms.unidade, r.unidade);
                        // Contatos/editar/churn só existem pra quem tem cadastro em `empresas`.
                        const clicavel = podeVerContatos && daMinhaUnidade && empresaId != null;
                        // Contagem do grupo dentro do que o usuário enxerga (ver grupoQtdVisivel).
                        const qtdGrupo = !r.grupo_chave
                          ? null
                          : grupoQtdVisivel
                            ? (grupoQtdVisivel.get(r.grupo_chave)?.size ?? 0)
                            : r.grupo_qtd;
                        const nContatos =
                          empresaId != null ? (contatosCount.get(empresaId) ?? 0) : 0;
                        const outrasContas = r.unidades_omie.filter((u) => u !== r.unidade);
                        return (
                          <TableRow
                            key={r.chave}
                            className={cn(
                              churned && "opacity-60",
                              clicavel && "cursor-pointer hover:bg-muted/50",
                            )}
                            onClick={
                              clicavel
                                ? () =>
                                    setContatoCliente({
                                      id: empresaId,
                                      nome: displayName(r) || "—",
                                      unidade: r.unidade,
                                    })
                                : undefined
                            }
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {displayName(r) || "—"}
                                {churned && (
                                  <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] px-1.5 py-0">
                                    churn
                                  </Badge>
                                )}
                                {podeVerContatos && nContatos > 0 && (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1 px-1.5 py-0 text-[10px] font-normal"
                                    title="Contatos vinculados — clique na linha para ver"
                                  >
                                    <Users className="h-3 w-3" />
                                    {nContatos}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {r.unidade ? (
                                <span className="inline-flex items-center gap-1">
                                  <Badge variant="secondary">{r.unidade}</Badge>
                                  {outrasContas.length > 0 && (
                                    <span
                                      className="text-[10px] text-muted-foreground"
                                      title={`Também na conta Omie de: ${outrasContas.join(", ")}`}
                                    >
                                      +{outrasContas.length}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>
                              {r.grupo_chave ? (
                                // <button> de verdade (era um Badge com role="button"): foco e
                                // Enter/Espaço passam a funcionar sem handler de teclado próprio.
                                <button
                                  type="button"
                                  title={`${r.grupo_nome ?? r.grupo_chave} — ${grupoOrigemLabel(r)}`}
                                  className={cn(
                                    badgeVariants({
                                      variant:
                                        grupoFilter === r.grupo_chave ? "default" : "secondary",
                                    }),
                                    "max-w-[180px] cursor-pointer gap-1 font-normal",
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const chave = r.grupo_chave;
                                    setGrupoFilter((prev) => (prev === chave ? null : chave));
                                  }}
                                >
                                  <Layers className="h-3 w-3 shrink-0" />
                                  <span className="min-w-0 truncate">
                                    {r.grupo_nome || r.grupo_chave}
                                  </span>
                                  {qtdGrupo != null && (
                                    <span className="shrink-0 opacity-70">· {qtdGrupo}</span>
                                  )}
                                </button>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {(() => {
                                const v = r.pipedrive_id
                                  ? (mrrByPipedriveId.get(r.pipedrive_id) ?? 0)
                                  : 0;
                                return v > 0 ? (
                                  fmtBRL(v)
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="font-mono text-xs whitespace-nowrap">
                              {fmtDocumento(r.documento) || "—"}
                            </TableCell>
                            <TableCell>{r.uf || "—"}</TableCell>
                            <TableCell>
                              {meta ? <Badge className={meta.badge}>{meta.label}</Badge> : "—"}
                            </TableCell>
                            <TableCell className="tabular-nums whitespace-nowrap">
                              {fmtDate(r.ultimo_recebimento) || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="whitespace-nowrap px-1.5 py-0 text-[10px] font-normal"
                              >
                                {ORIGEM_LABEL[r.origem]}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.pipedrive_id ? (
                                <a
                                  href={`https://app.pipedrive.com/deal/${r.pipedrive_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
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
                            <TableCell>
                              {fmtDate(info?.entrada_contrato_assinado_em) || "—"}
                            </TableCell>
                            <TableCell>{info?.closer || "—"}</TableCell>
                            {podeMarcarChurn && (
                              <TableCell
                                className="text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {daMinhaUnidade && empresaId != null && (
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
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                      {loading && pageRows.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={colSpanTabela}
                            className="py-10 text-center text-sm text-muted-foreground"
                          >
                            Carregando diretório de clientes…
                          </TableCell>
                        </TableRow>
                      )}
                      {!loading && filtered.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={colSpanTabela}
                            className="py-10 text-center text-sm text-muted-foreground"
                          >
                            {semUnidadeVinculada
                              ? "Sua conta não tem unidade vinculada em Sócios — peça ao admin para vincular o seu usuário."
                              : "Nenhum cliente encontrado."}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {!loading && totalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
                    <span className="text-xs text-muted-foreground">
                      Mostrando {((page - 1) * PAGE_SIZE + 1).toLocaleString("pt-BR")}–
                      {Math.min(page * PAGE_SIZE, filtered.length).toLocaleString("pt-BR")} de{" "}
                      {filtered.length.toLocaleString("pt-BR")}
                    </span>
                    {navegacaoPaginas}
                  </div>
                )}
              </Card>

              <p className="text-[11px] text-muted-foreground">
                Base nova = deal no Pipedrive · Base antiga = só no ERP/reconciliação · Grupos:
                cadastro, filiais por contrato, nome fantasia ou raiz de CNPJ.
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="pre-planning">
          <PrePlanningTab />
        </TabsContent>
      </Tabs>

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
  const [cnpj, setCnpj] = useState(fmtDocumento(r.documento));

  const docAtual = r.documento ?? "";
  const cnpjDigits = digits(cnpj);
  const nomeValido = nome.trim().length > 0;
  // Vazio, CNPJ de 14 dígitos, ou o documento atual sem alteração (pode ser um CPF —
  // o servidor só aceita trocar por CNPJ, mas não pode travar a edição do nome).
  const cnpjValido = cnpjDigits.length === 0 || cnpjDigits.length === 14 || cnpjDigits === docAtual;
  const nomeMudou = nome.trim() !== (r.razao_social ?? "").trim();
  const cnpjMudou = cnpjDigits !== docAtual && cnpjDigits.length === 14;

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
          setCnpj(fmtDocumento(r.documento));
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
          className="h-7 w-7 text-red-600 hover:text-red-700 dark:text-red-400"
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
