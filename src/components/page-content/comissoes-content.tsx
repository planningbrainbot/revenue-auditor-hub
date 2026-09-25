import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { DataProvider, useData, type OrigemFilter } from "@/components/audit/data-context";
import { brl, date, num } from "@/components/audit/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  BarraFiltros,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { MolduraReceita } from "@/components/receita/moldura";

/**
 * Apuração de comissões (contrato `docs/design/contratos/receita-e-repasses.md`
 * §8): vendas do Pipedrive × 1º pagamento, por Closer e SDR. Filtros na URL
 * (N7), `Select`/`Input` do ui no lugar dos nativos e um nome só para o estado
 * do pagamento (N11: "Com 1º pagamento" / "Sem pagamento").
 *
 * Os dados vêm do `DataProvider` da auditoria, que lê `contas_receber` com
 * `limit(50000)`, cortado em 1.000 pelo PostgREST: "Sem pagamento" pode estar
 * errado. É defeito de dado registrado no contrato (defeito 1), fora desta
 * tarefa; a procedência da página avisa.
 */

const PIPEDRIVE_DEAL_URL = "https://grupoplanning.pipedrive.com/deal/";

const ALL = "__all__";
/** Valor do filtro para "sem Closer/SDR". */
const SEM = "—";

type Status = "all" | "pago" | "sem_pag";
const STATUS: Record<Status, string> = {
  all: "Todas as vendas",
  pago: "Com 1º pagamento",
  sem_pag: "Sem pagamento",
};
const ehStatus = (v: string): v is Status => v in STATUS;

const ORIGENS: OrigemFilter[] = ["", "Base Nova", "Base Antiga", "sem"];
const ehOrigem = (v: string): v is OrigemFilter => (ORIGENS as string[]).includes(v);
/** O Select do ui não aceita valor vazio: "todas as bases" vira ALL na tela. */
const origemParaSelect = (o: OrigemFilter) => (o === "" ? ALL : o);

/**
 * Filtro global de base (Nova, Antiga, sem cadastro), com o `Select` do ui.
 * O `BaseFilterSelect` da auditoria é `<select>` nativo e serve outras telas;
 * aqui o estado vem da URL (`?base=`) e é empurrado para o contexto.
 */
function SeletorBase() {
  const { origemFilter, setOrigemFilter, allRegistros, getOrigem } = useData();
  const [baseUrl, setBaseUrl] = useFiltroNaUrl("base", "");
  const base: OrigemFilter = ehOrigem(baseUrl) ? baseUrl : "";

  useEffect(() => {
    if (origemFilter !== base) setOrigemFilter(base);
  }, [base, origemFilter, setOrigemFilter]);

  const contagem = useMemo(() => {
    let nova = 0;
    let antiga = 0;
    let sem = 0;
    for (const r of allRegistros) {
      const o = getOrigem(r);
      if (o === "Base Nova") nova++;
      else if (o === "Base Antiga") antiga++;
      else sem++;
    }
    return { nova, antiga, sem, total: allRegistros.length };
  }, [allRegistros, getOrigem]);

  return (
    <Select value={origemParaSelect(base)} onValueChange={(v) => setBaseUrl(v === ALL ? "" : v)}>
      <SelectTrigger className="w-[210px]" aria-label="Base">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas as bases ({num(contagem.total)})</SelectItem>
        <SelectItem value="Base Nova">Base Nova ({num(contagem.nova)})</SelectItem>
        <SelectItem value="Base Antiga">Base Antiga ({num(contagem.antiga)})</SelectItem>
        <SelectItem value="sem">Sem cadastro ({num(contagem.sem)})</SelectItem>
      </SelectContent>
    </Select>
  );
}

function BotaoAtualizar() {
  const { refresh, refreshing } = useData();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void refresh()}
      disabled={refreshing}
    >
      <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
      {refreshing ? "Atualizando…" : "Atualizar"}
    </Button>
  );
}

function ComissoesTable() {
  const { registros } = useData();
  const [q, setQUrl] = useFiltroNaUrl("q", "");
  // Rascunho local com pausa de 300 ms: gravar na URL a cada tecla empilha
  // navegação e refiltra a tabela inteira (mesmo padrão de rede-content).
  const [busca, setBusca] = useState(q);
  const gravada = useRef(q);
  useEffect(() => {
    if (q === gravada.current) return;
    gravada.current = q;
    setBusca(q);
  }, [q]);
  useEffect(() => {
    const v = busca.trim();
    if (v === gravada.current) return;
    const t = setTimeout(() => {
      gravada.current = v;
      setQUrl(v || undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [busca, setQUrl]);
  const [closerFilter, setCloserFilter] = useFiltroNaUrl("closer", ALL);
  const [sdrFilter, setSdrFilter] = useFiltroNaUrl("sdr", ALL);
  const [statusUrl, setStatusFilter] = useFiltroNaUrl("status", "all");
  const statusFilter: Status = ehStatus(statusUrl) ? statusUrl : "all";
  const limpar = useLimparFiltrosNaUrl(["q", "closer", "sdr", "status", "base"]);
  const [baseUrl] = useFiltroNaUrl("base", "");
  const navigate = useNavigate();

  /**
   * O cartão conta todas as vendas da base: antes de aplicar o seu filtro, tira
   * busca, Closer, SDR e status, senão a tabela não bate com o número clicado.
   * Uma navegação só, para não gravar a URL em etapas.
   */
  const aplicarCartao = (filtro: { status?: Status; closer?: string; sdr?: string }) => {
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        q: undefined,
        closer: filtro.closer,
        sdr: filtro.sdr,
        status: filtro.status && filtro.status !== "all" ? filtro.status : undefined,
      })) as never,
      replace: true,
      resetScroll: false,
    });
  };

  // Só vendas efetivamente registradas no Pipedrive — são as que geram comissão.
  const vendas = useMemo(() => registros.filter((r) => r.deal_id != null), [registros]);

  const closers = useMemo(
    () => Array.from(new Set(vendas.map((r) => r.closer).filter((v): v is string => !!v))).sort(),
    [vendas],
  );
  const sdrs = useMemo(
    () => Array.from(new Set(vendas.map((r) => r.sdr).filter((v): v is string => !!v))).sort(),
    [vendas],
  );

  const stats = useMemo(() => {
    const total = vendas.length;
    const comPag = vendas.filter((r) => r.pagou).length;
    const semCloser = vendas.filter((r) => !r.closer).length;
    const semSdr = vendas.filter((r) => !r.sdr).length;
    return { total, comPag, semPag: total - comPag, semCloser, semSdr };
  }, [vendas]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return vendas.filter((r) => {
      if (statusFilter === "pago" && !r.pagou) return false;
      if (statusFilter === "sem_pag" && r.pagou) return false;
      // Mesmo teste dos cards ("Sem Closer" = `!r.closer`, inclusive string vazia).
      if (closerFilter !== ALL && !(closerFilter === SEM ? !r.closer : r.closer === closerFilter))
        return false;
      if (sdrFilter !== ALL && !(sdrFilter === SEM ? !r.sdr : r.sdr === sdrFilter)) return false;
      if (ql) {
        const hay =
          `${r.deal_titulo ?? ""} ${r.razao_social ?? ""} ${r.cnpj ?? ""} ${r.deal_id ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [vendas, q, closerFilter, sdrFilter, statusFilter]);

  const temFiltro =
    !!q || closerFilter !== ALL || sdrFilter !== ALL || statusFilter !== "all" || !!baseUrl;

  return (
    <div className="space-y-6">
      <BarraFiltros aoLimpar={temFiltro ? limpar : undefined}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="w-64 pl-8"
            placeholder="Buscar nome, razão social, CNPJ ou deal"
            aria-label="Buscar venda"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <SeletorBase />
        <Select value={closerFilter} onValueChange={setCloserFilter}>
          <SelectTrigger className="w-[190px]" aria-label="Closer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os Closers</SelectItem>
            <SelectItem value={SEM}>Sem Closer atribuído</SelectItem>
            {closers.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sdrFilter} onValueChange={setSdrFilter}>
          <SelectTrigger className="w-[190px]" aria-label="SDR">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os SDRs</SelectItem>
            <SelectItem value={SEM}>Sem SDR atribuído</SelectItem>
            {sdrs.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[190px]" aria-label="1º pagamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="num text-[13px] text-muted-foreground">
          {num(filtered.length)} de {num(vendas.length)} vendas
        </span>
      </BarraFiltros>

      <Secao
        titulo="Quantas vendas já podem ser comissionadas?"
        descricao="Vendas ganhas no Pipedrive, na base escolhida. Cada card filtra a tabela."
      >
        <KpiGrade>
          <KpiCard
            rotulo="Vendas"
            valor={num(stats.total)}
            abrir={{ onClick: () => aplicarCartao({}), rotulo: "Ver todas" }}
          />
          <KpiCard
            rotulo="Com 1º pagamento"
            valor={num(stats.comPag)}
            tom="sucesso"
            abrir={{ onClick: () => aplicarCartao({ status: "pago" }), rotulo: "Filtrar" }}
          />
          <KpiCard
            rotulo="Sem pagamento"
            valor={num(stats.semPag)}
            tom="atencao"
            nota="pode estar errado: recebimentos lidos em até 1.000 títulos"
            abrir={{ onClick: () => aplicarCartao({ status: "sem_pag" }), rotulo: "Filtrar" }}
          />
          <KpiCard
            rotulo="Sem Closer atribuído"
            valor={num(stats.semCloser)}
            tom={stats.semCloser > 0 ? "atencao" : undefined}
            abrir={{ onClick: () => aplicarCartao({ closer: SEM }), rotulo: "Filtrar" }}
          />
          <KpiCard
            rotulo="Sem SDR atribuído"
            valor={num(stats.semSdr)}
            tom={stats.semSdr > 0 ? "atencao" : undefined}
            abrir={{ onClick: () => aplicarCartao({ sdr: SEM }), rotulo: "Filtrar" }}
          />
        </KpiGrade>
      </Secao>

      <Secao
        titulo="Quais vendas pagaram e têm Closer e SDR?"
        descricao="Confira se a venda foi realizada (1º pagamento recebido) antes de apurar a comissão."
      >
        {filtered.length === 0 ? (
          <EstadoVazio titulo="Nenhuma venda neste recorte" total={vendas.length} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="relative max-h-[600px] overflow-auto">
              <table className="w-full caption-bottom border-separate border-spacing-0 text-sm [&_tbody_td]:border-b">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
                  <TableRow>
                    <TableHead className="bg-card">Nome</TableHead>
                    <TableHead className="bg-card">CNPJ</TableHead>
                    <TableHead className="bg-card">Razão social</TableHead>
                    <TableHead className="bg-card">Pipedrive</TableHead>
                    <TableHead className="bg-card">Data da venda</TableHead>
                    <TableHead className="bg-card">Closer</TableHead>
                    <TableHead className="bg-card">SDR</TableHead>
                    <TableHead className="bg-card">1º pagamento</TableHead>
                    <TableHead className="bg-card text-right">Valor</TableHead>
                    <TableHead className="bg-card">Data do pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => (
                    <TableRow key={`${r.deal_id}-${i}`}>
                      <TableCell className="font-medium">{r.deal_titulo ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.cnpj ?? "—"}</TableCell>
                      <TableCell>{r.razao_social ?? "—"}</TableCell>
                      <TableCell>
                        <a
                          href={`${PIPEDRIVE_DEAL_URL}${r.deal_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="num inline-flex items-center gap-1 rounded-sm text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          aria-label={`Abrir o deal ${r.deal_id} no Pipedrive (nova aba)`}
                        >
                          {r.deal_id} <ExternalLink className="size-4" aria-hidden />
                        </a>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">
                        {date(r.data_fechamento)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.closer ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.sdr ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.pagou ? (
                          <StatusBadge tom="sucesso">Com 1º pagamento</StatusBadge>
                        ) : (
                          <StatusBadge tom="atencao">Sem pagamento</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-right">
                        {r.pagou && r.valor_primeiro_pag != null ? brl(r.valor_primeiro_pag) : "—"}
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">
                        {date(r.data_primeiro_pag)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </div>
        )}
      </Secao>
    </div>
  );
}

/**
 * A página inteira, com o cabeçalho: "Atualizar" mora nas `acoes` do
 * `PageHeader`. O cabeçalho fica fora do `DataProvider` (senão some enquanto
 * carrega, porque o provider troca tudo pelo spinner), e o botão, que precisa
 * do contexto, entra no slot das ações por portal.
 */
export function ComissoesContent() {
  const [slotAcoes, setSlotAcoes] = useState<HTMLSpanElement | null>(null);
  return (
    <MolduraReceita
      titulo="Comissões"
      pergunta="Quais vendas já pagaram e têm closer e SDR para comissionar?"
      descricao="Vendas ganhas no Pipedrive (franquias) × 1º pagamento recebido no Omie, por Closer e SDR. Todo o histórico, sem recorte de mês."
      procedencia={{
        fonte:
          "Pipedrive (vendas e contratos) × contas a receber do Omie · os recebimentos são lidos em até 1.000 títulos; 'Sem pagamento' pode estar errado",
        regua: "1º pagamento (caixa)",
      }}
      acoes={<span ref={setSlotAcoes} className="contents" />}
    >
      <DataProvider>
        {slotAcoes && createPortal(<BotaoAtualizar />, slotAcoes)}
        <div className="px-4 py-6 md:px-6">
          <ComissoesTable />
        </div>
      </DataProvider>
    </MolduraReceita>
  );
}
