import { useLayoutEffect, type ReactNode } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  ChevronsUpDown,
  Clock,
  Moon,
  PanelLeft,
  Plus,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
 * Esta primeira versão mostra os componentes COMO ESTÃO em eea3d90, inclusive
 * os defeitos (gráfico com `hsl(var(--…))` sobre variável hex, fonte de 9–11px,
 * cor crua de status), para a foto "antes" registrar o ponto de partida.
 *
 * `?tema=claro` tira a classe `dark` do <html> sem gravar preferência.
 * As seções têm âncora (#casca, #controles, #dados, #graficos, #estados) e o
 * script de captura (scripts/design/capturar.mjs) recorta a foto por elas.
 */
export const Route = createFileRoute("/vitrine")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
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
            Componentes como estão hoje ({tema === "claro" ? "tema claro" : "tema escuro"})
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
// coluna, para todos os itens aparecerem na mesma foto.
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
    >
      <SidebarHeader className="border-b p-0">
        <div className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
          <img src={logo} alt="Planning" className="h-6 w-auto shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{area.nome}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
        <div className="px-2 py-1 text-[10px] text-muted-foreground">{area.nome}</div>
      </SidebarFooter>
    </div>
  );
}

function SecaoCasca({ tema }: { tema: string }) {
  const rede = AREAS[0];
  return (
    <Secao id="casca" titulo="Casca: lateral, cabeçalho e AppShell">
      {/* O SidebarProvider é flex em linha; o wrapper em coluna segura o layout. */}
      <SidebarProvider className="min-h-0">
        <div className="w-full space-y-4">
          <div className="flex h-[640px] w-full overflow-hidden rounded-lg border">
            <LateralReplica area={rede} ativo="/rede-ltv" tema={tema} />
            <div className="flex min-w-0 flex-1 flex-col bg-background">
              {/* Cabeçalho do _authenticated/route.tsx */}
              <header className="flex h-[60px] items-center gap-3 border-b bg-card px-4">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md">
                  <PanelLeft className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1" />
                <div className="flex items-center gap-2">
                  <div className="hidden flex-col items-end text-right md:flex">
                    <span className="text-xs text-muted-foreground">socio@planning.com.br</span>
                    <span className="mt-0.5 flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-foreground">
                      Sócio
                      <span className="rounded bg-primary/15 px-1 py-px text-primary">
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
                  <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
                    Sair
                  </span>
                </div>
              </header>
              {/* AppShell: ValidationBanner + título + DataFreshnessBar */}
              <div className="sticky top-0 z-30 border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="flex items-start gap-2 px-4 py-2 text-xs sm:text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    <span className="font-semibold">Dados em validação:</span> as informações desta
                    página ainda estão sendo conferidas e podem não estar 100% corretas.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 border-b bg-card/50 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold text-foreground sm:text-base">
                    LTV Estimado — Gestão da Rede
                  </h1>
                  <p className="hidden truncate text-xs text-muted-foreground sm:block">
                    Valor do tempo de vida estimado por cliente
                  </p>
                </div>
                <Button size="sm" variant="outline">
                  Exportar
                </Button>
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
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">
                        {rotulo}
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-[10px] text-muted-foreground">{data}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-4 p-4 md:p-6">
                <KpisComoHoje />
                <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Todas as áreas de <code className="font-mono">lib/areas.ts</code>, sem corte de
            permissão:
          </p>
          <div className="grid grid-cols-4 items-start gap-3">
            {AREAS.map((a) => (
              <div key={a.slug} className="overflow-hidden rounded-lg border">
                <LateralReplica area={a} tema={tema} className="w-full border-r-0" />
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

// Cópia fiel de rede-ltv.tsx, INCLUSIVE o `hsl(var(--primary))`: desde que os
// tokens viraram hex, isso é cor inválida e a série sai no preto padrão do SVG.
// A foto "antes" precisa mostrar o defeito.
function SecaoGraficos() {
  return (
    <Secao id="graficos" titulo="Gráficos (estilo de rede-ltv.tsx)">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">LTV vs CAC por Mês</div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={SERIE}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(v: number) => fmtBRL(v)} />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="ltv"
                  name="LTV"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cac"
                  name="CAC"
                  stroke="hsl(0 84% 60%)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">ARPA e LT Médio</div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={SERIE}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} />
                <Legend />
                <Bar
                  dataKey="arpa"
                  name="ARPA"
                  fill="hsl(var(--primary) / 0.7)"
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
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis
                type="number"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11 }}
              />
              <YAxis type="category" dataKey="unidade" width={80} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtBRL(v)} />
              <Bar dataKey="ltv" name="LTV" fill="hsl(var(--primary))" isAnimationActive={false} />
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
