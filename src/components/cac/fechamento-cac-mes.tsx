// Aba "Fechamento do mês" do Funil de CAC: o CAC de um mês no formato do
// demonstrativo (por parcela), comparado com o que o gatilho de cada parcela põe
// no mês. Regras em src/lib/cac-fechamento.ts e no PRD
// wiki/prds/2026-10-minha-unidade-fechamento-de-cac.md.
//
// Lê tudo por ops.cac_fechamento_dados, que recorta a unidade: as tabelas de
// royalties só liberam leitura para a matriz.
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import * as XLSX from "xlsx-js-style";
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
import { supabase } from "@/integrations/supabase/client";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { ErroDaConsulta } from "@/components/receita/moldura";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import {
  montarFechamento,
  ROTULO_GRUPO,
  ROTULO_SITUACAO,
  SITUACAO_DIVERGE,
  type ApuracaoCac,
  type EstornoCac,
  type FaturaCac,
  type Grupo,
  type ItemCac,
  type LinhaFechamento,
  type Situacao,
  type VendaCac,
} from "@/lib/cac-fechamento";

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;

const TOM: Record<Situacao, TomStatus> = {
  no_mes: "sucesso",
  atrasada: "info",
  antes_do_gatilho: "atencao",
  sem_data_central: "neutro",
  sem_pagamento_marcado: "atencao",
  ja_cobrada: "perigo",
  sem_cobranca: "neutro",
  fora: "neutro",
  historico: "neutro",
  nao_entrou: "perigo",
};

const GRUPOS: Grupo[] = ["p1", "p2", "integral", "historico"];

export function FechamentoCacMes({
  escopo,
  unidadeId,
  unidadeNome,
  vendas,
}: {
  escopo: "rede" | "unidade";
  unidadeId: number | null;
  unidadeNome: string | null;
  vendas: VendaCac[];
}) {
  const daRede = escopo === "rede";
  const [mesNaUrl, setMes] = useFiltroNaUrl("mes", "");
  const [sitFiltro, setSit] = useFiltroNaUrl("sit", "");
  const [verFora, setVerFora] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [apuracoes, setApuracoes] = useState<ApuracaoCac[]>([]);
  const [itens, setItens] = useState<ItemCac[]>([]);
  const [faturas, setFaturas] = useState<FaturaCac[]>([]);
  const [estornos, setEstornos] = useState<EstornoCac[]>([]);

  useEffect(() => {
    if (unidadeId == null) return;
    let vivo = true;
    setCarregando(true);
    (async () => {
      // Uma chamada só: a função aplica o escopo (matriz ou sócio da unidade) e, para o
      // sócio, devolve só apuração confirmada. Migration 20261021210000.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- função fora dos tipos gerados
      const r = await (supabase as any).rpc("cac_fechamento_dados", { p_unidade_id: unidadeId });
      if (!vivo) return;
      setErro(r.error ? r.error.message : null);
      const d = (r.data ?? {}) as {
        apuracoes?: ApuracaoCac[];
        itens?: ItemCac[];
        faturas?: FaturaCac[];
        estornos?: EstornoCac[];
      };
      setApuracoes(d.apuracoes ?? []);
      setItens(d.itens ?? []);
      setFaturas(d.faturas ?? []);
      setEstornos(d.estornos ?? []);
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [unidadeId, tentativa]);

  // R-10: o sócio só vê apuração confirmada; a matriz vê também o rascunho.
  const visiveis = useMemo(
    () => apuracoes.filter((a) => daRede || a.status === "confirmado"),
    [apuracoes, daRede],
  );
  // Padrão: o mês anterior ao corrente (o fechamento de setembro acontece em outubro).
  const mesPadrao = useMemo(() => {
    const hoje = new Date();
    const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const alvo = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, "0")}`;
    return (
      (
        visiveis.find((a) => a.mes_referencia.slice(0, 7) <= alvo) ?? visiveis[0]
      )?.mes_referencia.slice(0, 7) ?? ""
    );
  }, [visiveis]);
  const mesSel = mesNaUrl || mesPadrao;
  const apuracao = visiveis.find((a) => a.mes_referencia.slice(0, 7) === mesSel) ?? null;

  const fech = useMemo(() => {
    if (!apuracao) return null;
    return montarFechamento({
      apuracao,
      apuracoes,
      itens,
      faturas,
      vendas,
      estornos,
      semAdiantamento: /recife/i.test(unidadeNome ?? ""),
    });
  }, [apuracao, apuracoes, itens, faturas, vendas, estornos, unidadeNome]);

  if (unidadeId == null) {
    return (
      <EstadoVazio
        titulo="Escolha uma unidade"
        descricao="O fechamento é por unidade: escolha uma no filtro acima."
      />
    );
  }
  if (carregando) return <Carregando variante="pagina" />;
  if (erro) {
    return (
      <ErroDaConsulta
        erro={erro}
        chaves={daRede ? "view.unidades_rede" : "view.meu_funil_cac"}
        titulo="Não foi possível ler a apuração de CAC"
        tentarNovamente={() => setTentativa((t) => t + 1)}
      />
    );
  }
  if (!apuracao || !fech) {
    return (
      <EstadoVazio
        titulo={daRede ? "Sem apuração para a unidade" : "Apuração ainda não liberada"}
        descricao={
          daRede
            ? "A unidade ainda não tem apuração de royalties."
            : "O fechamento aparece aqui quando a matriz confirma a apuração do mês."
        }
      />
    );
  }

  const rascunho = apuracao.status !== "confirmado";
  const ativas = fech.linhas.filter((l) => l.situacao !== "fora");
  const fora = fech.linhas.filter((l) => l.situacao === "fora");
  const contagem = new Map<Situacao, number>();
  for (const l of ativas) contagem.set(l.situacao, (contagem.get(l.situacao) ?? 0) + 1);
  const divergem = ativas.filter((l) => SITUACAO_DIVERGE.has(l.situacao) || l.valorDiferente);
  const filtrar = (ls: LinhaFechamento[]) =>
    sitFiltro ? ls.filter((l) => l.situacao === sitFiltro) : ls;
  const porGrupo = (g: Grupo) => filtrar(ativas).filter((l) => l.grupo === g);
  const somaGrupo = (g: Grupo) =>
    ativas.filter((l) => l.grupo === g).reduce((a, l) => a + l.valor, 0);
  const diferenca = fech.entrou - fech.deveria;

  const exportar = () =>
    exportarPlanilha(unidadeNome ?? "unidade", mesSel, fech.linhas, fech.pendencias);

  return (
    <div className="space-y-6">
      <BarraFiltros aoLimpar={sitFiltro ? () => setSit("") : undefined}>
        <Select value={mesSel} onValueChange={(v) => setMes(v)}>
          <SelectTrigger className="w-[230px]" aria-label="Mês de referência">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visiveis.map((a) => (
              <SelectItem key={a.id} value={a.mes_referencia.slice(0, 7)}>
                {fmtMes(a.mes_referencia)} · {a.status === "confirmado" ? "confirmada" : "rascunho"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sitFiltro && (
          <ChipFiltro
            rotulo="Situação"
            valor={ROTULO_SITUACAO[sitFiltro as Situacao] ?? sitFiltro}
            aoRemover={() => setSit("")}
          />
        )}
        <span className="num text-[13px] text-muted-foreground">
          Apuração {apuracao.id}
          {apuracao.confirmado_em ? ` · confirmada em ${fmtData(apuracao.confirmado_em)}` : ""}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={exportar}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden /> Exportar planilha do mês
        </Button>
      </BarraFiltros>

      <Secao
        titulo={`Quanto de CAC entra em ${fmtMes(mesSel)}?`}
        descricao="O CAC do mês é o da apuração, que é o que vai na nota. “Pelo gatilho” confere cada parcela: a 1ª entra no mês em que o cliente assina, a 2ª no mês em que paga o 1º honorário."
        acoes={rascunho ? <StatusBadge tom="atencao">prévia, pode mudar</StatusBadge> : undefined}
      >
        <KpiGrade>
          <KpiCard
            rotulo="CAC da apuração"
            valor={fmtBRL(fech.naApuracao ?? fech.entrou)}
            nota={GRUPOS.filter((g) => somaGrupo(g) > 0)
              .map((g) => `${ROTULO_GRUPO[g].split(" (")[0]} ${fmtBRL(somaGrupo(g))}`)
              .join(" · ")}
          />
          <KpiCard
            rotulo="Pelo gatilho"
            valor={fmtBRL(fech.deveria)}
            nota="o que a regra de cada parcela põe neste mês"
          />
          <KpiCard
            rotulo="Linhas para conferir"
            valor={divergem.length}
            tom={divergem.length > 0 ? "atencao" : "sucesso"}
            tomRotulo={divergem.length > 0 ? `${fmtBRL(diferenca)} de diferença` : "tudo bate"}
            abrir={
              divergem.length ? { onClick: () => setSit(""), rotulo: "Ver linhas" } : undefined
            }
          />
        </KpiGrade>
        {fech.notas.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
            {fech.notas.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
          {[...contagem.entries()].map(([s, q]) => (
            <button
              key={s}
              type="button"
              onClick={() => setSit(sitFiltro === s ? "" : s)}
              className={`rounded-full border px-3 py-1 text-[13px] ${sitFiltro === s ? "border-primary bg-primary/10" : "bg-card"}`}
              aria-pressed={sitFiltro === s}
            >
              {ROTULO_SITUACAO[s]} <span className="num text-muted-foreground">{q}</span>
            </button>
          ))}
        </div>
      </Secao>

      {GRUPOS.map((g) => {
        const ls = porGrupo(g);
        if (ls.length === 0) return null;
        return (
          <Secao
            key={g}
            titulo={ROTULO_GRUPO[g]}
            descricao={`${ls.length} linhas · ${fmtBRL(ls.reduce((a, l) => a + l.valor, 0))} na apuração`}
          >
            <TabelaLinhas linhas={ls} />
          </Secao>
        );
      })}

      {fora.length > 0 && (
        <Secao
          titulo="O que saiu da apuração, e por quê?"
          descricao="Itens excluídos com motivo. Não contam na diferença."
          acoes={
            <Button variant="ghost" size="sm" onClick={() => setVerFora((v) => !v)}>
              {verFora ? "Esconder" : `Mostrar ${fora.length}`}
            </Button>
          }
        >
          {verFora && <TabelaLinhas linhas={fora} />}
        </Secao>
      )}

      <Secao
        titulo="O que fica para o próximo mês?"
        descricao="Situação de hoje: o que tem gatilho em aberto e ainda não entrou em apuração nenhuma."
      >
        {fech.pendencias.length === 0 ? (
          <EstadoVazio
            titulo="Nada pendente"
            descricao="Toda venda assinada já tem as parcelas cobradas."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>O que falta</TableHead>
                    <TableHead className="text-right">Parcela esperada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fech.pendencias.map((p) => (
                    <TableRow key={`${p.chave}-${p.motivo}`}>
                      <TableCell className="max-w-[260px] truncate" title={p.cliente}>
                        {p.cliente}
                      </TableCell>
                      <TableCell className="text-sm">{p.motivo}</TableCell>
                      <TableCell className="num text-right">{fmtBRL(p.valor)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Secao>

      <Secao
        titulo="Que créditos a unidade recebeu no mês?"
        descricao="Estornos de CAC lançados no extrato neste mês. Ficam como crédito no extrato; não abatem sozinhos na nota."
      >
        {fech.ajustes.length === 0 ? (
          <EstadoVazio titulo="Nenhum crédito lançado no mês" />
        ) : (
          <ul className="space-y-1.5 rounded-xl border bg-card p-4 text-sm">
            {fech.ajustes.map((a, k) => (
              <li key={k} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{a.cliente ?? "—"}</span>
                <span className="num">{fmtBRL(a.valor_cb)}</span>
                {a.observacao && <span className="text-muted-foreground">{a.observacao}</span>}
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}

function TabelaLinhas({ linhas }: { linhas: LinhaFechamento[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Ganho</TableHead>
              <TableHead>Assinatura</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Na apuração</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.chave}>
                <TableCell className="max-w-[240px]">
                  <div className="truncate font-medium" title={l.cliente}>
                    {l.cliente}
                  </div>
                  {l.cnpj && <div className="num text-xs text-muted-foreground">{l.cnpj}</div>}
                </TableCell>
                <TableCell className="num whitespace-nowrap">{fmtData(l.ganho)}</TableCell>
                <TableCell className="num whitespace-nowrap">{fmtData(l.assinatura)}</TableCell>
                <TableCell className="num text-right">{fmtBRL(l.base)}</TableCell>
                <TableCell className="num text-right">{l.percentual ?? "—"}</TableCell>
                <TableCell className="num text-right font-medium">{fmtBRL(l.valor)}</TableCell>
                <TableCell className="num text-right text-muted-foreground">
                  {fmtBRL(l.esperado)}
                </TableCell>
                <TableCell className="min-w-[220px]">
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge tom={TOM[l.situacao]}>{ROTULO_SITUACAO[l.situacao]}</StatusBadge>
                    {l.valorDiferente && <StatusBadge tom="atencao">valor diferente</StatusBadge>}
                  </div>
                  {l.detalhe && (
                    <div className="mt-1 text-xs text-muted-foreground">{l.detalhe}</div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Planilha no layout do demonstrativo (uma aba por parcela), mais a situação. */
function exportarPlanilha(
  unidade: string,
  mes: string,
  linhas: LinhaFechamento[],
  pendencias: { cliente: string; motivo: string; valor: number | null }[],
) {
  const wb = XLSX.utils.book_new();
  const cab = [
    "Cliente",
    "CNPJ",
    "Data do ganho",
    "Assinatura do contrato",
    "Valor (R$)",
    "%",
    "Total a cobrar (R$)",
    "Esperado (R$)",
    "Situação",
    "Detalhe",
  ];
  const abas: [string, LinhaFechamento[]][] = [
    ["CAC - 1a parcela", linhas.filter((l) => l.grupo === "p1" && l.situacao !== "fora")],
    ["CAC - 2a parcela", linhas.filter((l) => l.grupo === "p2" && l.situacao !== "fora")],
    ["CAC - integral", linhas.filter((l) => l.grupo === "integral" && l.situacao !== "fora")],
    ["Clientes - CAC", linhas.filter((l) => l.grupo === "historico" && l.situacao !== "fora")],
    ["Fora da apuracao", linhas.filter((l) => l.situacao === "fora")],
  ];
  for (const [nome, ls] of abas) {
    if (!ls.length) continue;
    const linhasAoa = ls.map((l) => [
      l.cliente,
      l.cnpj ?? "—",
      fmtData(l.ganho),
      fmtData(l.assinatura),
      l.base ?? "",
      l.percentual ?? "",
      l.valor,
      l.esperado ?? "",
      ROTULO_SITUACAO[l.situacao] + (l.valorDiferente ? " (valor diferente)" : ""),
      l.detalhe ?? "",
    ]);
    const total = ls.reduce((a, l) => a + l.valor, 0);
    const ws = XLSX.utils.aoa_to_sheet([cab, ...linhasAoa, ["Total", "", "", "", "", "", total]]);
    ws["!cols"] = [
      { wch: 40 },
      { wch: 20 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 6 },
      { wch: 18 },
      { wch: 14 },
      { wch: 30 },
      { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, nome);
  }
  if (pendencias.length) {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Cliente", "O que falta", "Parcela esperada (R$)"],
      ...pendencias.map((p) => [p.cliente, p.motivo, p.valor ?? ""]),
    ]);
    ws["!cols"] = [{ wch: 40 }, { wch: 60 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, "Fica para o proximo mes");
  }
  const slug = unidade
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  XLSX.writeFile(wb, `fechamento-cac-${slug}-${mes}.xlsx`);
}
