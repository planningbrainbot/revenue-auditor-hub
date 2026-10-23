import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { carregarCella } from "@/lib/monetizacao/cella.functions";
import {
  PARTE_PLANNING,
  PERCENTUAL_HONORARIO,
  filtrarCella,
  montarCella,
  resumoCella,
  type CellaBruto,
  type LinhaCella,
  type VisaoCella,
} from "@/lib/monetizacao/cella";
import { cn } from "@/lib/utils";
import { brlCurto } from "./consultoria-funil";
import type { BuscaMonetizacao } from "./busca";

// Aba Cella (contrato docs/design/contratos/monetizacao-cella.md, "contrato ok" do Pedro em 22/10/2026). Onde está cada
// contrato passado à Diehl & Cella e quanto vale cada tese, lido do funil 9 "Projeto Planning" deles a cada 5 minutos
// pela função monetizacao-cella-envio. Tela interna e só de leitura: nada daqui vai para a Cella.

const TITULO = "Cella";
const PERGUNTA = "Onde está cada contrato da Cella, e quanto vale cada tese?";
const INT = new Intl.NumberFormat("pt-BR");
const ddmmaa = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";
const VISOES: { id: VisaoCella; titulo: string }[] = [
  { id: "contratos", titulo: "Contratos assinados" },
  { id: "sem-valor", titulo: "Sem valor de tese" },
  { id: "abertos", titulo: "Abertos com a Cella" },
  { id: "divergentes", titulo: "Lados divergentes" },
];
const SITUACAO_LA: Record<string, { rotulo: string; tom: TomStatus }> = {
  won: { rotulo: "Ganho lá", tom: "sucesso" },
  open: { rotulo: "Aberto lá", tom: "info" },
  lost: { rotulo: "Perdido lá", tom: "perigo" },
};

export function useCella() {
  const { user } = useAuth();
  const ler = useServerFn(carregarCella);
  return useQuery({
    queryKey: ["monetizacao-cella", user?.id],
    queryFn: () => ler(),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}

export function Cella({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const q = useCella();
  if (!q.data) {
    const erro = q.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={TITULO} pergunta={PERGUNTA} />
        {!erro ? (
          <Carregando variante="tabela" />
        ) : /^Seu acesso não inclui/.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: Pipedrive da Diehl & Cella, lido pelo Brain. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  return <PainelCella bruto={q.data} busca={busca} mudarBusca={mudarBusca} />;
}

export function PainelCella({
  bruto,
  busca,
  mudarBusca,
  hoje = hojeSP(),
  agora = Date.now(),
}: {
  bruto: CellaBruto;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  hoje?: string;
  agora?: number;
}) {
  const linhas = useMemo(() => montarCella(bruto, hoje), [bruto, hoje]);
  const r = resumoCella(linhas);
  const visao: VisaoCella = busca.ver ?? "contratos";
  const itens = filtrarCella(linhas, visao);
  const contagem: Record<VisaoCella, number> = {
    contratos: r.assinados,
    "sem-valor": r.semValor,
    abertos: r.abertos,
    divergentes: r.divergentes,
  };
  const ir = (v: VisaoCella) => mudarBusca({ ver: v === "contratos" ? undefined : v });
  const lidoEm = bruto.sync?.rodado_em ?? null;
  const atrasada = !lidoEm || agora - Date.parse(lidoEm) > 30 * 60_000;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  // Nenhuma tese com valor ainda: o honorário é dado ausente, não zero (N4).
  const semValor = r.credito === 0;

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao="Cards da Planning com a Cella ligados ao funil Projeto Planning da Diehl & Cella, desde 17/09/2026. Contrato e tese são negócios do funil deles; o valor de cada tese é o que a Cella cadastrar."
        procedencia={{
          fonte: "Pipedrive da Diehl & Cella, funil Projeto Planning (a cada 5 min)",
          atualizadoEm: lidoEm,
          regua: `honorário = ${pct(PERCENTUAL_HONORARIO)} do crédito, pelo contrato; Planning = ${pct(PARTE_PLANNING)} do honorário`,
        }}
        acoes={
          atrasada ? (
            <StatusBadge tom="atencao">
              {lidoEm
                ? `Pipedrive da Cella sem leitura desde ${new Date(lidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`
                : "Pipedrive da Cella ainda não foi lido"}
            </StatusBadge>
          ) : undefined
        }
      />

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Contratos assinados"
          valor={INT.format(r.assinados)}
          nota="ganhos lá, com a data do contrato"
          abrir={{ onClick: () => ir("contratos"), rotulo: "Ver os contratos" }}
        />
        <KpiCard
          rotulo="Contratos sem valor de tese"
          valor={`${INT.format(r.semValor)} de ${INT.format(r.assinados)}`}
          tom={r.semValor > 0 ? "perigo" : r.assinados > 0 ? "sucesso" : undefined}
          nota="nenhuma tese com valor cadastrado pela Cella"
          abrir={{ onClick: () => ir("sem-valor"), rotulo: "Ver quais" }}
        />
        <KpiCard
          rotulo="Honorário estimado"
          valor={brlCurto(r.honorario)}
          estado={semValor ? "nao-apurado" : "ok"}
          nota={
            semValor
              ? "a Cella ainda não cadastrou o valor de nenhuma tese"
              : `${pct(PERCENTUAL_HONORARIO)} de ${brlCurto(r.credito)} de crédito estimado nas teses`
          }
        />
        <KpiCard
          rotulo="Parte da Planning"
          valor={brlCurto(r.planning)}
          estado={semValor ? "nao-apurado" : "ok"}
          nota={`${pct(PARTE_PLANNING)} do honorário estimado`}
        />
      </KpiGrade>

      <section aria-label="Recortes" className="flex flex-wrap items-center gap-2">
        {VISOES.map((v) => (
          <Chip key={v.id} ativo={visao === v.id} onClick={() => ir(v.id)}>
            {v.titulo}{" "}
            <span className="num text-muted-foreground">{INT.format(contagem[v.id])}</span>
          </Chip>
        ))}
      </section>

      <Secao
        titulo={VISOES.find((v) => v.id === visao)!.titulo}
        descricao={`${INT.format(itens.length)} ${itens.length === 1 ? "card" : "cards"} · ${brlCurto(itens.reduce((s, l) => s + l.honorario, 0))} de honorário estimado`}
      >
        {linhas.length === 0 ? (
          <EstadoVazio titulo="Nenhum negócio da Cella ligado ao funil deles" />
        ) : itens.length === 0 ? (
          <EstadoVazio
            titulo="Nada neste recorte"
            descricao={`Nenhum card em "${VISOES.find((v) => v.id === visao)!.titulo}".`}
            total={linhas.length}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs">Assinado em</TableHead>
                  <TableHead className="text-xs">Teses e valor</TableHead>
                  <TableHead className="text-right text-xs">Crédito</TableHead>
                  <TableHead className="text-right text-xs">Honorário</TableHead>
                  <TableHead className="text-xs">Lá</TableHead>
                  <TableHead className="text-xs">Aqui</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((l) => (
                  <LinhaContrato key={l.deal_id} l={l} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>
    </main>
  );
}

function LinhaContrato({ l }: { l: LinhaCella }) {
  const la = l.statusLa ? SITUACAO_LA[l.statusLa] : null;
  return (
    <TableRow>
      <TableCell className="text-xs">
        {l.url ? (
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {l.nome}
          </a>
        ) : (
          <span className="font-medium">{l.nome}</span>
        )}
        <span className="block text-muted-foreground">
          {[l.org, l.unidade, l.dono].filter(Boolean).join(" · ")}
        </span>
      </TableCell>
      <TableCell className="num whitespace-nowrap text-xs">
        {ddmmaa(l.assinadoEm)}
        {l.diasDesdeAssinatura != null && (
          <span className="block text-muted-foreground">
            há {INT.format(l.diasDesdeAssinatura)} dias
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs">
        {l.teses.length === 0 ? (
          <span className="text-muted-foreground">nenhuma tese cadastrada</span>
        ) : (
          <ul className="space-y-0.5">
            {l.teses.map((t, i) => (
              <li
                key={i}
                className={cn(t.status === "lost" && "text-muted-foreground line-through")}
              >
                {t.titulo} ·{" "}
                {t.valor > 0 ? (
                  <span className="num">{brlCurto(t.valor)}</span>
                ) : (
                  <span className="text-warning">valor não cadastrado</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {l.outros.length > 0 && (
          <span className="mt-1 block text-muted-foreground">
            Outros negócios com o cliente: {l.outros.map((o) => o.titulo).join(", ")}
          </span>
        )}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right text-sm">
        {l.credito ? brlCurto(l.credito) : "—"}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right text-sm font-semibold">
        {l.honorario ? brlCurto(l.honorario) : "—"}
      </TableCell>
      <TableCell className="text-xs">
        {la ? (
          <StatusBadge tom={la.tom} icone={false}>
            {la.rotulo}
          </StatusBadge>
        ) : (
          <span className="text-muted-foreground">não está mais no funil</span>
        )}
        {l.etapaLa && l.statusLa === "open" && (
          <span className="block text-muted-foreground">{l.etapaLa}</span>
        )}
      </TableCell>
      <TableCell className="text-xs">
        {l.statusAqui === "won"
          ? "Ganho"
          : l.statusAqui === "lost"
            ? "Perdido"
            : (l.etapaAqui ?? "Aberto")}
        {l.divergente && (
          <span className="mt-1 block">
            <StatusBadge tom="atencao">lados divergentes</StatusBadge>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        ativo
          ? "border-primary-text/50 bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:border-primary-text/40",
      )}
    >
      {children}
    </button>
  );
}
