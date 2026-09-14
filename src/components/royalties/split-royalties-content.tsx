// Aba "Split" de Receitas Partners: royalty retido na fonte pelo Asaas.
//
// UMA tabela, uma linha por CLIENTE. Antes eram duas sub-abas, uma com grão de
// título e outra com grão de contrato, porque nenhum dos dois grãos comporta os
// dois lados: por título somem os clientes vendidos e nunca cadastrados no
// Omie; por contrato some quem fatura sem venda registrada. O grão de cliente
// comporta os dois, e de quebra não conta MRR em dobro quando há vários
// boletos. Ver ops.v_split_cliente (migration 50).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, ShieldCheck, Sigma } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

type Linha = {
  unidade: string | null;
  cnpj: string | null;
  cliente: string | null;
  contrato_id: number | null;
  pipedrive_deal_id: string | null;
  ganho_em: string | null;
  dias_desde_ganho: number | null;
  mrr_mensal: number | null;
  metodo_vinculo: string | null;
  titulos: number | null;
  titulos_pagos: number | null;
  valor_titulos: number | null;
  valor_pago: number | null;
  ultimo_pagamento: string | null;
  royalty_creditado: number | null;
  royalty_a_creditar: number | null;
  royalty_perdido: number | null;
  etapa: string;
};

/**
 * Totais vindos de asaas_splits, por unidade. Os cards NAO podem sair da
 * tabela por cliente: ela nasce do titulo do Omie, e split creditado cujo
 * titulo nao esta na nossa base ficava de fora. O extrato do Asaas e a fonte
 * de caixa; a tabela e o detalhamento possivel dela.
 */
type Resumo = {
  unidade: string | null;
  creditado: number | null;
  a_creditar: number | null;
  cancelado: number | null;
  splits_creditados: number | null;
  creditado_sem_titulo: number | null;
  splits_sem_titulo: number | null;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

/**
 * CNPJ vem pontuado de `contas_receber` e cru de `omie_clientes`. Normaliza os
 * dois. CPF de 11 dígitos aparece quando a unidade fatura pessoa física.
 */
function fmtDoc(v: string | null): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d ? v : null;
}

/** Só as duas pontas que exigem ação ficam em vermelho. */
function tomEtapa(e: string): "destructive" | "secondary" | "outline" {
  // 5 = pagou e nada foi retido; 0 = fatura sem venda registrada.
  if (e.startsWith("5.") || e.startsWith("0.")) return "destructive";
  if (e.startsWith("7.")) return "secondary";
  return "outline";
}

export function SplitRoyaltiesContent() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [resumo, setResumo] = useState<Resumo[]>([]);
  const [unidade, setUnidade] = useState<string>("todas");
  const [etapaFiltro, setEtapaFiltro] = useState<string>("todas");

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    (async () => {
      const [l, s] = await Promise.all([
        (supabase as any).from("v_split_cliente").select("*").order("etapa"),
        (supabase as any).from("v_split_resumo").select("*"),
      ]);
      if (!vivo) return;
      if (l.error) setErro(l.error.message);
      setLinhas((l.data ?? []) as Linha[]);
      setResumo((s.data ?? []) as Resumo[]);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  const unidades = useMemo(
    () => [...new Set(linhas.map((r) => r.unidade).filter(Boolean) as string[])].sort(),
    [linhas],
  );
  const etapas = useMemo(
    () => [...new Set(linhas.map((r) => r.etapa))].sort(),
    [linhas],
  );

  const filtradas = useMemo(
    () => linhas.filter(
      (r) => (unidade === "todas" || r.unidade === unidade)
          && (etapaFiltro === "todas" || r.etapa === etapaFiltro),
    ),
    [linhas, unidade, etapaFiltro],
  );

  // Cards seguem a unidade, não o filtro de etapa: filtrar etapa é navegação,
  // não recorte contábil.
  const doUnidade = useMemo(
    () => linhas.filter((r) => unidade === "todas" || r.unidade === unidade),
    [linhas, unidade],
  );
  const resumoFiltrado = useMemo(
    () => resumo.filter((r) => unidade === "todas" || r.unidade === unidade),
    [resumo, unidade],
  );
  const somaResumo = (f: (r: Resumo) => number | null) =>
    resumoFiltrado.reduce((a, r) => a + Number(f(r) ?? 0), 0);

  // Caixa: vem do Asaas, nao da tabela.
  const creditado = somaResumo((r) => r.creditado);
  const aCreditar = somaResumo((r) => r.a_creditar);
  const total = creditado + aCreditar;

  // Perda so existe onde ha titulo pago sem split, entao sai da tabela mesmo.
  const perdido = doUnidade.reduce((a, r) => a + Number(r.royalty_perdido ?? 0), 0);

  const porEtapa = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of doUnidade) m.set(r.etapa, (m.get(r.etapa) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [doUnidade]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (linhas.length === 0) {
    return (
      <div className="p-4">
        <Card className="p-6 text-sm text-muted-foreground">
          {erro
            ? `Não consegui ler a conferência do split: ${erro}`
            : "Nenhuma unidade com split ativo. A unidade entra aqui sozinha assim que unidades.split_ativo_desde for preenchida."}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as unidades</SelectItem>
            {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={etapaFiltro} onValueChange={setEtapaFiltro}>
          <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as etapas</SelectItem>
            {etapas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-center gap-3 p-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-xs text-muted-foreground">Royalty creditado</div>
            <div className="text-xl font-semibold">{fmtBRL(creditado)}</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <Clock className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-xs text-muted-foreground">A creditar</div>
            <div className="text-xl font-semibold">{fmtBRL(aCreditar)}</div>
          </div>
        </Card>
        {/* Tudo que o split ja capturou, dentro e fora do caixa. Cancelado
            continua fora: nao vira dinheiro. */}
        <Card className="flex items-center gap-3 border-primary/40 p-4">
          <Sigma className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <div className="text-xs text-muted-foreground">Total retido</div>
            <div className="text-xl font-semibold">{fmtBRL(total)}</div>
          </div>
        </Card>
        <Card className={`flex items-center gap-3 p-4 ${perdido > 0 ? "border-destructive/40" : ""}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${perdido > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          <div>
            <div className="text-xs text-muted-foreground">Pago sem reter royalty</div>
            <div className={`text-xl font-semibold ${perdido > 0 ? "text-destructive" : ""}`}>{fmtBRL(perdido)}</div>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {porEtapa.map(([e, n]) => (
          <Badge key={e} variant={tomEtapa(e)}>{e}: {n}</Badge>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Venda</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead className="text-right">Cobrado</TableHead>
              <TableHead className="text-right">Creditado</TableHead>
              <TableHead className="text-right">A creditar</TableHead>
              <TableHead>Etapa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((r) => (
              <TableRow key={`${r.contrato_id ?? "x"}-${r.cnpj ?? r.cliente}`}>
                <TableCell className="max-w-[300px]">
                  <div className="truncate font-medium">
                    {r.cliente ?? "—"}
                    {r.metodo_vinculo === "similaridade" && (
                      <span className="ml-2 text-xs text-amber-600">vínculo por semelhança</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                    <span>{fmtDoc(r.cnpj) ?? "sem CNPJ"}</span>
                    <span>deal {r.pipedrive_deal_id ?? "—"}</span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {r.ganho_em
                    ? `${fmtData(r.ganho_em)} · ${r.dias_desde_ganho}d`
                    : "sem venda registrada"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(r.mrr_mensal)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.titulos ? (
                    <>
                      {fmtBRL(r.valor_titulos)}
                      <div className="text-xs text-muted-foreground">
                        {r.titulos} boleto{r.titulos > 1 ? "s" : ""}
                        {r.titulos_pagos ? `, ${r.titulos_pagos} pago${r.titulos_pagos > 1 ? "s" : ""}` : ""}
                      </div>
                    </>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(r.royalty_creditado)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {Number(r.royalty_a_creditar ?? 0) > 0 ? fmtBRL(r.royalty_a_creditar) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={tomEtapa(r.etapa)}>{r.etapa}</Badge>
                  {Number(r.royalty_perdido ?? 0) > 0 && (
                    <span className="ml-2 text-xs text-destructive">
                      perdeu {fmtBRL(r.royalty_perdido)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-1 text-xs text-muted-foreground">
        {/* 1, 2 e 3 são diagnósticos diferentes, não graus do mesmo problema.
            Tratá-los como um só mandava o time procurar no Omie cliente que
            talvez já estivesse lá. */}
        <p>
          <strong>Etapa 1</strong> não é ausência de cadastro, é ausência de CNPJ
          no contrato: sem ele não dá para verificar nada. Quem resolve é quem
          preenche o CNPJ no card do Pipefy. <strong>Etapa 2</strong> é afirmação:
          temos o CNPJ e ele não está no cadastro do Omie da unidade.{" "}
          <strong>Etapa 3</strong> é cadastro feito e cobrança não emitida.
          <strong> Etapa 0</strong> é o contrário de tudo: fatura sem venda
          registrada no Pipedrive.
        </p>
        <p>
          O Asaas aplica o percentual sobre o valor do boleto menos a taxa do
          gateway (Pix R$ 1,00; cartão cerca de 2%), e Pix pago fora de uma
          cobrança não gera split.
        </p>
      </div>
    </div>
  );
}
