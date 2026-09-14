// Acompanhamento do royalty retido por split no Asaas.
//
// Duas perguntas diferentes, uma por aba, porque cada uma enxerga metade do
// buraco:
//   "Títulos x royalty"  — do título para trás: todo boleto emitido reteve?
//                          Pega o cliente que pagou sem split.
//   "Cadeia da venda"    — da venda para frente: todo cliente vendido virou
//                          título? Pega quem nunca foi cadastrado no Omie e por
//                          isso nunca gerou boleto nem split.
//
// Fonte: ops.v_split_conferencia e ops.v_cadeia_venda_royalty (migrations 47 e
// 48). As views só cobrem unidade com `split_ativo_desde` preenchido.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/royalties/split")({
  head: () => ({ meta: [{ title: "Split de Royalties – Planning" }] }),
  component: SplitRoyaltiesPage,
});

// A mesma chave gateia a página, a RLS das tabelas e o WHERE das duas views
// (migration 49). Se divergirem, a tela abre vazia sem dizer por quê.
const PERMISSAO = "view.royalties_split";

type Conferencia = {
  unidade: string | null;
  codigo_omie: number | null;
  cliente: string | null;
  cpf_cnpj: string | null;
  data_vencimento: string | null;
  data_pagamento: string | null;
  status_pagamento: string | null;
  valor_titulo: number | null;
  royalty_esperado: number | null;
  royalty_retido: number | null;
  status_split: string | null;
  data_credito: string | null;
  situacao: string;
  royalty_perdido: number | null;
  diferenca_taxa: number | null;
};

type Cadeia = {
  contrato_id: number;
  titulo: string | null;
  unidade: string | null;
  ganho_em: string | null;
  dias_desde_ganho: number | null;
  mrr_mensal: number | null;
  omie_cnpj: string | null;
  metodo_vinculo: string | null;
  titulos: number | null;
  titulos_pagos: number | null;
  royalty_retido: number | null;
  etapa: string;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—");

const ROTULO_SITUACAO: Record<string, string> = {
  retido: "Royalty retido",
  a_creditar: "A creditar",
  cancelado: "Cobrança cancelada",
  sem_split: "Sem split",
};

/** Só `sem_split` com título pago é perda; o resto é estado normal do fluxo. */
function tomSituacao(s: string): "destructive" | "secondary" | "outline" {
  if (s === "sem_split") return "destructive";
  if (s === "retido") return "secondary";
  return "outline";
}

function tomEtapa(e: string): "destructive" | "secondary" | "outline" {
  if (e.startsWith("4.")) return "destructive";
  if (e.startsWith("5.")) return "secondary";
  return "outline";
}

function SplitRoyaltiesPage() {
  const { can, loading: permLoading } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [conf, setConf] = useState<Conferencia[]>([]);
  const [cadeia, setCadeia] = useState<Cadeia[]>([]);
  const [unidade, setUnidade] = useState<string>("todas");

  const autorizado = permLoading || can(PERMISSAO);

  useEffect(() => {
    if (permLoading || !can(PERMISSAO)) return;
    let vivo = true;
    setLoading(true);
    (async () => {
      const [c, k] = await Promise.all([
        (supabase as any).from("v_split_conferencia").select("*").order("data_vencimento", { ascending: false }),
        (supabase as any).from("v_cadeia_venda_royalty").select("*").order("ganho_em", { ascending: false }),
      ]);
      if (!vivo) return;
      // View ausente (migration não aplicada) precisa dizer isso, e não fingir
      // que a unidade está limpa.
      if (c.error || k.error) setErro(c.error?.message ?? k.error?.message ?? null);
      setConf((c.data ?? []) as Conferencia[]);
      setCadeia((k.data ?? []) as Cadeia[]);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [permLoading, can]);

  const unidades = useMemo(() => {
    const s = new Set<string>();
    for (const r of conf) if (r.unidade) s.add(r.unidade);
    for (const r of cadeia) if (r.unidade) s.add(r.unidade);
    return [...s].sort();
  }, [conf, cadeia]);

  const confFiltrada = useMemo(
    () => (unidade === "todas" ? conf : conf.filter((r) => r.unidade === unidade)),
    [conf, unidade],
  );
  const cadeiaFiltrada = useMemo(
    () => (unidade === "todas" ? cadeia : cadeia.filter((r) => r.unidade === unidade)),
    [cadeia, unidade],
  );

  const perdido = confFiltrada.reduce((a, r) => a + Number(r.royalty_perdido ?? 0), 0);
  const retido = confFiltrada.reduce((a, r) => a + Number(r.royalty_retido ?? 0), 0);

  const porSituacao = useMemo(() => {
    const m = new Map<string, { n: number; valor: number }>();
    for (const r of confFiltrada) {
      const a = m.get(r.situacao) ?? { n: 0, valor: 0 };
      m.set(r.situacao, { n: a.n + 1, valor: a.valor + Number(r.royalty_retido ?? 0) });
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [confFiltrada]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, { n: number; mrr: number }>();
    for (const r of cadeiaFiltrada) {
      const a = m.get(r.etapa) ?? { n: 0, mrr: 0 };
      m.set(r.etapa, { n: a.n + 1, mrr: a.mrr + Number(r.mrr_mensal ?? 0) });
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cadeiaFiltrada]);

  if (!autorizado) {
    return (
      <AppShell title="Split de Royalties">
        <div className="p-6 text-sm text-muted-foreground">
          Você não tem permissão para ver esta página.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Split de Royalties"
      subtitle="Royalty retido na fonte pelo Asaas, do cliente vendido ao crédito na matriz"
      headerExtra={
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as unidades</SelectItem>
            {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-4 p-4 sm:p-6">
        {erro && (
          <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
            Não consegui ler as views do split: {erro}
          </Card>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : unidades.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Nenhuma unidade com split ativo. A unidade entra aqui sozinha assim que
            <code className="mx-1 rounded bg-muted px-1">unidades.split_ativo_desde</code>
            for preenchida.
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="flex items-center gap-3 p-4">
                <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">Royalty retido</div>
                  <div className="text-xl font-semibold">{fmtBRL(retido)}</div>
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

            <Tabs defaultValue="titulos">
              <TabsList>
                <TabsTrigger value="titulos">Títulos x royalty</TabsTrigger>
                <TabsTrigger value="cadeia">Cadeia da venda</TabsTrigger>
              </TabsList>

              <TabsContent value="titulos" className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {porSituacao.map(([s, v]) => (
                    <Badge key={s} variant={tomSituacao(s)}>
                      {ROTULO_SITUACAO[s] ?? s}: {v.n}
                    </Badge>
                  ))}
                </div>
                <Card className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Título</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead className="text-right">Esperado</TableHead>
                        <TableHead className="text-right">Retido</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {confFiltrada.map((r) => (
                        <TableRow key={r.codigo_omie ?? `${r.cliente}-${r.data_vencimento}`}>
                          <TableCell className="max-w-[260px] truncate font-medium">{r.cliente ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(r.valor_titulo)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {r.status_pagamento === "RECEBIDO" ? fmtData(r.data_pagamento) : (r.status_pagamento ?? "—")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(r.royalty_esperado)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(r.royalty_retido)}</TableCell>
                          <TableCell>
                            <Badge variant={tomSituacao(r.situacao)}>
                              {ROTULO_SITUACAO[r.situacao] ?? r.situacao}
                            </Badge>
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
                {/* O split incide sobre o valor menos a taxa do gateway, então
                    "retido" fica alguns reais abaixo de "esperado". Sem esta
                    nota a diferença parece erro de configuração. */}
                <p className="text-xs text-muted-foreground">
                  O Asaas aplica o percentual sobre o valor do boleto menos a taxa do
                  gateway (Pix R$ 1,00 fixo; cartão cerca de 2%), por isso o retido fica
                  um pouco abaixo do esperado. Pix pago fora de uma cobrança não gera
                  split e não aparece aqui.
                </p>
              </TabsContent>

              <TabsContent value="cadeia" className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {porEtapa.map(([e, v]) => (
                    <Badge key={e} variant={tomEtapa(e)}>{e}: {v.n}</Badge>
                  ))}
                </div>
                <Card className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente vendido</TableHead>
                        <TableHead>Ganho</TableHead>
                        <TableHead className="text-right">Dias</TableHead>
                        <TableHead className="text-right">MRR</TableHead>
                        <TableHead className="text-right">Retido</TableHead>
                        <TableHead>Etapa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cadeiaFiltrada.map((r) => (
                        <TableRow key={r.contrato_id}>
                          <TableCell className="max-w-[260px] truncate font-medium">
                            {r.titulo ?? "—"}
                            {/* Vínculo por nome erra: cliente com título e split
                                pode cair na etapa 1 só porque o nome não casou. */}
                            {r.omie_cnpj == null && (
                              <span className="ml-2 text-xs text-muted-foreground">sem vínculo</span>
                            )}
                            {r.metodo_vinculo === "similaridade" && (
                              <span className="ml-2 text-xs text-amber-600">vínculo por semelhança</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtData(r.ganho_em)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.dias_desde_ganho ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(r.mrr_mensal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(r.royalty_retido)}</TableCell>
                          <TableCell><Badge variant={tomEtapa(r.etapa)}>{r.etapa}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
                <p className="text-xs text-muted-foreground">
                  Etapa 1 é cliente vendido que nunca foi cadastrado no Omie da unidade:
                  não vira boleto, não splita, não aparece como perda em lugar nenhum.
                  O vínculo com o Omie é por nome, então confira antes de cobrar.
                </p>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AppShell>
  );
}
