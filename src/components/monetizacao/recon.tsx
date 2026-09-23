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
import { date, downloadCsv, Field, inputClass, Kpi, Notice, number, Panel } from "./common";
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Contas no radar Recon"
          value={number(potential.length)}
          hint="Aptas + pendentes abaixo · contas únicas"
          onClick={() => {
            setStatus(["potencial"]);
            setLimit(50);
          }}
        />
        <Kpi
          label="Aptas nos dados conferidos"
          value={number(eligible.length)}
          hint="Acima de R$ 5 mi · fora de qualquer BPO"
          accent
          onClick={() => {
            setStatus(["elegivel"]);
            setLimit(50);
          }}
        />
        <Kpi
          label="Acima de R$ 5 mi · conferir BPO"
          value={number(counts.confirmar_bpo)}
          hint="Falta identificação ou comprovar serviços"
          onClick={() => {
            setStatus(["confirmar_bpo"]);
            setLimit(50);
          }}
        />
        <Kpi
          label="Faixa atravessa R$ 5 mi"
          value={number(counts.faixa_limite)}
          hint="Confirmar valor anual e eventuais serviços pendentes"
          onClick={() => {
            setStatus(["faixa_limite"]);
            setLimit(50);
          }}
        />
      </div>
      <Notice>
        {number(potential.length)} contas no radar = {number(eligible.length)} aptas +{" "}
        {number(counts.confirmar_bpo)} para conferir BPO + {number(counts.faixa_limite)} com faixa
        atravessando o corte. Pendência não equivale a aprovação. Contato e regime não são vetos.
        Conferido em {date(updated)}; veja a data da fonte em cada conta. Seleção somente no
        Aquário.
      </Notice>
      <details className="rounded-lg border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          De onde saem os números · {number(accounts.length)} contas analisadas
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Grupos sem sobreposição. Uma conta com BPO identificado sai antes da análise do
          faturamento. Contas sem faturamento ou com divergências continuam disponíveis para
          conferência.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(Object.entries(GRUPOS_RECON) as [GrupoRecon, string][]).map(([g, label]) => (
            <button
              key={g}
              className="flex justify-between rounded border p-2 text-left hover:bg-muted/50"
              onClick={() => {
                setStatus([g]);
                setLimit(50);
              }}
            >
              <span>{label}</span>
              <strong>{number(counts[g])}</strong>
            </button>
          ))}
        </div>
      </details>
      <Panel
        title="Recon · carteira para trabalhar"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => exportRows(rows)}>
              <Download className="mr-1 h-3 w-3" />
              Exportar filtro
            </Button>
            <Button size="sm" disabled={!selected.length} onClick={() => exportRows(selected)}>
              Exportar seleção ({selected.length})
            </Button>
          </div>
        }
      >
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
          {number(rows.length)} contas · clique na empresa para ver os detalhes e as fontes.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-3">
                  <input
                    aria-label="Selecionar todas as contas filtradas"
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((a) => picked.has(a.key))}
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
                      className="text-left font-medium text-primary-text underline-offset-2 hover:underline"
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
                        <summary className="cursor-pointer">Ver fonte</summary>
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
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma conta neste filtro.
          </p>
        )}
        {rows.length > limit && (
          <Button className="mt-4" variant="outline" onClick={() => setLimit((v) => v + 50)}>
            Mostrar mais
          </Button>
        )}
      </Panel>
    </div>
  );
}
