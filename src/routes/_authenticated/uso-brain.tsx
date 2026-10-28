import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
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
import { usePermissions } from "@/hooks/use-permissions";
import { db } from "@/lib/uso";
import {
  formatarHoras,
  hojeSP,
  INTERVALO_SESSAO_MIN,
  resumir,
  segundaDaSemana,
  somarDias,
  type LinhaPessoa,
  type Painel,
} from "@/lib/uso-painel";

// Uso do Brain (contrato docs/design/contratos/uso-brain.md; PRD 2026-10-ops-uso-do-brain).
// Quem tem acesso ao Ops, quanto usou e em quais telas. A conta da semana fica em
// src/lib/uso-painel.ts; o recorte de quem pode ver fica em ops.uso_brain_painel.

type Busca = { semana?: string; pessoa?: string; admins?: "ocultar" };

const SEMANA_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export const Route = createFileRoute("/_authenticated/uso-brain")({
  ssr: false,
  head: () => ({ meta: [{ title: "Uso do Brain · Planning Brain" }] }),
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s.semana === "string" && SEMANA_RE.test(s.semana)
      ? { semana: segundaDaSemana(s.semana) }
      : {}),
    ...(typeof s.pessoa === "string" && UUID_RE.test(s.pessoa) ? { pessoa: s.pessoa } : {}),
    ...(s.admins === "ocultar" ? { admins: "ocultar" as const } : {}),
  }),
  component: UsoBrain,
});

const TITULO = "Uso do Brain";
const PERGUNTA = "Quem está usando o Ops, quanto e em quais telas?";
const DESCRICAO =
  "Pessoas com acesso ao Ops · semana de segunda a domingo, horário de Brasília · minuto ativo (aba visível e interação no último minuto). Uso registrado desde 28/10/2026.";
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const NUM = new Intl.NumberFormat("pt-BR");
const PCT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

function dataCurta(iso: string) {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

function quando(iso: string | null) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAPEL: Record<string, string> = {
  admin: "Super admin",
  diretor: "Diretor",
  socio: "Sócio",
  socio_regional: "Sócio regional",
  head: "Head",
  auditor: "Auditor",
};

function papeis(p: string | null) {
  if (!p) return "sem papel";
  return p
    .split(",")
    .map((x) => PAPEL[x] ?? x)
    .join(", ");
}

async function carregar(desde: string, pessoa?: string): Promise<Painel> {
  const { data, error } = await db.rpc("uso_brain_painel", {
    p_desde: desde,
    p_gap_min: INTERVALO_SESSAO_MIN,
    p_user_id: pessoa ?? null,
  });
  if (error) throw new Error(error.message);
  return data as Painel;
}

function Moldura({ children, filtros }: { children: React.ReactNode; filtros?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="admin"
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao={DESCRICAO}
        procedencia={{ fonte: "ops.uso_minutos", regua: "minuto ativo" }}
        filtros={filtros}
      />
      {children}
    </main>
  );
}

function UsoBrain() {
  const perms = usePermissions();
  const busca = Route.useSearch();
  const nav = Route.useNavigate();
  const semanaAtual = segundaDaSemana(hojeSP());
  const semana = busca.semana ?? semanaAtual;
  const comAdmins = busca.admins !== "ocultar";
  const pode = !perms.loading && perms.can("view.admin.uso");

  // Cinco semanas: a escolhida e as quatro fechadas antes dela, para a média.
  const desde = somarDias(semana, -28);
  const q = useQuery({
    queryKey: ["uso-brain", desde],
    queryFn: () => carregar(desde),
    enabled: pode,
    retry: false,
  });

  const semanas = useMemo(
    () => Array.from({ length: 8 }, (_, i) => somarDias(semanaAtual, -7 * i)),
    [semanaAtual],
  );

  const filtros = (
    <BarraFiltros
      aoLimpar={
        busca.semana || busca.admins
          ? () => nav({ search: (s: Busca) => ({ pessoa: s.pessoa }) })
          : undefined
      }
    >
      <Select
        value={semana}
        onValueChange={(v) =>
          nav({ search: (s: Busca) => ({ ...s, semana: v === semanaAtual ? undefined : v }) })
        }
      >
        <SelectTrigger className="h-9 w-[220px]" aria-label="Semana">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {semanas.map((s) => (
            <SelectItem key={s} value={s}>
              {dataCurta(s)} a {dataCurta(somarDias(s, 6))}
              {s === semanaAtual ? " (em andamento)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={comAdmins ? "mostrar" : "ocultar"}
        onValueChange={(v) =>
          nav({ search: (s: Busca) => ({ ...s, admins: v === "ocultar" ? "ocultar" : undefined }) })
        }
      >
        <SelectTrigger className="h-9 w-[200px]" aria-label="Super admins">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mostrar">Com super admins</SelectItem>
          <SelectItem value="ocultar">Sem super admins</SelectItem>
        </SelectContent>
      </Select>
    </BarraFiltros>
  );

  if (perms.loading)
    return (
      <Moldura>
        <Carregando variante="pagina" />
      </Moldura>
    );
  if (!pode)
    return (
      <Moldura>
        <EstadoSemAcesso oQueFalta="view.admin.uso (área Administração)" />
      </Moldura>
    );
  if (q.isLoading)
    return (
      <Moldura filtros={filtros}>
        <Carregando variante="pagina" />
      </Moldura>
    );
  if (q.isError)
    return (
      <Moldura filtros={filtros}>
        <EstadoErro
          titulo="O uso não carregou"
          detalhe={`Fonte: ops.uso_brain_painel. ${(q.error as Error).message}`}
          tentarNovamente={() => q.refetch()}
        />
      </Moldura>
    );

  const painel = q.data!;
  if (busca.pessoa) {
    const membro = painel.membros.find((m) => m.user_id === busca.pessoa);
    return (
      <Moldura filtros={filtros}>
        <DetalhePessoa
          userId={busca.pessoa}
          nome={membro ? (membro.nome ?? membro.email) : "Pessoa"}
          desde={desde}
          voltar={() => nav({ search: (s: Busca) => ({ ...s, pessoa: undefined }) })}
        />
      </Moldura>
    );
  }

  if (painel.historico.length === 0)
    return (
      <Moldura filtros={filtros}>
        <EstadoVazio
          titulo="Ainda não há uso registrado"
          descricao="O uso começou a ser registrado em 28/10/2026. Os números aparecem conforme o time navega no Ops."
        />
      </Moldura>
    );

  const r = resumir(painel, semana, comAdmins);
  const abrir = (l: LinhaPessoa) =>
    nav({ search: (s: Busca) => ({ ...s, pessoa: l.membro.user_id }) });

  return (
    <Moldura filtros={filtros}>
      <KpiGrade colunas={4}>
        <KpiCard rotulo="Ativos na semana" valor={NUM.format(r.ativos)} unidade="pessoas" />
        <KpiCard
          rotulo="% ativos"
          valor={r.comAcesso ? PCT.format(r.ativos / r.comAcesso) : "-"}
          nota={`${NUM.format(r.ativos)} de ${NUM.format(r.comAcesso)} com acesso ao Ops`}
          estado={semana === semanaAtual ? "parcial" : "ok"}
        />
        <KpiCard
          rotulo="Horas na semana"
          valor={formatarHoras(r.minutosSemana)}
          nota={semana === semanaAtual ? "semana em andamento" : undefined}
          estado={semana === semanaAtual ? "parcial" : "ok"}
        />
        <KpiCard
          rotulo="Média 4 semanas"
          valor={formatarHoras(r.mediaMin4Sem)}
          nota="horas por semana, nas 4 semanas fechadas antes desta"
        />
      </KpiGrade>

      <Secao
        titulo="Ranking"
        descricao="Quem usou na semana, do maior para o menor. Clique para ver as sessões."
      >
        {r.ranking.length === 0 ? (
          <EstadoVazio titulo="Ninguém usou o Ops nesta semana" total={r.comAcesso} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="hidden md:table-cell">Papel</TableHead>
                  <TableHead className="text-right">Na semana</TableHead>
                  <TableHead className="text-right">Média 4 sem.</TableHead>
                  <TableHead className="hidden md:table-cell">Último uso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.ranking.map((l, i) => (
                  <TableRow
                    key={l.membro.user_id}
                    className="cursor-pointer"
                    onClick={() => abrir(l)}
                  >
                    <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{l.membro.nome ?? l.membro.email}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {papeis(l.membro.papeis)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarHoras(l.minutosSemana)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatarHoras(l.mediaMin4Sem)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{quando(l.ultimoUso)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      <div className="grid gap-6 lg:grid-cols-2">
        <Secao titulo="Telas mais usadas" descricao="Minutos por tela na semana, as 10 primeiras.">
          {r.telas.length === 0 ? (
            <EstadoVazio titulo="Sem uso nesta semana" />
          ) : (
            <ul className="space-y-2">
              {r.telas.map((t) => (
                <li key={t.rota} className="flex items-center gap-3 text-sm">
                  <span className="w-48 truncate font-mono text-xs" title={t.rota}>
                    {t.rota}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(t.minutos / r.telas[0].minutos) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums">{formatarHoras(t.minutos)}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>

        <Secao
          titulo="Mapa de horário"
          descricao={`Minutos por dia da semana e hora, desde ${dataCurta(desde)}.`}
        >
          <MapaCalor calor={r.calor} />
        </Secao>
      </div>

      <Secao
        titulo="Sem uso na semana"
        descricao="Quem tem acesso ao Ops e não teve nenhum minuto ativo, pelo último login."
      >
        {r.semUso.length === 0 ? (
          <EstadoVazio titulo="Todos com acesso usaram nesta semana" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead className="hidden md:table-cell">Papel</TableHead>
                  <TableHead>Último login</TableHead>
                  <TableHead className="hidden md:table-cell">Último uso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.semUso.map((l) => (
                  <TableRow
                    key={l.membro.user_id}
                    className="cursor-pointer"
                    onClick={() => abrir(l)}
                  >
                    <TableCell className="font-medium">{l.membro.nome ?? l.membro.email}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {papeis(l.membro.papeis)}
                    </TableCell>
                    <TableCell>
                      {l.membro.ultimo_login ? (
                        quando(l.membro.ultimo_login)
                      ) : (
                        <StatusBadge tom="atencao">nunca entrou</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{quando(l.ultimoUso)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>
    </Moldura>
  );
}

function MapaCalor({ calor }: { calor: number[][] }) {
  const max = Math.max(1, ...calor.flat());
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid grid-cols-[2.5rem_repeat(24,minmax(1.1rem,1fr))] gap-0.5 text-xs">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-muted-foreground">
            {h % 3 === 0 ? h : ""}
          </span>
        ))}
        {calor.map((linha, d) => (
          <div key={d} className="contents">
            <span className="text-muted-foreground">{DIAS[d]}</span>
            {linha.map((m, h) => (
              <span
                key={h}
                className="h-4 rounded-sm bg-muted"
                title={`${DIAS[d]} ${h}h: ${formatarHoras(m)}`}
              >
                {m > 0 && (
                  <span
                    className="block h-full rounded-sm bg-primary"
                    style={{ opacity: 0.15 + 0.85 * (m / max) }}
                  />
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetalhePessoa({
  userId,
  nome,
  desde,
  voltar,
}: {
  userId: string;
  nome: string;
  desde: string;
  voltar: () => void;
}) {
  const q = useQuery({
    queryKey: ["uso-brain", desde, userId],
    queryFn: () => carregar(desde, userId),
    retry: false,
  });
  const cabecalho = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={voltar}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao ranking
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/admin/usuarios/$userId" params={{ userId }}>
          Abrir a ficha da pessoa
        </Link>
      </Button>
    </div>
  );

  if (q.isLoading) return <Carregando variante="tabela" />;
  if (q.isError)
    return (
      <EstadoErro
        titulo="O detalhe não carregou"
        detalhe={`Fonte: ops.uso_brain_painel. ${(q.error as Error).message}`}
        tentarNovamente={() => q.refetch()}
      />
    );
  const p = q.data!;
  const dias = [...p.dia].sort((a, b) => b.dia.localeCompare(a.dia));

  return (
    <Secao titulo={nome} descricao={`Desde ${dataCurta(desde)}.`} acoes={cabecalho}>
      {dias.length === 0 ? (
        <EstadoVazio titulo="Sem uso registrado neste período" />
      ) : (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Tempo</TableHead>
                  <TableHead className="text-right">Sessões</TableHead>
                  <TableHead>Primeiro e último minuto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dias.map((d) => (
                  <TableRow key={d.dia}>
                    <TableCell>{dataCurta(d.dia)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarHoras(d.minutos)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.sessoes}</TableCell>
                    <TableCell>
                      {hora(d.primeiro)} a {hora(d.ultimo)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sessão</TableHead>
                  <TableHead className="text-right">Duração</TableHead>
                  <TableHead>Telas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.sessoes.map((s) => (
                  <TableRow key={s.inicio}>
                    <TableCell className="whitespace-nowrap">
                      {quando(s.inicio)} a {hora(s.fim)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarHoras(s.minutos)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.rotas.join(" · ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Secao>
  );
}
