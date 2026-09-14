// Aba "Split" de Receitas Partners: royalty retido na fonte pelo Asaas.
//
// Duas perguntas de sentido oposto, uma por sub-aba, porque cada uma sozinha
// perde metade do buraco:
//   "Títulos x royalty"  do boleto para trás: todo título emitido reteve?
//   "Cadeia da venda"    da venda para frente: todo cliente vendido virou título?
//
// Fonte: ops.v_split_conferencia, ops.v_cadeia_venda_royalty e ops.asaas_splits
// (migrations 47 a 49).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";
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
  pipedrive_deal_id: string | null;
  omie_cnpj: string | null;
  metodo_vinculo: string | null;
  titulos: number | null;
  titulos_pagos: number | null;
  royalty_retido: number | null;
  etapa: string;
};

type Split = {
  id: string;
  valor: number | null;
  status: string;
  codigo_omie: number | null;
  data_credito: string | null;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—");

/**
 * CNPJ chega em dois formatos: pontuado de `contas_receber.cpf_cnpj` e cru de
 * `omie_clientes.cnpj_cpf`. Normaliza os dois, senão metade da coluna sai com
 * máscara e metade não. CPF de 11 dígitos aparece quando a unidade fatura
 * pessoa física.
 */
function fmtDoc(v: string | null): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d ? v : null;
}

const ROTULO_SITUACAO: Record<string, string> = {
  retido: "Creditado",
  a_creditar: "A creditar",
  cancelado: "Cobrança cancelada",
  sem_split: "Sem split",
};

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

export function SplitRoyaltiesContent() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [conf, setConf] = useState<Conferencia[]>([]);
  const [cadeia, setCadeia] = useState<Cadeia[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [unidade, setUnidade] = useState<string>("todas");

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    (async () => {
      const [c, k, s] = await Promise.all([
        (supabase as any).from("v_split_conferencia").select("*").order("data_vencimento", { ascending: false }),
        (supabase as any).from("v_cadeia_venda_royalty").select("*").order("ganho_em", { ascending: false }),
        // asaas_splits cru serve de contraprova: a view só enxerga split que
        // tem título correspondente, e existe split creditado sem título.
        (supabase as any).from("asaas_splits").select("id,valor,status,codigo_omie,data_credito"),
      ]);
      if (!vivo) return;
      if (c.error || k.error) setErro(c.error?.message ?? k.error?.message ?? null);
      setConf((c.data ?? []) as Conferencia[]);
      setCadeia((k.data ?? []) as Cadeia[]);
      setSplits((s.data ?? []) as Split[]);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  const unidades = useMemo(() => {
    const set = new Set<string>();
    for (const r of conf) if (r.unidade) set.add(r.unidade);
    for (const r of cadeia) if (r.unidade) set.add(r.unidade);
    return [...set].sort();
  }, [conf, cadeia]);

  const confFiltrada = useMemo(
    () => (unidade === "todas" ? conf : conf.filter((r) => r.unidade === unidade)),
    [conf, unidade],
  );
  const cadeiaFiltrada = useMemo(
    () => (unidade === "todas" ? cadeia : cadeia.filter((r) => r.unidade === unidade)),
    [cadeia, unidade],
  );

  // Somar por status, e não tudo junto: PENDING ainda não entrou e CANCELLED
  // nunca vai entrar. Somados sob o rótulo "retido" o número fica maior que o
  // extrato do Asaas, que foi exatamente o erro reportado em 14/09/2026.
  const creditado = confFiltrada
    .filter((r) => r.status_split === "DONE")
    .reduce((a, r) => a + Number(r.royalty_retido ?? 0), 0);
  const aCreditar = confFiltrada
    .filter((r) => r.status_split === "PENDING" || r.status_split === "AWAITING_CREDIT")
    .reduce((a, r) => a + Number(r.royalty_retido ?? 0), 0);
  const perdido = confFiltrada.reduce((a, r) => a + Number(r.royalty_perdido ?? 0), 0);

  // Split creditado cujo título não existe em contas_receber. A view é montada
  // a partir do título, então ele sumiria da tela: dinheiro que entrou e a
  // conferência não mostra. Não dá para atribuir a uma unidade (asaas_splits
  // guarda a conta de origem, não o nome), por isso fica sempre global.
  const orfaos = useMemo(() => {
    const comTitulo = new Set(conf.map((r) => r.codigo_omie).filter((x) => x != null));
    return splits.filter(
      (s) => s.status === "DONE" && (s.codigo_omie == null || !comTitulo.has(s.codigo_omie)),
    );
  }, [splits, conf]);
  const valorOrfaos = orfaos.reduce((a, s) => a + Number(s.valor ?? 0), 0);
  const creditadoNoAsaas = splits
    .filter((s) => s.status === "DONE")
    .reduce((a, s) => a + Number(s.valor ?? 0), 0);

  const porSituacao = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of confFiltrada) m.set(r.situacao, (m.get(r.situacao) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [confFiltrada]);

  const porEtapa = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of cadeiaFiltrada) m.set(r.etapa, (m.get(r.etapa) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cadeiaFiltrada]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (unidades.length === 0) {
    return (
      <div className="p-4">
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhuma unidade com split ativo. A unidade entra aqui sozinha assim que
          <code className="mx-1 rounded bg-muted px-1">unidades.split_ativo_desde</code>
          for preenchida.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {erro && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          Não consegui ler as views do split: {erro}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as unidades</SelectItem>
            {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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
        <Card className={`flex items-center gap-3 p-4 ${perdido > 0 ? "border-destructive/40" : ""}`}>
          <AlertTriangle className={`h-5 w-5 shrink-0 ${perdido > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          <div>
            <div className="text-xs text-muted-foreground">Pago sem reter royalty</div>
            <div className={`text-xl font-semibold ${perdido > 0 ? "text-destructive" : ""}`}>{fmtBRL(perdido)}</div>
          </div>
        </Card>
      </div>

      {/* Sem esta linha o total da tela nunca fecha com o extrato do Asaas e
          quem confere fica procurando um erro que não está na conta. */}
      {orfaos.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <span className="font-medium">Conferência com o Asaas:</span> creditado no
          gateway {fmtBRL(creditadoNoAsaas)}, dos quais {fmtBRL(valorOrfaos)} em{" "}
          {orfaos.length} split{orfaos.length > 1 ? "s" : ""} sem título correspondente
          no Omie, e por isso fora da tabela abaixo. Cancelados não entram em nenhum
          total: split cancelado não vira dinheiro.
        </Card>
      )}

      <Tabs defaultValue="titulos">
        <TabsList>
          <TabsTrigger value="titulos">Títulos x royalty</TabsTrigger>
          <TabsTrigger value="cadeia">Cadeia da venda</TabsTrigger>
        </TabsList>

        <TabsContent value="titulos" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {porSituacao.map(([s, n]) => (
              <Badge key={s} variant={tomSituacao(s)}>
                {ROTULO_SITUACAO[s] ?? s}: {n}
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
                    <TableCell className="max-w-[280px]">
                      <div className="truncate font-medium">{r.cliente ?? "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {fmtDoc(r.cpf_cnpj) ?? "sem CNPJ"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(r.valor_titulo)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.status_pagamento === "RECEBIDO" ? fmtData(r.data_pagamento) : (r.status_pagamento ?? "—")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(r.royalty_esperado)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/* Cancelado mostra o valor riscado: existiu, mas não entra em conta. */}
                      <span className={r.situacao === "cancelado" ? "text-muted-foreground line-through" : ""}>
                        {fmtBRL(r.royalty_retido)}
                      </span>
                    </TableCell>
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
          <p className="text-xs text-muted-foreground">
            O Asaas aplica o percentual sobre o valor do boleto menos a taxa do
            gateway (Pix R$ 1,00 fixo; cartão cerca de 2%), por isso o retido fica
            um pouco abaixo do esperado. Pix pago fora de uma cobrança não gera
            split e não aparece aqui.
          </p>
        </TabsContent>

        <TabsContent value="cadeia" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {porEtapa.map(([e, n]) => (
              <Badge key={e} variant={tomEtapa(e)}>{e}: {n}</Badge>
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
                    <TableCell className="max-w-[320px]">
                      <div className="truncate font-medium">
                        {r.titulo ?? "—"}
                        {r.metodo_vinculo === "similaridade" && (
                          <span className="ml-2 text-xs text-amber-600">vínculo por semelhança</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                        <span>{fmtDoc(r.omie_cnpj) ?? "sem CNPJ no Omie"}</span>
                        <span>deal {r.pipedrive_deal_id ?? "—"}</span>
                      </div>
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
    </div>
  );
}
