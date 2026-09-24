import { useMemo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  Secao,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { useWhatsappCustos, useSyncWhatsappCustos } from "@/hooks/use-whatsapp-custos";
import type { WhatsappCustoRow } from "@/lib/whatsapp-custos.functions";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

// Custo por conversa é da ordem de centavos, então o total do dia pode ser
// R$ 0,32. Formatar com 4 casas só na coluna de custo unitário.
const brl4 = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4 });

const mesLabel = (mes: string) => {
  const [ano, m] = mes.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m) - 1]}/${ano}`;
};

const numeroLabel = (phone: string) => {
  // 5562942635338 -> +55 62 94263-5338
  const m = phone.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : phone;
};

const CATEGORIA_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
  SERVICE: "Atendimento",
};

// "aaaa-mm-dd" → "dd/mm/aaaa" direto da string, sem passar por `Date`.
const diaLabel = (dia: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dia;
};

// Custo médio sem conversa é ausência, não R$ 0,0000 (N4).
const medio = (custo: number, conversas: number) => (conversas > 0 ? brl4(custo / conversas) : "—");

const TODOS = "todos";
const FONTE = "Faturamento da Meta (Cloud API) · cobrança por conversa (janela de 24 h)";

export function CustosTab() {
  const { data, isLoading, error, refetch } = useWhatsappCustos();
  const sync = useSyncWhatsappCustos();
  const [mesFiltro, setMesFiltro] = useFiltroNaUrl("mes", TODOS);

  const meses = useMemo(() => {
    const set = new Set((data?.linhas ?? []).map((l) => l.dia.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [data]);

  const linhasFiltradas = useMemo(() => {
    const linhas = data?.linhas ?? [];
    return mesFiltro === TODOS ? linhas : linhas.filter((l) => l.dia.startsWith(mesFiltro));
  }, [data, mesFiltro]);

  // Extrato por mês: é a visão que responde "quanto gastamos", o dia a dia
  // fica na tabela detalhada abaixo.
  const porMes = useMemo(() => {
    const acc = new Map<string, { custo: number; conversas: number }>();
    for (const l of data?.linhas ?? []) {
      const mes = l.dia.slice(0, 7);
      const cur = acc.get(mes) ?? { custo: 0, conversas: 0 };
      cur.custo += l.custo;
      cur.conversas += l.volume;
      acc.set(mes, cur);
    }
    return Array.from(acc.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const porNumero = useMemo(() => {
    const acc = new Map<string, { custo: number; conversas: number }>();
    for (const l of linhasFiltradas) {
      const cur = acc.get(l.phone_number) ?? { custo: 0, conversas: 0 };
      cur.custo += l.custo;
      cur.conversas += l.volume;
      acc.set(l.phone_number, cur);
    }
    return Array.from(acc.entries()).sort((a, b) => b[1].custo - a[1].custo);
  }, [linhasFiltradas]);

  // Detalhe por dia (agrega categorias/tipos do mesmo dia e número).
  const porDia = useMemo(() => {
    const acc = new Map<string, WhatsappCustoRow>();
    for (const l of linhasFiltradas) {
      const chave = `${l.dia}|${l.phone_number}|${l.categoria}`;
      const cur = acc.get(chave);
      if (cur) {
        cur.custo += l.custo;
        cur.volume += l.volume;
      } else {
        acc.set(chave, { ...l });
      }
    }
    return Array.from(acc.values()).sort((a, b) =>
      b.dia === a.dia ? b.custo - a.custo : b.dia.localeCompare(a.dia),
    );
  }, [linhasFiltradas]);

  const variacao =
    data && data.custoMesAnterior > 0
      ? ((data.custoMesAtual - data.custoMesAnterior) / data.custoMesAnterior) * 100
      : null;

  const botaoSync = (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={sync.isPending}
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: (r) => toast.success(
              `Extrato atualizado: a sincronização buscou os últimos 180 dias (${brl(r.custoTotal)}); o acumulado mostra todo o histórico importado.`,
            ),
          onError: (e) => toast.error((e as Error).message),
        })
      }
    >
      <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} aria-hidden />
      Forçar atualização
    </Button>
  );

  let conteudo: ReactNode;
  if (isLoading) {
    conteudo = (
      <div className="space-y-4">
        <Carregando variante="kpis" />
        <Carregando variante="tabela" />
      </div>
    );
  } else if (error || !data) {
    conteudo = (
      <EstadoErro
        titulo="Não foi possível carregar o extrato"
        detalhe={`Fonte: whatsapp_custos (faturamento da Meta): ${error instanceof Error ? error.message : String(error ?? "sem resposta")}`}
        tentarNovamente={() => void refetch()}
      />
    );
  } else if (data.linhas.length === 0) {
    conteudo = (
      <EstadoVazio
        titulo="Nenhum custo registrado ainda"
        descricao="Clique em “Forçar atualização” para puxar o extrato da Meta."
        acao={botaoSync}
      />
    );
  } else {
    conteudo = (
      <>
        <KpiGrade colunas={4}>
          <KpiCard
            rotulo="Gasto no mês atual"
            valor={brl(data.custoMesAtual)}
            delta={
              variacao !== null
                ? {
                    valor: variacao,
                    rotulo: `vs. mês anterior (${brl(data.custoMesAnterior)})`,
                    sentido: "menor-melhor",
                  }
                : undefined
            }
          />
          <KpiCard rotulo="Conversas no mês atual" valor={data.conversasMesAtual.toLocaleString("pt-BR")} />
          <KpiCard
            rotulo="Custo médio por conversa (todo o histórico importado)"
            valor={data.totalConversas > 0 ? brl4(data.custoMedioConversa) : "—"}
          />
          <KpiCard
            rotulo="Acumulado (histórico importado)"
            valor={brl(data.totalCusto)}
            nota={`${data.totalConversas.toLocaleString("pt-BR")} conversas`}
          />
        </KpiGrade>

        <Secao titulo="Quanto gastamos em cada mês?">
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="num text-right">Conversas</TableHead>
                  <TableHead className="num text-right">Custo médio</TableHead>
                  <TableHead className="num text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porMes.map(([mes, v]) => (
                  <TableRow key={mes}>
                    <TableCell className="font-medium">{mesLabel(mes)}</TableCell>
                    <TableCell className="num text-right">{v.conversas.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{medio(v.custo, v.conversas)}</TableCell>
                    <TableCell className="num text-right font-semibold">{brl(v.custo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Secao>

        <Secao
          titulo="Qual número remetente gastou mais?"
          descricao={mesFiltro === TODOS ? "Todo o histórico importado." : `Só ${mesLabel(mesFiltro)}.`}
          acoes={
            <div className="flex items-center gap-2">
              <span id="rotulo-detalhar" className="text-[13px] text-muted-foreground">
                Detalhar:
              </span>
              <Select value={mesFiltro} onValueChange={setMesFiltro}>
                <SelectTrigger className="h-8 w-[180px]" aria-labelledby="rotulo-detalhar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os meses</SelectItem>
                  {meses.map((m) => (
                    <SelectItem key={m} value={m}>
                      {mesLabel(m)}
                    </SelectItem>
                  ))}
                  {mesFiltro !== TODOS && !meses.includes(mesFiltro) && (
                    <SelectItem value={mesFiltro}>{mesFiltro}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          }
        >
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead className="num text-right">Conversas</TableHead>
                  <TableHead className="num text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porNumero.map(([phone, v]) => (
                  <TableRow key={phone}>
                    <TableCell className="font-medium">{numeroLabel(phone)}</TableCell>
                    <TableCell className="num text-right">{v.conversas.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="num text-right font-semibold">{brl(v.custo)}</TableCell>
                  </TableRow>
                ))}
                {porNumero.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                      Nenhum custo neste mês.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Secao>

        <Secao
          titulo="Como o gasto se distribui por dia?"
          descricao={mesFiltro === TODOS ? "Todo o histórico importado." : `Só ${mesLabel(mesFiltro)}.`}
        >
          <div className="overflow-hidden rounded-xl border bg-card [&>div]:max-h-[480px]">
            <Table>
              <TableHeader grudavel>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="num text-right">Conversas</TableHead>
                  <TableHead className="num text-right">Custo unit.</TableHead>
                  <TableHead className="num text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porDia.map((r) => (
                  <TableRow key={`${r.dia}-${r.phone_number}-${r.categoria}`}>
                    <TableCell className="num">{diaLabel(r.dia)}</TableCell>
                    <TableCell className="text-muted-foreground">{numeroLabel(r.phone_number)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{CATEGORIA_LABEL[r.categoria] ?? r.categoria}</Badge>
                    </TableCell>
                    <TableCell className="num text-right">{r.volume.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{medio(r.custo, r.volume)}</TableCell>
                    <TableCell className="num text-right font-semibold">{brl(r.custo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Secao>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            A cobrança é por <strong className="font-medium text-foreground">conversa</strong> (janela de 24 h), em
            R$, não por mensagem: por isso não bate com a contagem de disparos da Execução.
          </p>
          <Procedencia fonte={FONTE} atualizadoEm={data?.ultimaAtualizacao ?? null} />
        </div>
        {data && data.linhas.length > 0 && botaoSync}
      </div>
      {conteudo}
    </div>
  );
}
