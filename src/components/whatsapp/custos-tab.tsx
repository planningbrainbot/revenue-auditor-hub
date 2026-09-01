import { useMemo, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
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

export function CustosTab() {
  const { data, isLoading, error } = useWhatsappCustos();
  const sync = useSyncWhatsappCustos();
  const [mesFiltro, setMesFiltro] = useState<string>("todos");

  const meses = useMemo(() => {
    const set = new Set((data?.linhas ?? []).map((l) => l.dia.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [data]);

  const linhasFiltradas = useMemo(() => {
    const linhas = data?.linhas ?? [];
    return mesFiltro === "todos" ? linhas : linhas.filter((l) => l.dia.startsWith(mesFiltro));
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
    const acc = new Map<string, WhatsappCustoRow & { custoUnitario: number }>();
    for (const l of linhasFiltradas) {
      const chave = `${l.dia}|${l.phone_number}|${l.categoria}`;
      const cur = acc.get(chave);
      if (cur) {
        cur.custo += l.custo;
        cur.volume += l.volume;
      } else {
        acc.set(chave, { ...l, custoUnitario: 0 });
      }
    }
    return Array.from(acc.values())
      .map((r) => ({ ...r, custoUnitario: r.volume > 0 ? r.custo / r.volume : 0 }))
      .sort((a, b) => (b.dia === a.dia ? b.custo - a.custo : b.dia.localeCompare(a.dia)));
  }, [linhasFiltradas]);

  const variacao =
    data && data.custoMesAnterior > 0
      ? ((data.custoMesAtual - data.custoMesAnterior) / data.custoMesAnterior) * 100
      : null;

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando extrato…</div>;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-destructive">
        <TriangleAlert className="h-4 w-4" />
        {(error as Error).message}
      </div>
    );
  }

  const semDados = (data?.linhas.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Fonte: faturamento da Meta (Cloud API). A cobrança é por{" "}
          <strong>conversa</strong> (janela de 24h), não por mensagem.
          {data?.ultimaAtualizacao && (
            <> Atualizado em {new Date(data.ultimaAtualizacao).toLocaleString("pt-BR")}.</>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={sync.isPending}
          onClick={() =>
            sync.mutate(undefined, {
              onSuccess: (r) => toast.success(`Extrato atualizado — ${brl(r.custoTotal)} em 180 dias.`),
              onError: (e) => toast.error((e as Error).message),
            })
          }
        >
          <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
          Forçar atualização
        </Button>
      </div>

      {semDados ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum custo registrado ainda. Clique em “Forçar atualização” para puxar o extrato da Meta.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Gasto no mês atual</div>
              <div className="text-2xl font-bold">{brl(data!.custoMesAtual)}</div>
              {variacao !== null && (
                <div
                  className={cn(
                    "text-xs mt-0.5",
                    variacao > 0 ? "text-destructive" : "text-emerald-600",
                  )}
                >
                  {variacao > 0 ? "+" : ""}
                  {variacao.toFixed(0)}% vs. mês anterior ({brl(data!.custoMesAnterior)})
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Conversas no mês atual</div>
              <div className="text-2xl font-bold">{data!.conversasMesAtual.toLocaleString("pt-BR")}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Custo médio por conversa</div>
              <div className="text-2xl font-bold">{brl4(data!.custoMedioConversa)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Acumulado (180 dias)</div>
              <div className="text-2xl font-bold">{brl(data!.totalCusto)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {data!.totalConversas.toLocaleString("pt-BR")} conversas
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Extrato por mês</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Conversas</TableHead>
                  <TableHead className="text-right">Custo médio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porMes.map(([mes, v]) => (
                  <TableRow key={mes}>
                    <TableCell className="font-medium">{mesLabel(mes)}</TableCell>
                    <TableCell className="text-right">{v.conversas.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {brl4(v.conversas > 0 ? v.custo / v.conversas : 0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{brl(v.custo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Detalhar:</span>
            <Select value={mesFiltro} onValueChange={setMesFiltro}>
              <SelectTrigger className="w-[180px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os meses</SelectItem>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {mesLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Por número remetente</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead className="text-right">Conversas</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porNumero.map(([phone, v]) => (
                  <TableRow key={phone}>
                    <TableCell className="font-medium">{numeroLabel(phone)}</TableCell>
                    <TableCell className="text-right">{v.conversas.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(v.custo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Detalhamento diário</div>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Conversas</TableHead>
                    <TableHead className="text-right">Custo unit.</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porDia.map((r) => (
                    <TableRow key={`${r.dia}-${r.phone_number}-${r.categoria}`}>
                      <TableCell>{new Date(`${r.dia}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {numeroLabel(r.phone_number)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {CATEGORIA_LABEL[r.categoria] ?? r.categoria}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.volume.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {brl4(r.custoUnitario)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{brl(r.custo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
