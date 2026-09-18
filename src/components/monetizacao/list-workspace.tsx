import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCheck, Download, Plus, Presentation, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acionarMonetizacao, salvarListaAquario } from "@/lib/monetizacao/functions";
import { disponibilidade, FAIXAS, oferta } from "@/lib/monetizacao/model";
import { NOMES } from "@/lib/monetizacao/types";
import type {
  BaseMonetizacao,
  Conta,
  ItemLista,
  Lista,
  Produto,
  Unidade,
} from "@/lib/monetizacao/types";
import { useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { date, downloadCsv, Field, inputClass, Notice, OfertaTag, Panel } from "./common";

type Initial = { unit: Unidade | null; accounts: string[]; product: Produto };
type Draft = {
  id?: string;
  revision?: number;
  nome: string;
  unidade_id: number | null;
  owner_id: number;
  partner: string;
  origin_confirmed: boolean;
  scan_confirmed: boolean;
  items: ItemLista[];
  status: string;
};
const draftFrom = (l: Lista): Draft => ({
  ...l,
  owner_id: (l as Lista & { owner_id: number }).owner_id,
  partner: l.partner || "",
  origin_confirmed: (l as Lista & { origin_confirmed: boolean }).origin_confirmed,
  scan_confirmed: (l as Lista & { scan_confirmed: boolean }).scan_confirmed,
});
const empty = (): Draft => ({
  nome: "",
  unidade_id: null,
  owner_id: 28381245,
  partner: "",
  origin_confirmed: false,
  scan_confirmed: false,
  items: [],
  status: "draft",
});
const statusNames: Record<string, string> = {
  draft: "Rascunho",
  validated: "Validada com o sócio",
  sending: "Enviando",
  sent: "No Pipedrive",
  uncertain: "Conferir envio",
  blocked: "Revisar envio",
};

export function ListWorkspace({
  data,
  initial,
  onConsume,
  showAccount,
}: {
  data: BaseMonetizacao;
  initial: Initial | null;
  onConsume: () => void;
  showAccount: (a: Conta) => void;
}) {
  const [draft, setDraft] = useState<Draft>(empty),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [confirmSend, setConfirmSend] = useState(false);
  const save = useServerFn(salvarListaAquario),
    action = useServerFn(acionarMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const by = new Map(data.accounts.map((a) => [a.key, a]));
  useEffect(() => {
    if (!initial) return;
    const inferred =
      initial.unit ||
      data.units.find((u) => u.id && initial.accounts.every((k) => u.account_keys.includes(k))) ||
      null;
    setDraft({
      ...empty(),
      nome: `${NOMES[initial.product]} · ${inferred?.name || "Todas as unidades"}`,
      unidade_id: inferred?.id || null,
      items: initial.accounts.map((key) => ({
        id: crypto.randomUUID(),
        account_key: key,
        product: initial.product,
        review: {},
        status: "draft",
        deal_id: null,
        reason: null,
      })),
    });
    setSelected(new Set());
    setDirty(true);
    onConsume();
  }, [initial, data.units, onConsume]); // Refetch não substitui rascunho: initial só existe após seleção explícita.
  const owners = [
    ...new Map([
      [28381245, "Matheus Carvalho"],
      [27369179, "Samira Vieira"],
      ...data.cards
        .filter((c) => c.owner_id)
        .map((c) => [c.owner_id!, c.owner] as [number, string]),
    ]).entries(),
  ];
  const locked =
    draft.items.some((i) => ["sending", "sent", "uncertain"].includes(i.status)) ||
    !data.permissions.manage;
  const change = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch, status: "draft" });
    setDirty(true);
  };
  const updateReview = (index: number, field: string, value: string) =>
    change({
      items: draft.items.map((i, idx) =>
        idx === index ? { ...i, review: { ...i.review, [field]: value } } : i,
      ),
    });
  const issues = draft.items.flatMap((i) => {
    const a = by.get(i.account_key);
    if (!a) return ["Conta indisponível no seu escopo"];
    const result = oferta(a, i.product, i.review);
    return result.status !== "elegivel" ? [`${a.name}: ${result.reason}`] : [];
  });
  const reloadList = (id: string) => {
    const l = data.lists.find((l) => l.id === id);
    if (l) {
      setDraft(draftFrom(l));
      setDirty(false);
      setSelected(new Set());
    }
  };
  const persist = async (mode: "draft" | "validate") => {
    setBusy(true);
    try {
      const res = await save({
        data: {
          id: draft.id,
          revision: draft.revision,
          nome: draft.nome,
          unidade_id: draft.unidade_id,
          owner_id: draft.owner_id,
          partner: draft.partner,
          origin_confirmed: draft.origin_confirmed,
          scan_confirmed: draft.scan_confirmed,
          mode,
          items: draft.items.map(({ account_key, product, review }) => ({
            account_key,
            product,
            review,
          })),
        },
      });
      setDraft({
        ...draft,
        id: res.id,
        revision: res.revision,
        status: mode === "validate" ? "validated" : "draft",
      });
      setDirty(false);
      await invalidate();
      toast.success(
        mode === "validate"
          ? "Validação opcional registrada. A lista está pronta para seleção."
          : "Lista salva e disponível à equipe.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Itens confirmados pelo banco são a única fonte para os IDs enviados ao CRM.
  const persisted = data.lists.find((l) => l.id === draft.id);
  useEffect(() => {
    if (!dirty && persisted && persisted.revision >= (draft.revision || 0)) {
      setDraft(draftFrom(persisted));
    }
  }, [persisted, dirty, draft.revision]);
  const sendable =
    !dirty && persisted && ["draft", "validated"].includes(persisted.status)
      ? persisted.items.filter((i) => {
          const a = by.get(i.account_key);
          return (
            ["draft", "validated", "blocked"].includes(i.status) &&
            a &&
            oferta(a, i.product, i.review).status === "elegivel"
          );
        })
      : [];
  const sendingItems = sendable.filter((i) => selected.has(i.id));
  const send = async () => {
    setConfirmSend(false);
    setBusy(true);
    try {
      let pending = 0;
      for (let n = 0; n < sendingItems.length; n += 1) {
        try {
          const res = await action({ data: { action: "send", items: [sendingItems[n].id] } });
          pending +=
            res.results?.filter((r) => r.status !== "sent" || r.handoff?.status !== "complete")
              .length ?? 1;
        } catch {
          pending += 1;
        }
      }
      setSelected(new Set());
      await invalidate();
      if (pending)
        toast.warning(
          `${pending} oportunidade(s) com pendências. Confira o card e complete os dados pela lista.`,
        );
      else toast.success("Cards preparados no Pipedrive. Consulte os links na lista.");
    } catch (e) {
      toast.error((e as Error).message);
      await invalidate();
    } finally {
      setBusy(false);
    }
  };
  const listUnit =
    data.units.find((u) => u.id !== null && u.id === draft.unidade_id)?.name || "Todas as unidades";
  const exportRows = () => [
    [
      "Lista",
      "Unidade",
      "Empresa",
      "Produto",
      "Faturamento anual",
      "Segmento",
      "Regime",
      "Contato",
      "Outra oferta",
      "Observação",
      "Validação",
      "Sócio",
    ],
    ...draft.items.map((i) => {
      const a = by.get(i.account_key);
      return [
        draft.nome,
        listUnit,
        a?.name,
        NOMES[i.product],
        i.review.band || a?.band,
        i.review.segment || a?.segment,
        i.review.regime || a?.regime,
        a?.contact ? "Com contato" : "Obter com o sócio",
        a && oferta(a, "finance").status === "elegivel" && i.product !== "finance"
          ? "Finance · perfil aderente"
          : "",
        i.review.note,
        statusNames[draft.status],
        draft.partner,
      ];
    }),
  ];
  const presentation = () => {
    const esc = (s: unknown) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
      );
    const content = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(draft.nome)}</title><style>body{font:15px system-ui;color:#19362a;max-width:1100px;margin:40px auto;padding:24px}header{border-bottom:3px solid #03784a;padding-bottom:24px}h1{margin:12px 0}small,p{color:#61776b}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{text-align:left;padding:14px 10px;border-bottom:1px solid #d9e5de;font-size:13px}th{background:#edf5ef}aside{padding:16px;border:1px solid #bcd8c6;margin-top:24px}button{padding:10px;margin:10px 0}@media print{button{display:none}body{margin:0}}</style><header><img alt="Caixa de Oportunidade" width="235" src="${location.origin}/brand/caixa/assinatura-horizontal.svg"><p>Planning · Clientes / Aquário</p><h1>${esc(draft.nome)}</h1><p>${esc(listUnit)} · ${draft.items.length} oportunidades · ${esc(statusNames[draft.status])}</p></header><button onclick="window.print()">Imprimir / salvar PDF</button><table><thead><tr><th>Empresa</th><th>Produto</th><th>Faturamento</th><th>Segmento / regime</th><th>Próximo passo</th></tr></thead><tbody>${draft.items
      .map((i) => {
        const a = by.get(i.account_key);
        return `<tr><td>${esc(a?.name)}<br><small>${a?.contact ? "Com contato" : "Contato: obter com o sócio"}</small></td><td>${esc(NOMES[i.product])}${a && i.product !== "finance" && oferta(a, "finance").status === "elegivel" ? "<br><small>Também atende a Finance</small>" : ""}</td><td>${esc(i.review.band || a?.band || "A confirmar")}</td><td>${esc(i.review.segment || a?.segment || "A confirmar")}<br><small>${esc(i.review.regime || a?.regime)}</small></td><td>${esc(i.review.note || "Validar oportunidade com o sócio")}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table><aside>Contas únicas: ${new Set(draft.items.map((i) => i.account_key)).size}. Uma empresa pode ter mais de uma oferta. Sócio: ${esc(draft.partner || "A registrar")}. ${dirty ? "Rascunho com alterações ainda não salvas." : "Registro: " + esc(statusNames[draft.status])}</aside><p>Gerado em ${new Date().toLocaleString("pt-BR")} · Uso interno Planning.</p></html>`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = (draft.nome || "lista-para-socio").replace(/[^\p{L}\p{N} -]/gu, "") + ".html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <Panel
        title="Listas compartilhadas"
        action={
          <Button
            size="icon"
            variant="ghost"
            aria-label="Nova lista"
            onClick={() => {
              setDraft(empty());
              setDirty(false);
              setSelected(new Set());
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        }
      >
        <div className="space-y-2">
          {data.lists.length ? (
            [...data.lists].reverse().map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  if (
                    dirty &&
                    !window.confirm("Há alterações não salvas. Descartar e abrir outra lista?")
                  )
                    return;
                  reloadList(l.id);
                }}
                className={`w-full rounded-lg border p-3 text-left hover:border-primary ${draft.id === l.id ? "border-primary bg-primary/5" : ""}`}
              >
                <strong className="block text-sm">{l.nome}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {l.items.length} ofertas · {statusNames[l.status]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {l.unidade_nome} · {date(l.updated_at)}
                </span>
              </button>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Abra uma unidade, selecione as empresas e prepare a primeira lista.
            </p>
          )}
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel
          title={draft.nome || "1. Preparar lista"}
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!draft.items.length}
                onClick={presentation}
              >
                <Presentation className="mr-1 h-4 w-4" />
                Apresentação
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!draft.items.length}
                onClick={() => downloadCsv("lista-para-socio.csv", exportRows())}
              >
                <Download className="mr-1 h-4 w-4" />
                CSV
              </Button>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome da lista">
              <input
                className={inputClass}
                value={draft.nome}
                disabled={locked}
                onChange={(e) => change({ nome: e.target.value })}
              />
            </Field>
            <Field label="Unidade">
              <select
                className={inputClass}
                disabled={locked}
                value={draft.unidade_id || ""}
                onChange={(e) => change({ unidade_id: Number(e.target.value) || null })}
              >
                <option value="">Todas as unidades</option>
                {data.units
                  .filter((u) => u.id)
                  .map((u) => (
                    <option key={u.key} value={u.id!}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Hunter no Pipedrive">
              <select
                className={inputClass}
                value={draft.owner_id}
                disabled={locked}
                onChange={(e) => change({ owner_id: Number(e.target.value) })}
              >
                {owners.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="my-3 text-xs text-muted-foreground">
            {new Set(draft.items.map((i) => i.account_key)).size} contas únicas ·{" "}
            {draft.items.length} ofertas ·{" "}
            {dirty ? "Alterações não salvas" : statusNames[draft.status]}
          </p>
          {!draft.items.length ? (
            <Notice>
              Selecione empresas em Carteiras por unidade ou Todas as contas e clique em Preparar
              lista.
            </Notice>
          ) : (
            <div className="space-y-3">
              {draft.items.map((i, idx) => {
                const a = by.get(i.account_key),
                  r = a ? oferta(a, i.product, i.review) : null,
                  savedItem = persisted?.items.find(
                    (s) => s.account_key === i.account_key && s.product === i.product,
                  );
                return (
                  <div key={i.id} className="rounded-lg border p-3">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <button
                          className="text-left text-sm font-semibold hover:text-primary hover:underline"
                          onClick={() => a && showAccount(a)}
                        >
                          {a?.name || "Conta fora do escopo"}
                        </button>
                        <span className="ml-2 text-xs font-medium text-primary">
                          {NOMES[i.product]}
                        </span>
                        {a && (
                          <div className="mt-1 flex gap-1">
                            <OfertaTag account={a} product="cella" />
                            <OfertaTag account={a} product="consultoria" />
                            <OfertaTag account={a} product="finance" />
                          </div>
                        )}
                      </div>
                      {!locked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover ${a?.name}`}
                          onClick={() => change({ items: draft.items.filter((_, n) => n !== idx) })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label="Faturamento anual">
                        <select
                          className={inputClass}
                          value={i.review.band || a?.band || ""}
                          disabled={locked}
                          onChange={(e) => updateReview(idx, "band", e.target.value)}
                        >
                          <option value="">Confirmar com o sócio</option>
                          {Object.keys(FAIXAS).map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Segmento">
                        <input
                          className={inputClass}
                          value={i.review.segment || a?.segment || ""}
                          disabled={locked}
                          onChange={(e) => updateReview(idx, "segment", e.target.value)}
                        />
                      </Field>
                      <Field label="Regime">
                        <select
                          className={inputClass}
                          value={i.review.regime || a?.regime || ""}
                          disabled={locked}
                          onChange={(e) => updateReview(idx, "regime", e.target.value)}
                        >
                          <option value="">Confirmar regime</option>
                          {[
                            "Lucro Real",
                            "Lucro Presumido",
                            "Lucro Arbitrado",
                            "Simples Nacional",
                            "MEI",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="mt-2">
                      <Field label="Oportunidade e próximo passo para o sócio">
                        <input
                          className={inputClass}
                          value={i.review.note || ""}
                          disabled={locked}
                          onChange={(e) => updateReview(idx, "note", e.target.value)}
                          placeholder="Tese, necessidade ou ajuda que o sócio pode oferecer"
                        />
                      </Field>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p
                        className={
                          r?.status === "elegivel" ? "text-muted-foreground" : "text-amber-600"
                        }
                      >
                        {r?.reason}{" "}
                        {a?.contact ? "Contato cadastrado." : "Contato: obter com o sócio."}
                      </p>
                      {savedItem && (
                        <div>
                          {savedItem.deal_id ? (
                            <a
                              className="text-primary underline"
                              href={`https://grupoplanning.pipedrive.com/deal/${savedItem.deal_id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir oportunidade #{savedItem.deal_id}
                            </a>
                          ) : (
                            <span>{statusNames[savedItem.status]}</span>
                          )}
                          {savedItem.reason && <p className="text-amber-600">{savedItem.reason}</p>}
                          {savedItem.status === "sent" && data.permissions.send && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const reply = await action({
                                    data: { action: "send", items: [savedItem.id] },
                                  });
                                  const report = reply.results?.[0]?.handoff;
                                  if (report?.status === "complete")
                                    toast.success(
                                      `Card completo: ${report.people || 0} contato(s), ${report.notes || 0} nota(s), ${report.files || 0} arquivo(s).`,
                                    );
                                  else
                                    toast.warning(
                                      report?.errors?.join(" ") ||
                                        "Preenchimento em andamento. O card existente foi preservado.",
                                    );
                                  await invalidate();
                                } catch (e) {
                                  toast.error((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Completar dados do card
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!!draft.items.length && (
            <div className="mt-4">
              <Button onClick={() => persist("draft")} disabled={busy || locked || !dirty}>
                <Save className="mr-2 h-4 w-4" />
                Salvar lista
              </Button>
            </div>
          )}
        </Panel>
        {!!draft.items.length && (
          <details className="rounded-lg border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Registrar validação com o sócio · opcional
            </summary>
            <div className="space-y-3">
              {draft.status === "sent" && issues.length > 0 && (
                <Notice>
                  {issues.length} itens desta lista histórica não atendem à regra atual ou têm dados
                  pendentes. Eles não integram a base apta de Consultoria.
                </Notice>
              )}
              <Field label="Sócio que validou">
                <input
                  className={inputClass}
                  value={draft.partner}
                  disabled={locked}
                  onChange={(e) => change({ partner: e.target.value })}
                  placeholder="Nome do sócio"
                />
              </Field>
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft.origin_confirmed}
                  disabled={locked}
                  onChange={(e) => change({ origin_confirmed: e.target.checked })}
                />
                O sócio confirmou as oportunidades. Consultoria exige Base Antiga comprovada, sem
                fechamento pelo comercial e fora do Simples.
              </label>
              {issues.length > 0 && (
                <details className="text-xs text-amber-600">
                  <summary>{issues.length} pendência(s) antes da validação</summary>
                  <ul className="mt-2 space-y-1">
                    {issues.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </details>
              )}
              <Button
                onClick={() => persist("validate")}
                disabled={
                  busy ||
                  locked ||
                  !!issues.length ||
                  !draft.origin_confirmed ||
                  draft.partner.trim().length < 3
                }
              >
                <CheckCheck className="mr-2 h-4 w-4" />
                Registrar validação
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Este registro é opcional e não bloqueia o envio direto. As regras do produto e os
                dados da oportunidade são conferidos no envio.
              </p>
            </div>
          </details>
        )}
        {persisted && (
          <Panel title="Enviar oportunidades selecionadas ao Pipedrive">
            <div className="space-y-2">
              {!!sendable.length && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(new Set(sendable.map((i) => i.id)))}
                  disabled={busy || !data.permissions.send}
                >
                  Selecionar todas as aptas ({sendable.length})
                </Button>
              )}
              {sendable.map((i) => {
                const a = by.get(i.account_key),
                  available = a
                    ? disponibilidade(a, i.product, data.cards, undefined, data.reservations)
                    : null;
                return (
                  <label
                    key={i.id}
                    className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(i.id)}
                        disabled={!data.permissions.send || busy}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(i.id);
                          else next.delete(i.id);
                          setSelected(next);
                        }}
                      />
                      {a?.name} · {NOMES[i.product]}
                    </span>
                    <span className="text-xs text-muted-foreground">{available?.reason}</span>
                  </label>
                );
              })}
              {!sendable.length && (
                <p className="text-sm text-muted-foreground">
                  {dirty
                    ? "Salve as alterações para enviar os dados atuais. Não é necessária validação com o sócio."
                    : "Nenhuma oportunidade apta aguardando envio. Confira os dados e os motivos acima."}
                </p>
              )}
              <Button
                disabled={!sendingItems.length || busy || !data.permissions.send}
                onClick={() => setConfirmSend(true)}
              >
                <Send className="mr-2 h-4 w-4" />
                Enviar ao Pipedrive ({sendingItems.length})
              </Button>
              <p className="text-xs text-muted-foreground">
                O campo “Caixa · Produto” receberá o produto exibido em cada oportunidade. Somente
                os itens selecionados serão enviados à etapa de entrada. Negócios existentes são
                vinculados; respostas incertas ficam bloqueadas para conferência.
              </p>
            </div>
          </Panel>
        )}
      </div>
      <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar {sendingItems.length} oportunidade(s)?</DialogTitle>
            <DialogDescription>
              Lista {draft.nome} · {listUnit} · responsável{" "}
              {owners.find(([id]) => id === draft.owner_id)?.[1]}. As oportunidades serão criadas na
              etapa de entrada do pipe de Monetização.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 overflow-y-auto space-y-1 text-sm">
            {sendingItems.map((i) => (
              <li key={i.id}>
                {by.get(i.account_key)?.name} · {NOMES[i.product]}
              </li>
            ))}
          </ul>
          <Button onClick={send} disabled={busy}>
            Confirmar envio ao Pipedrive
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
