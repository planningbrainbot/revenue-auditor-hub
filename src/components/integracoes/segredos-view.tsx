import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, CheckCircle2, AlertCircle, Plug, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  listarSegredos,
  salvarSegredo,
  apagarSegredo,
  testarAsaas,
  CHAVES_CONHECIDAS,
  type SegredoStatus,
} from "@/lib/integracoes-segredos.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const quando = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function SegredosView() {
  const qc = useQueryClient();
  const carregar = useServerFn(listarSegredos);
  const fnSalvar = useServerFn(salvarSegredo);
  const fnApagar = useServerFn(apagarSegredo);
  const fnTestar = useServerFn(testarAsaas);

  const { data, isLoading, error } = useQuery({
    queryKey: ["integracoes-segredos"],
    queryFn: () => carregar(),
  });

  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [visivel, setVisivel] = useState<Record<string, boolean>>({});
  const [teste, setTeste] = useState<{ ok: boolean; detalhe: string } | null>(null);

  const recarregar = () => qc.invalidateQueries({ queryKey: ["integracoes-segredos"] });
  const aoFalhar = (e: unknown) => toast.error(e instanceof Error ? e.message : "Falhou.");

  const mSalvar = useMutation({
    mutationFn: (d: { chave: string; valor: string }) => fnSalvar({ data: d }),
    onSuccess: (_r, d) => {
      toast.success("Guardado. O valor não volta para a tela.");
      setRascunho((r) => ({ ...r, [d.chave]: "" }));
      setTeste(null);
      recarregar();
    },
    onError: aoFalhar,
  });
  const mApagar = useMutation({
    mutationFn: (d: { chave: string }) => fnApagar({ data: d }),
    onSuccess: () => {
      toast.success("Removido.");
      setTeste(null);
      recarregar();
    },
    onError: aoFalhar,
  });
  const mTestar = useMutation({
    mutationFn: () => fnTestar(),
    onSuccess: (r) => {
      setTeste(r);
      if (r.ok) toast.success(r.detalhe);
      else toast.error(r.detalhe);
    },
    onError: aoFalhar,
  });

  const porChave = useMemo(
    () => new Map((data?.status ?? []).map((s: SegredoStatus) => [s.chave, s])),
    [data?.status],
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (error)
    return (
      <Card className="border-destructive/40 p-4">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Falha ao carregar."}
        </p>
      </Card>
    );

  const grupos = [...new Set(CHAVES_CONHECIDAS.map((c) => c.grupo))];
  const asaasPronto =
    porChave.get("ASAAS_API_KEY")?.configurado && porChave.get("ASAAS_WEBHOOK_TOKEN")?.configurado;

  return (
    <div className="space-y-4">
      <Card className="flex gap-3 p-4">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            <b className="text-foreground">O valor entra e não volta.</b> Depois de salvo, a tela
            mostra só os quatro últimos caracteres — nem esta página nem nenhum usuário logado
            consegue ler a chave inteira. Para trocar, escreva por cima.
          </p>
        </div>
      </Card>

      {grupos.map((grupo) => (
        <div key={grupo} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{grupo}</h2>
            {grupo === "Asaas" ? (
              <>
                <Badge variant={asaasPronto ? "default" : "outline"}>
                  {asaasPronto ? "configurado" : "incompleto"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={mTestar.isPending}
                  onClick={() => mTestar.mutate()}
                >
                  <Plug className="mr-1.5 h-3.5 w-3.5" />
                  {mTestar.isPending ? "Testando…" : "Testar conexão"}
                </Button>
              </>
            ) : null}
          </div>

          {grupo === "Asaas" && teste ? (
            <Card
              className={`flex items-start gap-2 p-3 text-sm ${
                teste.ok ? "border-emerald-500/40" : "border-destructive/40"
              }`}
            >
              {teste.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <span>{teste.detalhe}</span>
            </Card>
          ) : null}

          {CHAVES_CONHECIDAS.filter((c) => c.grupo === grupo).map((c) => {
            const s = porChave.get(c.chave);
            const valor = rascunho[c.chave] ?? "";
            return (
              <Card key={c.chave} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">{c.rotulo}</Label>
                      {s?.configurado ? (
                        <Badge
                          variant="secondary"
                          className="max-w-[22rem] truncate font-mono text-[10px]"
                          title={s.final}
                        >
                          {s.final}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          não configurado
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{c.ajuda}</p>
                  </div>
                  {s?.configurado ? (
                    <div className="text-right text-[11px] text-muted-foreground">
                      <p>{quando(s.atualizado_em)}</p>
                      <p>{s.atualizado_por ?? ""}</p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {c.opcoes ? (
                    <Select
                      value={valor}
                      onValueChange={(v) => setRascunho((r) => ({ ...r, [c.chave]: v }))}
                    >
                      <SelectTrigger className="max-w-md">
                        <SelectValue placeholder="Escolha" />
                      </SelectTrigger>
                      <SelectContent>
                        {c.opcoes.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex max-w-md flex-1 items-center gap-1">
                      <Input
                        type={c.segredo && !visivel[c.chave] ? "password" : "text"}
                        value={valor}
                        autoComplete="off"
                        onChange={(e) => setRascunho((r) => ({ ...r, [c.chave]: e.target.value }))}
                        placeholder={s?.configurado ? "Escreva por cima para trocar" : "Colar aqui"}
                      />
                      {c.segredo ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setVisivel((v) => ({ ...v, [c.chave]: !v[c.chave] }))}
                        >
                          {visivel[c.chave] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  )}
                  <Button
                    size="sm"
                    disabled={!valor.trim() || mSalvar.isPending}
                    onClick={() => mSalvar.mutate({ chave: c.chave, valor })}
                  >
                    Salvar
                  </Button>
                  {s?.configurado ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Remover"
                      onClick={() => mApagar.mutate({ chave: c.chave })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ))}

      <Card className="space-y-2 p-4 text-sm">
        <p className="font-medium">Depois de salvar a chave e o token</p>
        <p className="text-muted-foreground">
          Cadastre o webhook no painel do Asaas, em Integrações › Webhooks, apontando para o
          endereço abaixo e usando o mesmo token que você definiu aqui. Marque os eventos{" "}
          <span className="font-mono text-xs">PAYMENT_RECEIVED</span> e{" "}
          <span className="font-mono text-xs">PAYMENT_CONFIRMED</span>.
        </p>
        <code className="block overflow-x-auto rounded bg-muted px-3 py-2 text-xs">
          https://ulgiochewwpmmssksqlw.supabase.co/functions/v1/broker-asaas-webhook
        </code>
      </Card>
    </div>
  );
}
