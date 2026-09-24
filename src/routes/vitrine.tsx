import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Download,
  Moon,
  PanelLeft,
  Phone,
  Plus,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AREAS, type Area } from "@/lib/areas";
import { aplicarTema } from "@/lib/tema-compartilhado";
import {
  AnelArea,
  BarraFiltros,
  Carregando,
  ChipFiltro,
  Degrau,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  Filete,
  GradeCirculos,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  Secao as SecaoPlanningUi,
  StatusBadge,
} from "@/components/planning";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SLUGS_AREA, corDaArea, iconeDaArea, nomeDaArea } from "@/lib/planning/cores-area";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { COR_NEGATIVO, linhaMetaProps } from "@/lib/planning/grafico";

/**
 * Vitrine do design system — só em desenvolvimento.
 *
 * Existe para revisar e fotografar a interface sem login e sem banco: tudo
 * aqui é dado sintético, e nenhum componente que busca dado ao montar entra
 * (ValidationBanner, DataFreshnessBar, AppSidebar, PlanningLogo). Esses
 * aparecem como réplica estática com os mesmos primitivos. O PlanningLogo em
 * especial ficou de fora porque o `useTheme` dele grava a preferência e
 * reaplica o tema salvo, o que desfaria o `?tema=claro`.
 *
 * A primeira versão mostrava os componentes COMO ESTAVAM em eea3d90, inclusive
 * os defeitos (gráfico com hsl() em volta de variável hex, fonte de 9–11px,
 * cor crua de status), e a foto "antes" registrou isso. Desde o T3 os gráficos
 * usam o tema de src/lib/planning/grafico.ts; o resto muda nas tarefas seguintes.
 *
 * `?tema=claro` tira a classe `dark` do <html> sem gravar preferência.
 * As seções têm âncora (#casca, #controles, #dados, #graficos, #estados,
 * #planning, #arquetipos) e o script de captura (scripts/design/capturar.mjs)
 * recorta a foto por elas. #planning mostra os componentes de
 * src/components/planning em todos os estados; #arquetipos monta os cinco
 * tipos de página de docs/design/ARQUETIPOS.md com dado sintético.
 */
export const Route = createFileRoute("/vitrine")({
  ssr: false,
  // Repassa as outras chaves: os exemplos de BarraFiltros gravam filtro na URL
  // (useFiltroNaUrl), e uma validação que devolvesse só `tema` apagaria todos.
  validateSearch: (s: Record<string, unknown>) => ({
    ...s,
    tema: s.tema === "claro" ? ("claro" as const) : undefined,
  }),
  beforeLoad: () => {
    // Em produção a rota existe no bundle, mas não abre.
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Vitrine — Planning Brain" }] }),
  component: Vitrine,
});

function Vitrine() {
  const { tema } = Route.useSearch();

  // Layout effect para a foto não pegar o tema errado no primeiro quadro.
  // `aplicarTema` só mexe no DOM; `gravarModo` (que persistiria) não é chamado.
  useLayoutEffect(() => {
    aplicarTema(tema === "claro" ? "claro" : "escuro");
  }, [tema]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1360px] space-y-12 px-6 py-8">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Planning Brain · vitrine
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Design system v2 ({tema === "claro" ? "tema claro" : "tema escuro"})
          </h1>
          <p className="text-sm text-muted-foreground">
            Dado sintético. Nada aqui consulta o banco.
          </p>
        </header>

        <SecaoCasca tema={tema === "claro" ? "claro" : "escuro"} />
        <SecaoControles />
        <SecaoDados />
        <SecaoGraficos />
        <SecaoEstados />
        <SecaoPlanning />
        <SecaoArquetipos />
      </div>
    </div>
  );
}

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} data-vitrine-secao={id} className="scroll-mt-4 space-y-4 py-2">
      <h2 className="border-b pb-2 text-lg font-semibold">
        <span className="font-mono text-muted-foreground">#{id}</span> {titulo}
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ casca */

// Réplica da lateral: mesmas classes de app-sidebar.tsx, sem permissão nem
// query. A de verdade só mostra a área da rota; aqui cada área ganha uma
// coluna, para todos os itens aparecerem na mesma foto. `--area-atual` fica no
// invólucro, como na casca, e é dela que o filete do item ativo tira a cor.
function LateralReplica({
  area,
  ativo,
  tema,
  className = "w-64",
}: {
  area: Area;
  ativo?: string;
  tema: string;
  className?: string;
}) {
  const logo =
    tema === "escuro" ? "/brand/planning-logo-white.svg" : "/brand/planning-logo-dark.svg";
  return (
    <div
      className={`flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground ${className}`}
      style={{ "--area-atual": corDaArea(area.slug) } as CSSProperties}
    >
      <SidebarHeader className="border-b p-0">
        <div className="flex w-full flex-col gap-2 px-3 py-3 text-left">
          <img src={logo} alt="Planning" className="h-5 w-auto shrink-0 self-start" />
          <span className="flex w-full min-w-0 items-center gap-2">
            <AnelArea area={area.slug} icone={area.icone as LucideIcon} tamanho="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{area.nome}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {area.grupos.map((group) => (
          <SidebarGroup key={`${area.slug}-${group.label}`}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={`${group.label}-${item.title}`}>
                    <SidebarMenuButton asChild isActive={item.url === ativo}>
                      <a href="#casca" className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t p-2">
        <div className="truncate px-2 py-1 text-xs text-muted-foreground">{area.nome}</div>
      </SidebarFooter>
    </div>
  );
}

// O seletor aberto, como o DropdownMenuContent da lateral o desenha: anel por
// área e a atual marcada com filete + "aqui".
function SeletorReplica({ atual }: { atual: string }) {
  return (
    <div className="w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Planning Brain
      </div>
      {AREAS.filter((a) => a.slug !== "admin").map((a) => (
        <div
          key={a.slug}
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
        >
          <AnelArea area={a.slug} icone={a.icone as LucideIcon} tamanho="sm" />
          <span className="flex-1">{a.nome}</span>
          {a.slug === atual && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Filete area={a.slug} className="h-3.5" />
              aqui
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function SecaoCasca({ tema }: { tema: string }) {
  const rede = AREAS[0];
  const ativo = "/rede-ltv";
  const itemAtivo = rede.grupos.flatMap((g) => g.items).find((i) => i.url === ativo);
  return (
    <Secao id="casca" titulo="Casca: lateral, cabeçalho e AppShell">
      {/* O SidebarProvider é flex em linha; o wrapper em coluna segura o layout. */}
      <SidebarProvider className="min-h-0">
        <div className="w-full space-y-4">
          <div
            className="flex h-[640px] w-full overflow-hidden rounded-lg border"
            style={{ "--area-atual": corDaArea(rede.slug) } as CSSProperties}
          >
            <LateralReplica area={rede} ativo={ativo} tema={tema} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
              {/* Cabeçalho do _authenticated/route.tsx: trilha à esquerda. */}
              <header className="flex h-[60px] shrink-0 items-center gap-3 border-b bg-card px-4">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md">
                  <PanelLeft className="h-4 w-4" />
                </span>
                <nav aria-label="Onde você está" className="min-w-0 flex-1">
                  <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                    <li className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <Filete className="h-4" />
                      {rede.nome}
                    </li>
                    <li aria-hidden className="text-muted-foreground">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </li>
                    <li className="min-w-0 truncate font-medium text-foreground">
                      {itemAtivo?.title}
                    </li>
                  </ol>
                </nav>
                <div className="flex items-center gap-2">
                  <div className="hidden flex-col items-end gap-1 text-right md:flex">
                    <span className="text-xs text-muted-foreground">socio@planning.com.br</span>
                    <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium leading-4 text-foreground">
                      Sócio
                      <span className="rounded-full bg-primary/15 px-1.5 text-primary-text">
                        Campinas
                      </span>
                    </span>
                  </div>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full">
                    <Bell className="h-4 w-4" />
                  </span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full">
                    <Moon className="h-4 w-4" />
                  </span>
                  <Button type="button" variant="outline" size="sm">
                    Sair
                  </Button>
                </div>
              </header>
              {/* AppShell: ValidationBanner + PageHeader + DataFreshnessBar */}
              <div className="min-h-0 flex-1 overflow-hidden">
                <div className="sticky top-0 z-30 border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  <div className="flex items-start gap-2 px-4 py-2 text-xs sm:text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      <span className="font-semibold">Dados em validação:</span> as informações
                      desta página ainda estão sendo conferidas e podem não estar 100% corretas.
                    </p>
                  </div>
                </div>
                <div className="border-b px-4 pt-6">
                  <PageHeader
                    area={rede.slug}
                    titulo={itemAtivo?.title ?? "LTV Estimado"}
                    descricao="Valor do tempo de vida estimado por cliente"
                    acoes={
                      <Button size="sm" variant="outline">
                        <Download className="h-4 w-4" />
                        Exportar
                      </Button>
                    }
                    className="border-b-0"
                  />
                </div>
                <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-1">
                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                    {[
                      ["Omie", "dados de 22 de set. de 26"],
                      ["Pipedrive", "sync 23 de set. de 26"],
                      ["Tratativas", "manual 19 de set. de 26"],
                    ].map(([rotulo, data]) => (
                      <span key={rotulo} className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/80">
                          {rotulo}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">{data}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
                  <KpiGrade colunas={3}>
                    <KpiCard
                      rotulo="LTV médio"
                      valor="R$ 48,2 mil"
                      delta={{ valor: 3.1, rotulo: "vs ago" }}
                      procedencia={{ fonte: "Omie · Pipedrive", atualizadoEm: "2026-09-23T07:40:00" }}
                      abrir={{ href: "#casca", rotulo: "Abrir contas" }}
                    />
                    <KpiCard
                      rotulo="Ticket médio"
                      valor="R$ 1.840"
                      unidade="/mês"
                      procedencia={{ fonte: "Omie", atualizadoEm: "2026-09-22" }}
                    />
                    <KpiCard
                      rotulo="Vida média"
                      valor="26,2"
                      unidade="meses"
                      estado="nao-apurado"
                      procedencia={{ fonte: "Central de Tratativas", atualizadoEm: null }}
                    />
                  </KpiGrade>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Seletor de área aberto:</p>
              <SeletorReplica atual={rede.slug} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Todas as áreas de <code className="font-mono">lib/areas.ts</code>, sem corte de
            permissão, com o primeiro item de cada uma ativo:
          </p>
          <div className="grid grid-cols-4 items-start gap-3">
            {AREAS.map((a) => (
              <div key={a.slug} className="overflow-hidden rounded-lg border">
                <LateralReplica
                  area={a}
                  ativo={a.grupos[0].items[0].url}
                  tema={tema}
                  className="w-full border-r-0"
                />
              </div>
            ))}
          </div>
        </div>
      </SidebarProvider>
    </Secao>
  );
}

/* -------------------------------------------------------------- controles */

function SecaoControles() {
  const variantes = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
  const tamanhos = ["sm", "default", "lg"] as const;
  return (
    <Secao id="controles" titulo="Controles">
      <div className="space-y-3">
        {tamanhos.map((t) => (
          <div key={t} className="flex flex-wrap items-center gap-3">
            <span className="w-16 font-mono text-xs text-muted-foreground">{t}</span>
            {variantes.map((v) => (
              <Button key={v} variant={v} size={t}>
                {v}
              </Button>
            ))}
            <Button size="icon" variant="outline">
              <Plus />
            </Button>
            <Button disabled size={t}>
              desabilitado
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Unidade</label>
          <Input placeholder="Buscar unidade…" />
          <Input defaultValue="Planning Campinas" />
          <Input disabled placeholder="Desabilitado" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Safra</label>
          <Select defaultValue="2026-t3">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2026-t3">3º trimestre de 2026</SelectItem>
              <SelectItem value="2026-t2">2º trimestre de 2026</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Observação da tratativa…" />
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked /> Só contas ativas
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox /> Incluir contas em implantação
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch defaultChecked /> Mostrar meta
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch /> Agrupar por sócio
          </label>
          <Progress value={62} />
        </div>
      </div>

      <Tabs defaultValue="resumo">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="unidades">Por unidade</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="resumo" className="text-sm text-muted-foreground">
          Conteúdo da aba ativa.
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Badge>default</Badge>
        <Badge variant="secondary">secondary</Badge>
        <Badge variant="destructive">destructive</Badge>
        <Badge variant="outline">outline</Badge>
        {/* Status do jeito que as telas fazem hoje: cor crua, cada uma a sua. */}
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          Em dia
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          Atrasado
        </span>
        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">
          Churn
        </span>
        <span className="text-xs font-medium text-green-600">+4,2%</span>
        <span className="text-xs font-medium text-rose-500">−1,8%</span>
      </div>
    </Secao>
  );
}

/* ------------------------------------------------------------------ dados */

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function KpisComoHoje() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">LTV</div>
        <div className="mt-1 text-2xl font-bold">{fmtBRL(48230)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">por cliente ativo</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">ARPA</div>
        <div className="mt-1 text-2xl font-bold">{fmtBRL(1940)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">receita média por cliente</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">LT Médio</div>
        <div className="mt-1 text-2xl font-bold">24,9</div>
        <div className="mt-0.5 text-xs text-muted-foreground">meses desde a entrada</div>
      </Card>
    </div>
  );
}

const UNIDADES = [
  { unidade: "Campinas", socio: "R. Almeida", contas: 142, mrr: 281400, status: "Em dia" },
  { unidade: "Ribeirão Preto", socio: "M. Souza", contas: 118, mrr: 226900, status: "Em dia" },
  { unidade: "Goiânia", socio: "T. Castro", contas: 97, mrr: 174300, status: "Atrasado" },
  { unidade: "Uberlândia", socio: "L. Prado", contas: 88, mrr: 162100, status: "Em dia" },
  { unidade: "Londrina", socio: "F. Nunes", contas: 73, mrr: 131800, status: "Atrasado" },
  { unidade: "Cuiabá", socio: "A. Reis", contas: 61, mrr: 118200, status: "Em dia" },
  { unidade: "Sorocaba", socio: "C. Lima", contas: 54, mrr: 96400, status: "Churn" },
  { unidade: "Rio Verde", socio: "P. Moura", contas: 39, mrr: 71500, status: "Em dia" },
];

function StatusCru({ status }: { status: string }) {
  const cls =
    status === "Em dia"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : status === "Atrasado"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>
  );
}

function SecaoDados() {
  return (
    <Secao id="dados" titulo="Dados: KPIs, tabela e cards">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">LTV Estimado — Gestão da Rede</h1>
          <p className="text-sm text-muted-foreground">
            Valor do tempo de vida estimado por cliente
          </p>
        </div>
      </div>
      <KpisComoHoje />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidade</TableHead>
              <TableHead>Sócio</TableHead>
              <TableHead className="text-right">Contas</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {UNIDADES.map((u) => (
              <TableRow key={u.unidade}>
                <TableCell className="font-medium">{u.unidade}</TableCell>
                <TableCell className="text-muted-foreground">{u.socio}</TableCell>
                <TableCell className="text-right">{u.contas}</TableCell>
                <TableCell className="text-right">{fmtBRL(u.mrr)}</TableCell>
                <TableCell>
                  <StatusCru status={u.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Royalties do mês</CardTitle>
            <CardDescription>Setembro de 2026 · 8 unidades</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtBRL(126480)}</div>
            <p className="mt-1 text-[11px] text-emerald-600">+6,1% vs. agosto</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fila de ligação</CardTitle>
            <CardDescription>Contas sem contato há 30+ dias</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">37</div>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-600">12 atrasadas</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30">
          <CardHeader>
            <CardTitle className="text-red-700 dark:text-red-300">Inadimplência</CardTitle>
            <CardDescription>Boletos vencidos há 15+ dias</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700 dark:text-red-300">{fmtBRL(18920)}</div>
            <p className="mt-1 text-[9px] text-muted-foreground">atualizado em 22/09</p>
          </CardContent>
        </Card>
      </div>
    </Secao>
  );
}

/* --------------------------------------------------------------- gráficos */

const SERIE = [
  { label: "out/25", ltv: 39800, cac: 8200, arpa: 1710, lt: 21.4 },
  { label: "nov/25", ltv: 40900, cac: 8900, arpa: 1740, lt: 21.9 },
  { label: "dez/25", ltv: 41500, cac: 9400, arpa: 1760, lt: 22.3 },
  { label: "jan/26", ltv: 42100, cac: 8700, arpa: 1790, lt: 22.8 },
  { label: "fev/26", ltv: 43600, cac: 8100, arpa: 1820, lt: 23.2 },
  { label: "mar/26", ltv: 44200, cac: 7900, arpa: 1840, lt: 23.5 },
  { label: "abr/26", ltv: 45100, cac: 8300, arpa: 1860, lt: 23.9 },
  { label: "mai/26", ltv: 45900, cac: 8600, arpa: 1880, lt: 24.1 },
  { label: "jun/26", ltv: 46400, cac: 9100, arpa: 1900, lt: 24.3 },
  { label: "jul/26", ltv: 47000, cac: 8800, arpa: 1910, lt: 24.5 },
  { label: "ago/26", ltv: 47700, cac: 8400, arpa: 1930, lt: 24.7 },
  { label: "set/26", ltv: 48230, cac: 8100, arpa: 1940, lt: 24.9 },
];

const POR_UNIDADE = UNIDADES.map((u, i) => ({ unidade: u.unidade, ltv: 61000 - i * 4300 }));

// Cópia dos gráficos de rede-ltv.tsx, com o tema único de gráfico: um eixo Y
// por gráfico, como a tela real (DESIGN.md §5 regra 4, 24/09/2026). LTV e CAC
// dividem o eixo porque os dois são R$.
function SecaoGraficos() {
  return (
    <Secao id="graficos" titulo="Gráficos (estilo de rede-ltv.tsx)">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">O LTV estimado cobre o CAC da rede, mês a mês? (R$)</div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={SERIE}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="label" {...eixoProps} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} {...eixoProps} />
                <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                <Legend {...legendaProps} />
                <Line
                  type="monotone"
                  dataKey="ltv"
                  name="LTV estimado"
                  stroke={CORES_SERIE[0]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="cac"
                  name="CAC da rede"
                  stroke={CORES_SERIE[1]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Quanto vale, por mês, um contrato ativo? (R$)</div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SERIE}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="label" {...eixoProps} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} {...eixoProps} />
                <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                <Legend {...legendaProps} />
                <Bar
                  dataKey="arpa"
                  name="ARPA por contrato"
                  fill={CORES_SERIE[0]} fillOpacity={0.7}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">LTV por Unidade</div>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={POR_UNIDADE} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid {...gradeProps} vertical horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                {...eixoProps}
              />
              <YAxis type="category" dataKey="unidade" width={80} {...eixoProps} />
              <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
              <Bar dataKey="ltv" name="LTV" fill={CORES_SERIE[0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </Secao>
  );
}

/* ---------------------------------------------------------------- estados */

// Os estados como as telas fazem hoje: texto solto, cada um num formato, e
// nada que separe vazio de zero de sem permissão.
function SecaoEstados() {
  return (
    <Secao id="estados" titulo="Estados: carregando, vazio, erro (como estão hoje)">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">rede-overview.tsx</p>
          <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">admin.integracoes.tsx</p>
          <div className="rounded-md border p-8 text-muted-foreground">Carregando...</div>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">Skeleton (painel-unidade.tsx)</p>
          <div className="space-y-2">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">Tabela vazia</p>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                    Nenhum registro encontrado
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">
            KPI sem dado (zero x não apurado)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Churn do mês</div>
              <div className="mt-1 text-2xl font-bold">0</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">NPS</div>
              <div className="mt-1 text-2xl font-bold">—</div>
            </Card>
          </div>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted-foreground">Erro</p>
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            Erro ao carregar dados: permission denied for table contratos
          </div>
        </div>
      </div>
    </Secao>
  );
}

/* ======================================================= componentes Planning */

// Momento fixo para as fotos não mudarem de um dia para o outro.
const AGORA = "2026-09-23T07:40:00";

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function Moldura({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border bg-background p-6 ${className}`}>{children}</div>;
}

function SecaoPlanning() {
  const [ultimoClique, setUltimoClique] = useState<string | null>(null);
  return (
    <Secao id="planning" titulo="Componentes Planning (src/components/planning)">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <div className="space-y-3">
            <Rotulo>Degrau · a seta em degrau do manual</Rotulo>
            <div className="flex items-center gap-8">
              {(
                [
                  ["sobe", "text-success"],
                  ["desce", "text-danger"],
                  ["estavel", "text-muted-foreground"],
                ] as const
              ).map(([sentido, cor]) => (
                <div key={sentido} className="flex items-center gap-3">
                  <Degrau sentido={sentido} className={cor} />
                  <Degrau sentido={sentido} className={`size-8 ${cor}`} />
                  <span className="font-mono text-xs text-muted-foreground">{sentido}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Rotulo>Filete e grade de círculos</Rotulo>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative h-28 overflow-hidden rounded-xl border bg-card">
                <GradeCirculos className="text-foreground" />
                <span className="absolute bottom-3 left-3 font-mono text-xs text-muted-foreground">
                  GradeCirculos
                </span>
              </div>
              <div className="relative h-28 overflow-hidden rounded-xl border bg-card">
                <GradeCirculos esmaecer="radial" className="text-area-monetizacao" style={{ opacity: 0.08 }} />
                <span className="absolute bottom-3 left-3 font-mono text-xs text-muted-foreground">
                  esmaecer="radial"
                </span>
              </div>
            </div>
            <div className="flex h-10 items-stretch gap-3">
              {SLUGS_AREA.map((s) => (
                <Filete key={s} area={s} className="h-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <Rotulo>AnelArea · md e sm</Rotulo>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            {SLUGS_AREA.map((s) => {
              const Icone = iconeDaArea(s);
              return Icone ? (
                <div key={s} className="flex items-center gap-2.5">
                  <AnelArea area={s} icone={Icone} />
                  <AnelArea area={s} icone={Icone} tamanho="sm" />
                  <span className="truncate text-[13px]">{nomeDaArea(s)}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Rotulo>StatusBadge · cinco tons, sempre ícone + palavra</Rotulo>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tom="sucesso">Pago</StatusBadge>
            <StatusBadge tom="atencao">Vence em 3 dias</StatusBadge>
            <StatusBadge tom="perigo">Fatura não emitida</StatusBadge>
            <StatusBadge tom="info">Em validação</StatusBadge>
            <StatusBadge tom="neutro">Sem movimento</StatusBadge>
            <StatusBadge tom="info" icone={Phone}>
              Ligação agendada
            </StatusBadge>
          </div>
        </div>
        <div className="space-y-3">
          <Rotulo>Procedencia</Rotulo>
          <Procedencia fonte="Omie" atualizadoEm={AGORA} regua="caixa" />
          <Procedencia fonte="Pipedrive · Pipefy" atualizadoEm="2026-09-22" />
          <Procedencia fonte="Planilha de metas (manual)" atualizadoEm={null} />
        </div>
      </div>

      <div className="space-y-3">
        <Rotulo>KpiCard · os estados (passe o mouse nos que abrem registros)</Rotulo>
        <KpiGrade colunas={4}>
          <KpiCard
            rotulo="Royalties do mês"
            valor="R$ 245,1 mil"
            delta={{ valor: 4.2, rotulo: "vs ago" }}
            meta={{ valor: "R$ 260 mil", progresso: 0.943 }}
            procedencia={{ fonte: "Omie", atualizadoEm: AGORA }}
            abrir={{ href: "#planning", rotulo: "Abrir apurações" }}
            area="receita"
          />
          <KpiCard
            rotulo="Churn do mês"
            valor="0,9"
            unidade="%"
            delta={{ valor: -12, rotulo: "vs ago", sentido: "menor-melhor" }}
            procedencia={{ fonte: "Central de Tratativas", atualizadoEm: "2026-09-22" }}
            abrir={{ onClick: () => setUltimoClique("Churn do mês") }}
            area="clientes"
          />
          <KpiCard
            rotulo="Abordagens (KR1)"
            valor={23}
            unidade="contas"
            meta={{ valor: 40 }}
            delta={{ valor: 0, rotulo: "vs semana passada" }}
            procedencia={{ fonte: "Pipedrive", atualizadoEm: AGORA }}
          />
          <KpiCard
            rotulo="Inadimplência"
            valor="R$ 18,9 mil"
            tom="perigo"
            tomRotulo="acima do limite"
            delta={{ valor: 6.5, rotulo: "vs ago", sentido: "menor-melhor" }}
            procedencia={{ fonte: "Omie", atualizadoEm: AGORA }}
            abrir={{ href: "#planning" }}
            area="receita"
          />
          <KpiCard
            rotulo="Faturado no mês"
            valor="7 de 11"
            unidade="unidades"
            estado="parcial"
            procedencia={{ fonte: "Omie · 4 unidades sem NF", atualizadoEm: AGORA }}
          />
          <KpiCard
            rotulo="CAC do trimestre"
            valor={0}
            estado="nao-apurado"
            procedencia={{ fonte: "Despesas de C&M", atualizadoEm: null }}
          />
          <KpiCard
            rotulo="NPS"
            valor={0}
            estado="indisponivel"
            procedencia={{ fonte: "Track.co fora desde 21/09", atualizadoEm: "2026-09-21" }}
          />
          <KpiCard
            rotulo="Margem da unidade"
            valor={0}
            estado="sem-acesso"
            abrir={{ href: "#planning" }}
          />
        </KpiGrade>
        <p className="text-[13px] text-muted-foreground">
          Os quatro últimos recebem <code className="font-mono">valor={"{0}"}</code> e não mostram
          zero. {ultimoClique ? `Último card aberto por botão: ${ultimoClique}.` : ""}
        </p>
      </div>

      <div className="space-y-3">
        <Rotulo>PageHeader · com pergunta, sem pergunta, sem área</Rotulo>
        <Moldura>
          <PageHeader
            area="rede"
            titulo="Overview"
            pergunta="A rede está crescendo com margem, e onde ela trava?"
            descricao="11 unidades · setembro de 2026 até o dia 22 · valores em R$, régua de caixa"
            procedencia={{ fonte: "Omie + Pipedrive", atualizadoEm: AGORA, regua: "caixa" }}
            acoes={
              <Button variant="outline" size="sm">
                <Download /> Exportar
              </Button>
            }
            filtros={<FiltrosExemplo prefixo="ph" />}
          />
        </Moldura>
        <div className="grid gap-4 lg:grid-cols-2">
          <Moldura>
            <PageHeader
              area="clientes"
              titulo="Base de clientes"
              descricao="3.219 contas · catálogo Pipefy + Omie"
            />
          </Moldura>
          <Moldura>
            <PageHeader
              titulo="Minha conta"
              pergunta="Quais dados meus o Brain guarda?"
              descricao="Sem área: o eyebrow mostra só o nome curto da tela."
            />
          </Moldura>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Rotulo>Secao</Rotulo>
          <Moldura>
            <SecaoPlanningUi
              titulo="Quais unidades ainda não pagaram agosto?"
              descricao="Faturado e não recebido · valores em R$"
              acoes={
                <Button variant="link" size="sm">
                  Ver detalhe <ArrowRight />
                </Button>
              }
            >
              <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                Conteúdo do bloco.
              </div>
            </SecaoPlanningUi>
          </Moldura>
        </div>
        <div className="space-y-3">
          <Rotulo>BarraFiltros · estado na URL (useFiltroNaUrl)</Rotulo>
          <Moldura>
            <FiltrosExemplo prefixo="bf" comBarra />
          </Moldura>
        </div>
      </div>

      <div className="space-y-3">
        <Rotulo>Estados de tela · vazio, erro, sem acesso</Rotulo>
        <div className="grid gap-4 lg:grid-cols-3">
          <EstadoVazio
            titulo="Nenhuma conta apta em Belém"
            total={3219}
            acao={
              <Button variant="outline" size="sm">
                Limpar filtros
              </Button>
            }
          />
          <div className="space-y-4">
            <EstadoErro
              detalhe="O Omie não respondeu (tempo esgotado depois de 30 s)."
              tentarNovamente={() => undefined}
            />
            <EstadoSemAcesso oQueFalta="Receita e Repasses › Apuração de Royalties" />
          </div>
          <Carregando variante="kpis" className="[&>div]:grid-cols-2 [&>div]:lg:grid-cols-2" />
        </div>
      </div>

      <div className="space-y-3">
        <Rotulo>Carregando · tabela, gráfico, página</Rotulo>
        <div className="grid gap-4 lg:grid-cols-2">
          <Carregando variante="tabela" linhas={4} />
          <Carregando variante="grafico" />
        </div>
        <Moldura>
          <Carregando variante="pagina" linhas={3} />
        </Moldura>
      </div>
    </Secao>
  );
}

const UNIDADES_FILTRO = ["Belém", "Campinas", "Goiânia", "Londrina", "Rio Verde"];

// Dois filtros ligados à URL. `prefixo` separa as chaves de cada exemplo.
function FiltrosExemplo({ prefixo, comBarra }: { prefixo: string; comBarra?: boolean }) {
  const [unidade, setUnidade] = useFiltroNaUrl(`${prefixo}_unidade`, "todas");
  const [periodo, setPeriodo] = useFiltroNaUrl(`${prefixo}_periodo`, "2026-09");
  const limpar = useLimparFiltrosNaUrl([`${prefixo}_unidade`, `${prefixo}_periodo`]);
  const ativo = unidade !== "todas" || periodo !== "2026-09";

  const controles = (
    <>
      <Select value={periodo} onValueChange={setPeriodo}>
        <SelectTrigger className="h-8 w-44" aria-label="Período">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="2026-09">setembro de 2026</SelectItem>
          <SelectItem value="2026-08">agosto de 2026</SelectItem>
          <SelectItem value="2026-t3">3º trimestre de 2026</SelectItem>
        </SelectContent>
      </Select>
      <Select value={unidade} onValueChange={setUnidade}>
        <SelectTrigger className="h-8 w-44" aria-label="Unidade">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todas">Todas as unidades</SelectItem>
          {UNIDADES_FILTRO.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unidade !== "todas" && (
        <ChipFiltro rotulo="Unidade" valor={unidade} aoRemover={() => setUnidade(undefined)} />
      )}
    </>
  );
  if (!comBarra) return controles;
  return (
    <div className="space-y-2">
      <BarraFiltros aoLimpar={ativo ? limpar : undefined}>{controles}</BarraFiltros>
      <p className="font-mono text-xs text-muted-foreground">
        ?{prefixo}_unidade={unidade}&{prefixo}_periodo={periodo}
      </p>
    </div>
  );
}

/* ================================================================ arquétipos */

function Arquetipo({
  n,
  nome,
  rota,
  children,
}: {
  n: number;
  nome: string;
  rota: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-sm font-semibold text-muted-foreground">{n}</span>
        <h3 className="text-lg font-semibold">{nome}</h3>
        <span className="text-[13px] text-muted-foreground">
          modelo para <code className="font-mono">{rota}</code>
        </span>
      </div>
      <div className="rounded-2xl border bg-background">
        <div className="space-y-8 p-6 md:p-8">{children}</div>
      </div>
    </div>
  );
}

function SecaoArquetipos() {
  return (
    <Secao id="arquetipos" titulo="Os cinco arquétipos de página (ARQUETIPOS.md)">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Dado sintético, números ilustrativos. Cada página responde uma pergunta no título, diz de
        onde vem o número e manda para a tela que é dona dele.
      </p>
      <div className="space-y-14">
        <VisaoGeral />
        <FilaDeTrabalho />
        <ListaRelatorio />
        <Ficha />
        <Configuracao />
      </div>
    </Secao>
  );
}

/* ------------------------------------------------------------ 1 visão geral */

const MRR_12M = [
  { mes: "out/25", mrr: 1.62, meta: 1.65 },
  { mes: "nov/25", mrr: 1.64, meta: 1.68 },
  { mes: "dez/25", mrr: 1.67, meta: 1.71 },
  { mes: "jan/26", mrr: 1.69, meta: 1.74 },
  { mes: "fev/26", mrr: 1.73, meta: 1.77 },
  { mes: "mar/26", mrr: 1.76, meta: 1.8 },
  { mes: "abr/26", mrr: 1.79, meta: 1.83 },
  { mes: "mai/26", mrr: 1.82, meta: 1.86 },
  { mes: "jun/26", mrr: 1.85, meta: 1.89 },
  { mes: "jul/26", mrr: 1.87, meta: 1.92 },
  { mes: "ago/26", mrr: 1.9, meta: 1.96 },
  { mes: "set/26", mrr: 1.94, meta: 2.0 },
];

const CRESCIMENTO_UNIDADE = [
  { unidade: "Campinas", pct: 6.2 },
  { unidade: "Cuiabá", pct: 5.1 },
  { unidade: "Ribeirão Preto", pct: 4.8 },
  { unidade: "Uberlândia", pct: 3.9 },
  { unidade: "Belém", pct: 3.2 },
  { unidade: "Londrina", pct: 2.4 },
  { unidade: "Rio Verde", pct: 1.7 },
  { unidade: "Maringá", pct: 0.9 },
  { unidade: "Sorocaba", pct: -0.8 },
  { unidade: "Dourados", pct: -1.4 },
  { unidade: "Goiânia", pct: -2.1 },
];

const PENDENCIAS = [
  {
    tom: "perigo" as const,
    selo: "Sem fatura",
    texto: "4 unidades fecharam agosto e a fatura não saiu",
    valor: "R$ 96 mil",
    acao: "Abrir apurações",
  },
  {
    tom: "atencao" as const,
    selo: "Não recebido",
    texto: "2 unidades faturaram agosto e ainda não pagaram",
    valor: "R$ 78 mil",
    acao: "Abrir cobrança",
  },
  {
    tom: "atencao" as const,
    selo: "IDU em queda",
    texto: "Goiânia perdeu 9 pontos de IDU em setembro",
    valor: "IDU 61",
    acao: "Abrir IDU de Goiânia",
  },
];

function VisaoGeral() {
  const fmtMi = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} mi`;
  return (
    <Arquetipo n={1} nome="Visão geral" rota="/rede-overview">
      <PageHeader
        area="rede"
        titulo="Overview"
        pergunta="A rede está crescendo com margem, e onde ela trava?"
        descricao="11 unidades · setembro de 2026 até o dia 22 · valores em R$, régua de caixa"
        procedencia={{ fonte: "Omie + Pipedrive", atualizadoEm: AGORA, regua: "caixa" }}
        filtros={<FiltrosExemplo prefixo="vg" />}
      />

      <KpiGrade colunas={6}>
        <KpiCard
          rotulo="MRR da rede"
          valor="R$ 1,94 mi"
          delta={{ valor: 2.1, rotulo: "vs ago" }}
          meta={{ valor: "R$ 2,0 mi", progresso: 0.97 }}
          procedencia={{ fonte: "Omie", atualizadoEm: AGORA }}
          abrir={{ href: "#arquetipos", rotulo: "Abrir contratos" }}
        />
        <KpiCard
          rotulo="Clientes ativos"
          valor="3.219"
          delta={{ valor: 1.3, rotulo: "vs ago" }}
          procedencia={{ fonte: "Pipefy", atualizadoEm: AGORA }}
          abrir={{ href: "#arquetipos", rotulo: "Abrir base" }}
        />
        <KpiCard
          rotulo="Churn do mês"
          valor="0,9"
          unidade="%"
          tom="sucesso"
          delta={{ valor: -12, rotulo: "vs ago", sentido: "menor-melhor" }}
          meta={{ valor: "≤ 1,0 %", progresso: 1 }}
          procedencia={{ fonte: "Tratativas", atualizadoEm: "2026-09-22" }}
          abrir={{ href: "#arquetipos" }}
        />
        <KpiCard
          rotulo="Royalties do mês"
          valor="R$ 245 mil"
          estado="parcial"
          procedencia={{ fonte: "Omie · 7 de 11 apuradas", atualizadoEm: AGORA }}
          abrir={{ href: "#arquetipos" }}
        />
        <KpiCard
          rotulo="IDU médio"
          valor="78,4"
          delta={{ valor: -0.6, rotulo: "vs ago" }}
          meta={{ valor: 80, progresso: 0.98 }}
          procedencia={{ fonte: "IDU", atualizadoEm: "2026-09-20" }}
          abrir={{ href: "#arquetipos" }}
        />
        <KpiCard
          rotulo="CAC do trimestre"
          valor={0}
          estado="nao-apurado"
          procedencia={{ fonte: "Despesas de C&M fecham em 05/10", atualizadoEm: null }}
        />
      </KpiGrade>

      <SecaoPlanningUi
        titulo="O que pede sua atenção?"
        descricao="Três pendências de maior valor; cada uma abre a tela que resolve."
      >
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {PENDENCIAS.map((p) => (
            <div key={p.texto} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <StatusBadge tom={p.tom} className="w-32 justify-center">
                {p.selo}
              </StatusBadge>
              <span className="min-w-0 flex-1 text-sm text-foreground">{p.texto}</span>
              <span className="num text-sm font-semibold">{p.valor}</span>
              <Button variant="outline" size="sm">
                {p.acao} <ArrowRight />
              </Button>
            </div>
          ))}
        </div>
      </SecaoPlanningUi>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <SecaoPlanningUi
          titulo="O MRR está no ritmo da meta?"
          descricao="Últimos 12 meses · R$ milhões · tracejado = meta"
          acoes={
            <Button variant="link" size="sm">
              Ver detalhe <ArrowRight />
            </Button>
          }
        >
          <div className="h-[300px] rounded-xl border bg-card p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={MRR_12M} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="mes" {...eixoProps} />
                <YAxis
                  domain={[1.5, 2.1]}
                  tickFormatter={(v: number) => v.toLocaleString("pt-BR")}
                  width={36}
                  {...eixoProps}
                />
                <Tooltip {...tooltipProps} formatter={(v: number) => fmtMi(v)} />
                <Line
                  dataKey="meta"
                  name="Meta"
                  dot={false}
                  isAnimationActive={false}
                  {...linhaMetaProps}
                />
                <Line
                  dataKey="mrr"
                  name="MRR"
                  stroke={CORES_SERIE[0]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SecaoPlanningUi>
        <SecaoPlanningUi
          titulo="Quais unidades puxam o crescimento?"
          descricao="Variação do MRR em setembro vs agosto · %"
        >
          <div className="h-[300px] rounded-xl border bg-card p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={CRESCIMENTO_UNIDADE}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid {...gradeProps} vertical horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => `${v}%`} {...eixoProps} />
                <YAxis
                  type="category"
                  dataKey="unidade"
                  width={104}
                  interval={0}
                  {...eixoProps}
                />
                <Tooltip
                  {...tooltipProps}
                  formatter={(v: number) => `${v.toLocaleString("pt-BR")}%`}
                />
                <Bar dataKey="pct" name="Variação" barSize={12} isAnimationActive={false}>
                  {CRESCIMENTO_UNIDADE.map((u) => (
                    <Cell key={u.unidade} fill={u.pct < 0 ? COR_NEGATIVO : CORES_SERIE[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SecaoPlanningUi>
      </div>
    </Arquetipo>
  );
}

/* --------------------------------------------------------------- 2 fila */

type LinhaFila = {
  empresa: string;
  unidade: string;
  score: number;
  gatilho: string;
  ondeParei: string;
  proxima: string | null;
  quando: string | null;
  vencido?: boolean;
  parado?: boolean;
};

const FILA: LinhaFila[] = [
  {
    empresa: "Transportadora Vale do Ipê",
    unidade: "Goiânia",
    score: 84,
    gatilho: "Folha acima de R$ 400 mil/mês",
    ondeParei: "1 toque · sem retorno",
    proxima: "Retornar ligação",
    quando: "22/09",
    vencido: true,
  },
  {
    empresa: "Agropecuária Serra Azul",
    unidade: "Rio Verde",
    score: 87,
    gatilho: "ECD 2024 com crédito de PIS não tomado",
    ondeParei: "2 toques · falou com o contador",
    proxima: "Ligar para o sócio",
    quando: "24/09",
  },
  {
    empresa: "Comercial Três Irmãos",
    unidade: "Londrina",
    score: 81,
    gatilho: "Desenquadrou do Simples em julho",
    ondeParei: "Reunião marcada",
    proxima: "Reunião de diagnóstico",
    quando: "25/09 · 14h",
  },
  {
    empresa: "Laticínios Boa Vista",
    unidade: "Uberlândia",
    score: 78,
    gatilho: "Exporta 30% da receita",
    ondeParei: "Proposta enviada há 16 dias",
    proxima: "Cobrar retorno da proposta",
    quando: "26/09",
    parado: true,
  },
  {
    empresa: "Cerealista Monte Alegre",
    unidade: "Cuiabá",
    score: 74,
    gatilho: "Migrou para o Lucro Real",
    ondeParei: "Nunca abordada",
    proxima: null,
    quando: null,
  },
  {
    empresa: "Auto Peças Horizonte",
    unidade: "Sorocaba",
    score: 71,
    gatilho: "CND vence em 10 dias",
    ondeParei: "3 toques · pediu material",
    proxima: "Enviar estudo por e-mail",
    quando: "29/09",
  },
];

const HIGIENE = [
  { chave: "sem-passo", rotulo: "Sem próximo passo", teste: (l: LinhaFila) => !l.proxima },
  { chave: "parados", rotulo: "Parados há 15 dias", teste: (l: LinhaFila) => !!l.parado },
  { chave: "vencido", rotulo: "Passo vencido", teste: (l: LinhaFila) => !!l.vencido },
];

function FilaDeTrabalho() {
  const [higiene, setHigiene] = useFiltroNaUrl("fila_higiene", "");
  const [curva, setCurva] = useFiltroNaUrl("fila_curva", "todas");
  const limpar = useLimparFiltrosNaUrl(["fila_higiene", "fila_curva"]);
  const [aberta, setAberta] = useState<LinhaFila | null>(null);

  const filtro = HIGIENE.find((h) => h.chave === higiene);
  const linhas = filtro ? FILA.filter(filtro.teste) : FILA;

  return (
    <Arquetipo n={2} nome="Fila de trabalho" rota="/fila-cella">
      <PageHeader
        area="monetizacao"
        titulo="Fila Cella"
        pergunta="Quem eu abordo agora na base instalada?"
        descricao="312 contas na fila · vendedor exclusivo: Matheus · daily às 13h30 · ordem: vencidos primeiro, depois score"
        procedencia={{ fonte: "Pipedrive · Pipefy", atualizadoEm: AGORA }}
      />

      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Abordagens da semana (KR1)"
          valor={23}
          unidade="contas"
          meta={{ valor: 40 }}
          delta={{ valor: 15, rotulo: "vs semana passada" }}
          procedencia={{ fonte: "Pipedrive", atualizadoEm: AGORA }}
        />
        <KpiCard
          rotulo="Viraram reunião (KR2)"
          valor="8,7"
          unidade="%"
          meta={{ valor: "10 %", progresso: 0.87 }}
          procedencia={{ fonte: "Pipedrive", atualizadoEm: AGORA }}
        />
        <KpiCard
          rotulo="Propostas no mês (KR3)"
          valor={1}
          tom="atencao"
          tomRotulo="abaixo do ritmo"
          unidade="propostas"
          meta={{ valor: 5 }}
          procedencia={{ fonte: "Pipedrive", atualizadoEm: AGORA }}
        />
      </KpiGrade>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Higiene da fila:</span>
          {HIGIENE.map((h) => {
            const n = FILA.filter(h.teste).length;
            const ativo = higiene === h.chave;
            return (
              <Button
                key={h.chave}
                variant={ativo ? "secondary" : "outline"}
                size="sm"
                aria-pressed={ativo}
                onClick={() => setHigiene(ativo ? undefined : h.chave)}
              >
                {h.rotulo}
                <span className="num rounded-full bg-muted px-1.5 text-xs">{n}</span>
              </Button>
            );
          })}
        </div>
        <BarraFiltros aoLimpar={higiene || curva !== "todas" ? limpar : undefined}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 w-60 pl-8" placeholder="Buscar empresa ou CNPJ" />
          </div>
          <Select value={curva} onValueChange={setCurva}>
            <SelectTrigger className="h-8 w-36" aria-label="Curva">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as curvas</SelectItem>
              <SelectItem value="A">Curva A</SelectItem>
              <SelectItem value="B">Curva B</SelectItem>
            </SelectContent>
          </Select>
          {filtro && (
            <ChipFiltro rotulo="Higiene" valor={filtro.rotulo} aoRemover={() => setHigiene(undefined)} />
          )}
          <span className="num ml-auto text-[13px] text-muted-foreground">
            {linhas.length} de {FILA.length} na página
          </span>
        </BarraFiltros>

        {linhas.length === 0 ? (
          <EstadoVazio titulo="Nada nesta faixa de higiene" total={312} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-right">#</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Por que agora</TableHead>
                  <TableHead>Onde parei</TableHead>
                  <TableHead>Próxima ação</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l, i) => (
                  <TableRow key={l.empresa} className="cursor-pointer" onClick={() => setAberta(l)}>
                    <TableCell className="num text-right text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="font-medium">{l.empresa}</div>
                      <div className="text-xs text-muted-foreground">{l.unidade}</div>
                    </TableCell>
                    <TableCell className="num text-right font-semibold">{l.score}</TableCell>
                    <TableCell className="max-w-56 text-[13px]">{l.gatilho}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{l.ondeParei}</TableCell>
                    <TableCell>
                      {l.proxima ? (
                        <div className="space-y-0.5">
                          <div className="text-[13px]">{l.proxima}</div>
                          {l.vencido ? (
                            <StatusBadge tom="perigo">venceu {l.quando}</StatusBadge>
                          ) : (
                            <div className="num text-xs text-muted-foreground">{l.quando}</div>
                          )}
                        </div>
                      ) : (
                        <StatusBadge tom="atencao">definir próximo passo</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={i === 0 ? "default" : "outline"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAberta(l);
                        }}
                      >
                        Registrar toque
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Procedencia fonte="Pipedrive (toques) · Pipefy (conta) · score de 20/09" atualizadoEm={AGORA} />
      </div>

      <Sheet open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {aberta && (
            <>
              <SheetHeader>
                <SheetTitle>{aberta.empresa}</SheetTitle>
                <SheetDescription>
                  {aberta.unidade} · score {aberta.score} · {aberta.gatilho}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-4 text-sm">
                <div>
                  <Rotulo>Onde parei</Rotulo>
                  <p className="mt-1">{aberta.ondeParei}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="toque-nota">
                    O que aconteceu neste toque?
                  </label>
                  <Textarea id="toque-nota" placeholder="Falei com…" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Próximo passo e data</label>
                  <Input defaultValue="Ligar de novo · 30/09" />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setAberta(null)}>
                  Cancelar
                </Button>
                <Button onClick={() => setAberta(null)}>Registrar toque</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Arquetipo>
  );
}

/* ---------------------------------------------------------- 3 lista/relatório */

const CONTAS = [
  { empresa: "Agro Belém Insumos", cnpj: "18.402.117/0001-30", regime: "Lucro Real", apta: "crm", mrr: 4850 },
  { empresa: "Pará Frutas Exportação", cnpj: "22.915.340/0001-08", regime: "Lucro Real", apta: "sim", mrr: 3920 },
  { empresa: "Distribuidora Guamá", cnpj: "09.771.204/0001-61", regime: "Lucro Presumido", apta: "sim", mrr: 2780 },
  { empresa: "Construtora Marajó", cnpj: "31.208.559/0001-44", regime: "Lucro Presumido", apta: "sim", mrr: 2410 },
  { empresa: "Supermercado Nazaré", cnpj: "14.663.890/0001-27", regime: "Lucro Real", apta: "crm", mrr: 2150 },
  { empresa: "Madeireira Icoaraci", cnpj: "27.340.118/0001-95", regime: "Simples Nacional", apta: "nao", mrr: 1320 },
  { empresa: "Clínica São Brás", cnpj: "35.091.772/0001-12", regime: "Lucro Presumido", apta: "sim", mrr: 1180 },
  { empresa: "Transportes Ananindeua", cnpj: "40.557.263/0001-70", regime: "Simples Nacional", apta: "nao", mrr: 960 },
] as const;

function SeloApta({ apta }: { apta: "sim" | "nao" | "crm" }) {
  if (apta === "sim") return <StatusBadge tom="sucesso">Apta</StatusBadge>;
  if (apta === "crm") return <StatusBadge tom="info">Já no CRM</StatusBadge>;
  return <StatusBadge tom="neutro">Não apta</StatusBadge>;
}

function ListaRelatorio() {
  const [unidade, setUnidade] = useFiltroNaUrl("lista_unidade", "Belém");
  const [produto, setProduto] = useFiltroNaUrl("lista_produto", "consultoria");
  const limpar = useLimparFiltrosNaUrl(["lista_unidade", "lista_produto"]);
  return (
    <Arquetipo n={3} nome="Lista/Relatório" rota="/clientes">
      <PageHeader
        area="clientes"
        titulo="Base de clientes"
        pergunta="Quais contas de Belém são aptas a Consultoria e ainda não estão no CRM?"
        descricao="3.219 contas na rede · catálogo Pipefy + Omie · unidade de contagem: conta conciliada"
        procedencia={{ fonte: "Pipefy + Omie", atualizadoEm: AGORA }}
        acoes={
          <Button variant="outline" size="sm">
            <Download /> Exportar CSV
          </Button>
        }
      />

      <BarraFiltros aoLimpar={limpar}>
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="h-8 w-40" aria-label="Unidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNIDADES_FILTRO.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={produto} onValueChange={setProduto}>
          <SelectTrigger className="h-8 w-44" aria-label="Produto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="consultoria">Consultoria</SelectItem>
            <SelectItem value="recuperacao">Recuperação tributária</SelectItem>
          </SelectContent>
        </Select>
        <ChipFiltro rotulo="Unidade" valor={unidade} aoRemover={() => setUnidade(undefined)} />
        <ChipFiltro rotulo="Situação" valor="fora do CRM" aoRemover={() => undefined} />
        <span className="num ml-auto text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">282</span> de 3.219 contas
        </span>
      </BarraFiltros>

      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Contas no recorte"
          valor="282"
          unidade="contas"
          procedencia={{ fonte: "Pipefy", atualizadoEm: AGORA }}
        />
        <KpiCard
          rotulo="Aptas a Consultoria"
          valor="41"
          unidade="contas"
          procedencia={{ fonte: "régua de aptidão de 15/09", atualizadoEm: "2026-09-15" }}
          abrir={{ href: "#arquetipos", rotulo: "Filtrar aptas" }}
        />
        <KpiCard
          rotulo="Aptas já no CRM"
          valor="12"
          unidade="contas"
          procedencia={{ fonte: "Pipedrive", atualizadoEm: AGORA }}
          abrir={{ href: "#arquetipos", rotulo: "Filtrar no CRM" }}
        />
      </KpiGrade>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Regime</TableHead>
              <TableHead>Consultoria</TableHead>
              <TableHead className="text-right">Honorário mensal (R$)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CONTAS.map((c) => (
              <TableRow key={c.cnpj} className="cursor-pointer">
                <TableCell className="font-medium">{c.empresa}</TableCell>
                <TableCell className="num text-[13px] text-muted-foreground">{c.cnpj}</TableCell>
                <TableCell className="text-[13px]">{c.regime}</TableCell>
                <TableCell>
                  <SeloApta apta={c.apta} />
                </TableCell>
                <TableCell className="num text-right">
                  {c.mrr.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-[13px] text-muted-foreground">
          <span className="num">Mostrando 1–8 de 282</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Página anterior" disabled>
              <ChevronLeft />
            </Button>
            <span className="num px-2">1 de 36</span>
            <Button variant="ghost" size="icon" aria-label="Próxima página">
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </Arquetipo>
  );
}

/* ---------------------------------------------------------------- 4 ficha */

const ITENS_APURACAO = [
  { cliente: "Agro Belém Insumos", omie: 4850, crm: 4850, situacao: "ok" },
  { cliente: "Pará Frutas Exportação", omie: 3920, crm: 3920, situacao: "ok" },
  { cliente: "Distribuidora Guamá", omie: 2780, crm: null, situacao: "so-omie" },
  { cliente: "Construtora Marajó", omie: null, crm: 2410, situacao: "so-crm" },
  { cliente: "Supermercado Nazaré", omie: 2150, crm: 1890, situacao: "diverge" },
  { cliente: "Clínica São Brás", omie: 1180, crm: null, situacao: "so-omie" },
] as const;

const fmtCentavos = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

function SeloSituacao({ situacao }: { situacao: (typeof ITENS_APURACAO)[number]["situacao"] }) {
  switch (situacao) {
    case "ok":
      return <StatusBadge tom="sucesso">Conferido</StatusBadge>;
    case "so-omie":
      return <StatusBadge tom="atencao">Só no Omie</StatusBadge>;
    case "so-crm":
      return <StatusBadge tom="atencao">Só no Pipedrive</StatusBadge>;
    default:
      return <StatusBadge tom="perigo">Valor diverge</StatusBadge>;
  }
}

function Ficha() {
  const [ver, setVer] = useFiltroNaUrl("ficha_itens", "pendentes");
  const itens = ver === "todos" ? ITENS_APURACAO : ITENS_APURACAO.filter((i) => i.situacao !== "ok");
  return (
    <Arquetipo n={4} nome="Ficha" rota="/royalties/$unidadeId/$mes">
      <div className="flex items-center justify-between gap-4">
        <nav aria-label="Trilha" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <a href="#arquetipos" className="hover:text-foreground hover:underline">
            Receita e Repasses
          </a>
          <ChevronRight className="size-3.5" aria-hidden />
          <a href="#arquetipos" className="hover:text-foreground hover:underline">
            Apuração de Royalties
          </a>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="text-foreground">Belém · ago/2026</span>
        </nav>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm">
            <ChevronLeft /> jul/2026
          </Button>
          <Button variant="ghost" size="sm" disabled>
            set/2026 <ChevronRight />
          </Button>
        </div>
      </div>

      <PageHeader
        area="receita"
        titulo="Belém · ago/2026"
        pergunta="A apuração de Belém em agosto está pronta para fechar e faturar?"
        descricao="64 contratos ativos em agosto · royalties de 10% sobre o honorário · régua de competência"
        procedencia={{ fonte: "royalties_itens · Omie · Pipedrive", atualizadoEm: AGORA, regua: "competência" }}
        acoes={
          <>
            <StatusBadge tom="info">Em revisão</StatusBadge>
            <Button variant="outline" size="sm">
              <Download /> PDF
            </Button>
            <Button size="sm">Fechar apuração</Button>
          </>
        }
      />

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Base de cálculo"
          valor="R$ 412,3 mil"
          delta={{ valor: 3.4, rotulo: "vs jul" }}
          procedencia={{ fonte: "Omie", atualizadoEm: AGORA }}
        />
        <KpiCard
          rotulo="Royalties"
          valor="R$ 41,2 mil"
          delta={{ valor: 3.4, rotulo: "vs jul" }}
          procedencia={{ fonte: "10% da base", atualizadoEm: AGORA }}
        />
        <KpiCard
          rotulo="Itens conferidos"
          valor={58}
          unidade="de 64"
          meta={{ valor: 64, rotulo: "total" }}
          procedencia={{ fonte: "royalties_itens", atualizadoEm: AGORA }}
          abrir={{ onClick: () => setVer("pendentes"), rotulo: "Ver pendentes" }}
        />
        <KpiCard
          rotulo="Diferença Omie × Pipedrive"
          valor="R$ 3,1 mil"
          delta={{ valor: -41, rotulo: "vs jul", sentido: "menor-melhor" }}
          procedencia={{ fonte: "Omie · Pipedrive", atualizadoEm: AGORA }}
        />
      </KpiGrade>

      <SecaoPlanningUi
        titulo="Quais itens ainda não foram conferidos?"
        descricao="Honorário do mês por contrato · R$"
        acoes={
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Itens">
            {(
              [
                ["pendentes", "Pendentes (6)"],
                ["todos", "Todos (64)"],
              ] as const
            ).map(([v, r]) => (
              <Button
                key={v}
                size="sm"
                variant={ver === v ? "secondary" : "ghost"}
                aria-pressed={ver === v}
                className="h-7"
                onClick={() => setVer(v)}
              >
                {r}
              </Button>
            ))}
          </div>
        }
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">No Omie</TableHead>
                <TableHead className="text-right">No Pipedrive</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((i) => (
                <TableRow key={i.cliente}>
                  <TableCell className="font-medium">{i.cliente}</TableCell>
                  <TableCell className="num text-right">{fmtCentavos(i.omie)}</TableCell>
                  <TableCell className="num text-right">{fmtCentavos(i.crm)}</TableCell>
                  <TableCell>
                    <SeloSituacao situacao={i.situacao} />
                  </TableCell>
                  <TableCell>
                    {i.situacao !== "ok" && (
                      <Button variant="ghost" size="sm">
                        Conferir
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SecaoPlanningUi>
    </Arquetipo>
  );
}

/* --------------------------------------------------------- 5 configuração */

const COLUNAS_ACESSO = ["Rede", "Clientes", "Receita", "People", "Monetização", "Broker"] as const;

// "t" = área inteira, número = páginas escolhidas, "-" = sem acesso.
const PAPEIS: { papel: string; pessoas: number; acesso: (string | number)[] }[] = [
  { papel: "Sócio", pessoas: 11, acesso: ["t", "t", "t", "t", "t", "t"] },
  { papel: "Controladoria", pessoas: 3, acesso: ["t", "t", "t", "-", "-", "-"] },
  { papel: "CS", pessoas: 6, acesso: ["t", "t", 2, "-", "-", "-"] },
  { papel: "Monetização", pessoas: 4, acesso: ["-", "t", "-", "-", "t", "-"] },
  { papel: "Broker", pessoas: 5, acesso: ["-", "-", "-", "-", "-", "t"] },
  { papel: "Colaborador", pessoas: 58, acesso: ["-", "-", "-", 3, "-", "-"] },
];

function CelulaAcesso({ v }: { v: string | number }) {
  if (v === "t")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] text-success">
        <Check className="size-4" aria-hidden /> área inteira
      </span>
    );
  if (typeof v === "number")
    return <span className="num whitespace-nowrap text-[13px] text-foreground">{v} páginas</span>;
  return (
    <span className="text-muted-foreground" aria-label="sem acesso">
      —
    </span>
  );
}

function Configuracao() {
  return (
    <Arquetipo n={5} nome="Configuração" rota="/admin/permissoes">
      <PageHeader
        area="admin"
        titulo="Permissões"
        pergunta="Quem vê o quê, em cada área?"
        descricao="6 papéis · 6 áreas · mudança vale no próximo login de cada pessoa"
        procedencia={{ fonte: "ops.papeis", atualizadoEm: "2026-09-18T16:05:00" }}
        acoes={
          <Button size="sm">
            <Plus /> Novo papel
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-8" placeholder="Buscar papel ou área" />
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Papel</TableHead>
                  {COLUNAS_ACESSO.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {PAPEIS.map((p) => (
                  <TableRow key={p.papel}>
                    <TableCell>
                      <div className="font-medium">{p.papel}</div>
                      <div className="num text-xs text-muted-foreground">{p.pessoas} pessoas</div>
                    </TableCell>
                    {p.acesso.map((v, i) => (
                      <TableCell key={COLUNAS_ACESSO[i]}>
                        <CelulaAcesso v={v} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-2">
          <Rotulo>Confirmação antes de salvar</Rotulo>
          <div className="space-y-4 rounded-2xl border bg-popover p-5 text-popover-foreground shadow-lg">
            <div className="space-y-1">
              <p className="text-base font-semibold">Dar Receita e Repasses ao papel CS?</p>
              <p className="text-sm text-muted-foreground">
                6 pessoas passam a ver a área inteira, incluindo apuração de royalties e contas a
                receber de todas as unidades.
              </p>
            </div>
            <StatusBadge tom="atencao">Alarga acesso de 6 pessoas</StatusBadge>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm">
                Cancelar
              </Button>
              <Button size="sm">Salvar e registrar</Button>
            </div>
          </div>
        </div>
      </div>
    </Arquetipo>
  );
}
