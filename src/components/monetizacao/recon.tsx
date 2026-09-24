import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normal, oferta } from "@/lib/monetizacao/model";
import {
  faturamentoRecon,
  GRUPOS_RECON,
  grupoRecon,
  ofertaRecon,
  potencialRecon,
} from "@/lib/monetizacao/recon";
import type { GrupoRecon } from "@/lib/monetizacao/recon";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { Conta } from "@/lib/monetizacao/types";
import { EstadoVazio, KpiCard, KpiGrade } from "@/components/planning";
import {
  BotaoComMotivo,
  date,
  downloadCsv,
  Field,
  FOCO_VISIVEL,
  inputClass,
  NotaApoio,
  number,
  SecaoCartao,
} from "./common";
import { FieldMulti, MultiSelect } from "./multi-select";

export function ReconAquario({
  accounts,
  showAccount,
}: {
  accounts: Conta[];
  showAccount: (a: Conta) => void;
}) {
  // Classificação, unidade e contato aceitam várias opções; nada marcado = todas as contas.
  const [status, setStatus] = useState<string[]>(["potencial"]),
    [query, setQuery] = useState(""),
    [unit, setUnit] = useState<string[]>([]),
    [contact, setContact] = useState<string[]>([]),
    [limit, setLimit] = useState(50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const eligible = accounts.filter((a) => ofertaRecon(a).status === "elegivel");
  const potential = accounts.filter(potencialRecon);
  const counts = Object.fromEntries(
    Object.keys(GRUPOS_RECON).map((g) => [g, accounts.filter((a) => grupoRecon(a) === g).length]),
  ) as Record<GrupoRecon, number>;
  const checked = accounts.filter((a) => a.recon);
  const updated = checked
    .map((a) => a.recon!.checked_at)
    .sort()
    .at(-1);
  const rows = useMemo(
    () =>
      accounts
        .filter(
          (a) =>
            (!status.length ||
              status.some((s) => (s === "potencial" ? potencialRecon(a) : grupoRecon(a) === s))) &&
            (!query ||
              normal([a.name, a.unit_label, a.segment].join(" ")).includes(normal(query))) &&
            (!unit.length || unit.includes(a.unit_label ?? "")) &&
            (!contact.length || contact.includes(String(a.contact))),
        )
        .sort(
          (a, b) =>
            Number(ofertaRecon(b).status === "elegivel") -
              Number(ofertaRecon(a).status === "elegivel") ||
            (b.recon?.revenue_exact ?? b.recon?.revenue_min ?? -1) -
              (a.recon?.revenue_exact ?? a.recon?.revenue_min ?? -1) ||
            a.name.localeCompare(b.name, "pt-BR"),
        ),
    [accounts, status, query, unit, contact],
  );
  const selected = accounts.filter((a) => picked.has(a.key));
  // O checkbox do cabeçalho marca o FILTRO inteiro, inclusive as linhas além da página: diz isso.
  const visiveis = Math.min(limit, rows.length);
  const todasDoFiltro = rows.length > 0 && rows.every((a) => picked.has(a.key));
  const algumaDoFiltro = rows.some((a) => picked.has(a.key));
  const chavesDoFiltro = new Set(rows.map((a) => a.key));
  const foraDoFiltro = selected.filter((a) => !chavesDoFiltro.has(a.key)).length;
  const rotuloCabecalho = todasDoFiltro
    ? `Desmarcar as ${number(rows.length)} contas do filtro`
    : `Selecionar as ${number(rows.length)} contas do filtro, não só as ${number(visiveis)} desta página`;
  // Cartão ou grupo filtra a tabela e leva até ela.
  const filtrar = (s: string[]) => {
    setStatus(s);
    setLimit(50);
    document.getElementById("recon-tabela")?.scrollIntoView({ behavior: "smooth" });
  };
  const exportRows = (items: Conta[]) =>
    downloadCsv("aquario-recon.csv", [
      [
        "Empresa",
        "Unidade",
        "Faturamento anual",
        "Fonte do faturamento",
        "Segmento",
        "Contato",
        "Classificação",
        "Motivo",
        "Produtos dos contratos",
        "Contratos conferidos",
        "Conferido em",
        "Outras ofertas aderentes",
      ],
      ...items.map((a) => [
        a.name,
        a.unit_label,
        faturamentoRecon(a),
        a.recon?.revenue_sources?.join("; "),
        a.segment,
        a.contact ? "Com contato" : "Obter com o sócio",
        GRUPOS_RECON[grupoRecon(a)],
        ofertaRecon(a).reason,
        a.recon?.products.join("; "),
        a.recon?.contract_ids.join("; "),
        a.recon?.checked_at,
        PRODUTOS.filter((p) => oferta(a, p).status === "elegivel")
          .map((p) => NOMES[p])
          .join("; "),
      ]),
    ]);
  return (
    <div className="space-y-4">
      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Contas no radar Recon"
          valor={number(potential.length)}
          nota="Aptas + pendentes abaixo · contas únicas"
          abrir={{ rotulo: "Filtrar a tabela", onClick: () => filtrar(["potencial"]) }}
        />
        <KpiCard
          rotulo="Aptas nos dados conferidos"
          valor={number(eligible.length)}
          nota="Acima de R$ 5 mi · fora de qualquer BPO"
          tom="sucesso"
          abrir={{ rotulo: "Filtrar a tabela", onClick: () => filtrar(["elegivel"]) }}
        />
        <KpiCard
          rotulo="Acima de R$ 5 mi · conferir BPO"
          valor={number(counts.confirmar_bpo)}
          nota="Falta identificação ou comprovar serviços"
          abrir={{ rotulo: "Filtrar a tabela", onClick: () => filtrar(["confirmar_bpo"]) }}
        />
        <KpiCard
          rotulo="Faixa atravessa R$ 5 mi"
          valor={number(counts.faixa_limite)}
          nota="Confirmar valor anual e eventuais serviços pendentes"
          abrir={{ rotulo: "Filtrar a tabela", onClick: () => filtrar(["faixa_limite"]) }}
        />
      </KpiGrade>
      <NotaApoio>
        {number(potential.length)} contas no radar = {number(eligible.length)} aptas +{" "}
        {number(counts.confirmar_bpo)} para conferir BPO + {number(counts.faixa_limite)} com faixa
        atravessando o corte. Pendência não equivale a aprovação. Contato e regime não são vetos.
        Conferido em {date(updated)}; veja a data da fonte em cada conta. Seleção e exportação
        somente aqui: o Recon ainda não envia ao Pipedrive.
      </NotaApoio>
      <details className="rounded-lg border bg-card p-4 text-sm">
        <summary className={`cursor-pointer font-medium ${FOCO_VISIVEL}`}>
          De onde saem os números · {number(accounts.length)} contas analisadas
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Grupos sem sobreposição. Uma conta com BPO identificado sai antes da análise do
          faturamento. Contas sem faturamento ou com divergências continuam disponíveis para
          conferência. Cada grupo filtra a tabela abaixo.
        </p>
        <KpiGrade colunas={3} className="mt-3">
          {(Object.entries(GRUPOS_RECON) as [GrupoRecon, string][]).map(([g, label]) => (
            <KpiCard
              key={g}
              rotulo={label}
              valor={number(counts[g])}
              abrir={{ rotulo: "Filtrar a tabela", onClick: () => filtrar([g]) }}
            />
          ))}
        </KpiGrade>
      </details>
      <SecaoCartao
        titulo="Recon · carteira para trabalhar"
        acoes={
          <div className="flex flex-wrap gap-2">
            <BotaoComMotivo
              variant="outline"
              size="sm"
              disabled={!rows.length}
              motivo={!rows.length ? "Nenhuma conta neste filtro" : null}
              onClick={() => exportRows(rows)}
            >
              <Download className="mr-1 h-3 w-3" />
              Exportar filtro ({number(rows.length)})
            </BotaoComMotivo>
            <BotaoComMotivo
              size="sm"
              disabled={!selected.length}
              motivo={!selected.length ? "Marque ao menos uma conta na tabela" : null}
              onClick={() => exportRows(selected)}
            >
              Exportar seleção ({number(selected.length)})
            </BotaoComMotivo>
          </div>
        }
      >
        <span id="recon-tabela" className="block scroll-mt-4" />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Buscar empresa">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className={`${inputClass} pl-8`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome, unidade ou segmento"
              />
            </div>
          </Field>
          <FieldMulti label="Classificação">
            <MultiSelect
              label="Classificação"
              placeholder="Todas as contas"
              value={status}
              onChange={(v) => {
                setStatus(v);
                setLimit(50);
              }}
              options={[
                { value: "potencial", label: "No radar · aptas e pendentes" },
                ...(Object.entries(GRUPOS_RECON) as [GrupoRecon, string][]).map(([g, label]) => ({
                  value: g,
                  label: `${label} (${number(counts[g])})`,
                })),
              ]}
            />
          </FieldMulti>
          <FieldMulti label="Unidade">
            <MultiSelect
              label="Unidade"
              placeholder="Todas as unidades"
              value={unit}
              onChange={(v) => {
                setUnit(v);
                setLimit(50);
              }}
              options={[...new Set(accounts.map((a) => a.unit_label).filter(Boolean) as string[])]
                .sort((a, b) => a.localeCompare(b, "pt-BR"))
                .map((u) => ({ value: u, label: u }))}
            />
          </FieldMulti>
          <FieldMulti label="Contato">
            <MultiSelect
              label="Contato"
              placeholder="Com e sem contato"
              value={contact}
              onChange={(v) => {
                setContact(v);
                setLimit(50);
              }}
              options={[
                { value: "true", label: "Com contato" },
                { value: "false", label: "Obter com o sócio" },
              ]}
            />
          </FieldMulti>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {number(rows.length)} contas no filtro · {number(visiveis)} nesta página · clique na
          empresa para ver os detalhes e as fontes.
          {selected.length > 0 &&
            ` ${number(selected.length)} selecionada(s)${foraDoFiltro ? `, ${number(foraDoFiltro)} fora deste filtro (entram na exportação da seleção)` : ""}.`}{" "}
          O quadrado do cabeçalho marca todas as contas do filtro, inclusive as que ainda não
          aparecem na página.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-3">
                  <input
                    aria-label={rotuloCabecalho}
                    title={rotuloCabecalho}
                    type="checkbox"
                    className={FOCO_VISIVEL}
                    disabled={!rows.length}
                    checked={todasDoFiltro}
                    ref={(el) => {
                      if (el) el.indeterminate = !todasDoFiltro && algumaDoFiltro;
                    }}
                    onChange={(e) =>
                      setPicked(e.target.checked ? new Set(rows.map((a) => a.key)) : new Set())
                    }
                  />
                </th>
                <th className="p-3">Empresa / unidade</th>
                <th className="p-3">Faturamento anual</th>
                <th className="p-3">Serviços contratados</th>
                <th className="p-3">Critério Recon</th>
                <th className="p-3">Contato / outras ofertas</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((a) => (
                <tr className="border-b align-top hover:bg-muted/20" key={a.key}>
                  <td className="p-3">
                    <input
                      aria-label={`Selecionar ${a.name}`}
                      type="checkbox"
                      className={FOCO_VISIVEL}
                      checked={picked.has(a.key)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(a.key);
                          else next.delete(a.key);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      className={`text-left font-medium text-primary-text underline-offset-2 hover:underline ${FOCO_VISIVEL}`}
                      onClick={() => showAccount(a)}
                    >
                      {a.name}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.unit_label || "Unidade a confirmar"} ·{" "}
                      {a.segment || "Segmento a confirmar"}
                    </p>
                  </td>
                  <td className="max-w-xs p-3">
                    {faturamentoRecon(a)}
                    {!!a.recon?.revenue_sources?.length && (
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className={`cursor-pointer ${FOCO_VISIVEL}`}>Ver fonte</summary>
                        {a.recon.revenue_sources.map((source) => (
                          <p key={source} className="mt-1">
                            {source}
                          </p>
                        ))}
                      </details>
                    )}
                  </td>
                  <td className="max-w-xs p-3 text-xs">
                    {a.recon?.products.length
                      ? a.recon.products.join(" · ")
                      : "Serviços a confirmar"}
                  </td>
                  <td className="max-w-sm p-3">
                    <p className="mb-1 text-xs font-semibold">{GRUPOS_RECON[grupoRecon(a)]}</p>
                    <span
                      className={
                        ofertaRecon(a).status === "elegivel"
                          ? "text-xs text-primary-text"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {ofertaRecon(a).reason}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {a.contact ? "Com contato" : "Obter com o sócio"}
                    <p className="mt-1 text-muted-foreground">
                      {PRODUTOS.filter((p) => oferta(a, p).status === "elegivel")
                        .map((p) => NOMES[p])
                        .join(" · ") || "Sem outra oferta confirmada"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EstadoVazio
            titulo="Nenhuma conta neste filtro"
            total={accounts.length}
            acao={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatus(["potencial"]);
                  setQuery("");
                  setUnit([]);
                  setContact([]);
                  setLimit(50);
                }}
              >
                Voltar ao radar
              </Button>
            }
          />
        )}
        {rows.length > limit && (
          <Button className="mt-4" variant="outline" onClick={() => setLimit((v) => v + 50)}>
            Mostrar mais
          </Button>
        )}
      </SecaoCartao>
    </div>
  );
}
