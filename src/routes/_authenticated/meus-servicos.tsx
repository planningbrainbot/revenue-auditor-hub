import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import {
  contasFixasDaUnidade,
  segundaViaBoleto,
  type ContasFixasDaUnidade,
  type Fatura,
  type SegundaVia,
  type ServicoContratado,
  type SituacaoFatura,
} from "@/lib/contas-fixas-unidade.functions";

// Serviços contratados da matriz e as faturas do boleto de contas fixas
// (07/10/2026). Royalties e CAC ficam fora por decisão do Eliezek: aqui é só o
// que a unidade paga de fixo. A regra de acesso está na função do servidor.

type Busca = { unidade?: number };

export const Route = createFileRoute("/_authenticated/meus-servicos")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Busca => {
    const n = Number(search.unidade);
    return Number.isInteger(n) && n > 0 ? { unidade: n } : {};
  },
  head: () => ({ meta: [{ title: "Serviços e faturas – Planning" }] }),
  component: MeusServicosPage,
});

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function diaLocal(d: string | null): Date | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const fmtData = (d: string | null) => diaLocal(d)?.toLocaleDateString("pt-BR") ?? "—";
const fmtMes = (d: string | null) =>
  diaLocal(d)?.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) ?? "—";
/** Mês seguinte à competência: é quando o boleto dela vence. */
const mesDoBoleto = (competencia: string) => {
  const d = diaLocal(competencia);
  return d ? new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—";
};

const SITUACAO: Record<SituacaoFatura, { tom: TomStatus; texto: string }> = {
  pago: { tom: "sucesso", texto: "Pago" },
  atrasado: { tom: "perigo", texto: "Atrasado" },
  vence_hoje: { tom: "atencao", texto: "Vence hoje" },
  a_vencer: { tom: "info", texto: "A vencer" },
  cancelado: { tom: "neutro", texto: "Cancelado" },
  a_emitir: { tom: "neutro", texto: "A emitir" },
  sem_titulo: { tom: "neutro", texto: "Emitido, situação ainda não lida" },
  em_conferencia: { tom: "atencao", texto: "Em conferência na matriz" },
};

const REGRA: Record<string, string> = {
  quinto_dia_util: "vence no 5º dia útil do mês seguinte à competência",
  dia_15: "vence no dia 15 do mês seguinte à competência",
};

function MeusServicosPage() {
  const { unidade } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const fn = useServerFn(contasFixasDaUnidade);
  const q = useQuery({
    queryKey: ["contas-fixas-unidade", unidade ?? null],
    queryFn: () => fn({ data: { id: unidade ?? null } }),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      {q.isLoading ? (
        <Carregando variante="pagina" />
      ) : q.isError || !q.data ? (
        <EstadoErro
          titulo="Não foi possível abrir os serviços da unidade"
          detalhe={(q.error as Error)?.message}
          tentarNovamente={() => q.refetch()}
        />
      ) : (
        <Conteudo
          d={q.data}
          atualizadoEm={new Date(q.dataUpdatedAt)}
          trocarUnidade={(id) => navigate({ search: { unidade: id } })}
        />
      )}
    </div>
  );
}

function Conteudo({
  d,
  atualizadoEm,
  trocarUnidade,
}: {
  d: ContasFixasDaUnidade;
  atualizadoEm: Date;
  trocarUnidade: (id: number) => void;
}) {
  const emAberto = d.faturas.filter((f) => ["atrasado", "vence_hoje", "a_vencer"].includes(f.situacao));
  const atrasadas = d.faturas.filter((f) => f.situacao === "atrasado");
  const proxima = [...d.faturas]
    .filter((f) => f.situacao !== "pago" && f.situacao !== "cancelado")
    .sort((a, b) => (a.venceEm ?? "9").localeCompare(b.venceEm ?? "9"))[0];
  const mensal = d.servicos.reduce((s, x) => s + (x.valorAtual ?? 0), 0);

  return (
    <>
      <PageHeader
        area="minha_unidade"
        titulo="Serviços e faturas"
        pergunta={`O que ${d.unidade.nome} contrata da matriz, e o que já pagou?`}
        descricao={
          d.unidade.regraVencimento
            ? `Boleto de contas fixas · ${REGRA[d.unidade.regraVencimento] ?? d.unidade.regraVencimento}`
            : "Boleto de contas fixas"
        }
        procedencia={{
          fonte: "Cadastro do CSC e dos serviços fixos · boletos de contas fixas · títulos do Omie da Partners",
          atualizadoEm,
          regua: "situação do título no Omie, sincronizada uma vez por dia",
        }}
        acoes={
          d.opcoes.length > 0 ? (
            <Select value={String(d.unidade.id)} onValueChange={(v) => trocarUnidade(Number(v))}>
              <SelectTrigger className="w-56" aria-label="Unidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {d.opcoes.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {!d.unidade.sigla ? (
        <EstadoVazio
          titulo="Esta unidade não está no faturamento de contas fixas"
          descricao="Não há serviço contratado nem boleto de contas fixas registrado para ela."
        />
      ) : (
        <>
          <KpiGrade colunas={4}>
            <KpiCard
              rotulo="Mensalidade de hoje"
              valor={fmtBRL(mensal)}
              nota={`${d.servicos.filter((s) => s.valorAtual != null).length} serviço(s) em ${fmtMes(d.competenciaAtual)}`}
            />
            <KpiCard
              rotulo="Próximo vencimento"
              valor={proxima?.venceEm ? fmtData(proxima.venceEm) : "—"}
              nota={proxima ? `${fmtBRL(proxima.valor)} · competência ${fmtMes(proxima.competencia)}` : "Nada a vencer"}
            />
            <KpiCard
              rotulo="Em aberto"
              valor={fmtBRL(emAberto.reduce((s, f) => s + f.valor, 0))}
              nota={`${emAberto.length} boleto(s) emitido(s) e não pago(s)`}
            />
            <KpiCard
              rotulo="Atrasado"
              valor={fmtBRL(atrasadas.reduce((s, f) => s + f.valor, 0))}
              tom={atrasadas.length ? "perigo" : undefined}
              nota={atrasadas.length ? `${atrasadas.length} boleto(s) vencido(s)` : "Nenhum boleto vencido"}
            />
          </KpiGrade>

          <Secao
            titulo="Quais serviços a unidade contrata?"
            descricao="Valor por competência. O boleto de cada competência vence no mês seguinte."
          >
            {d.servicos.length === 0 ? (
              <EstadoVazio titulo="Nenhum serviço contratado" descricao="Não há CSC nem serviço fixo no cadastro." />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {d.servicos.map((s) => (
                  <CartaoServico key={s.servico} s={s} competenciaAtual={d.competenciaAtual} />
                ))}
              </div>
            )}
          </Secao>

          <Secao
            titulo="Quais faturas já foram pagas?"
            descricao="Um boleto por competência, do mais recente ao mais antigo. O registro começa em 09/2026, com o boleto de contas fixas."
          >
            {d.faturas.length === 0 ? (
              <EstadoVazio titulo="Nenhuma fatura emitida ainda" />
            ) : (
              <TabelaFaturas faturas={d.faturas} />
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Pagamento feito hoje pode aparecer como atrasado até a baixa no Omie, que costuma levar de 1 a 2 dias úteis.
            </p>
          </Secao>
        </>
      )}
    </>
  );
}

function CartaoServico({ s, competenciaAtual }: { s: ServicoContratado; competenciaAtual: string }) {
  const encerrado = s.fim != null && s.fim < competenciaAtual && s.proximos.length === 0;
  const naoComecou = s.inicio != null && s.inicio > competenciaAtual;
  const pb = s.primeiroBoleto;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{s.nome}</h3>
        {encerrado ? (
          <StatusBadge tom="neutro">Encerrado</StatusBadge>
        ) : naoComecou ? (
          <StatusBadge tom="info">Começa em {fmtMes(s.inicio)}</StatusBadge>
        ) : (
          <StatusBadge tom="sucesso">Ativo</StatusBadge>
        )}
      </div>
      <p className="text-2xl font-semibold tabular-nums">
        {s.valorAtual != null ? fmtBRL(s.valorAtual) : "—"}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/mês</span>
      </p>
      <dl className="space-y-1 text-sm">
        {s.inicio && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Desde</dt>
            <dd className="capitalize">{fmtMes(s.inicio)}</dd>
          </div>
        )}
        {s.fim && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Até</dt>
            <dd className="capitalize">{fmtMes(s.fim)}</dd>
          </div>
        )}
        {pb && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Primeiro boleto</dt>
            <dd className="text-right">
              {pb.venceEm ? fmtData(pb.venceEm) : <span className="capitalize">{mesDoBoleto(pb.competencia)}</span>}
              {" · "}
              {fmtBRL(pb.valor)}
              {!pb.emitido && <span className="block text-xs text-muted-foreground">ainda não emitido</span>}
            </dd>
          </div>
        )}
      </dl>
      {s.proximos.length > 0 && (
        <div className="border-t pt-2 text-sm">
          <p className="mb-1 text-muted-foreground">Próximos valores</p>
          <ul className="space-y-0.5">
            {s.proximos.map((p) => (
              <li key={p.competenciaInicio} className="flex justify-between gap-2">
                <span className="capitalize">
                  {p.competenciaFim === p.competenciaInicio
                    ? fmtMes(p.competenciaInicio)
                    : p.competenciaFim
                      ? `${fmtMes(p.competenciaInicio)} a ${fmtMes(p.competenciaFim)}`
                      : `de ${fmtMes(p.competenciaInicio)} em diante`}
                </span>
                <span className="tabular-nums">{fmtBRL(p.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TabelaFaturas({ faturas }: { faturas: Fatura[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Competência</TableHead>
            <TableHead>Serviços</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Boleto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {faturas.map((f) => {
            const st = SITUACAO[f.situacao];
            return (
              <TableRow key={f.cicloId}>
                <TableCell className="font-medium capitalize">{fmtMes(f.competencia)}</TableCell>
                <TableCell className="text-sm">
                  {f.itens.map((i) => (
                    <div key={i.servico} className="flex justify-between gap-4">
                      <span>{i.nome}</span>
                      <span className="tabular-nums text-muted-foreground">{fmtBRL(i.valor)}</span>
                    </div>
                  ))}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtBRL(f.valor)}</TableCell>
                <TableCell>{fmtData(f.venceEm)}</TableCell>
                <TableCell>
                  <StatusBadge tom={st.tom}>{st.texto}</StatusBadge>
                  {f.pagoEm && <span className="mt-1 block text-xs text-muted-foreground">em {fmtData(f.pagoEm)}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {f.segundaVia ? <BotaoSegundaVia cicloId={f.cicloId} /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function BotaoSegundaVia({ cicloId }: { cicloId: number }) {
  const fn = useServerFn(segundaViaBoleto);
  const [via, setVia] = useState<SegundaVia | null>(null);
  const m = useMutation({
    mutationFn: () => fn({ data: { cicloId } }),
    onSuccess: (r) => {
      setVia(r);
      window.open(r.link, "_blank", "noopener");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
        <FileDown className="h-4 w-4" aria-hidden />
        {m.isPending ? "Buscando..." : "2ª via"}
      </Button>
      {/* O navegador pode barrar a janela aberta depois da espera: o link fica como reserva. */}
      {via && (
        <a href={via.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
          Abrir boleto
        </a>
      )}
      {via?.linhaDigitavel && (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            navigator.clipboard.writeText(via.linhaDigitavel ?? "").then(
              () => toast.success("Código de barras copiado"),
              () => toast.error("Não foi possível copiar"),
            );
          }}
        >
          <Copy className="h-3 w-3" aria-hidden />
          Copiar código de barras
        </button>
      )}
      {via && (via.juros != null || via.multa != null) && (
        <span className="text-xs text-muted-foreground">
          Após o vencimento: multa {via.multa ?? 0}% e juros {via.juros ?? 0}% ao mês
        </span>
      )}
    </div>
  );
}
