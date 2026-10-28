import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MoreHorizontal, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  FOCO_VISIVEL,
  StatusBadge,
} from "@/components/planning";
import { BotaoComMotivo, inputClass } from "@/components/monetizacao/common";
import { useAuth } from "@/hooks/use-auth";
import { fmtWhatsapp } from "@/lib/telefone";
import type { Conta } from "@/lib/monetizacao/types";
import {
  abrirPedido,
  cancelarPedido,
  consultarCnpj,
  contatosDaConta,
  informarChurn,
  meusPedidos,
  permissoesPedido,
  resumoContatos,
  type ConsultaCnpj,
} from "@/lib/clientes/pedidos.functions";
import {
  CARGOS,
  CATEGORIAS_CHURN,
  emailValido,
  mascararCnpj,
  MOTIVOS_DESATIVAR,
  NAO_RECONHECO,
  normalizarWhatsapp,
  quando,
  resumoDoPedido,
  situacaoDoPedido,
  TIPO_PEDIDO,
  type ContatoConta,
  type Pedido,
  type PermissoesPedido,
  type ResumoConta,
} from "@/lib/clientes/pedidos";

// Atualização da base pela unidade (PRD de 28/10/2026, contrato `clientes.md`, adendo de 28/10). O sócio propõe; o CS
// decide em /clientes/pedidos; o envio grava no Pipefy. A tela repete as regras do banco só para avisar antes.

/** Alvo das ações: uma conta da Base ou um cliente declarado pela unidade (pedido aberto). */
export type AlvoPedido = { tipo: "conta"; conta: Conta } | { tipo: "declarado"; pedido: Pedido };

const nomeDoAlvo = (a: AlvoPedido) =>
  a.tipo === "conta" ? a.conta.name : (a.pedido.conta_nome ?? "Cliente declarado");

type Acoes = {
  perms: PermissoesPedido | undefined;
  resumo: Record<string, ResumoConta>;
  declarados: Pedido[];
  /** Por que não dá para pedir; nulo quando dá. */
  bloqueio: string | null;
  carregando: boolean;
  abrirContatos: (a: AlvoPedido) => void;
  abrirChurn: (c: Conta) => void;
  abrirNaoReconheco: (c: Conta) => void;
  abrirIncluirCliente: () => void;
  atualizar: () => void;
};
const Ctx = createContext<Acoes | null>(null);
export const useAcoesBase = () => useContext(Ctx);

export const CHAVES_PEDIDOS = ["base-pedidos"] as const;

/** Permissões de pedido (abrir, decidir, ver como) e as unidades regionais. */
export function usePermissoesPedido() {
  const { user } = useAuth();
  const fn = useServerFn(permissoesPedido);
  return useQuery({
    queryKey: [...CHAVES_PEDIDOS, "perms", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 60_000,
  });
}
/** Contatos e pedidos por conta, e os clientes declarados (`ops.base_contatos_resumo`). */
export function useResumoContatos() {
  const { user } = useAuth();
  const fn = useServerFn(resumoContatos);
  return useQuery({
    queryKey: [...CHAVES_PEDIDOS, "resumo", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function AcoesBaseProvider({ contas, children }: { contas: Conta[]; children: ReactNode }) {
  const qc = useQueryClient();
  const perms = usePermissoesPedido();
  const resumo = useResumoContatos();
  const [contatos, setContatos] = useState<AlvoPedido | null>(null);
  const [churn, setChurn] = useState<Conta | null>(null);
  const [naoRec, setNaoRec] = useState<Conta | null>(null);
  const [incluir, setIncluir] = useState(false);
  const atualizar = () => void qc.invalidateQueries({ queryKey: CHAVES_PEDIDOS });
  const bloqueio = !perms.data
    ? "Carregando as permissões."
    : perms.data.ver_como
      ? 'Modo "ver como": a tela é só leitura, nenhum pedido é aberto.'
      : !perms.data.abrir
        ? "Seu acesso não permite pedir mudanças na base (chave edit.base_unidade)."
        : null;
  const valor: Acoes = {
    perms: perms.data,
    resumo: resumo.data?.contas ?? {},
    declarados: resumo.data?.declarados ?? [],
    bloqueio,
    carregando: resumo.isLoading,
    abrirContatos: setContatos,
    abrirChurn: setChurn,
    abrirNaoReconheco: setNaoRec,
    abrirIncluirCliente: () => setIncluir(true),
    atualizar,
  };
  return (
    <Ctx.Provider value={valor}>
      {children}
      <PainelContatos alvo={contatos} fechar={() => setContatos(null)} />
      <DialogChurn conta={churn} fechar={() => setChurn(null)} />
      <DialogNaoReconheco conta={naoRec} contas={contas} fechar={() => setNaoRec(null)} />
      <DialogIncluirCliente
        aberto={incluir}
        fechar={() => setIncluir(false)}
        aoIncluir={(p) => {
          setIncluir(false);
          setContatos({ tipo: "declarado", pedido: p });
        }}
      />
    </Ctx.Provider>
  );
}

/** Aviso escrito quando os botões estão desabilitados (o Chrome não abre `title` de botão desabilitado). */
function AvisoBloqueio({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      {texto}
    </p>
  );
}

// ============ Na lista de clientes ============

/** Coluna "Contato do NPS" da lista: o nome e o número, ou o selo de falta. */
export function CelulaNps({ conta }: { conta: Conta }) {
  const ctx = useAcoesBase();
  if (!ctx) return null;
  const r = ctx.resumo[conta.key];
  const abertos = r?.tipos ?? [];
  return (
    <div className="space-y-1">
      {ctx.carregando ? (
        <span className="text-xs text-muted-foreground">Carregando</span>
      ) : r?.nps ? (
        <>
          <div className="text-sm">{r.nps.nome}</div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {fmtWhatsapp(r.nps.whatsapp)}
          </div>
        </>
      ) : (
        <StatusBadge tom="perigo">Sem contato do NPS</StatusBadge>
      )}
      {abertos.includes("churn") && <StatusBadge tom="atencao">Churn com o CS</StatusBadge>}
      {abertos.includes("nao_reconheco") && (
        <StatusBadge tom="atencao">Não reconhecido, com o CS</StatusBadge>
      )}
      {!!r?.pedidos && !abertos.includes("churn") && !abertos.includes("nao_reconheco") && (
        <StatusBadge tom="atencao">
          {r.pedidos} pedido{r.pedidos > 1 ? "s" : ""} com o CS
        </StatusBadge>
      )}
    </div>
  );
}

/** Ações da linha: Contatos e o menu com Informar churn e Não reconheço. */
export function AcoesDaConta({ conta }: { conta: Conta }) {
  const ctx = useAcoesBase();
  if (!ctx) return null;
  const tipos = ctx.resumo[conta.key]?.tipos ?? [];
  const cliente = conta.base?.situacao?.estado === "cliente";
  return (
    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
      <Button
        variant="outline"
        size="sm"
        onClick={() => ctx.abrirContatos({ tipo: "conta", conta })}
        aria-label={`Contatos de ${conta.name}`}
      >
        <Users className="size-4" aria-hidden />
        Contatos
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Mais ações para ${conta.name}`}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => ctx.abrirContatos({ tipo: "conta", conta })}>
            Ver e editar contatos
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!!ctx.bloqueio || !cliente || tipos.includes("churn")}
            onSelect={() => ctx.abrirChurn(conta)}
          >
            {tipos.includes("churn") ? "Churn já informado" : "Informar churn"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!!ctx.bloqueio || !cliente || tipos.includes("nao_reconheco")}
            onSelect={() => ctx.abrirNaoReconheco(conta)}
            className="text-danger focus:text-danger"
          >
            Não reconheço este cliente
          </DropdownMenuItem>
          {ctx.bloqueio && (
            <p className="max-w-60 px-2 py-1.5 text-xs text-muted-foreground">{ctx.bloqueio}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Clientes declarados pela unidade, fora dos cartões e totais da Base (R-18). */
export function DeclaradosPelaUnidade() {
  const ctx = useAcoesBase();
  if (!ctx?.declarados.length) return null;
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b p-4">
        <h2 className="font-semibold">Declarados pela unidade</h2>
        <p className="text-xs text-muted-foreground">
          Clientes que a unidade incluiu e o CS ainda confere · fora dos cartões e dos totais da
          Base
        </p>
      </div>
      <ul className="divide-y">
        {ctx.declarados.map((p) => {
          const s = situacaoDoPedido(p);
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">{p.conta_nome}</div>
                <div className="text-xs text-muted-foreground">
                  CNPJ {mascararCnpj(p.proposto.cnpj)} · {p.unidade_nome} · incluído em{" "}
                  {quando(p.criado_em)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tom="info">Declarado pela unidade</StatusBadge>
                <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => ctx.abrirContatos({ tipo: "declarado", pedido: p })}
                >
                  <Users className="size-4" aria-hidden />
                  Contatos ({p.filhos?.length ?? 0})
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function BotaoIncluirCliente() {
  const ctx = useAcoesBase();
  if (!ctx?.perms?.abrir) return null;
  return (
    <BotaoComMotivo
      size="sm"
      disabled={!!ctx.bloqueio}
      motivo={ctx.bloqueio}
      onClick={ctx.abrirIncluirCliente}
    >
      <Plus className="size-4" aria-hidden />
      Incluir cliente
    </BotaoComMotivo>
  );
}

// ============ Painel de contatos ============

function PainelContatos({ alvo, fechar }: { alvo: AlvoPedido | null; fechar: () => void }) {
  const ctx = useAcoesBase()!;
  const { user } = useAuth();
  const fn = useServerFn(contatosDaConta);
  const abrirFn = useServerFn(abrirPedido);
  const key = alvo?.tipo === "conta" ? alvo.conta.key : null;
  const pai = alvo?.tipo === "declarado" ? alvo.pedido.id : null;
  const q = useQuery({
    queryKey: [...CHAVES_PEDIDOS, "contatos", user?.id, key, pai],
    queryFn: () => fn({ data: { key, pai } }),
    enabled: !!alvo && !!user,
  });
  const [form, setForm] = useState<{ contato: ContatoConta | null } | null>(null);
  const [desativar, setDesativar] = useState<ContatoConta | null>(null);
  const [enviando, setEnviando] = useState<number | null>(null);
  const pendentes = q.data?.pedidos ?? [];
  const pendenteDe = (id: number) => pendentes.find((p) => p.contato_id === id);
  const novos = pendentes.filter((p) => p.tipo === "contato_incluir");
  const nps = q.data?.contatos.find((c) => c.contato_nps && c.whatsapp_valido) ?? null;
  const declarado = alvo?.tipo === "declarado";
  const semCadastro = !!q.data && !q.data.tem_cadastro && !q.data.tem_cnpj;
  const pedirNps = async (c: ContatoConta) => {
    setEnviando(c.id);
    try {
      await abrirFn({ data: { tipo: "contato_nps", key, contato: c.id, proposto: {}, pai: null } });
      toast.success("Pedido enviado ao CS. Você acompanha em Meus pedidos.");
      ctx.atualizar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(null);
    }
  };
  return (
    <>
      <Sheet open={!!alvo} onOpenChange={(v) => !v && fechar()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {alvo && (
            <>
              <SheetHeader>
                <SheetTitle>{nomeDoAlvo(alvo)}</SheetTitle>
                <SheetDescription>
                  {alvo.tipo === "conta"
                    ? alvo.conta.base?.cnpjs.map(mascararCnpj).join(" · ") || "CNPJ a confirmar"
                    : `CNPJ ${mascararCnpj(alvo.pedido.proposto.cnpj)} · declarado pela unidade`}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3">
                <AvisoBloqueio texto={ctx.bloqueio} />
                {declarado && (
                  <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
                    Cliente declarado pela unidade. Os contatos que você incluir aqui são aprovados
                    pelo CS junto com o cliente.
                  </p>
                )}
                {!declarado && q.data && !nps && (
                  <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                    Este cliente não recebe a pesquisa de NPS: nenhum contato com WhatsApp está
                    marcado como contato do NPS.
                  </p>
                )}
                {semCadastro && (
                  <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                    Este cliente está sem CNPJ e sem cadastro em Empresas: fale com o CS para
                    corrigir o cadastro antes de incluir contatos.
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <h3 className="font-semibold">
                    Contatos {q.data ? `(${q.data.contatos.length})` : ""}
                  </h3>
                  <BotaoComMotivo
                    size="sm"
                    disabled={!!ctx.bloqueio || semCadastro || !q.data}
                    motivo={
                      ctx.bloqueio ??
                      (semCadastro ? "Cliente sem CNPJ e sem cadastro em Empresas." : null)
                    }
                    onClick={() => setForm({ contato: null })}
                  >
                    <Plus className="size-4" aria-hidden />
                    Incluir contato
                  </BotaoComMotivo>
                </div>
                {q.isLoading ? (
                  <Carregando variante="tabela" linhas={3} />
                ) : q.error ? (
                  <EstadoErro
                    detalhe={(q.error as Error).message}
                    tentarNovamente={() => void q.refetch()}
                  />
                ) : (
                  <>
                    {q.data!.contatos.map((c) => {
                      const pk = pendenteDe(c.id);
                      return (
                        <div
                          key={c.id}
                          className={`rounded-xl border bg-card p-3 ${pk ? "border-dashed" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-medium">{c.nome}</div>
                              <div className="text-xs text-muted-foreground">
                                {c.cargo || "Sem cargo"}
                              </div>
                            </div>
                            {c.contato_nps && (
                              <StatusBadge tom="sucesso">Contato do NPS</StatusBadge>
                            )}
                          </div>
                          <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                            {c.whatsapp ? (
                              <>
                                WhatsApp {fmtWhatsapp(c.whatsapp)}
                                {!c.whatsapp_valido && (
                                  <span className="ml-1 text-danger">(formato inválido)</span>
                                )}
                              </>
                            ) : (
                              <span className="text-danger">Sem WhatsApp</span>
                            )}
                            {c.email ? ` · ${c.email}` : ""}
                          </div>
                          {pk ? (
                            <div className="mt-2">
                              <StatusBadge tom={situacaoDoPedido(pk).tom}>
                                {TIPO_PEDIDO[pk.tipo]}: {situacaoDoPedido(pk).rotulo.toLowerCase()}
                              </StatusBadge>
                            </div>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1">
                              <BotaoComMotivo
                                size="sm"
                                variant="outline"
                                disabled={!!ctx.bloqueio}
                                motivo={ctx.bloqueio}
                                onClick={() => setForm({ contato: c })}
                              >
                                Editar
                              </BotaoComMotivo>
                              {!c.contato_nps && (
                                <BotaoComMotivo
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    !!ctx.bloqueio || !c.whatsapp_valido || enviando === c.id
                                  }
                                  motivo={
                                    ctx.bloqueio ??
                                    (!c.whatsapp_valido
                                      ? "Precisa de WhatsApp válido: edite o contato antes."
                                      : null)
                                  }
                                  onClick={() => void pedirNps(c)}
                                >
                                  Marcar como contato do NPS
                                </BotaoComMotivo>
                              )}
                              <BotaoComMotivo
                                size="sm"
                                variant="ghost"
                                className="text-danger"
                                disabled={!!ctx.bloqueio}
                                motivo={ctx.bloqueio}
                                onClick={() => setDesativar(c)}
                              >
                                Desativar
                              </BotaoComMotivo>
                            </div>
                          )}
                          {!c.whatsapp_valido && !pk && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Sem WhatsApp válido o contato não recebe o NPS.
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {novos.map((p) => (
                      <div key={p.id} className="rounded-xl border border-dashed bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{p.proposto.nome}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.proposto.cargo || "Sem cargo"}
                            </div>
                          </div>
                          <StatusBadge tom={situacaoDoPedido(p).tom}>
                            Novo: {situacaoDoPedido(p).rotulo.toLowerCase()}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                          WhatsApp {fmtWhatsapp(p.proposto.whatsapp)}
                          {p.proposto.email ? ` · ${p.proposto.email}` : ""}
                          {p.proposto.contato_nps ? " · será o contato do NPS" : ""}
                        </div>
                      </div>
                    ))}
                    {!q.data!.contatos.length && !novos.length && (
                      <EstadoVazio
                        titulo="Nenhum contato cadastrado"
                        descricao="Inclua quem recebe a pesquisa de NPS."
                      />
                    )}
                  </>
                )}
                <p className="pt-2 text-xs text-muted-foreground">
                  Toda inclusão ou mudança vai para o CS da matriz, que confere e grava na base
                  Stakeholder do Pipefy. Você acompanha em Meus pedidos. O CS responde em até 2 dias
                  úteis.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {alvo && (
        <DialogContato
          alvo={alvo}
          aberto={!!form}
          contato={form?.contato ?? null}
          npsAtual={nps}
          existentes={q.data?.contatos ?? []}
          fechar={() => setForm(null)}
        />
      )}
      {alvo?.tipo === "conta" && (
        <DialogDesativar conta={alvo.conta} contato={desativar} fechar={() => setDesativar(null)} />
      )}
    </>
  );
}

function Campo({
  id,
  rotulo,
  erro,
  dica,
  children,
}: {
  id: string;
  rotulo: string;
  erro?: string | null;
  dica?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
      {erro && (
        <p className="text-xs text-danger" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

const whatsappOuNulo = (v: string | null) => {
  const w = normalizarWhatsapp(v ?? "");
  return "valor" in w ? w.valor : null;
};

function DialogContato({
  alvo,
  aberto,
  contato,
  npsAtual,
  existentes,
  fechar,
}: {
  alvo: AlvoPedido;
  aberto: boolean;
  contato: ContatoConta | null;
  npsAtual: ContatoConta | null;
  existentes: ContatoConta[];
  fechar: () => void;
}) {
  const ctx = useAcoesBase()!;
  const fn = useServerFn(abrirPedido);
  const chave = `${contato?.id ?? "novo"}-${aberto}`;
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-lg">
        <FormContato
          key={chave}
          alvo={alvo}
          contato={contato}
          npsAtual={npsAtual}
          existentes={existentes}
          enviar={async (proposto) => {
            await fn({
              data: {
                tipo: contato ? "contato_editar" : "contato_incluir",
                key: alvo.tipo === "conta" ? alvo.conta.key : null,
                contato: contato?.id ?? null,
                proposto,
                pai: alvo.tipo === "declarado" ? alvo.pedido.id : null,
              },
            });
            toast.success("Pedido enviado ao CS. Você acompanha em Meus pedidos.");
            ctx.atualizar();
            fechar();
          }}
          fechar={fechar}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormContato({
  alvo,
  contato,
  npsAtual,
  existentes,
  enviar,
  fechar,
}: {
  alvo: AlvoPedido;
  contato: ContatoConta | null;
  npsAtual: ContatoConta | null;
  existentes: ContatoConta[];
  enviar: (p: Record<string, unknown>) => Promise<void>;
  fechar: () => void;
}) {
  const [nome, setNome] = useState(contato?.nome ?? "");
  const [cargo, setCargo] = useState(contato?.cargo ?? "");
  const [wpp, setWpp] = useState(contato?.whatsapp ? (fmtWhatsapp(contato.whatsapp) ?? "") : "");
  const [email, setEmail] = useState(contato?.email ?? "");
  const [nps, setNps] = useState(!contato && !npsAtual);
  const [erros, setErros] = useState<Record<string, string | null>>({});
  const [enviando, setEnviando] = useState(false);
  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = normalizarWhatsapp(wpp);
    const dup =
      "valor" in w
        ? existentes.find((c) => c.id !== contato?.id && whatsappOuNulo(c.whatsapp) === w.valor)
        : undefined;
    const novos = {
      nome: nome.trim().length < 3 ? "Informe o nome completo (3 letras ou mais)." : null,
      wpp: "erro" in w ? w.erro : dup ? `Esse WhatsApp já é de ${dup.nome} neste cliente.` : null,
      email: email.trim() && !emailValido(email.trim()) ? "E-mail inválido." : null,
    };
    setErros(novos);
    if (Object.values(novos).some(Boolean) || !("valor" in w)) return;
    setEnviando(true);
    try {
      await enviar({
        nome: nome.trim(),
        cargo: cargo || null,
        whatsapp: w.valor,
        email: email.trim() || null,
        contato_nps: contato?.contato_nps || nps,
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form onSubmit={submeter} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>{contato ? "Editar contato" : "Incluir contato"}</DialogTitle>
        <DialogDescription>{nomeDoAlvo(alvo)}</DialogDescription>
      </DialogHeader>
      <Campo id="ct-nome" rotulo="Nome *" erro={erros.nome}>
        <Input
          id="ct-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoComplete="off"
        />
      </Campo>
      <Campo id="ct-cargo" rotulo="Cargo">
        <Select value={cargo || undefined} onValueChange={setCargo}>
          <SelectTrigger id="ct-cargo">
            <SelectValue placeholder="Escolha o cargo" />
          </SelectTrigger>
          <SelectContent>
            {CARGOS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
      <Campo
        id="ct-wpp"
        rotulo="WhatsApp *"
        erro={erros.wpp}
        dica="Com DDD. É para esse número que vai a pesquisa de NPS."
      >
        <Input
          id="ct-wpp"
          inputMode="tel"
          placeholder="(11) 90000-0000"
          value={wpp}
          onChange={(e) => setWpp(e.target.value)}
        />
      </Campo>
      <Campo id="ct-email" rotulo="E-mail" erro={erros.email}>
        <Input
          id="ct-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Campo>
      {!contato?.contato_nps && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={nps} onCheckedChange={(v) => setNps(v === true)} className="mt-0.5" />
          <span>
            Este é o contato que recebe o NPS
            {npsAtual && (
              <span className="block text-xs text-muted-foreground">
                Hoje é {npsAtual.nome}. Marcando aqui, passa a ser este.
              </span>
            )}
          </span>
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Enviando" : "Enviar ao CS"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DialogDesativar({
  conta,
  contato,
  fechar,
}: {
  conta: Conta;
  contato: ContatoConta | null;
  fechar: () => void;
}) {
  const ctx = useAcoesBase()!;
  const fn = useServerFn(abrirPedido);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <Dialog
      open={!!contato}
      onOpenChange={(v) => {
        if (!v) {
          fechar();
          setMotivo("");
          setErro(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Desativar {contato?.nome}?</DialogTitle>
          <DialogDescription>
            A pessoa deixa de ser contato de {conta.name}. O cadastro dela não é apagado.
          </DialogDescription>
        </DialogHeader>
        {contato?.contato_nps && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            É o contato do NPS. Sem outro marcado, o cliente fica sem pesquisa.
          </p>
        )}
        <Campo id="ds-motivo" rotulo="Por quê? *" erro={erro}>
          <Select value={motivo || undefined} onValueChange={setMotivo}>
            <SelectTrigger id="ds-motivo">
              <SelectValue placeholder="Escolha o motivo" />
            </SelectTrigger>
            <SelectContent>
              {MOTIVOS_DESATIVAR.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={enviando}
            onClick={async () => {
              if (!motivo) return setErro("Escolha o motivo.");
              setEnviando(true);
              try {
                await fn({
                  data: {
                    tipo: "contato_desativar",
                    key: conta.key,
                    contato: contato!.id,
                    proposto: { motivo },
                    pai: null,
                  },
                });
                toast.success("Pedido enviado ao CS.");
                ctx.atualizar();
                setMotivo("");
                fechar();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setEnviando(false);
              }
            }}
          >
            Enviar ao CS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Churn e não reconheço ============

function DialogChurn({ conta, fechar }: { conta: Conta | null; fechar: () => void }) {
  const ctx = useAcoesBase()!;
  const fn = useServerFn(informarChurn);
  const hoje = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(hoje);
  const [categoria, setCategoria] = useState("");
  const [relato, setRelato] = useState("");
  const [erros, setErros] = useState<Record<string, string | null>>({});
  const [enviando, setEnviando] = useState(false);
  const limpar = () => {
    setData(hoje);
    setCategoria("");
    setRelato("");
    setErros({});
  };
  return (
    <Dialog
      open={!!conta}
      onOpenChange={(v) => {
        if (!v) {
          fechar();
          limpar();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Informar churn</DialogTitle>
          <DialogDescription>
            {conta?.name} · ao enviar, abre na hora uma tratativa para o CS no Pipefy (pipe
            Tratativas, Contatar ASAP). O churn só conta quando o CS confirmar; até lá o cliente
            segue na base.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const novos = {
              data: !data || data > hoje ? "Informe a data (hoje ou antes)." : null,
              categoria: categoria ? null : "Escolha o motivo.",
              relato:
                relato.trim().length >= 10 ? null : "Conte o que aconteceu (10 letras ou mais).",
            };
            setErros(novos);
            if (Object.values(novos).some(Boolean) || !conta) return;
            setEnviando(true);
            try {
              await fn({ data: { key: conta.key, data, categoria, relato: relato.trim() } });
              toast.success("Tratativa aberta para o CS no Pipefy.");
              ctx.atualizar();
              limpar();
              fechar();
            } catch (err) {
              toast.error((err as Error).message);
              ctx.atualizar();
            } finally {
              setEnviando(false);
            }
          }}
        >
          <Campo id="ch-data" rotulo="Quando o cliente saiu ou avisou *" erro={erros.data}>
            <Input
              id="ch-data"
              type="date"
              max={hoje}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </Campo>
          <Campo id="ch-cat" rotulo="Motivo *" erro={erros.categoria}>
            <Select value={categoria || undefined} onValueChange={setCategoria}>
              <SelectTrigger id="ch-cat">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS_CHURN.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo id="ch-rel" rotulo="O que aconteceu *" erro={erros.relato}>
            <Textarea
              id="ch-rel"
              value={relato}
              onChange={(e) => setRelato(e.target.value)}
              placeholder="Ex.: o sócio avisou por e-mail em 20/10 que vai internalizar a contabilidade a partir de dezembro."
            />
          </Campo>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? "Abrindo a tratativa" : "Enviar ao CS"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogNaoReconheco({
  conta,
  contas,
  fechar,
}: {
  conta: Conta | null;
  contas: Conta[];
  fechar: () => void;
}) {
  const ctx = useAcoesBase()!;
  const fn = useServerFn(abrirPedido);
  const [motivo, setMotivo] = useState<keyof typeof NAO_RECONHECO | "">("");
  const [unidade, setUnidade] = useState("");
  const [outra, setOutra] = useState("");
  const [buscaOutra, setBuscaOutra] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const unidades = (ctx.perms?.unidades ?? []).filter((u) => !u.minha);
  const candidatas = useMemo(() => {
    const t = buscaOutra.trim().toLowerCase();
    if (t.length < 2) return [];
    return contas
      .filter((c) => c.key !== conta?.key && c.name.toLowerCase().includes(t))
      .slice(0, 8);
  }, [buscaOutra, contas, conta?.key]);
  const limpar = () => {
    setMotivo("");
    setUnidade("");
    setOutra("");
    setBuscaOutra("");
    setObs("");
    setErro(null);
  };
  return (
    <Dialog
      open={!!conta}
      onOpenChange={(v) => {
        if (!v) {
          fechar();
          limpar();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Não reconheço este cliente</DialogTitle>
          <DialogDescription>
            {conta?.name} · {conta?.base?.cnpjs.map(mascararCnpj).join(" · ")}. Ele continua na sua
            base até o CS decidir.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={motivo}
          onValueChange={(v) => setMotivo(v as typeof motivo)}
          className="space-y-2"
        >
          {(Object.keys(NAO_RECONHECO) as (keyof typeof NAO_RECONHECO)[]).map((k) => (
            <div key={k} className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value={k} />
                {NAO_RECONHECO[k]}
              </label>
              {k === "outra_unidade" && motivo === k && (
                <div className="ml-6">
                  <Select value={unidade || undefined} onValueChange={setUnidade}>
                    <SelectTrigger aria-label="Qual unidade?">
                      <SelectValue placeholder="Qual unidade?" />
                    </SelectTrigger>
                    <SelectContent>
                      {unidades.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {k === "mesma_empresa" && motivo === k && (
                <div className="ml-6 space-y-1">
                  <Input
                    aria-label="Buscar a outra linha da base"
                    placeholder="Buscar a outra linha pelo nome"
                    value={buscaOutra}
                    onChange={(e) => {
                      setBuscaOutra(e.target.value);
                      setOutra("");
                    }}
                  />
                  {candidatas.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => {
                        setOutra(c.key);
                        setBuscaOutra(c.name);
                      }}
                      className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${FOCO_VISIVEL} ${outra === c.key ? "bg-muted font-medium" : ""}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </RadioGroup>
        <Campo id="nr-obs" rotulo="Observação">
          <Textarea id="nr-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
        </Campo>
        {erro && (
          <p className="text-sm text-danger" role="alert">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            disabled={enviando}
            onClick={async () => {
              if (!motivo) return setErro("Escolha uma das opções.");
              if (motivo === "outra_unidade" && !unidade) return setErro("Diga qual unidade.");
              if (motivo === "mesma_empresa" && !outra)
                return setErro("Escolha a outra linha da base.");
              setEnviando(true);
              try {
                await fn({
                  data: {
                    tipo: "nao_reconheco",
                    key: conta!.key,
                    contato: null,
                    proposto: {
                      motivo,
                      unidade_id: motivo === "outra_unidade" ? Number(unidade) : null,
                      conta_key: motivo === "mesma_empresa" ? outra : null,
                      obs,
                    },
                    pai: null,
                  },
                });
                toast.success("Pedido enviado ao CS.");
                ctx.atualizar();
                limpar();
                fechar();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setEnviando(false);
              }
            }}
          >
            Enviar ao CS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Incluir cliente ============

function DialogIncluirCliente({
  aberto,
  fechar,
  aoIncluir,
}: {
  aberto: boolean;
  fechar: () => void;
  aoIncluir: (p: Pedido) => void;
}) {
  const ctx = useAcoesBase()!;
  const consultarFn = useServerFn(consultarCnpj);
  const abrirFn = useServerFn(abrirPedido);
  const [cnpj, setCnpj] = useState("");
  const [achado, setAchado] = useState<ConsultaCnpj | null>(null);
  const [desde, setDesde] = useState("");
  const minhas = (ctx.perms?.unidades ?? []).filter((u) => u.minha);
  const [unidade, setUnidade] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const limpar = () => {
    setCnpj("");
    setAchado(null);
    setDesde("");
    setUnidade("");
    setErro(null);
  };
  const livre = achado?.estado === "livre" ? achado : null;
  const unidadeEscolhida = unidade || (minhas.length === 1 ? String(minhas[0].id) : "");
  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          fechar();
          limpar();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir cliente</DialogTitle>
          <DialogDescription>
            Para cliente antigo da unidade que não está na base. Venda nova continua entrando pelo
            Pipedrive.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setErro(null);
            if (!livre) {
              if (cnpj.replace(/\D/g, "").length !== 14) return setErro("CNPJ tem 14 dígitos.");
              setOcupado(true);
              try {
                setAchado(await consultarFn({ data: { cnpj } }));
              } catch (err) {
                setErro((err as Error).message);
              } finally {
                setOcupado(false);
              }
              return;
            }
            if (!unidadeEscolhida) return setErro("Escolha a unidade do cliente.");
            setOcupado(true);
            try {
              const p = await abrirFn({
                data: {
                  tipo: "cliente_incluir",
                  key: null,
                  contato: null,
                  pai: null,
                  proposto: {
                    cnpj: livre.cnpj,
                    razao_social: livre.razao_social,
                    nome_fantasia: livre.nome_fantasia,
                    uf: livre.uf,
                    cidade: livre.cidade,
                    situacao_receita: livre.situacao_receita,
                    desde: desde || null,
                    unidade_id: Number(unidadeEscolhida),
                  },
                },
              });
              toast.success("Cliente incluído como declarado. Inclua o contato do NPS.");
              ctx.atualizar();
              limpar();
              aoIncluir(p);
            } catch (err) {
              setErro((err as Error).message);
            } finally {
              setOcupado(false);
            }
          }}
        >
          <Campo id="ic-cnpj" rotulo="CNPJ *">
            <Input
              id="ic-cnpj"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={cnpj}
              readOnly={!!livre}
              onChange={(e) => {
                setCnpj(e.target.value);
                setAchado(null);
              }}
            />
          </Campo>
          {achado?.estado === "na_sua_base" && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              Esse CNPJ já está na sua base: {achado.nome}.
            </p>
          )}
          {achado?.estado === "cliente_rede" && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              Esse CNPJ já está cadastrado na rede. Se o cliente é seu, fale com o CS.
            </p>
          )}
          {achado?.estado === "pedido" && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
              Já existe um pedido de inclusão para esse CNPJ, aguardando o CS.
            </p>
          )}
          {livre && (
            <>
              <div className="rounded-xl border bg-card p-3">
                <div className="font-medium">{livre.razao_social}</div>
                <div className="text-sm text-muted-foreground">
                  {[livre.nome_fantasia, livre.cidade && `${livre.cidade}/${livre.uf}`]
                    .filter(Boolean)
                    .join(" · ")}
                  {livre.situacao_receita
                    ? ` · situação na Receita: ${livre.situacao_receita.toLowerCase()}`
                    : ""}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Dados da Receita Federal (BrasilAPI)
                </div>
              </div>
              {minhas.length !== 1 && (
                <Campo id="ic-un" rotulo="Unidade *">
                  <Select value={unidade || undefined} onValueChange={setUnidade}>
                    <SelectTrigger id="ic-un">
                      <SelectValue placeholder="Escolha a unidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {(minhas.length ? minhas : (ctx.perms?.unidades ?? [])).map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}
              <Campo id="ic-desde" rotulo="Cliente desde (mês e ano)">
                <input
                  id="ic-desde"
                  type="month"
                  className={inputClass}
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </Campo>
              <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
                O cliente entra na sua base agora, marcado "Declarado pela unidade", e você já pode
                incluir contatos. O CS confere no Omie e na Central de Contratos. Cliente declarado
                não entra em MRR nem nos totais de clientes ativos.
              </p>
            </>
          )}
          {erro && (
            <p className="text-sm text-danger" role="alert">
              {erro}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            {livre && (
              <Button type="button" variant="ghost" onClick={limpar}>
                Outro CNPJ
              </Button>
            )}
            <Button type="submit" disabled={ocupado}>
              {ocupado ? "Aguarde" : livre ? "Enviar ao CS" : "Buscar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Meus pedidos ============

export function MeusPedidos() {
  const { user } = useAuth();
  const ctx = useAcoesBase();
  const fn = useServerFn(meusPedidos);
  const cancelarFn = useServerFn(cancelarPedido);
  const q = useQuery({
    queryKey: [...CHAVES_PEDIDOS, "meus", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
  });
  const [cancelando, setCancelando] = useState<string | null>(null);
  if (q.isLoading) return <Carregando variante="tabela" />;
  if (q.error)
    return (
      <EstadoErro detalhe={(q.error as Error).message} tentarNovamente={() => void q.refetch()} />
    );
  const lista = q.data ?? [];
  if (!lista.length)
    return (
      <EstadoVazio
        titulo="Nenhum pedido da sua unidade ainda"
        descricao="Pelos botões Contatos e ⋯ da lista de clientes você inclui contatos, marca o contato do NPS, informa churn ou diz que não reconhece um cliente."
      />
    );
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b p-4">
        <h2 className="font-semibold">Meus pedidos</h2>
        <p className="text-xs text-muted-foreground">
          Pedidos da sua unidade, do mais novo para o mais antigo · o CS responde em até 2 dias
          úteis
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">O que muda</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const s = situacaoDoPedido(p);
              const podeCancelar =
                p.situacao === "aberto" && !(p.tipo === "churn" && p.pipefy_ref) && !ctx?.bloqueio;
              return (
                <tr key={p.id} className="border-t align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{TIPO_PEDIDO[p.tipo]}</div>
                    <div className="text-xs text-muted-foreground">
                      {quando(p.criado_em)}
                      {p.autor ? ` · ${p.autor}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">{p.conta_nome}</td>
                  <td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">
                    {resumoDoPedido(p)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge>
                    {(p.motivo_recusa || (p.situacao === "erro" && p.erro)) && (
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                        {p.motivo_recusa ?? p.erro}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {podeCancelar && p.criado_por === user?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancelando === p.id}
                        onClick={async () => {
                          setCancelando(p.id);
                          try {
                            await cancelarFn({ data: { id: p.id } });
                            toast.success("Pedido cancelado.");
                            ctx?.atualizar();
                          } catch (e) {
                            toast.error((e as Error).message);
                          } finally {
                            setCancelando(null);
                          }
                        }}
                      >
                        Cancelar
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
