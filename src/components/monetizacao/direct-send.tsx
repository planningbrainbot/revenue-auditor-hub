import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acionarMonetizacao, salvarListaAquario } from "@/lib/monetizacao/functions";
import { disponibilidade, oferta } from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Conta, Produto } from "@/lib/monetizacao/types";
import { useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { Field, inputClass, Notice } from "./common";

export function DirectSend({
  data,
  accounts,
  initialProduct,
  unitId,
  close,
  done,
}: {
  data: BaseMonetizacao;
  accounts: Conta[];
  initialProduct: Produto | "";
  unitId: number | null;
  close: () => void;
  done: () => void;
}) {
  const [product, setProduct] = useState<Produto | "">(initialProduct);
  const [owner, setOwner] = useState(28381245);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof save>> | null>(null);
  const [results, setResults] = useState<{ item: string; status: string; reason?: string }[]>([]);
  const listId = useRef(crypto.randomUUID());
  const running = useRef(false);
  const save = useServerFn(salvarListaAquario),
    action = useServerFn(acionarMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const owners = [
    ...new Map([
      [28381245, "Matheus Carvalho"] as [number, string],
      [27369179, "Samira Vieira"] as [number, string],
      ...data.cards
        .filter((c) => c.owner_id)
        .map((c) => [c.owner_id!, c.owner] as [number, string]),
    ]).entries(),
  ];
  const checks = accounts.map((a) => ({
    account: a,
    result: product ? oferta(a, product) : null,
    available: product
      ? disponibilidade(a, product, data.cards, undefined, data.reservations)
      : null,
  }));
  const ready = checks.filter((c) => c.result?.status === "elegivel" && c.available?.free);
  const send = async () => {
    if (running.current || !product || (!saved && !ready.length)) return;
    running.current = true;
    setBusy(true);
    try {
      const list =
        saved ||
        (await save({
          data: {
            id: listId.current,
            nome: `${NOMES[product]} · envio direto · ${new Date().toLocaleDateString("pt-BR")}`,
            unidade_id:
              unitId ??
              data.units.find(
                (u) => u.id && ready.every(({ account }) => u.account_keys.includes(account.key)),
              )?.id ??
              null,
            owner_id: owner,
            partner: "",
            origin_confirmed: false,
            scan_confirmed: false,
            mode: "draft",
            items: ready.map(({ account }) => ({ account_key: account.key, product, review: {} })),
          },
        }));
      setSaved(list);
      const progress: typeof results = [];
      for (let start = 0; start < list.items.length; start += 10) {
        const reply = await action({
          data: { action: "send", items: list.items.slice(start, start + 10).map((i) => i.id) },
        });
        const batch = reply.results || [];
        progress.push(...batch);
        setResults([...progress]);
        if (
          batch.length !== Math.min(10, list.items.length - start) ||
          batch.some((r) => r.status !== "sent")
        )
          break;
      }
      await invalidate();
      const sent = progress.filter((r) => r.status === "sent").length;
      if (sent === list.items.length) {
        toast.success(`${sent} oportunidade(s) no Pipedrive, com produto preenchido.`);
        done();
      } else
        toast.warning(
          `${sent} envio(s) confirmado(s). Confira os demais resultados na lista salva.`,
        );
    } catch (e) {
      toast.error((e as Error).message);
      await invalidate();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar seleção ao Pipedrive</DialogTitle>
          <DialogDescription>
            {accounts.length} conta(s) selecionada(s). Envio à etapa de entrada de Monetização, sem
            validação obrigatória com a unidade.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Produto específico no Pipedrive">
            <select
              className={inputClass}
              value={product}
              disabled={busy || !!saved}
              onChange={(e) => setProduct(e.target.value as Produto)}
            >
              <option value="">Selecione o produto</option>
              {PRODUTOS.map((p) => (
                <option key={p} value={p}>
                  {NOMES[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsável">
            <select
              className={inputClass}
              value={owner}
              disabled={busy || !!saved}
              onChange={(e) => setOwner(Number(e.target.value))}
            >
              {owners.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
          {checks.map(({ account, result, available }) => (
            <li key={account.key} className="rounded border p-3">
              <strong>{account.name}</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                {!product
                  ? "Escolha o produto para conferir a oportunidade."
                  : result?.status !== "elegivel"
                    ? result?.reason
                    : !available?.free
                      ? available?.reason
                      : `Pronta para enviar · ${NOMES[product]}`}
              </p>
            </li>
          ))}
        </ul>
        {product && ready.length < accounts.length && (
          <Notice>
            {accounts.length - ready.length} conta(s) têm dados pendentes, estão fora do perfil ou
            já têm oportunidade/reserva. Não serão incluídas neste envio. Consulte o motivo acima;
            os dados podem ser completados na lista.
          </Notice>
        )}
        {!!results.length && (
          <ul className="space-y-1 text-xs">
            {results.map((r) => (
              <li key={r.item}>
                {
                  accounts.find(
                    (a) => a.key === saved?.items.find((i) => i.id === r.item)?.account_key,
                  )?.name
                }
                : {r.status === "sent" ? "Enviado" : r.reason || "Conferir envio na lista salva"}
              </li>
            ))}
          </ul>
        )}
        <Button
          onClick={send}
          disabled={busy || !data.permissions.send || (!saved && !ready.length) || !!results.length}
        >
          <Send className="mr-2 h-4 w-4" />
          {busy
            ? "Enviando…"
            : `Enviar ${saved?.items.length ?? ready.length} oportunidade(s) ao Pipedrive`}
        </Button>
        <p className="text-xs text-muted-foreground">
          O campo Caixa · Produto recebe o produto escolhido. O resultado ficará nas listas
          compartilhadas e na operação.
        </p>
      </DialogContent>
    </Dialog>
  );
}
