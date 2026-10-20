import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarraFiltros,
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import { useConfigFaturamento, useReler } from "@/hooks/use-faturamento";
import {
  AJUDA_PAPEL,
  filtrarEmpresas,
  fraseDesativar,
  pessoasPorPapel,
  resumoDoPapel,
  ROTULO_FATURA_POR,
  ROTULO_PAPEL,
  seloOmie,
  substitutoPadrao,
  type BuscaConfig,
} from "@/lib/faturamento/config";
import { desembrulhar, tipoDoErro } from "@/lib/faturamento/erros";
import {
  ativarServicoFaturamento,
  configurarEmissoraFaturamento,
  padroesServicoFaturamento,
  removerDonoFaturamento,
  salvarDonoFaturamento,
  sincronizarServicosFaturamento,
} from "@/lib/faturamento/faturamento.functions";
import { dataCompleta, diaEHora, documento } from "@/lib/faturamento/formato";
import type {
  ConfigFaturamento,
  EmissoraConfig,
  FaturaPor,
  PapelEmissora,
  PessoaConfig,
  ServicoConfig,
} from "@/lib/faturamento/tipos";
import { AREA_FATURAMENTO, ErroDaArea, PaginaFaturamento } from "./moldura";

/**
 * Configuração do faturamento (`/faturamento/configuracao`), arquétipo Configuração. Contrato
 * `docs/design/contratos/faturamento-configuracao.md`: "Quem pede e aprova em cada empresa, e o que ela já
 * manda ao Omie?".
 *
 * Tudo de `ops.fat_config`; cada mudança passa pela RPC dela, que confere a controladoria e o recorte de novo.
 * "Gravar no Omie" só o administrador do Brain liga (trava da E1), sempre com o efeito dito antes; a chave do
 * Omie nunca aparece, nem mascarada.
 */

const TITULO = "Configuração";
const PERGUNTA = "Quem pede e aprova em cada empresa, e o que ela já manda ao Omie?";

export function ConfiguracaoFaturamento({ busca }: { busca: BuscaConfig }) {
  const navigate = useNavigate();
  const config = useConfigFaturamento();
  const mudar = (parcial: Partial<BuscaConfig>) =>
    void navigate({
      to: "/faturamento/configuracao",
      search: { ...busca, ...parcial },
      replace: true,
      resetScroll: false,
    });

  const sincronizadoEm = useMemo(() => {
    let max: string | null = null;
    for (const e of config.data?.emissoras ?? [])
      for (const s of e.servicos)
        if (s.sincronizado_em && (!max || Date.parse(s.sincronizado_em) > Date.parse(max)))
          max = s.sincronizado_em;
    return max;
  }, [config.data]);

  const cabecalho = (
    <PageHeader
      area={AREA_FATURAMENTO}
      titulo={TITULO}
      pergunta={PERGUNTA}
      descricao="Empresas do grupo no seu recorte · situação de agora · empresa. Mudança de pessoa vale para o próximo pedido; ligar a gravação vale para o próximo envio."
      procedencia={{
        fonte: `Empresas: cadastro do grupo · serviços: catálogo do Omie${sincronizadoEm ? ` sincronizado em ${dataCompleta(sincronizadoEm)}` : ""}`,
      }}
    />
  );

  if (config.isPending)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <Carregando variante="tabela" />
      </PaginaFaturamento>
    );
  if (config.error || !config.data)
    return (
      <PaginaFaturamento>
        {cabecalho}
        {tipoDoErro(config.error) === "sem_acesso" ? (
          <EstadoSemAcesso oQueFalta="Faturamento · Controladoria" />
        ) : (
          <ErroDaArea erro={config.error} tentarNovamente={() => void config.refetch()} />
        )}
      </PaginaFaturamento>
    );

  const c = config.data;
  const lista = filtrarEmpresas(c.emissoras, busca);
  const ativas = c.emissoras.filter((e) => e.ativa).length;
  const aberta = busca.empresa
    ? (c.emissoras.find((e) => e.apelido === busca.empresa) ?? null)
    : null;

  return (
    <PaginaFaturamento>
      {cabecalho}
      <BarraFiltros
        aoLimpar={
          busca.busca || busca.inativas
            ? () => mudar({ busca: undefined, inativas: undefined })
            : undefined
        }
      >
        <label className="relative">
          <span className="sr-only">Buscar empresa ou pessoa</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            key={busca.busca ?? ""}
            defaultValue={busca.busca ?? ""}
            placeholder="Empresa ou pessoa (ex.: Hugo)"
            className="h-8 w-72 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter")
                mudar({ busca: (e.target as HTMLInputElement).value.trim() || undefined });
            }}
            onBlur={(e) => {
              const v = e.target.value.trim() || undefined;
              if (v !== busca.busca) mudar({ busca: v });
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={busca.inativas === "sim"}
            onCheckedChange={(v) => mudar({ inativas: v === true ? "sim" : undefined })}
          />
          Mostrar empresas inativas
        </label>
      </BarraFiltros>

      {lista.length === 0 ? (
        <EstadoVazio titulo="Nenhuma empresa com esse nome ou pessoa" total={ativas} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Fatura por</TableHead>
                <TableHead>Donos</TableHead>
                <TableHead>Gestores</TableHead>
                <TableHead className="num text-right">Solicitantes</TableHead>
                <TableHead className="num text-right">Serviços liberados</TableHead>
                <TableHead>Omie</TableHead>
                <TableHead>Pipefy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((e) => {
                const papeis = pessoasPorPapel(e);
                const selo = seloOmie(e);
                return (
                  <TableRow
                    key={e.id}
                    tabIndex={0}
                    className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => mudar({ empresa: e.apelido, secao: undefined })}
                    onKeyDown={(ev) =>
                      ev.key === "Enter" && mudar({ empresa: e.apelido, secao: undefined })
                    }
                  >
                    <TableCell className="min-w-[14rem]">
                      <span className="block font-medium text-foreground">
                        {e.apelido}
                        {!e.ativa && (
                          <StatusBadge tom="neutro" className="ml-2">
                            inativa
                          </StatusBadge>
                        )}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {e.razao_social}
                      </span>
                    </TableCell>
                    <TableCell>{e.fatura_por ? ROTULO_FATURA_POR[e.fatura_por] : "—"}</TableCell>
                    <TableCell className="text-[13px]">{resumoDoPapel(papeis.dono)}</TableCell>
                    <TableCell className="text-[13px]">{resumoDoPapel(papeis.gestor)}</TableCell>
                    <TableCell className="num text-right">
                      {e.contagem.solicitantes || "—"}
                    </TableCell>
                    <TableCell className="num text-right">
                      {e.servicos_liberados} de {e.servicos_total}
                    </TableCell>
                    <TableCell>
                      <span title={selo.detalhe ?? undefined}>
                        <StatusBadge tom={selo.tom}>{selo.rotulo}</StatusBadge>
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tom={e.pipefy_sync ? "sucesso" : "neutro"}>
                        {e.pipefy_sync ? "Ligado" : "Desligado"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        open={!!aberta}
        onOpenChange={(abre) => !abre && mudar({ empresa: undefined, secao: undefined })}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          {aberta && <FichaDaEmpresa e={aberta} config={c} />}
        </SheetContent>
      </Sheet>
    </PaginaFaturamento>
  );
}

// ------------------------------------------------------------------ o sheet da empresa

function useMudanca<T, A = void>(fn: (a: A) => Promise<T>, sucesso: (r: T) => string) {
  const reler = useReler();
  return useMutation<T, Error, A>({
    mutationFn: fn,
    onSuccess: (r) => {
      toast.success(sucesso(r));
      void reler();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A mudança não foi salva."),
  });
}

function FichaDaEmpresa({ e, config }: { e: EmissoraConfig; config: ConfigFaturamento }) {
  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle>
          {e.apelido} · {e.razao_social}
        </SheetTitle>
        <SheetDescription>
          {documento(e.cnpj)} ·{" "}
          {e.ativa ? "ativa no portal" : "inativa no portal (não há mais faturamento)"}
        </SheetDescription>
      </SheetHeader>
      <Pessoas e={e} config={config} />
      <Servicos e={e} />
      <OmieEPipefy e={e} podeGravar={config.pode_gravar_omie} />
    </div>
  );
}

// ---------- Seção 1: pessoas

function Pessoas({ e, config }: { e: EmissoraConfig; config: ConfigFaturamento }) {
  const papeis = pessoasPorPapel(e);
  const [adicionar, setAdicionar] = useState(false);
  const [desativar, setDesativar] = useState<PessoaConfig | null>(null);
  const [trocar, setTrocar] = useState<PessoaConfig | null>(null);
  const removerFn = useServerFn(removerDonoFaturamento);
  const remover = useMudanca(
    async () => desembrulhar(await removerFn({ data: { id: (desativar as PessoaConfig).id } })),
    () =>
      `${desativar?.pessoa.nome ?? "A pessoa"} deixou de ser ${desativar ? ROTULO_PAPEL[desativar.papel].singular : "do cadastro"} na ${e.apelido}.`,
  );
  const vazio = !papeis.dono.length && !papeis.gestor.length && !papeis.solicitante.length;

  return (
    <Secao
      titulo={`Quem responde pela ${e.apelido}?`}
      acoes={
        <Button size="sm" onClick={() => setAdicionar(true)}>
          <UserPlus className="size-4" aria-hidden />
          Adicionar pessoa
        </Button>
      }
    >
      {vazio ? (
        <EstadoVazio titulo={`Ninguém pede nem aprova pela ${e.apelido} ainda.`} />
      ) : (
        <div className="space-y-3">
          {(Object.keys(papeis) as PapelEmissora[]).map((papel) =>
            papeis[papel].length ? (
              <div key={papel} className="rounded-xl border bg-card">
                <h3 className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {ROTULO_PAPEL[papel].plural}
                </h3>
                <ul className="divide-y">
                  {papeis[papel].map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{p.pessoa.nome}</p>
                        <p className="text-[13px] text-muted-foreground">
                          {[
                            p.email,
                            p.desde && `desde ${dataCompleta(p.desde)}`,
                            papel === "dono" && `substituto: ${p.substituto?.nome ?? "nenhum"}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {!p.abre_faturamento && (
                          <p className="text-[13px] text-muted-foreground">
                            Ainda não abre o Faturamento: dê o acesso em Administração › Pessoas.
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {papel === "dono" && (
                          <Button variant="outline" size="sm" onClick={() => setTrocar(p)}>
                            Trocar substituto
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setDesativar(p)}>
                          Desativar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      )}

      {adicionar && <DialogAdicionar e={e} config={config} aoFechar={() => setAdicionar(false)} />}
      {trocar && (
        <DialogSubstituto e={e} config={config} pessoa={trocar} aoFechar={() => setTrocar(null)} />
      )}
      <AlertDialog open={!!desativar} onOpenChange={(abre) => !abre && setDesativar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {desativar?.pessoa.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              {desativar ? fraseDesativar(desativar, e.apelido) : ""} O histórico fica; para mudar o
              papel, desative e adicione de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => remover.mutate(undefined, { onSettled: () => setDesativar(null) })}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Secao>
  );
}

function DialogAdicionar({
  e,
  config,
  aoFechar,
}: {
  e: EmissoraConfig;
  config: ConfigFaturamento;
  aoFechar: () => void;
}) {
  const salvarFn = useServerFn(salvarDonoFaturamento);
  const [busca, setBusca] = useState("");
  const [pessoaId, setPessoaId] = useState<string | null>(null);
  const [papel, setPapel] = useState<PapelEmissora>("solicitante");
  const [substituto, setSubstituto] = useState<string | null>(null);
  const semAcento = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const candidatos = config.pessoas_ativas
    .filter(
      (p) =>
        !busca.trim() || semAcento(`${p.nome} ${p.email ?? ""}`).includes(semAcento(busca.trim())),
    )
    .slice(0, 8);
  const pessoa = config.pessoas_ativas.find((p) => p.id === pessoaId) ?? null;
  const subst = papel === "dono" ? (substituto ?? substitutoPadrao(e, pessoaId)) : null;

  const salvar = useMudanca(
    async () =>
      desembrulhar(
        await salvarFn({
          data: {
            dados: {
              emissora_id: e.id,
              user_id: pessoaId as string,
              papel,
              ...(papel === "dono" ? { substituto_id: subst } : {}),
            },
          },
        }),
      ),
    (r) => `${r.pessoa.nome} agora é ${ROTULO_PAPEL[r.papel].singular} na ${e.apelido}.`,
  );

  return (
    <Dialog open onOpenChange={(abre) => !abre && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar pessoa na {e.apelido}</DialogTitle>
          <DialogDescription>Mudança de pessoa vale para o próximo pedido.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fat-pessoa">Pessoa</Label>
            <Input
              id="fat-pessoa"
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Nome ou e-mail"
              className="h-9"
            />
            <ul
              className="max-h-48 overflow-auto rounded-md border"
              role="listbox"
              aria-label="Pessoas ativas do Brain"
            >
              {candidatos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={pessoaId === p.id}
                    onClick={() => setPessoaId(p.id)}
                    className={
                      pessoaId === p.id
                        ? "flex w-full flex-col bg-accent px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "flex w-full flex-col px-3 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    }
                  >
                    <span>{p.nome}</span>
                    <span className="text-[13px] text-muted-foreground">{p.email}</span>
                  </button>
                </li>
              ))}
              {candidatos.length === 0 && (
                <li className="px-3 py-1.5 text-[13px] text-muted-foreground">
                  Ninguém com esse nome.
                </li>
              )}
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <RadioGroup
              value={papel}
              onValueChange={(v) => setPapel(v as PapelEmissora)}
              className="space-y-2"
            >
              {(["dono", "gestor", "solicitante"] as PapelEmissora[]).map((p) => (
                <label
                  key={p}
                  htmlFor={`fat-papel-${p}`}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <RadioGroupItem id={`fat-papel-${p}`} value={p} className="mt-0.5" />
                  <span>
                    <span className="font-medium capitalize">{ROTULO_PAPEL[p].singular}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {AJUDA_PAPEL[p]}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
          {papel === "dono" && (
            <EscolherSubstituto
              e={e}
              config={config}
              valor={subst}
              excluir={pessoaId}
              aoMudar={setSubstituto}
            />
          )}
          {pessoa && !pessoa.abre_faturamento && (
            <p className="rounded-md border bg-card px-3 py-2 text-[13px] text-muted-foreground">
              {pessoa.nome} ainda não abre o Faturamento. Ela só entra quando alguém der o acesso em
              Administração › Pessoas.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Voltar
          </Button>
          {pessoaId ? (
            <Button
              disabled={salvar.isPending}
              onClick={() => salvar.mutate(undefined, { onSuccess: aoFechar })}
            >
              {salvar.isPending ? "Salvando…" : "Adicionar"}
            </Button>
          ) : (
            <BotaoComMotivo rotulo="Adicionar" motivo="Escolha a pessoa primeiro." />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EscolherSubstituto({
  e,
  config,
  valor,
  excluir,
  aoMudar,
}: {
  e: EmissoraConfig;
  config: ConfigFaturamento;
  valor: string | null;
  excluir: string | null;
  aoMudar: (v: string | null) => void;
}) {
  // O substituto sai das pessoas da empresa (gestor primeiro) e, se preciso, das ativas do Brain.
  const daEmpresa = e.pessoas
    .filter((p) => p.ativo && p.pessoa.id !== excluir)
    .map((p) => p.pessoa);
  const opcoes = [
    ...new Map([...daEmpresa, ...config.pessoas_ativas].map((p) => [p.id, p.nome])).entries(),
  ].filter(([id]) => id !== excluir);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="fat-substituto">Substituto (dá o OK quando o dono não está)</Label>
      <Select value={valor ?? "nenhum"} onValueChange={(v) => aoMudar(v === "nenhum" ? null : v)}>
        <SelectTrigger id="fat-substituto" className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="nenhum">Sem substituto</SelectItem>
          {opcoes.map(([id, nome]) => (
            <SelectItem key={id} value={id}>
              {nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[13px] text-muted-foreground">Padrão: o gestor da empresa.</p>
    </div>
  );
}

function DialogSubstituto({
  e,
  config,
  pessoa,
  aoFechar,
}: {
  e: EmissoraConfig;
  config: ConfigFaturamento;
  pessoa: PessoaConfig;
  aoFechar: () => void;
}) {
  const salvarFn = useServerFn(salvarDonoFaturamento);
  const [valor, setValor] = useState<string | null>(pessoa.substituto?.id ?? null);
  const salvar = useMudanca(
    async () =>
      desembrulhar(await salvarFn({ data: { dados: { id: pessoa.id, substituto_id: valor } } })),
    (r) =>
      r.substituto
        ? `${r.substituto.nome} substitui ${r.pessoa.nome} na ${e.apelido}.`
        : `${r.pessoa.nome} fica sem substituto.`,
  );
  return (
    <Dialog open onOpenChange={(abre) => !abre && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Substituto de {pessoa.pessoa.nome}</DialogTitle>
          <DialogDescription>
            Quem dá o OK nos pedidos de {pessoa.pessoa.nome} quando ele não está.
          </DialogDescription>
        </DialogHeader>
        <EscolherSubstituto
          e={e}
          config={config}
          valor={valor}
          excluir={pessoa.pessoa.id}
          aoMudar={setValor}
        />
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            disabled={salvar.isPending}
            onClick={() => salvar.mutate(undefined, { onSuccess: aoFechar })}
          >
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Seção 2: serviços

function Servicos({ e }: { e: EmissoraConfig }) {
  const sincronizarFn = useServerFn(sincronizarServicosFaturamento);
  const sincronizar = useMudanca(
    async () => desembrulhar(await sincronizarFn({ data: { emissora: e.id } })),
    () =>
      `Leitura do catálogo da ${e.apelido} pedida ao Omie. Os serviços novos entram desligados.`,
  );
  const sinc = e.sincronizacao;
  const ultima = e.servicos.reduce<string | null>(
    (m, s) =>
      s.sincronizado_em && (!m || Date.parse(s.sincronizado_em) > Date.parse(m))
        ? s.sincronizado_em
        : m,
    null,
  );
  const botao = !e.tem_chave ? (
    <BotaoComMotivo
      rotulo="Sincronizar com o Omie"
      motivo={`A ${e.apelido} não tem chave do Omie no cofre`}
      variant="outline"
      size="sm"
    />
  ) : (
    <Button
      variant="outline"
      size="sm"
      disabled={
        sincronizar.isPending || sinc?.status === "pendente" || sinc?.status === "processando"
      }
      onClick={() => sincronizar.mutate()}
    >
      {sinc?.status === "pendente" || sinc?.status === "processando"
        ? "Sincronizando…"
        : "Sincronizar com o Omie"}
    </Button>
  );
  return (
    <Secao
      titulo="Quais serviços aparecem no pedido?"
      descricao={[
        `${e.servicos_liberados} de ${e.servicos_total} liberados`,
        ultima ? `sincronizado em ${dataCompleta(ultima)}` : "nunca sincronizado",
        sinc?.status === "erro" && sinc.erro_legivel
          ? `a última leitura falhou: ${sinc.erro_legivel}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      acoes={botao}
    >
      {e.servicos.length === 0 ? (
        <EstadoVazio titulo={`O catálogo da ${e.apelido} ainda não veio do Omie.`} acao={botao} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead>Códigos</TableHead>
                <TableHead>Tributação</TableHead>
                <TableHead>Categoria padrão</TableHead>
                <TableHead>Conta corrente padrão</TableHead>
                <TableHead>Aparece no pedido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {e.servicos.map((s) => (
                <LinhaServico key={s.id} s={s} apelido={e.apelido} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Secao>
  );
}

function LinhaServico({ s, apelido }: { s: ServicoConfig; apelido: string }) {
  const ativarFn = useServerFn(ativarServicoFaturamento);
  const padroesFn = useServerFn(padroesServicoFaturamento);
  const [categoria, setCategoria] = useState(s.categoria_padrao ?? "");
  const [conta, setConta] = useState(
    s.conta_corrente_padrao === null ? "" : String(s.conta_corrente_padrao),
  );
  const ativar = useMudanca(
    async () => desembrulhar(await ativarFn({ data: { id: s.id, ativo: !s.ativo } })),
    (r) =>
      r.ativo
        ? `${s.descricao} passa a aparecer no pedido da ${apelido}.`
        : `${s.descricao} saiu do pedido${r.rascunhos_usando ? `; ${r.rascunhos_usando} ${r.rascunhos_usando === 1 ? "rascunho usa" : "rascunhos usam"} este serviço` : ""}.`,
  );
  const padroes = useMudanca(
    async () => {
      const n = conta.trim() === "" ? null : Number(conta);
      if (n !== null && (!Number.isInteger(n) || n < 0))
        throw new Error("A conta corrente é um número inteiro.");
      return desembrulhar(
        await padroesFn({
          data: { id: s.id, categoria: categoria.trim() || null, contaCorrente: n },
        }),
      );
    },
    () => `Padrões de ${s.descricao} salvos.`,
  );
  const salvarSeMudou = () => {
    const contaAtual = s.conta_corrente_padrao === null ? "" : String(s.conta_corrente_padrao);
    if ((categoria.trim() || "") !== (s.categoria_padrao ?? "") || conta.trim() !== contaAtual)
      padroes.mutate();
  };
  const motivo = !s.no_omie
    ? "Não está mais no Omie: sai do pedido."
    : !s.tem_tributacao
      ? "Falta tributação no Omie: não aparece no pedido."
      : null;
  return (
    <TableRow>
      <TableCell className="min-w-[16rem]">
        <span className="block text-foreground">{s.descricao}</span>
        <span className="block text-[13px] text-muted-foreground">
          código no Omie {s.codigo_omie ?? "—"}
        </span>
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {[
          s.codigo,
          s.codigo_lc116 && `LC 116 ${s.codigo_lc116}`,
          s.codigo_municipal && `municipal ${s.codigo_municipal}`,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
      </TableCell>
      <TableCell>
        {!s.no_omie ? (
          <StatusBadge tom="neutro">não está mais no Omie</StatusBadge>
        ) : s.tem_tributacao ? (
          <span className="text-[13px] text-muted-foreground">configurada</span>
        ) : (
          <StatusBadge tom="atencao">Falta tributação no Omie: não aparece no pedido</StatusBadge>
        )}
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Categoria padrão de ${s.descricao}`}
          value={categoria}
          onChange={(ev) => setCategoria(ev.target.value)}
          onBlur={salvarSeMudou}
          className="num h-8 w-28"
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Conta corrente padrão de ${s.descricao}`}
          value={conta}
          inputMode="numeric"
          onChange={(ev) => setConta(ev.target.value)}
          onBlur={salvarSeMudou}
          className="num h-8 w-36"
        />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <Switch
            checked={s.ativo}
            disabled={ativar.isPending}
            onCheckedChange={() => ativar.mutate()}
            aria-label={`${s.descricao} aparece no pedido`}
          />
          {s.ativo && motivo && (
            <span className="text-[13px] text-muted-foreground">
              liberado, mas {motivo.toLowerCase()}
            </span>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}

// ---------- Seção 3: Omie e Pipefy

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-foreground">{rotulo}</span>
      <span className="flex flex-wrap items-center gap-2 text-sm">{children}</span>
    </div>
  );
}

function OmieEPipefy({ e, podeGravar }: { e: EmissoraConfig; podeGravar: boolean }) {
  const configurarFn = useServerFn(configurarEmissoraFaturamento);
  const [confirmar, setConfirmar] = useState<null | "gravar" | "simular" | "pipefy">(null);
  const mudarEmissora = useMudanca(
    async (dados: {
      modoOmie?: "simular" | "gravar";
      pipefySync?: boolean;
      faturaPor?: FaturaPor;
    }) => desembrulhar(await configurarFn({ data: { emissora: e.id, ...dados } })),
    (r) =>
      `${r.apelido}: Omie ${r.modo_omie === "gravar" ? "gravando" : "em simulação"} · Pipefy ${r.pipefy_sync ? "ligado" : "desligado"}.`,
  );
  const semChave = `A ${e.apelido} não tem chave do Omie no cofre`;
  const omie = e.omie;
  const leitura =
    omie.ultima_falha_em &&
    (!omie.ultimo_ok_em || Date.parse(omie.ultima_falha_em) > Date.parse(omie.ultimo_ok_em))
      ? `Falhou em ${diaEHora(omie.ultima_falha_em)}${omie.motivo ? `: ${omie.motivo}` : ""}`
      : omie.ultimo_ok_em
        ? `Lida em ${diaEHora(omie.ultimo_ok_em)}`
        : "Ainda não lida";

  return (
    <Secao titulo={`Como a ${e.apelido} fala com o Omie e com o Pipefy?`}>
      <div className="divide-y rounded-xl border bg-card">
        <Linha rotulo="Fatura por">
          <Select
            value={e.fatura_por ?? "nenhum"}
            onValueChange={(v) =>
              v !== "nenhum" && mudarEmissora.mutate({ faturaPor: v as FaturaPor })
            }
          >
            <SelectTrigger className="h-8 w-36" aria-label="Fatura por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {e.fatura_por === null && <SelectItem value="nenhum">Não definido</SelectItem>}
              <SelectItem value="os">OS</SelectItem>
              <SelectItem value="contrato">Contrato</SelectItem>
              <SelectItem value="ambos">Ambos</SelectItem>
            </SelectContent>
          </Select>
        </Linha>
        <Linha rotulo="Chave do Omie">
          <StatusBadge tom={e.tem_chave ? "sucesso" : "neutro"}>
            {e.tem_chave ? "Guardada no cofre" : "Sem chave"}
          </StatusBadge>
          <span className="text-[13px] text-muted-foreground">{leitura}</span>
        </Linha>
        <Linha rotulo="Conta corrente padrão da empresa">
          <span className="num text-muted-foreground">{e.conta_corrente_padrao ?? "—"}</span>
        </Linha>
        <Linha rotulo="Gravar no Omie">
          {!e.tem_chave ? (
            <BotaoComMotivo
              rotulo={e.modo_omie === "gravar" ? "Gravando" : "Simulação"}
              motivo={semChave}
              variant="outline"
              size="sm"
            />
          ) : e.modo_omie === "simular" && !podeGravar ? (
            <BotaoComMotivo
              rotulo="Simulação"
              motivo="Só o administrador do Brain liga a gravação no Omie (trava da E1)"
              variant="outline"
              size="sm"
            />
          ) : (
            <Switch
              checked={e.modo_omie === "gravar"}
              disabled={mudarEmissora.isPending}
              onCheckedChange={(v) => setConfirmar(v ? "gravar" : "simular")}
              aria-label={`Gravar no Omie da ${e.apelido}`}
            />
          )}
          <StatusBadge tom={e.modo_omie === "gravar" ? "sucesso" : "info"}>
            {e.modo_omie === "gravar" ? "Gravando" : "Simulação"}
          </StatusBadge>
        </Linha>
        <Linha rotulo="Criar e mover cards no Pipefy">
          {!e.tem_chave ? (
            <BotaoComMotivo
              rotulo={e.pipefy_sync ? "Ligado" : "Desligado"}
              motivo={semChave}
              variant="outline"
              size="sm"
            />
          ) : (
            <Switch
              checked={e.pipefy_sync}
              disabled={mudarEmissora.isPending}
              onCheckedChange={(v) =>
                v ? setConfirmar("pipefy") : mudarEmissora.mutate({ pipefySync: false })
              }
              aria-label={`Criar e mover cards no Pipefy para a ${e.apelido}`}
            />
          )}
          <StatusBadge tom={e.pipefy_sync ? "sucesso" : "neutro"}>
            {e.pipefy_sync ? "Ligado" : "Desligado"}
          </StatusBadge>
        </Linha>
      </div>

      <AlertDialog open={!!confirmar} onOpenChange={(abre) => !abre && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar === "gravar"
                ? `Ligar a gravação no Omie da ${e.apelido}?`
                : confirmar === "simular"
                  ? `Voltar a ${e.apelido} para a simulação?`
                  : `Ligar o Pipefy para a ${e.apelido}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "gravar"
                ? `A partir de agora, todo pedido da ${e.apelido} que receber o OK cria cliente e OS de verdade no Omie da ${e.apelido}, e o Faturar da tesouraria emite nota. Os pedidos já simulados continuam simulados e não vão ao Omie.`
                : confirmar === "simular"
                  ? `Os próximos envios da ${e.apelido} voltam a ser simulados. O que já foi ao Omie fica lá.`
                  : `Cada pedido novo da ${e.apelido} passa a criar um card no pipe Contas a Receber e a mover a fase a cada mudança (OS criada, faturado, recebido). Os pedidos já enviados não ganham card.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                mudarEmissora.mutate(
                  confirmar === "pipefy"
                    ? { pipefySync: true }
                    : { modoOmie: confirmar === "gravar" ? "gravar" : "simular" },
                )
              }
            >
              {confirmar === "gravar"
                ? "Gravar no Omie"
                : confirmar === "simular"
                  ? "Voltar para a simulação"
                  : "Ligar o Pipefy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Secao>
  );
}
