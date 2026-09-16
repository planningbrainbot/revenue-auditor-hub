import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normal, oferta } from "@/lib/monetizacao/model";
import { ofertaRecon } from "@/lib/monetizacao/recon";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { Conta } from "@/lib/monetizacao/types";
import { date, downloadCsv, Field, inputClass, Kpi, Notice, number, Panel } from "./common";

export function ReconAquario({
  accounts,
  showAccount,
}: {
  accounts: Conta[];
  showAccount: (a: Conta) => void;
}) {
  const [status, setStatus] = useState("elegivel"),
    [query, setQuery] = useState(""),
    [unit, setUnit] = useState(""),
    [contact, setContact] = useState(""),
    [limit, setLimit] = useState(50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const eligible = accounts.filter((a) => ofertaRecon(a).status === "elegivel");
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
            (!status || ofertaRecon(a).status === status) &&
            (!query ||
              normal([a.name, a.unit_label, a.segment].join(" ")).includes(normal(query))) &&
            (!unit || a.unit_label === unit) &&
            (!contact || String(a.contact) === contact),
        )
        .sort(
          (a, b) =>
            (b.recon?.revenue_min ?? -1) - (a.recon?.revenue_min ?? -1) ||
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
        a.band,
        a.segment,
        a.contact ? "Com contato" : "Obter com o sócio",
        ofertaRecon(a).status,
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Recon · base apta"
          value={number(eligible.length)}
          hint="Acima de R$ 5 mi · fora de qualquer BPO"
          accent
        />
        <Kpi
          label="Excluídas por BPO"
          value={number(checked.filter((a) => a.recon?.bpo_status === "bpo").length)}
          hint="Contábil, fiscal, folha, financeiro e demais BPOs"
        />
        <Kpi
          label="Dados a confirmar"
          value={number(accounts.filter((a) => ofertaRecon(a).status === "revisar").length)}
          hint="Não entram na base apta"
        />
      </div>
      <Notice>
        Base para seleção no Aquário. Nenhum envio ao Pipedrive. Contato e regime tributário não são
        critérios de exclusão do Recon. Conferência dos contratos: {date(updated)}.
      </Notice>
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
          <Field label="Classificação">
            <select
              className={inputClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setLimit(50);
              }}
            >
              <option value="elegivel">Base apta para Recon</option>
              <option value="revisar">Dados a confirmar</option>
              <option value="fora_regra">Fora do perfil</option>
              <option value="">Todas as contas</option>
            </select>
          </Field>
          <Field label="Unidade">
            <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Todas as unidades</option>
              {[...new Set(accounts.map((a) => a.unit_label).filter(Boolean))].sort().map((u) => (
                <option key={u} value={u!}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contato">
            <select
              className={inputClass}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            >
              <option value="">Com e sem contato</option>
              <option value="true">Com contato</option>
              <option value="false">Obter com o sócio</option>
            </select>
          </Field>
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
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => showAccount(a)}
                    >
                      {a.name}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.unit_label || "Unidade a confirmar"} ·{" "}
                      {a.segment || "Segmento a confirmar"}
                    </p>
                  </td>
                  <td className="p-3">{a.band || "A confirmar"}</td>
                  <td className="max-w-xs p-3 text-xs">
                    {a.recon?.products.length
                      ? a.recon.products.join(" · ")
                      : "Serviços a confirmar"}
                  </td>
                  <td className="max-w-sm p-3">
                    <span
                      className={
                        ofertaRecon(a).status === "elegivel"
                          ? "text-xs text-primary"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {ofertaRecon(a).reason}
                    </span>
                  </td>
                  <td className="p-3 text-xs">{a.contact ? "Com contato" : "Obter com o sócio"}</td>
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
