import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCheck, Download, Plus, Presentation, Save, Search, Send, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acionarMonetizacao, salvarListaAquario } from "@/lib/monetizacao/functions";
import { disponibilidade, FAIXAS, oferta, SITUACOES_RECEITA } from "@/lib/monetizacao/model";
import { CLOSERS, NOMES_ENVIO, PIPES_ENVIO, pipeDoProduto } from "@/lib/monetizacao/types";
import { ofertaEnvio } from "@/lib/monetizacao/recon";
import type {
  BaseMonetizacao,
  Conta,
  ItemLista,
  Lista,
  ProdutoEnvio,
  Unidade,
} from "@/lib/monetizacao/types";
import { useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { cn } from "@/lib/utils";
import { EstadoVazio } from "@/components/planning";
import {
  BotaoComMotivo,
  date,
  downloadCsv,
  Field,
  FOCO_VISIVEL,
  inputClass,
  Notice,
  OfertaTag,
  SecaoCartao,
} from "./common";

type Initial = { unit: Unidade | null; accounts: string[]; product: ProdutoEnvio };
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

// Filtros da coluna de listas: a situação gravada no banco (draft, validated, sent).
const FILTROS_LISTA = [
  ["todas", "Todas"],
  ["draft", "Rascunhos"],
  ["validated", "Validadas"],
  ["sent", "No Pipedrive"],
] as const;
/** Endereço da apresentação de uma lista salva: tela isolada, sem menu, pronta para imprimir. */
const urlApresentacao = (id: string) => `/apresentacao/lista/${id}`;

export function ListWorkspace({
  data,
  initial,
  onConsume,
  showAccount,
  listaAberta,
  aoAbrirLista,
  irParaProdutos,
}: {
  data: BaseMonetizacao;
  initial: Initial | null;
  onConsume: () => void;
  showAccount: (a: Conta) => void;
  /** Lista aberta na URL (`?lista=`): o link abre a mesma lista. */
  listaAberta?: string;
  /** Grava a lista aberta na URL; `null` = nenhuma lista salva aberta. */
  aoAbrirLista?: (id: string | null) => void;
  /** Leva à visão Produtos (estado vazio: é lá que a lista começa). */
  irParaProdutos?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(empty),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [confirmSend, setConfirmSend] = useState(false);
  // Trocar de lista com alterações não salvas pede confirmação (antes, `confirm()` nativo).
  // `null` = nada pendente; `{ abrir: id }` abre a lista salva; `{ abrir: null }` começa outra.
  const [descartar, setDescartar] = useState<{ abrir: string | null } | null>(null);
  const [filtroLista, setFiltroLista] = useState<(typeof FILTROS_LISTA)[number][0]>("todas"),
    [buscaLista, setBuscaLista] = useState("");
  // Confirmar o descarte também fecha o diálogo: sem esta marca, o fechamento desfaria a URL.
  const confirmandoDescarte = useRef(false);
  const save = useServerFn(salvarListaAquario),
    action = useServerFn(acionarMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const by = new Map(data.accounts.map((a) => [a.key, a]));
  // Lido dentro do efeito sem entrar nas dependências dele: o efeito só pode reagir a `initial`,
  // mas precisa enxergar o rascunho de agora para saber se há lista aberta.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!initial) return;
    const inferred =
      initial.unit ||
      data.units.find((u) => u.id && initial.accounts.every((k) => u.account_keys.includes(k))) ||
      null;
    const novos: ItemLista[] = initial.accounts.map((key) => ({
      id: crypto.randomUUID(),
      account_key: key,
      product: initial.product,
      review: {},
      status: "draft",
      deal_id: null,
      reason: null,
    }));
    const aberta = draftRef.current;
    if (!aberta.id) {
      setDraft({
        ...empty(),
        nome: `${NOMES_ENVIO[initial.product]} · ${inferred?.name || "Todas as unidades"}`,
        unidade_id: inferred?.id || null,
        items: novos,
      });
      setSelected(new Set());
      setDirty(true);
      onConsume();
      return;
    }
    // Com uma lista salva aberta, "Preparar lista" SOMA a ela. Antes daqui saía
    // `{ ...empty(), items: novos }`, e `empty()` não tem `id`/`revision`: a lista aberta era
    // descartada em silêncio e o próximo salvar criava outra, porque `persist` manda `id: draft.id`.
    // A chave de unicidade do banco é (list_id, account_key, product) — é por ela que se deduplica.
    const tem = new Set(aberta.items.map((i) => `${i.account_key}|${i.product}`));
    const somar = novos.filter((i) => !tem.has(`${i.account_key}|${i.product}`));
    const repetidas = novos.length - somar.length;
    const jaEstavam = repetidas ? ` · ${repetidas} já estavam na lista` : "";
    if (somar.length) {
      setDraft({ ...aberta, items: [...aberta.items, ...somar] });
      setSelected(new Set());
      setDirty(true);
      toast.success(
        `${somar.length} ${somar.length === 1 ? "conta adicionada" : "contas adicionadas"} a "${aberta.nome}"${jaEstavam}`,
      );
    } else {
      toast.info(`Nada a adicionar: as ${novos.length} já estavam em "${aberta.nome}".`);
    }
    onConsume();
  }, [initial, data.units, onConsume]); // Refetch não substitui rascunho: initial só existe após seleção explícita.
  // Closers que recebem card: Willian Linhares e Matheus Carvalho (Pedro, 29/09). Lista antiga com
  // outro dono continua mostrando o dono dela, para não trocar de responsável em silêncio.
  const owners: [number, string][] = CLOSERS.some(([id]) => id === draft.owner_id)
    ? CLOSERS
    : [...CLOSERS, [draft.owner_id, `Responsável atual (${draft.owner_id})`]];
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
    const result = ofertaEnvio(a, i.product, i.review);
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
  // `null` começa uma lista nova; um id abre a lista salva. A URL acompanha (`?lista=`).
  const trocarPara = (id: string | null) => {
    aoAbrirLista?.(id);
    if (id) return reloadList(id);
    setDraft(empty());
    setDirty(false);
    setSelected(new Set());
  };
  // Link com `?lista=` (ou voltar do navegador) abre a lista, depois que ela chega na carga. Com
  // rascunho não salvo, pergunta antes, como o clique na coluna.
  useEffect(() => {
    if (!listaAberta || listaAberta === draftRef.current.id) return;
    if (!data.lists.some((l) => l.id === listaAberta)) return;
    if (dirty) setDescartar({ abrir: listaAberta });
    else reloadList(listaAberta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaAberta, data.lists]);
  // Por que não dá para editar: sem a chave, ou lista com item já no Pipedrive.
  const motivoTravada = !data.permissions.manage
    ? "Editar lista exige a permissão manage.aquario"
    : locked
      ? "A lista tem oportunidade enviada ao Pipedrive e não pode mais ser editada"
      : null;
  const persist = async (mode: "draft" | "validate"): Promise<string | null> => {
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
      if (res.id !== draft.id) aoAbrirLista?.(res.id);
      await invalidate();
      toast.success(
        mode === "validate"
          ? "Validação opcional registrada. A lista está pronta para seleção."
          : "Lista salva e disponível à equipe.",
      );
      return res.id;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
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
            ofertaEnvio(a, i.product, i.review).status === "elegivel"
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
        NOMES_ENVIO[i.product],
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
  // A apresentação abre numa aba própria, numa URL do Brain (/apresentacao/lista/<id>), no lugar do
  // HTML baixado de antes. Ela lê a lista salva: com alteração não salva, salva o rascunho antes.
  // A aba é aberta no clique (antes do `await`), senão o navegador bloqueia a janela.
  const precisaSalvar = !draft.id || dirty;
  const presentation = async () => {
    if (!precisaSalvar && draft.id) {
      window.open(urlApresentacao(draft.id), "_blank", "noopener");
      return;
    }
    const aba = window.open("about:blank", "_blank");
    const id = await persist("draft");
    if (id && aba) aba.location.href = urlApresentacao(id);
    else aba?.close();
  };
  const listasVisiveis = [...data.lists]
    .reverse()
    .filter((l) => filtroLista === "todas" || l.status === filtroLista)
    .filter(
      (l) =>
        !buscaLista.trim() ||
        `${l.nome} ${l.unidade_nome ?? ""}`.toLowerCase().includes(buscaLista.trim().toLowerCase()),
    );
  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <SecaoCartao
        titulo="Listas compartilhadas"
        acoes={
          <Button
            size="icon"
            variant="ghost"
            aria-label="Nova lista"
            onClick={() => {
              // Mesmo portão do botão de trocar de lista, logo abaixo: abrir uma lista nova
              // descarta o rascunho em andamento, e isso não pode acontecer em silêncio.
              if (dirty) setDescartar({ abrir: null });
              else trocarPara(null);
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        }
      >
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Situação das listas">
            {FILTROS_LISTA.map(([k, rotulo]) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={filtroLista === k ? "secondary" : "ghost"}
                aria-pressed={filtroLista === k}
                onClick={() => setFiltroLista(k)}
                className={filtroLista === k ? "border border-input" : "text-muted-foreground"}
              >
                {rotulo}
              </Button>
            ))}
          </div>
          <label className="relative block">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              aria-label="Buscar lista por nome ou unidade"
              className={`${inputClass} pl-8`}
              value={buscaLista}
              onChange={(e) => setBuscaLista(e.target.value)}
              placeholder="Nome ou unidade"
            />
          </label>
        </div>
        <div className="space-y-2">
          {listasVisiveis.length ? (
            listasVisiveis.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-current={draft.id === l.id ? "true" : undefined}
                onClick={() => {
                  if (dirty) setDescartar({ abrir: l.id });
                  else trocarPara(l.id);
                }}
                className={cn(
                  "w-full rounded-lg border p-3 text-left",
                  FOCO_VISIVEL,
                  // A lista aberta mantém a borda da marca; o hover só vale para as outras.
                  draft.id === l.id ? "border-primary bg-primary/5" : "hover:border-input",
                )}
              >
                <strong className="block text-sm">{l.nome}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {l.items.length} ofertas · {statusNames[l.status]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {l.unidade_nome} · {date(l.updated_at)}
                </span>
              </button>
            ))
          ) : data.lists.length ? (
            <p className="text-xs text-muted-foreground">Nenhuma lista neste filtro.</p>
          ) : (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                Nenhuma lista salva. Em Produtos, selecione as contas e prepare a primeira lista.
              </p>
              {irParaProdutos && (
                <Button size="sm" variant="outline" onClick={irParaProdutos}>
                  Ir para Produtos
                </Button>
              )}
            </div>
          )}
        </div>
      </SecaoCartao>
      <div className="space-y-4">
        <SecaoCartao
          titulo={draft.nome || "1. Preparar lista"}
          acoes={
            <div className="flex flex-wrap gap-2">
              <BotaoComMotivo
                variant="outline"
                size="sm"
                disabled={!draft.items.length || busy || (precisaSalvar && locked)}
                motivo={
                  !draft.items.length
                    ? "A lista ainda não tem empresas"
                    : precisaSalvar && locked
                      ? "Salve a lista para abrir a apresentação; seu acesso não permite salvar."
                      : precisaSalvar
                        ? "Salva o rascunho e abre a apresentação numa aba nova."
                        : "Abre a apresentação numa aba nova, pronta para imprimir ou salvar em PDF."
                }
                onClick={() => void presentation()}
              >
                <Presentation className="mr-1 h-4 w-4" />
                {precisaSalvar ? "Salvar e apresentar" : "Apresentação"}
              </BotaoComMotivo>
              <BotaoComMotivo
                variant="outline"
                size="sm"
                disabled={!draft.items.length}
                motivo={!draft.items.length ? "A lista ainda não tem empresas" : null}
                onClick={() => downloadCsv("lista-para-socio.csv", exportRows())}
              >
                <Download className="mr-1 h-4 w-4" />
                CSV
              </BotaoComMotivo>
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
            <Field label="Closer no Pipedrive">
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
            <EstadoVazio
              titulo="Lista sem empresas"
              descricao="Selecione empresas em Base de clientes e clique em Preparar lista, ou abra uma lista compartilhada."
            />
          ) : (
            <div className="space-y-3">
              {draft.items.map((i, idx) => {
                const a = by.get(i.account_key),
                  r = a ? ofertaEnvio(a, i.product, i.review) : null,
                  savedItem = persisted?.items.find(
                    (s) => s.account_key === i.account_key && s.product === i.product,
                  );
                return (
                  <div key={i.id} className="rounded-lg border p-3">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          className={`text-left text-sm font-semibold hover:text-primary-text hover:underline ${FOCO_VISIVEL}`}
                          onClick={() => a && showAccount(a)}
                        >
                          {a?.name || "Conta fora do escopo"}
                        </button>
                        <span className="ml-2 text-xs font-medium text-primary-text">
                          {NOMES_ENVIO[i.product]}
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
                    {a?.situacao_receita && a.situacao_receita !== "ativa" && (
                      <div className="mt-2">
                        <Field label="Situação na Receita">
                          <select
                            className={inputClass}
                            value={i.review.situacao_receita || a.situacao_receita}
                            disabled={locked}
                            onChange={(e) => updateReview(idx, "situacao_receita", e.target.value)}
                          >
                            {Object.entries(SITUACOES_RECEITA).map(([v, label]) => (
                              <option key={v} value={v}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {a.situacao_receita_fonte || "Consulta em lote da Receita"}. Marque
                            &quot;Ativa&quot; só com a inscrição regularizada conferida — é o que
                            libera a conta para oferta.
                          </p>
                        </Field>
                      </div>
                    )}
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
                          r?.status === "elegivel" ? "text-muted-foreground" : "text-warning"
                        }
                      >
                        {r?.reason}{" "}
                        {a?.contact ? "Contato cadastrado." : "Contato: obter com o sócio."}
                      </p>
                      {savedItem && (
                        <div>
                          {savedItem.deal_id ? (
                            <a
                              className={`text-primary-text underline ${FOCO_VISIVEL}`}
                              href={`https://grupoplanning.pipedrive.com/deal/${savedItem.deal_id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir oportunidade #{savedItem.deal_id}
                            </a>
                          ) : (
                            <span>{statusNames[savedItem.status]}</span>
                          )}
                          {savedItem.reason && <p className="text-warning">{savedItem.reason}</p>}
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
              <BotaoComMotivo
                onClick={() => persist("draft")}
                disabled={busy || locked || !dirty}
                motivo={[
                  busy && "Aguarde: há uma gravação ou envio em andamento",
                  motivoTravada,
                  !dirty && "Nada mudou desde o último salvamento",
                ]}
              >
                <Save className="mr-2 h-4 w-4" />
                Salvar lista
              </BotaoComMotivo>
            </div>
          )}
        </SecaoCartao>
        {!!draft.items.length && (
          <details className="rounded-lg border bg-card p-4">
            <summary className={`cursor-pointer text-sm font-medium ${FOCO_VISIVEL}`}>
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
                  className={FOCO_VISIVEL}
                  checked={draft.origin_confirmed}
                  disabled={locked}
                  onChange={(e) => change({ origin_confirmed: e.target.checked })}
                />
                O sócio confirmou as oportunidades. Consultoria exige Base Antiga comprovada, sem
                fechamento pelo comercial e fora do Simples.
              </label>
              {issues.length > 0 && (
                <details className="text-xs text-warning">
                  <summary className={cn("cursor-pointer", FOCO_VISIVEL)}>
                    {issues.length} pendência(s) antes da validação
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {issues.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </details>
              )}
              <BotaoComMotivo
                onClick={() => persist("validate")}
                disabled={
                  busy ||
                  locked ||
                  !!issues.length ||
                  !draft.origin_confirmed ||
                  draft.partner.trim().length < 3
                }
                motivo={[
                  busy && "Aguarde: há uma gravação ou envio em andamento",
                  motivoTravada,
                  !!issues.length &&
                    `Resolva ${issues.length} pendência(s) antes (lista acima do botão)`,
                  draft.partner.trim().length < 3 && "Informe o sócio que validou (3+ letras)",
                  !draft.origin_confirmed && "Marque a confirmação do sócio",
                ]}
              >
                <CheckCheck className="mr-2 h-4 w-4" />
                Registrar validação
              </BotaoComMotivo>
              <p className="text-xs text-muted-foreground">
                Este registro é opcional e não bloqueia o envio direto. As regras do produto e os
                dados da oportunidade são conferidos no envio.
              </p>
            </div>
          </details>
        )}
        {persisted && (
          <SecaoCartao titulo="Enviar oportunidades selecionadas ao Pipedrive">
            <div className="space-y-2">
              {!!sendable.length && (
                <BotaoComMotivo
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(new Set(sendable.map((i) => i.id)))}
                  disabled={busy || !data.permissions.send}
                  motivo={[
                    !data.permissions.send && "Enviar exige a permissão send.monetizacao",
                    busy && "Aguarde: há uma gravação ou envio em andamento",
                  ]}
                >
                  Selecionar todas as aptas ({sendable.length})
                </BotaoComMotivo>
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
                        className={FOCO_VISIVEL}
                        checked={selected.has(i.id)}
                        disabled={!data.permissions.send || busy}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(i.id);
                          else next.delete(i.id);
                          setSelected(next);
                        }}
                      />
                      {a?.name} · {NOMES_ENVIO[i.product]}
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
              <BotaoComMotivo
                disabled={!sendingItems.length || busy || !data.permissions.send}
                motivo={[
                  !data.permissions.send && "Enviar exige a permissão send.monetizacao",
                  busy && "Aguarde: há uma gravação ou envio em andamento",
                  !sendingItems.length && "Marque ao menos uma oportunidade apta acima",
                ]}
                onClick={() => setConfirmSend(true)}
              >
                <Send className="mr-2 h-4 w-4" />
                Enviar ao Pipedrive ({sendingItems.length})
              </BotaoComMotivo>
              <p className="text-xs text-muted-foreground">
                O pipe sai do produto de cada oportunidade: Consultoria, Finance e Cella vão para{" "}
                {PIPES_ENVIO.caixa.nome} (pipe {PIPES_ENVIO.caixa.id}), com o campo “Caixa ·
                Produto”; Recon vai para o pipe {PIPES_ENVIO.recon.id}. Somente os itens
                selecionados são enviados à etapa de entrada. Negócios existentes são vinculados;
                respostas incertas ficam bloqueadas para conferência.
              </p>
            </div>
          </SecaoCartao>
        )}
      </div>
      <AlertDialog
        open={!!descartar}
        onOpenChange={(o) => {
          if (o) return;
          // Cancelar um link (?lista=) devolve a URL à lista que continua aberta.
          if (!confirmandoDescarte.current && descartar?.abrir && descartar.abrir !== draft.id)
            aoAbrirLista?.(draft.id ?? null);
          confirmandoDescarte.current = false;
          setDescartar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Descartar as alterações de “{draft.nome || "lista sem nome"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {descartar?.abrir
                ? "Há alterações não salvas. Abrir outra lista joga fora o que mudou desde o último salvamento."
                : "Há alterações não salvas. Começar outra lista joga fora o que mudou desde o último salvamento."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                const alvo = descartar;
                confirmandoDescarte.current = true;
                setDescartar(null);
                if (alvo) trocarPara(alvo.abrir);
              }}
            >
              Descartar alterações
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar {sendingItems.length} oportunidade(s)?</DialogTitle>
            <DialogDescription>
              Lista {draft.nome} · {listUnit} · closer{" "}
              {owners.find(([id]) => id === draft.owner_id)?.[1]}. As oportunidades serão criadas na
              etapa de entrada de{" "}
              {[...new Set(sendingItems.map((i) => pipeDoProduto(i.product)))]
                .map(
                  (k) =>
                    `${PIPES_ENVIO[k].nome} (pipe ${PIPES_ENVIO[k].id}, etapa ${PIPES_ENVIO[k].entrada})`,
                )
                .join(" e ")}
              .
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 overflow-y-auto space-y-1 text-sm">
            {sendingItems.map((i) => (
              <li key={i.id}>
                {by.get(i.account_key)?.name} · {NOMES_ENVIO[i.product]}
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
