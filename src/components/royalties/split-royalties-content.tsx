// Aba "Split" de Receitas Partners: royalty retido na fonte pelo Asaas.
//
// UMA tabela, uma linha por CLIENTE. Antes eram duas sub-abas, uma com grão de
// título e outra com grão de contrato, porque nenhum dos dois grãos comporta os
// dois lados: por título somem os clientes vendidos e nunca cadastrados no
// Omie; por contrato some quem fatura sem venda registrada. O grão de cliente
// comporta os dois, e de quebra não conta MRR em dobro quando há vários
// boletos. Ver ops.v_split_cliente (migration 50).
//
// DS v2 (contrato `docs/design/contratos/receita-e-repasses.md` §7): filtros na
// URL (N7); erro de `v_split_resumo` deixa os cards de caixa "indisponível", não
// R$ 0,00 (N4); erro da tabela por cliente vira `EstadoErro`.
//
// Duas telas usam este componente: /unidades/split (a rede, chave
// `view.royalties_split`) e /meu-split (a unidade do sócio, chave
// `view.meu_split`, desde 08/10/2026). Quem recorta a unidade é a view, não o
// componente; no modo "unidade" ele só tira o seletor de unidade.
//
// Período (08/10/2026): as views de sempre somam a história inteira; o recorte
// de meses sai de `v_split_cliente_mes` (dinheiro por mês de vencimento do
// título) e `v_split_resumo_mes` (caixa por mês de crédito). A etapa continua
// sendo a situação de hoje: o período recorta linhas e dinheiro, não a etapa.
import { useEffect, useMemo, useState } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  BarraFiltros,
  Carregando,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { ErroDaConsulta } from "@/components/receita/moldura";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";

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

/** As colunas de dinheiro de `Linha`, por mês de vencimento do título. */
type LinhaMes = {
  unidade: string | null;
  cnpj: string | null;
  mes: string;
  titulos: number | null;
  titulos_pagos: number | null;
  valor_titulos: number | null;
  valor_pago: number | null;
  royalty_creditado: number | null;
  royalty_a_creditar: number | null;
  royalty_perdido: number | null;
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

/** `Resumo` por mês: creditado no mês do crédito, a creditar no vencimento do título. */
type ResumoMes = Resumo & { mes: string | null };

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (m: string) => `${MESES_CURTOS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

/** Meses de `de` a `ate`, inclusive, em AAAA-MM. */
function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let [a, m] = de.split("-").map(Number);
  const [aFim, mFim] = ate.split("-").map(Number);
  while (a < aFim || (a === aFim && m <= mFim)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return out;
}

const chaveCliente = (unidade: string | null, cnpj: string | null) => `${unidade ?? ""}|${cnpj ?? ""}`;

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
function tomEtapa(e: string): TomStatus {
  // 5 = pagou e nada foi retido; 0 = fatura sem venda registrada.
  if (e.startsWith("5.") || e.startsWith("0.")) return "perigo";
  return "neutro";
}

/** Etapa exata, ou prefixo quando o filtro termina em ".*" ("5.*" = toda etapa 5). */
function casaEtapa(etapa: string, filtro: string): boolean {
  if (filtro === "todas") return true;
  if (filtro.endsWith(".*")) return etapa.startsWith(filtro.slice(0, -1));
  return etapa === filtro;
}

export function SplitRoyaltiesContent({ escopo = "rede" }: { escopo?: "rede" | "unidade" } = {}) {
  const daRede = escopo === "rede";
  const chave = daRede ? "view.royalties_split" : "view.meu_split";
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [erroResumo, setErroResumo] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [linhasMes, setLinhasMes] = useState<LinhaMes[]>([]);
  const [resumo, setResumo] = useState<Resumo[]>([]);
  const [resumoMes, setResumoMes] = useState<ResumoMes[]>([]);
  const [unidadeNaUrl, setUnidade] = useFiltroNaUrl("unidade", "todas");
  // Na tela da unidade a view já devolve uma unidade só; o filtro não existe.
  const unidade = daRede ? unidadeNaUrl : "todas";
  const [etapaFiltro, setEtapaFiltro] = useFiltroNaUrl("etapa", "todas");
  // Vazio = sem recorte: a história inteira, como antes do filtro existir.
  const [de, setDe] = useFiltroNaUrl("de", "");
  const [ate, setAte] = useFiltroNaUrl("ate", "");
  const limparFiltros = useLimparFiltrosNaUrl(["unidade", "etapa", "de", "ate"]);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    (async () => {
      const [l, lm, s, sm] = await Promise.all([
        (supabase as any).from("v_split_cliente").select("*").order("etapa"),
        (supabase as any).from("v_split_cliente_mes").select("*"),
        (supabase as any).from("v_split_resumo").select("*"),
        (supabase as any).from("v_split_resumo_mes").select("*"),
      ]);
      if (!vivo) return;
      setErro(l.error?.message ?? lm.error?.message ?? null);
      setErroResumo(s.error?.message ?? sm.error?.message ?? null);
      setLinhas((l.data ?? []) as Linha[]);
      setLinhasMes((lm.data ?? []) as LinhaMes[]);
      setResumo((s.data ?? []) as Resumo[]);
      setResumoMes((sm.data ?? []) as ResumoMes[]);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [tentativa]);

  // Meses do seletor: do primeiro mês com dado ao último (vencimento futuro
  // incluído), e nunca antes do mês atual.
  const todosOsMeses = useMemo(() => {
    const hoje = new Date();
    const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const meses = [
      ...linhasMes.map((r) => r.mes),
      ...resumoMes.map((r) => r.mes),
      atual,
    ].filter(Boolean) as string[];
    meses.sort();
    return mesesEntre(meses[0], meses[meses.length - 1]);
  }, [linhasMes, resumoMes]);
  const periodoAtivo = de !== "" || ate !== "";
  const deEf = todosOsMeses.includes(de) ? de : todosOsMeses[0];
  const ateEf = todosOsMeses.includes(ate) ? ate : todosOsMeses[todosOsMeses.length - 1];
  const [ini, fim] = deEf <= ateEf ? [deEf, ateEf] : [ateEf, deEf];
  const noPeriodo = (mes: string | null | undefined) => !!mes && mes >= ini && mes <= fim;

  // Com período, cada linha fica com o dinheiro dos títulos que vencem nele, e
  // cliente com título só fora do período sai. Cliente sem título nenhum
  // (etapas 1 a 3) continua devendo cobrança em todo mês depois da venda: entra
  // se a venda foi ganha até o fim do período.
  const linhasDoPeriodo = useMemo(() => {
    if (!periodoAtivo) return linhas;
    const somas = new Map<string, LinhaMes>();
    for (const m of linhasMes) {
      if (!noPeriodo(m.mes)) continue;
      const k = chaveCliente(m.unidade, m.cnpj);
      const a = somas.get(k);
      if (!a) { somas.set(k, { ...m }); continue; }
      a.titulos = Number(a.titulos ?? 0) + Number(m.titulos ?? 0);
      a.titulos_pagos = Number(a.titulos_pagos ?? 0) + Number(m.titulos_pagos ?? 0);
      a.valor_titulos = Number(a.valor_titulos ?? 0) + Number(m.valor_titulos ?? 0);
      a.valor_pago = Number(a.valor_pago ?? 0) + Number(m.valor_pago ?? 0);
      a.royalty_creditado = Number(a.royalty_creditado ?? 0) + Number(m.royalty_creditado ?? 0);
      a.royalty_a_creditar = Number(a.royalty_a_creditar ?? 0) + Number(m.royalty_a_creditar ?? 0);
      a.royalty_perdido = Number(a.royalty_perdido ?? 0) + Number(m.royalty_perdido ?? 0);
    }
    const out: Linha[] = [];
    for (const r of linhas) {
      if (!r.titulos) {
        if (!r.ganho_em || r.ganho_em.slice(0, 7) <= fim) out.push(r);
        continue;
      }
      const p = somas.get(chaveCliente(r.unidade, r.cnpj));
      if (!p) continue;
      out.push({
        ...r,
        titulos: p.titulos,
        titulos_pagos: p.titulos_pagos,
        valor_titulos: p.valor_titulos,
        valor_pago: p.valor_pago,
        royalty_creditado: p.royalty_creditado,
        royalty_a_creditar: p.royalty_a_creditar,
        royalty_perdido: p.royalty_perdido,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, linhasMes, periodoAtivo, ini, fim]);

  const tentarDeNovo = () => setTentativa((n) => n + 1);

  const unidades = useMemo(
    () => [...new Set(linhas.map((r) => r.unidade).filter(Boolean) as string[])].sort(),
    [linhas],
  );
  const etapas = useMemo(
    () => [...new Set(linhas.map((r) => r.etapa))].sort(),
    [linhas],
  );

  // "Pago sem reter royalty" abre a etapa 5 (pagou e nada foi retido). Se a
  // view tiver mais de uma variante "5.x", o filtro vira o prefixo "5.*".
  const etapas5 = etapas.filter((e) => e.startsWith("5."));
  const filtroEtapa5 = etapas5.length === 1 ? etapas5[0] : "5.*";

  const filtradas = useMemo(
    () => linhasDoPeriodo.filter(
      (r) => (unidade === "todas" || r.unidade === unidade)
          && casaEtapa(r.etapa, etapaFiltro),
    ),
    [linhasDoPeriodo, unidade, etapaFiltro],
  );

  // Cards seguem a unidade, não o filtro de etapa: filtrar etapa é navegação,
  // não recorte contábil.
  const doUnidade = useMemo(
    () => linhasDoPeriodo.filter((r) => unidade === "todas" || r.unidade === unidade),
    [linhasDoPeriodo, unidade],
  );
  // Sem período, o resumo de sempre; com período, o do mês (o split cancelado
  // sem título não tem mês e só aparece sem filtro, mas fica fora dos totais).
  const resumoFiltrado = useMemo(
    () => (periodoAtivo ? resumoMes.filter((r) => noPeriodo(r.mes)) : resumo)
      .filter((r) => unidade === "todas" || r.unidade === unidade),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resumo, resumoMes, periodoAtivo, ini, fim, unidade],
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
    return <Carregando variante="pagina" className="px-4 py-6 md:px-6" />;
  }

  if (erro) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErroDaConsulta
          erro={erro}
          chaves={chave}
          titulo="Não foi possível ler a conferência do split"
          tentarNovamente={tentarDeNovo}
        />
      </div>
    );
  }

  if (linhas.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        {daRede ? (
          <EstadoVazio
            titulo="Nenhuma unidade com split ativo"
            descricao="A unidade entra aqui sozinha assim que unidades.split_ativo_desde for preenchida."
          />
        ) : (
          <EstadoVazio
            titulo="Sua unidade ainda não tem split ativo"
            descricao="O acompanhamento aparece aqui a partir da data em que o split do Asaas da unidade for ligado."
          />
        )}
      </div>
    );
  }

  // Sem o resumo do Asaas, os cards de caixa não são zero: são desconhecidos.
  const estadoCaixa = erroResumo ? "indisponivel" : "ok";
  const notaCaixa = erroResumo ? "extrato do Asaas não carregou" : undefined;
  const temFiltro = unidade !== "todas" || etapaFiltro !== "todas" || periodoAtivo;

  return (
    <div className="space-y-6 px-4 py-6 md:px-6">
      <BarraFiltros aoLimpar={temFiltro ? limparFiltros : undefined}>
        {daRede && (
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="w-[200px]" aria-label="Unidade"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as unidades</SelectItem>
              {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span>De</span>
          <Select value={deEf} onValueChange={(v) => setDe(v === todosOsMeses[0] ? "" : v)}>
            <SelectTrigger className="w-[110px]" aria-label="Mês inicial"><SelectValue /></SelectTrigger>
            <SelectContent>
              {todosOsMeses.map((m) => <SelectItem key={m} value={m}>{fmtMes(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <span>até</span>
          <Select
            value={ateEf}
            onValueChange={(v) => setAte(v === todosOsMeses[todosOsMeses.length - 1] ? "" : v)}
          >
            <SelectTrigger className="w-[110px]" aria-label="Mês final"><SelectValue /></SelectTrigger>
            <SelectContent>
              {todosOsMeses.map((m) => <SelectItem key={m} value={m}>{fmtMes(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Select value={etapaFiltro} onValueChange={setEtapaFiltro}>
          <SelectTrigger className="w-[280px]" aria-label="Etapa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as etapas</SelectItem>
            {etapaFiltro.endsWith(".*") && (
              <SelectItem value={etapaFiltro}>Etapa {etapaFiltro.slice(0, -2)} (todas)</SelectItem>
            )}
            {etapas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="num text-[13px] text-muted-foreground">
          {filtradas.length} de {linhas.length} clientes
        </span>
      </BarraFiltros>

      <Secao
        titulo="Quanto o Asaas reteve e creditou?"
        descricao={
          periodoAtivo
            ? `Creditado e a creditar vêm do extrato de splits do Asaas (caixa), não da tabela. De ${fmtMes(ini)} a ${fmtMes(fim)}: creditado pelo mês do crédito, a creditar pelo vencimento do boleto, pago sem reter pelo vencimento do título.`
            : `Creditado e a creditar vêm do extrato de splits do Asaas (caixa), não da tabela; ${daRede ? "seguem a unidade, não a etapa" : "não seguem o filtro de etapa"}.`
        }
      >
        {erroResumo && (
          <ErroDaConsulta
            erro={erroResumo}
            titulo="Não foi possível ler o resumo do Asaas; creditado, a creditar e total ficam indisponíveis"
            tentarNovamente={tentarDeNovo}
          />
        )}
        <KpiGrade>
          <KpiCard rotulo="Royalty creditado" valor={fmtBRL(creditado)} estado={estadoCaixa} nota={notaCaixa} />
          <KpiCard rotulo="A creditar" valor={fmtBRL(aCreditar)} estado={estadoCaixa} nota={notaCaixa} />
          {/* Tudo que o split ja capturou, dentro e fora do caixa. Cancelado
              continua fora: nao vira dinheiro. */}
          <KpiCard
            rotulo="Total retido"
            valor={fmtBRL(total)}
            estado={estadoCaixa}
            nota={notaCaixa ?? "creditado + a creditar; cancelado fica fora"}
          />
          <KpiCard
            rotulo="Pago sem reter royalty"
            valor={fmtBRL(perdido)}
            tom={perdido > 0 ? "perigo" : undefined}
            tomRotulo={perdido > 0 ? "royalty perdido" : undefined}
            nota="títulos pagos sem split, da tabela por cliente"
            abrir={
              perdido > 0 ? { onClick: () => setEtapaFiltro(filtroEtapa5), rotulo: "Ver clientes" } : undefined
            }
          />
        </KpiGrade>
      </Secao>

      <Secao
        titulo="Em que etapa está cada cliente?"
        descricao={
          periodoAtivo
            ? `Uma linha por cliente com boleto vencendo de ${fmtMes(ini)} a ${fmtMes(fim)}, e os vendidos até o fim do período que ainda não têm boleto. Os valores são só desses boletos; a etapa é a situação de hoje.`
            : "Uma linha por cliente, da venda ao crédito do royalty na matriz."
        }
      >
        <div className="flex flex-wrap gap-2">
          {porEtapa.map(([e, n]) => (
            <StatusBadge key={e} tom={tomEtapa(e)}>
              <span className="num">{e}: {n}</span>
            </StatusBadge>
          ))}
        </div>

        {filtradas.length === 0 ? (
          <EstadoVazio titulo="Nenhum cliente neste recorte" total={linhas.length} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
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
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{r.cliente ?? "—"}</span>
                        {r.metodo_vinculo === "similaridade" && (
                          <StatusBadge tom="atencao" className="shrink-0">vínculo por semelhança</StatusBadge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                        <span>{fmtDoc(r.cnpj) ?? "sem CNPJ"}</span>
                        <span>deal {r.pipedrive_deal_id ?? "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-xs text-muted-foreground">
                      {r.ganho_em
                        ? `${fmtData(r.ganho_em)} · ${r.dias_desde_ganho}d`
                        : "sem venda registrada"}
                    </TableCell>
                    <TableCell className="num text-right">{fmtBRL(r.mrr_mensal)}</TableCell>
                    <TableCell className="num text-right">
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
                    <TableCell className="num text-right">{fmtBRL(r.royalty_creditado)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">
                      {Number(r.royalty_a_creditar ?? 0) > 0 ? fmtBRL(r.royalty_a_creditar) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tom={tomEtapa(r.etapa)}>{r.etapa}</StatusBadge>
                        {Number(r.royalty_perdido ?? 0) > 0 && (
                          <StatusBadge tom="perigo">perdeu {fmtBRL(r.royalty_perdido)}</StatusBadge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      <div className="max-w-3xl space-y-1 text-xs text-muted-foreground">
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
