import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAbrirCiclo,
  useDetalheDaConta,
  useSalvarCampoOperado,
  useToquesDaConta,
} from "@/hooks/use-fila-cella";
import {
  BRL,
  ESTAGIOS,
  FRENTES,
  PAPEIS_DECISAO,
  RELACIONAMENTOS,
  dataBR,
  formatCnpj,
  type Estagio,
  type FilaContaRow,
  type Frente,
  type PapelDecisao,
  type Relacionamento,
} from "@/lib/fila-cella.types";
import {
  BloqueiosChips,
  CadenciaChip,
  CurvaChips,
  EcdChip,
  ForcaChip,
  bloqueiosDaConta,
} from "@/components/fila-cella/badges";
import { RegistrarToqueDialog } from "@/components/fila-cella/registrar-toque-dialog";
import { EncerrarCicloDialog } from "@/components/fila-cella/encerrar-ciclo-dialog";
import { ResolverCnpjDialog } from "@/components/fila-cella/resolver-cnpj-dialog";

// Sheet lateral, não Dialog: o Matheus consulta o painel ENQUANTO fala ao
// telefone, e modal captura o foco (§6.2).

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function ContaDetalheSheet({
  conta,
  onOpenChange,
  podeEscrever,
}: {
  conta: FilaContaRow | null;
  onOpenChange: (o: boolean) => void;
  podeEscrever: boolean;
}) {
  const { can } = usePermissions();
  const aberto = !!conta;
  const detalhe = useDetalheDaConta(conta?.cnpj_principal ?? null, aberto);
  const cadencia = useToquesDaConta(conta?.id ?? null);
  const salvar = useSalvarCampoOperado();
  const abrirCiclo = useAbrirCiclo();

  const [toqueAberto, setToqueAberto] = useState(false);
  const [encerrarAberto, setEncerrarAberto] = useState(false);
  const [cnpjAberto, setCnpjAberto] = useState(false);
  const [motivoEntrada, setMotivoEntrada] = useState("");
  const [frenteNova, setFrenteNova] = useState<Frente | "">("");
  const [respostaRelac, setRespostaRelac] = useState("");

  useEffect(() => {
    if (!conta) return;
    setMotivoEntrada("");
    setFrenteNova(conta.frente ?? "");
    setRespostaRelac(conta.relacionamento_resposta ?? "");
  }, [conta]);

  if (!conta) return null;

  const bloqueios = bloqueiosDaConta(conta);
  const gatilhos = detalhe.data?.gatilhos ?? [];
  const consumo = detalhe.data?.consumo ?? [];
  const grupo = detalhe.data?.grupo ?? [];
  const semGatilho = gatilhos.length === 0 && !conta.gatilho_principal;

  // Checklist §6.1: em Curva A, relacionamento tem de estar verificado antes do
  // primeiro contato — e a resposta do responsável é registrada, não presumida.
  const exigeRelacionamento =
    conta.curva_declarada === "A" && conta.relacionamento === "Não verificado";

  const patch = async (p: Record<string, unknown>) => {
    try {
      await salvar.mutateAsync({ conta_id: conta.id, ...p });
      toast.success("Salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };

  const criarCiclo = async () => {
    if (!frenteNova) return;
    try {
      await abrirCiclo.mutateAsync({
        conta_id: conta.id,
        frente: frenteNova,
        motivo_entrada: motivoEntrada,
      });
      toast.success("Ciclo aberto.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao abrir o ciclo.");
    }
  };

  const motivoToqueBloqueado = !podeEscrever
    ? "Você não tem manage.fila_cella."
    : conta.ciclo_id == null
      ? "Abra um ciclo antes de registrar o primeiro toque."
      : semGatilho
        ? "Nenhum cliente entra na fila sem gatilho identificado e registrado (playbook §3.6)."
        : exigeRelacionamento
          ? "Curva A: registre a checagem de relacionamento com o responsável antes do primeiro contato (playbook §3.4). Quem libera é o CS da conta."
          : (conta.toques ?? 0) >= 4
            ? "Este ciclo já teve 4 toques. Encerre o ciclo com motivo."
            : null;

  return (
    <>
      <Sheet open={aberto} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-[640px]">
          <SheetHeader>
            <SheetTitle className="pr-8 text-left">{conta.titulo}</SheetTitle>
          </SheetHeader>

          <div className="space-y-6 py-4">
            {bloqueios.length > 0 && (
              <Secao titulo="Bloqueios">
                <BloqueiosChips bloqueios={bloqueios} />
              </Secao>
            )}

            <Secao titulo="Identidade">
              <div className="space-y-1">
                <Linha rotulo="Razão social">{conta.razao_social ?? "—"}</Linha>
                <Linha rotulo="CNPJ">
                  {conta.cnpj_principal ? (
                    <span className="font-mono">{formatCnpj(conta.cnpj_principal)}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!can("manage.de_para_cnpj")}
                      onClick={() => setCnpjAberto(true)}
                    >
                      Resolver CNPJ
                    </Button>
                  )}
                </Linha>
                <Linha rotulo="UF · Unidade">
                  {conta.uf ?? "—"} · {conta.unidade ?? "—"}
                </Linha>
                <Linha rotulo="Dono da conta">{conta.dono_conta ?? "—"}</Linha>
                <Linha rotulo="MRR">{BRL(conta.mrr)}</Linha>
                <Linha rotulo="Cliente desde">{dataBR(conta.cliente_desde)}</Linha>
                <Linha rotulo="Segmento">
                  {conta.segmento ?? "—"}
                  {conta.segmento_prioritario && <span className="ml-1 text-amber-500">★</span>}
                </Linha>
                <Linha rotulo="Faixa declarada">{conta.faixa_declarada ?? "—"}</Linha>
                <Linha rotulo="Regime">
                  {conta.regime_tributario ?? "não confirmado"} · elegível: {conta.elegivel}
                </Linha>
                <Linha rotulo="Curva (declarada │ ECD)">
                  <CurvaChips
                    declarada={conta.curva_declarada}
                    apurada={conta.curva_ecd}
                    diverge={conta.curva_diverge}
                  />
                </Linha>
                <Linha rotulo="Receita operacional (ECD)">
                  {conta.receita_operacional == null ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground">—</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Receita não apurada nesta ECD. Não é o mesmo que receita zero: 202 dos 404
                        CNPJs da base não têm receita apurável.
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    BRL(conta.receita_operacional)
                  )}
                </Linha>
              </div>
              {conta.avisos?.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
                  {conta.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </Secao>

            <Secao titulo="Sinal da ECD">
              <div className="flex items-center gap-2">
                <EcdChip estado={conta.ecd_estado} />
                <ForcaChip
                  forca={conta.forca}
                  temOverride={conta.forca_tem_override}
                  motivo={conta.forca_motivo}
                />
                {!conta.score_comparavel && (
                  <span className="text-xs text-muted-foreground">
                    score não comparável — teto 5
                  </span>
                )}
              </div>
              {detalhe.isLoading && (
                <p className="text-sm text-muted-foreground">Carregando evidência…</p>
              )}
              {gatilhos.length > 0 ? (
                <div className="divide-y rounded-md border text-sm">
                  {gatilhos.map((g, i) => (
                    <div key={`${g.gatilho}-${i}`} className="flex items-baseline gap-2 p-2">
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {g.gatilho}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate" title={g.nome_conta}>
                        {g.nome_conta}
                      </span>
                      <span className="shrink-0 tabular-nums">{BRL(g.valor)}</span>
                      <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                        {g.tipo}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                !detalhe.isLoading && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conta contábil casou com gatilho.
                  </p>
                )
              )}
              {consumo.length > 0 && (
                <div className="space-y-1 text-sm">
                  {consumo.map((c, i) => (
                    <Linha key={`${c.categoria}-${c.metrica}-${i}`} rotulo={c.categoria}>
                      {BRL(c.valor_total)}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({c.metrica}, {c.qtd_contas} conta{c.qtd_contas > 1 ? "s" : ""})
                      </span>
                    </Linha>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    O rótulo da métrica anda colado ao número de propósito: saldo é fechamento num
                    ponto, fluxo é soma do ano — somar os dois é somar laranja com maçã.
                  </p>
                </div>
              )}
              {grupo.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Grupo econômico (mesma raiz de CNPJ): {grupo.map(formatCnpj).join(" · ")}
                </p>
              )}
            </Secao>

            <Secao titulo="Camada operada">
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label>Relacionamento</Label>
                  <Select
                    value={conta.relacionamento}
                    disabled={!podeEscrever}
                    onValueChange={(v) => patch({ relacionamento: v as Relacionamento })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELACIONAMENTOS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    rows={2}
                    disabled={!podeEscrever}
                    value={respostaRelac}
                    onChange={(e) => setRespostaRelac(e.target.value)}
                    onBlur={() =>
                      respostaRelac !== (conta.relacionamento_resposta ?? "") &&
                      patch({ relacionamento_resposta: respostaRelac || null })
                    }
                    placeholder='Resposta literal do responsável a "existe algo em aberto que eu precise saber antes de falar com esse cliente?"'
                  />
                  {conta.relacionamento_em && (
                    <p className="text-xs text-muted-foreground">
                      Checado em {dataBR(conta.relacionamento_em)}.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Papel na decisão</Label>
                    <Select
                      value={conta.papel_decisao ?? ""}
                      disabled={!podeEscrever}
                      onValueChange={(v) => patch({ papel_decisao: v as PapelDecisao })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAPEIS_DECISAO.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Estágio</Label>
                    <Select
                      value={conta.estagio}
                      disabled={!podeEscrever}
                      onValueChange={(v) => patch({ estagio: v as Estagio })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ESTAGIOS.map((e) => (
                          <SelectItem key={e} value={e}>
                            {e}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="urgencia"
                      checked={conta.urgencia}
                      disabled={!podeEscrever}
                      onCheckedChange={(v) => patch({ urgencia: v })}
                    />
                    <Label htmlFor="urgencia" className="text-sm">
                      Urgência (+3 no score)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="conflito"
                      checked={conta.conflito_interno}
                      disabled={!podeEscrever}
                      onCheckedChange={(v) => patch({ conflito_interno: v })}
                    />
                    <Label htmlFor="conflito" className="text-sm">
                      Conflito com Auditoria Tributária
                    </Label>
                  </div>
                </div>
              </div>
            </Secao>

            <Secao titulo="Cadência">
              {conta.ciclo_id ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CadenciaChip cicloNum={conta.ciclo_num} toques={conta.toques} />
                    <span className="text-sm text-muted-foreground">
                      frente {conta.ciclo_frente} · último toque {dataBR(conta.ultimo_toque)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {motivoToqueBloqueado ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button disabled>Registrar toque</Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{motivoToqueBloqueado}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button onClick={() => setToqueAberto(true)}>Registrar toque</Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={!podeEscrever}
                      onClick={() => setEncerrarAberto(true)}
                    >
                      Encerrar ciclo
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {conta.reentrada_bloqueada && (
                    <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                      Reentrada bloqueada até {dataBR(conta.bloqueado_ate)} (
                      {conta.recusa_explicita ? "180 dias, recusa explícita" : "60 dias"}). Furar a
                      data exige fato novo e a permissão manage.fila_cella_override.
                    </p>
                  )}
                  <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                    <Select
                      value={frenteNova}
                      disabled={!podeEscrever}
                      onValueChange={(v) => setFrenteNova(v as Frente)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Frente" />
                      </SelectTrigger>
                      <SelectContent>
                        {FRENTES.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={motivoEntrada}
                      disabled={!podeEscrever}
                      onChange={(e) => setMotivoEntrada(e.target.value)}
                      placeholder="Motivo de entrada — novo a cada ciclo"
                    />
                  </div>
                  <Button
                    onClick={criarCiclo}
                    disabled={
                      !podeEscrever || !frenteNova || !motivoEntrada.trim() || abrirCiclo.isPending
                    }
                  >
                    Abrir ciclo {(conta.ciclo_num ?? 0) + 1}
                  </Button>
                </div>
              )}

              {(cadencia.data?.toques.length ?? 0) > 0 && (
                <div className="divide-y rounded-md border text-sm">
                  {cadencia.data!.toques.map((t) => (
                    <div key={t.id} className="space-y-1 p-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          Toque {t.toque_num}/4 · {dataBR(t.data)} · {t.canal} · {t.gatilho_ref}
                        </span>
                        <Badge variant="outline" className="font-normal">
                          {t.resultado}
                        </Badge>
                        {t.override_por && (
                          <Badge className="bg-amber-500 font-normal text-white hover:bg-amber-500">
                            override
                          </Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap">{t.literal}</p>
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            <Secao titulo="Checklist antes de falar (§6.1)">
              <ul className="space-y-1 text-sm">
                {[
                  {
                    ok: conta.relacionamento !== "Não verificado",
                    txt: "Relacionamento checado com o responsável, com a resposta registrada",
                  },
                  { ok: !semGatilho, txt: "Gatilho identificado e registrado" },
                  { ok: !!conta.frente, txt: "Frente escolhida" },
                  { ok: !conta.conflito_interno, txt: "Sem conflito com a Auditoria Tributária" },
                  { ok: conta.elegivel !== "Não", txt: "Conta elegível" },
                ].map((c) => (
                  <li
                    key={c.txt}
                    className={cn("flex gap-2", !c.ok && "text-amber-700 dark:text-amber-400")}
                  >
                    <span>{c.ok ? "✓" : "○"}</span>
                    <span>{c.txt}</span>
                  </li>
                ))}
              </ul>
            </Secao>

            <Secao titulo="Handoff ao Cella">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="outline" disabled>
                      Gerar handoff ao Cella
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Fora da v1 (fase F4). O handoff leva o literal de todos os toques e a evidência
                  conta a conta; o formato ainda não foi acordado com o escritório.
                </TooltipContent>
              </Tooltip>
            </Secao>
          </div>
        </SheetContent>
      </Sheet>

      {conta.ciclo_id != null && (
        <>
          <RegistrarToqueDialog
            open={toqueAberto}
            onOpenChange={setToqueAberto}
            conta={conta}
            gatilhos={gatilhos}
          />
          <EncerrarCicloDialog
            open={encerrarAberto}
            onOpenChange={setEncerrarAberto}
            conta={conta}
          />
        </>
      )}
      <ResolverCnpjDialog open={cnpjAberto} onOpenChange={setCnpjAberto} conta={conta} />
    </>
  );
}
