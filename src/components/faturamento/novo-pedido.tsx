import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, OctagonAlert, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import {
  useContextoFaturamento,
  useDepartamentosFaturamento,
  useFichaPedido,
  usePreviaParcelas,
  useReler,
  useServicosFaturamento,
} from "@/hooks/use-faturamento";
import { desembrulhar, ErroFaturamento, tipoDoErro } from "@/lib/faturamento/erros";
import {
  conferirTomadorFaturamento,
  descartarPedidoFaturamento,
  enviarPedidoFaturamento,
  salvarPedidoFaturamento,
} from "@/lib/faturamento/faturamento.functions";
import { faixaDaSituacao } from "@/lib/faturamento/ficha";
import {
  dataCompleta,
  dinheiro,
  diaSP,
  documento as formatarDocumento,
  listaNomes,
  mesCorrenteSP,
  rotuloMes,
} from "@/lib/faturamento/formato";
import {
  competenciaDoFormulario,
  dadosParaSalvar,
  descricaoPadrao,
  documentoValido,
  emailValido,
  erroDoDocumento,
  errosDoCampo,
  avisoDoVencimento,
  formularioDoPedido,
  formularioVazio,
  opcoesDeCompetencia,
  previaPronta,
  fraseAoEnviar,
  juntarEmails,
  lerValor,
  mascararDocumento,
  normalizarDocumento,
  normalizarProjeto,
  parcelasDoFormulario,
  pendenciasLocais,
  rotuloEnviar,
  valorParaDigitar,
  type FormPedido,
} from "@/lib/faturamento/formulario";
import { LIMIAR_SUGESTAO, TEMPO_JEV_MS } from "@/lib/faturamento/jev";
import { fraseSimulacao, procedenciaFaturamento } from "@/lib/faturamento/rotulos";
import type {
  Contexto,
  ErroCampo,
  FichaPedido,
  ServicoCatalogo,
  TomadorConferido,
} from "@/lib/faturamento/tipos";
import { cn } from "@/lib/utils";
import { AREA_FATURAMENTO, ErroDaArea, PaginaFaturamento, SeloSituacao } from "./moldura";

/**
 * Novo pedido (`/faturamento/novo`), Ficha em modo de edição. Contrato
 * `docs/design/contratos/faturamento-novo.md`: "O que precisa ser faturado, para quem e como?".
 *
 * Quatro seções na ordem da lista da Ana (spec §5.2), com o Dono da receita logo depois da empresa (a lista
 * não tem; o contrato pôs). O cliente é conferido e buscado pelo documento (`fat_tomador`, que consulta a
 * Receita quando falta); o serviço vem do catálogo da empresa (`fat_servicos`); a prévia das parcelas vem
 * da mesma função que grava no envio (`fat_parcelas_previa`). Recibo e nota de débito também saem por OS no
 * Omie (resposta 7 da Ana).
 *
 * O lugar da sugestão de serviço e do aviso de descrição (T5, o Jev) já está aqui, atrás de `assistente`:
 * sem ele, o botão e o aviso não aparecem (não é falta de permissão, então não ficam desabilitados).
 */

const PERGUNTA = "O que precisa ser faturado, para quem e como?";

/**
 * O que o assistente recebe da tela. `nomeCliente` só serve para o servidor tirar o nome do texto antes de ir
 * ao Jev; nunca é enviado a ele.
 */
export interface EntradaAssistente {
  emissoraId: string;
  projeto: string;
  descricao: string;
  valor: number | null;
  nomeCliente: string | null;
  /** O documento do cliente: o servidor busca o nome dele para tirar do texto. Nunca vai ao Jev. */
  documento: string | null;
}

/** A sugestão de serviço e a conferência da descrição (T5). Desligada enquanto ninguém passa isto. */
export interface AssistenteServico {
  /** Escolhe, dentro do catálogo da empresa, o serviço que combina com o projeto e a descrição. */
  /** `servicoId` nulo: nenhum serviço do catálogo combina. A confiança decide se a tela mostra. */
  sugerir: (
    entrada: EntradaAssistente,
  ) => Promise<{ servicoId: string | null; confianca: number | null }>;
  /** `false` quando a descrição não parece ser do serviço escolhido. */
  conferirDescricao: (entrada: EntradaAssistente & { servicoId: string }) => Promise<boolean>;
}

type Busca = { pedido?: string; emissora?: string };

export function NovoPedido({
  busca,
  assistente,
}: {
  busca: Busca;
  assistente?: AssistenteServico;
}) {
  const contexto = useContextoFaturamento();
  // O pedido criado nesta tela: a URL ganha o id no primeiro "Salvar rascunho", e o formulário que já está
  // aberto continua o mesmo (sem recarregar do banco nem perder o quadro do cliente).
  const [criadoAqui, setCriadoAqui] = useState<string | null>(null);
  const deFora = !!busca.pedido && busca.pedido !== criadoAqui;
  const ficha = useFichaPedido(busca.pedido, deFora);
  const navigate = useNavigate();
  const ctx = contexto.data;

  // Pedido que já saiu de rascunho ou devolvido não se edita: a Ficha diz em que pé está.
  const naoEdita =
    deFora && !!ficha.data && !["rascunho", "devolvido"].includes(ficha.data.pedido.status);
  useEffect(() => {
    if (naoEdita && busca.pedido)
      void navigate({ to: "/faturamento/pedido/$id", params: { id: busca.pedido }, replace: true });
  }, [naoEdita, busca.pedido, navigate]);

  const cabecalho = <PageHeader area={AREA_FATURAMENTO} titulo="Novo pedido" pergunta={PERGUNTA} />;

  if (contexto.isPending || (deFora && ficha.isPending) || naoEdita)
    return (
      <PaginaFaturamento>
        <Carregando variante="pagina" />
      </PaginaFaturamento>
    );
  if (contexto.error || !ctx)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <ErroDaArea erro={contexto.error} tentarNovamente={() => void contexto.refetch()} />
      </PaginaFaturamento>
    );
  if (deFora && (ficha.error || !ficha.data))
    return (
      <PaginaFaturamento>
        {cabecalho}
        <ErroDaArea
          erro={ficha.error}
          oQueFalta="ser o autor, o dono ou o gestor deste pedido"
          tentarNovamente={() => void ficha.refetch()}
        />
      </PaginaFaturamento>
    );
  // Quem tem a porta e nenhum papel de pedir vê a tela vazia com o recado, não "sem acesso" (contrato, Estados;
  // decisão do coordenador de 20/10/2026).
  if (!ctx.emissoras.some((e) => e.pode_pedir))
    return (
      <PaginaFaturamento>
        {cabecalho}
        <EstadoVazio
          titulo="Você ainda não pode pedir faturamento em nenhuma empresa."
          descricao="Quem cadastra é a controladoria (Ana Carvalhais)."
        />
      </PaginaFaturamento>
    );
  if (deFora && ficha.data && !ficha.data.acoes.editar.pode)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <EstadoSemAcesso oQueFalta={ficha.data.acoes.editar.motivo ?? "ser o autor deste pedido"} />
      </PaginaFaturamento>
    );

  return (
    <Formulario
      key={deFora ? (ficha.data?.pedido.id ?? "novo") : "novo"}
      ctx={ctx}
      ficha={deFora ? (ficha.data ?? null) : null}
      emissoraDaUrl={busca.emissora}
      assistente={assistente}
      aoCriar={setCriadoAqui}
    />
  );
}

// ------------------------------------------------------------------ o formulário

function inicioDoFormulario(
  ctx: Contexto,
  ficha: FichaPedido | null,
  emissoraDaUrl?: string,
): FormPedido {
  if (ficha) return formularioDoPedido(ficha);
  const podem = ctx.emissoras.filter((e) => e.pode_pedir);
  const escolhida =
    podem.find((e) => e.apelido === emissoraDaUrl) ?? (podem.length === 1 ? podem[0] : undefined);
  return formularioVazio({
    emissora_id: escolhida?.id ?? null,
    dono_id: escolhida?.meus_papeis.includes("dono") ? ctx.usuario.id : null,
  });
}

function Formulario({
  ctx,
  ficha,
  emissoraDaUrl,
  assistente,
  aoCriar,
}: {
  ctx: Contexto;
  ficha: FichaPedido | null;
  emissoraDaUrl?: string;
  assistente?: AssistenteServico;
  aoCriar: (id: string) => void;
}) {
  const navigate = useNavigate();
  const reler = useReler();
  const [form, setForm] = useState<FormPedido>(() => inicioDoFormulario(ctx, ficha, emissoraDaUrl));
  const [salvo, setSalvo] = useState<{ id: string; numero: string; status: string } | null>(
    ficha
      ? { id: ficha.pedido.id, numero: ficha.pedido.numero, status: ficha.pedido.status }
      : null,
  );
  const [sujo, setSujo] = useState(false);
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [errosServidor, setErrosServidor] = useState<ErroCampo[]>([]);
  const [tomador, setTomador] = useState<TomadorConferido | null>(null);
  // A empresa em que a busca foi feita: o aviso de contrato "em outra empresa" é relativo a ela.
  const [tomadorEmissora, setTomadorEmissora] = useState<string | null>(null);
  const [descartar, setDescartar] = useState(false);
  // "Sugerir outro serviço" (aviso de descrição) pede a sugestão de novo.
  const [pedirSugestao, setPedirSugestao] = useState(0);
  // A descrição que o aviso do Jev confere: muda ao sair do campo (o contrato pede "ao sair do campo
  // Descrição"), não a cada tecla.
  const [descricaoConferida, setDescricaoConferida] = useState(ficha?.pedido.descricao_nf ?? "");
  const saindo = useRef(false);
  const hojeSP = diaSP(new Date()) as string;

  const podem = ctx.emissoras.filter((e) => e.pode_pedir || e.id === form.emissora_id);
  const emissora = ctx.emissoras.find((e) => e.id === form.emissora_id) ?? null;
  const donos = emissora?.donos ?? [];
  const souDono = !!form.dono_id && form.dono_id === ctx.usuario.id;
  const nomeDono =
    donos.find((d) => d.id === form.dono_id)?.nome ?? (souDono ? ctx.usuario.nome : null);
  const simulacao = emissora?.modo_omie === "simular";

  const servicos = useServicosFaturamento(form.emissora_id);
  const departamentos = useDepartamentosFaturamento();
  // O cliente que vale é o da busca do documento e da empresa de agora.
  const tomadorAtual =
    tomador &&
    tomadorEmissora === form.emissora_id &&
    normalizarDocumento(tomador.documento) === normalizarDocumento(form.tomador_documento)
      ? tomador
      : null;
  const contratos =
    tomadorAtual?.contratos_outra_emissora ?? ficha?.pedido.contratos_outra_emissora ?? [];
  const bloqueio = tomadorAtual?.bloqueio?.motivo ?? null;

  // Prévia: só depois de a pessoa parar de digitar (meio segundo).
  const valorNum = lerValor(form.valor);
  const parcelasNum = parcelasDoFormulario(form);
  const [previaPedida, setPreviaPedida] = useState<[number | null, number | null, string | null]>([
    null,
    null,
    null,
  ]);
  useEffect(() => {
    const t = setTimeout(
      () => setPreviaPedida([valorNum, parcelasNum, form.primeiro_vencimento || null]),
      500,
    );
    return () => clearTimeout(t);
  }, [valorNum, parcelasNum, form.primeiro_vencimento]);
  const previa = usePreviaParcelas(...previaPedida);

  // Só marca o formulário como alterado (e tira o erro do banco do campo) quando o valor muda de verdade.
  const formRef = useRef(form);
  formRef.current = form;
  const mudar = (parcial: Partial<FormPedido>) => {
    const atual = formRef.current;
    const mudou = (Object.keys(parcial) as (keyof FormPedido)[]).filter(
      (k) => JSON.stringify(atual[k]) !== JSON.stringify(parcial[k]),
    );
    if (!mudou.length) return;
    setForm((f) => ({ ...f, ...parcial }));
    setSujo(true);
    setErrosServidor((es) =>
      es.filter((e) => !e.campo || !mudou.includes(e.campo as keyof FormPedido)),
    );
  };

  // ---------- cliente
  const tomadorFn = useServerFn(conferirTomadorFaturamento);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  // A resposta só vale se ainda é do documento e da empresa do formulário: a consulta à Receita pode levar
  // segundos, e uma resposta velha não pode trocar o bloqueio nem o aviso de contrato do cliente novo.
  const daBuscaAtual = (args: { documento: string; emissora: string }) =>
    args.documento === normalizarDocumento(formRef.current.tomador_documento) &&
    args.emissora === formRef.current.emissora_id;
  const buscarTomador = useMutation({
    mutationFn: async (args: { documento: string; emissora: string }) =>
      desembrulhar(await tomadorFn({ data: args })),
    onSuccess: (t, args) => {
      if (!daBuscaAtual(args)) return;
      setErroBusca(null);
      setTomador(t);
      setTomadorEmissora(args.emissora);
      if (!t.valido) return;
      const f = formRef.current;
      // O nome vem do cadastro (PJ); a pessoa ainda pode corrigir. PF: o nome é digitado. Passa por `mudar`,
      // para o Enviar salvar antes o que veio preenchido.
      mudar({
        tomador_nome:
          f.tomador_tipo === "pj" && t.nome && (!f.tomador_nome || f.tomador_nome === tomador?.nome)
            ? t.nome
            : f.tomador_nome,
        emails_envio: f.emails_envio.length ? f.emails_envio : juntarEmails([], t.emails),
      });
    },
    onError: (e, args) => {
      if (!daBuscaAtual(args)) return;
      setTomador(null);
      // Sem papel na empresa, o banco recusa a busca (e não abre nome, e-mail nem contrato do cliente): o
      // quadro diz por quê, sem alarme, e o pedido segue com o nome digitado.
      const apelido = ctx.emissoras.find((x) => x.id === args.emissora)?.apelido ?? "esta empresa";
      setErroBusca(
        tipoDoErro(e) === "sem_acesso"
          ? `A busca do cliente na ${apelido} é de quem pede faturamento por ela.`
          : e instanceof Error
            ? e.message
            : "Não deu para buscar o cliente agora.",
      );
    },
  });
  const conferirDocumento = (doc: string, emissoraId: string | null) => {
    // A busca sempre leva a empresa: o banco confere o papel nela antes de abrir o cadastro do cliente.
    if (documentoValido(doc) && emissoraId)
      buscarTomador.mutate({ documento: normalizarDocumento(doc), emissora: emissoraId });
  };
  // Ao abrir um rascunho com documento, o quadro do cliente já vem preenchido.
  const conferiuInicio = useRef(false);
  useEffect(() => {
    if (
      !conferiuInicio.current &&
      form.tomador_documento &&
      documentoValido(form.tomador_documento)
    ) {
      conferiuInicio.current = true;
      conferirDocumento(form.tomador_documento, form.emissora_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trocarEmissora = (id: string) => {
    const nova = ctx.emissoras.find((e) => e.id === id);
    const tinhaServico = !!form.servico_id;
    mudar({
      emissora_id: id,
      servico_id: null,
      confirmou_emissora: false,
      dono_id: nova?.meus_papeis.includes("dono") ? ctx.usuario.id : null,
    });
    if (tinhaServico) toast.message("O serviço foi limpo: o catálogo é por empresa.");
    // O aviso de contrato em outra empresa depende da empresa escolhida.
    conferirDocumento(form.tomador_documento, id);
  };

  // ---------- serviço
  const servicoEscolhido = servicos.data?.servicos.find((s) => s.id === form.servico_id) ?? null;
  const escolherServico = (s: ServicoCatalogo) => {
    // Com a descrição já escrita, o aviso de "não combina" (T5) confere o par novo.
    if (form.descricao_nf.trim()) setDescricaoConferida(form.descricao_nf);
    mudar({
      servico_id: s.id,
      descricao_nf: form.descricao_nf.trim()
        ? form.descricao_nf
        : descricaoPadrao(s.descricao, form.projeto, competenciaDoFormulario(form)),
    });
  };

  // ---------- erros
  const locais = pendenciasLocais(form, { contratoEmOutra: contratos.length > 0, bloqueio });
  const erros = tentouEnviar
    ? [...errosServidor, ...locais.filter((l) => !errosServidor.some((s) => s.campo === l.campo))]
    : errosServidor;
  const erroDe = (campo: string) => errosDoCampo(erros, campo);
  const gerais = erros.filter((e) => e.campo === null);

  // ---------- salvar, enviar, descartar
  const salvarFn = useServerFn(salvarPedidoFaturamento);
  const enviarFn = useServerFn(enviarPedidoFaturamento);
  const descartarFn = useServerFn(descartarPedidoFaturamento);

  const salvarAgora = async () => {
    const r = desembrulhar(
      await salvarFn({ data: { id: salvo?.id ?? null, dados: dadosParaSalvar(form) } }),
    );
    setSalvo({ id: r.id, numero: r.numero, status: r.status });
    setSujo(false);
    if (!salvo) {
      // A URL ganha o id (troca sem empilhar): recarregar não perde nada.
      aoCriar(r.id);
      saindo.current = true;
      void navigate({ to: "/faturamento/novo", search: { pedido: r.id }, replace: true }).finally(
        () => {
          saindo.current = false;
        },
      );
    }
    return r;
  };

  const salvar = useMutation({
    mutationFn: salvarAgora,
    onSuccess: (r) => {
      setErrosServidor([]);
      toast.success(`Rascunho salvo · ${r.numero}`);
      void reler();
    },
    onError: (e) => {
      if (e instanceof ErroFaturamento && e.tipo === "validacao") setErrosServidor(e.campos);
      toast.error(e instanceof Error ? e.message : "O rascunho não foi salvo.");
    },
  });

  const enviar = useMutation({
    mutationFn: async () => {
      const r = sujo || !salvo ? await salvarAgora() : salvo;
      return desembrulhar(await enviarFn({ data: { id: r.id } }));
    },
    onSuccess: (r) => {
      saindo.current = true;
      toast.success(
        r.aguardando
          ? `Enviado para o OK de ${r.aguardando.nome}.`
          : r.simulacao_emissora
            ? "Enviado em simulação."
            : `Enviado. Vai ao Omie da ${emissora?.apelido ?? "empresa"}.`,
      );
      void reler();
      void navigate({
        to: "/faturamento/pedido/$id",
        params: { id: r.id },
        search: { volta: "/faturamento/pedidos" },
      });
    },
    onError: (e) => {
      if (e instanceof ErroFaturamento && e.tipo === "validacao") setErrosServidor(e.campos);
      toast.error(e instanceof Error ? e.message : "O pedido não foi enviado.");
    },
  });

  const descartarPedido = useMutation({
    mutationFn: async () => desembrulhar(await descartarFn({ data: { id: salvo?.id as string } })),
    onSuccess: (r) => {
      saindo.current = true;
      toast.success(`Rascunho descartado: ${r.numero} ficou como Cancelado.`);
      void reler();
      void navigate({ to: "/faturamento/pedidos" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "O rascunho não foi descartado."),
  });

  const clicarEnviar = () => {
    setTentouEnviar(true);
    if (locais.length) {
      toast.error(
        locais.length === 1
          ? `Falta um campo: ${locais[0].mensagem}`
          : `Faltam ${locais.length} campos. Veja as marcas abaixo de cada um.`,
      );
      return;
    }
    enviar.mutate();
  };

  // ---------- sair sem salvar (N7: descartar rascunho sempre pergunta)
  const saida = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      sujo && !saindo.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => sujo,
    withResolver: true,
  });

  // ---------- textos
  const apelidos = ctx.emissoras.filter((e) => e.pode_pedir).map((e) => e.apelido);
  const simulacoes = fraseSimulacao(emissora && simulacao ? [emissora.apelido] : []);
  const universo = [
    "Pedido pontual, avulso ou parcelado",
    `empresas em que você pode pedir: ${listaNomes(apelidos)}`,
    "vai ao Omie da empresa escolhida",
    simulacoes,
  ]
    .filter(Boolean)
    .join(" · ");
  const status = salvo?.status ?? ficha?.pedido.status ?? null;
  const faixa = ficha && ficha.pedido.status === "devolvido" ? faixaDaSituacao(ficha) : null;
  const ocupado = salvar.isPending || enviar.isPending || descartarPedido.isPending;
  const podeDescartar = !!salvo && (ficha ? ficha.acoes.descartar.pode : true);
  const motivoEnvio = bloqueio
    ? bloqueio
    : contratos.length > 0 && !form.confirmou_emissora
      ? "Confirme a empresa que fatura"
      : null;

  return (
    <PaginaFaturamento>
      <nav
        aria-label="Trilha"
        className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground"
      >
        <span>Faturamento</span>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link
          to="/faturamento/pedidos"
          className="text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Pedidos
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{salvo?.numero ?? "Novo pedido"}</span>
      </nav>
      <PageHeader
        area={AREA_FATURAMENTO}
        titulo={salvo?.numero ?? "Novo pedido"}
        pergunta={PERGUNTA}
        procedencia={procedenciaFaturamento(ctx)}
        descricao={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {status && <SeloSituacao situacao={status} />}
            <span>{universo}</span>
          </span>
        }
      />

      {faixa && (
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-foreground">{faixa}</p>
      )}
      {gerais.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-foreground"
        >
          {gerais.map((g) => (
            <p key={g.mensagem} className="flex items-start gap-2">
              <OctagonAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              {g.mensagem}
            </p>
          ))}
        </div>
      )}

      {/* Seção 1 */}
      <Secao titulo="Quem fatura, e para quem?">
        <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
          <Campo id="fat-emissora" rotulo="Empresa que fatura" erros={erroDe("emissora_id")}>
            <Select value={form.emissora_id ?? ""} onValueChange={trocarEmissora}>
              <SelectTrigger id="fat-emissora" className="h-9">
                <SelectValue placeholder="Escolha a empresa" />
              </SelectTrigger>
              <SelectContent>
                {podem.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.apelido} · {e.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          <Campo
            id="fat-dono"
            rotulo="Dono da receita"
            ajuda="Quem responde pelo que é faturado. Quando não é você, o pedido vai para o OK dele."
            erros={erroDe("dono_id")}
          >
            {!emissora ? (
              <BotaoComMotivo
                rotulo="Escolha o dono"
                motivo="Escolha a empresa que fatura primeiro"
                variant="outline"
              />
            ) : donos.length === 0 && !souDono ? (
              <p className="text-sm text-muted-foreground">
                A {emissora.apelido} ainda não tem dono cadastrado. Peça à controladoria (Ana
                Carvalhais).
              </p>
            ) : (
              <Select value={form.dono_id ?? ""} onValueChange={(v) => mudar({ dono_id: v })}>
                <SelectTrigger id="fat-dono" className="h-9">
                  <SelectValue placeholder="Escolha o dono" />
                </SelectTrigger>
                <SelectContent>
                  {donos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                      {d.id === ctx.usuario.id ? " (você)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Campo>

          {contratos.length > 0 && (
            <div className="space-y-3 rounded-xl border bg-card p-3 md:col-span-2">
              <p className="text-sm text-foreground">
                Este cliente tem contrato vigente na{" "}
                {listaNomes([...new Set(contratos.map((c) => c.emissora.apelido))])}. Você escolheu
                a {emissora?.apelido ?? "outra empresa"}.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.confirmou_emissora}
                    onCheckedChange={(v) => mudar({ confirmou_emissora: v === true })}
                  />
                  Confirmo que quem fatura é a {emissora?.apelido ?? "empresa escolhida"}
                </label>
                {contratos
                  .map((c) => ctx.emissoras.find((e) => e.id === c.emissora.id && e.pode_pedir))
                  .filter(
                    (e, i, todos): e is NonNullable<typeof e> => !!e && todos.indexOf(e) === i,
                  )
                  .map((e) => (
                    <Button
                      key={e.id}
                      variant="outline"
                      size="sm"
                      onClick={() => trocarEmissora(e.id)}
                    >
                      Trocar para {e.apelido}
                    </Button>
                  ))}
              </div>
              {tomadorAtual?.contratos_lidos_em && (
                <p className="text-[13px] text-muted-foreground">
                  Contratos lidos do Omie em {dataCompleta(tomadorAtual.contratos_lidos_em)}.
                </p>
              )}
              {erroDe("confirmou_emissora").map((m) => (
                <MensagemErro key={m} mensagem={m} />
              ))}
            </div>
          )}

          <Campo id="fat-tipo" rotulo="Cliente PF ou PJ">
            <RadioGroup
              id="fat-tipo"
              value={form.tomador_tipo}
              onValueChange={(v) => {
                mudar({ tomador_tipo: v as "pj" | "pf", tomador_documento: "" });
                setTomador(null);
              }}
              className="flex gap-4"
            >
              <Opcao valor="pj" rotulo="PJ (CNPJ)" />
              <Opcao valor="pf" rotulo="PF (CPF)" />
            </RadioGroup>
          </Campo>

          <Campo
            id="fat-documento"
            rotulo={form.tomador_tipo === "pj" ? "CNPJ" : "CPF"}
            ajuda={
              form.tomador_tipo === "pj"
                ? "Aceita o CNPJ com letras (o novo formato da Receita)."
                : undefined
            }
            erros={[
              ...erroDe("tomador_documento"),
              ...(!tentouEnviar &&
              form.tomador_documento &&
              normalizarDocumento(form.tomador_documento).length >=
                (form.tomador_tipo === "pj" ? 14 : 11)
                ? [erroDoDocumento(form.tomador_tipo, form.tomador_documento)].filter(
                    (x): x is string => !!x,
                  )
                : []),
            ]}
          >
            <Input
              id="fat-documento"
              value={form.tomador_documento}
              inputMode={form.tomador_tipo === "pf" ? "numeric" : "text"}
              autoCapitalize="characters"
              placeholder={form.tomador_tipo === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
              onChange={(e) =>
                mudar({ tomador_documento: mascararDocumento(form.tomador_tipo, e.target.value) })
              }
              onBlur={() => conferirDocumento(form.tomador_documento, form.emissora_id)}
              className="h-9"
            />
          </Campo>

          <QuadroCliente
            tipo={form.tomador_tipo}
            buscando={buscarTomador.isPending}
            tomador={tomadorAtual}
            documento={form.tomador_documento}
            semEmpresa={!form.emissora_id}
            erro={erroBusca}
          />

          <Campo id="fat-nome" rotulo="Nome do cliente" erros={erroDe("tomador_nome")}>
            <Input
              id="fat-nome"
              value={form.tomador_nome}
              onChange={(e) => mudar({ tomador_nome: e.target.value })}
              className="h-9"
            />
          </Campo>

          <Campo
            id="fat-emails"
            rotulo="E-mail para envio"
            ajuda="Um ou mais. Vêm do cadastro quando existem; dá para tirar e acrescentar."
            erros={erroDe("emails_envio")}
          >
            <Emails valor={form.emails_envio} aoMudar={(v) => mudar({ emails_envio: v })} />
          </Campo>
        </div>
      </Secao>

      {/* Seção 2 */}
      <Secao titulo="O que foi feito?">
        <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
          <Campo id="fat-projeto" rotulo="Nome do projeto" erros={erroDe("projeto")}>
            <Input
              id="fat-projeto"
              value={form.projeto}
              onChange={(e) => mudar({ projeto: e.target.value })}
              onBlur={() =>
                form.projeto !== normalizarProjeto(form.projeto) &&
                mudar({ projeto: normalizarProjeto(form.projeto) })
              }
              className="h-9"
            />
          </Campo>

          <Campo id="fat-servico" rotulo="Serviço" erros={erroDe("servico_id")}>
            <CampoServico
              emissora={emissora?.apelido ?? null}
              servicos={servicos.data?.servicos ?? null}
              carregando={servicos.isFetching && !servicos.data}
              semTributacao={servicos.data?.sem_tributacao ?? 0}
              escolhido={servicoEscolhido}
              aoEscolher={escolherServico}
            />
            {assistente && emissora && (
              <SugestaoServico
                // A sugestão é da empresa: trocar a empresa começa outra (achado da revisão de 20/10/2026).
                key={emissora.id}
                assistente={assistente}
                emissoraId={emissora.id}
                apelido={emissora.apelido}
                projeto={form.projeto}
                descricao={form.descricao_nf}
                valor={valorNum}
                nomeCliente={form.tomador_nome || null}
                documento={normalizarDocumento(form.tomador_documento) || null}
                servicos={servicos.data?.servicos ?? []}
                aoUsar={escolherServico}
                gatilho={pedirSugestao}
              />
            )}
          </Campo>

          <Campo
            id="fat-descricao"
            rotulo="Descrição da nota"
            ajuda="O texto que vai na nota. Com o serviço escolhido e a descrição vazia, vem o padrão, editável."
            erros={erroDe("descricao_nf")}
            largura="inteira"
          >
            <Textarea
              id="fat-descricao"
              value={form.descricao_nf}
              rows={3}
              maxLength={2000}
              onChange={(e) => mudar({ descricao_nf: e.target.value })}
              onBlur={() => setDescricaoConferida(form.descricao_nf)}
            />
            {assistente && emissora && form.servico_id && (
              <AvisoDescricao
                assistente={assistente}
                emissoraId={emissora.id}
                servicoId={form.servico_id}
                servico={servicoEscolhido?.descricao ?? "o serviço"}
                descricao={descricaoConferida}
                valor={valorNum}
                nomeCliente={form.tomador_nome || null}
                documento={normalizarDocumento(form.tomador_documento) || null}
                aoSugerirOutro={() => setPedirSugestao((n) => n + 1)}
              />
            )}
          </Campo>
        </div>
      </Secao>

      {/* Seção 3 */}
      <Secao titulo="Quanto e como cobrar?">
        <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
          <Campo id="fat-valor" rotulo="Valor (R$)" erros={erroDe("valor")}>
            <Input
              id="fat-valor"
              value={form.valor}
              inputMode="decimal"
              placeholder="0,00"
              onChange={(e) => mudar({ valor: e.target.value })}
              onBlur={() => {
                const v = lerValor(form.valor);
                if (v !== null) mudar({ valor: valorParaDigitar(v) });
              }}
              className="num h-9"
            />
          </Campo>

          <Campo
            id="fat-documento-fiscal"
            rotulo="Nota fiscal, recibo ou nota de débito"
            ajuda="Recibo e nota de débito também saem por OS no Omie, como hoje."
            erros={erroDe("documento")}
          >
            <RadioGroup
              id="fat-documento-fiscal"
              value={form.documento ?? ""}
              onValueChange={(v) => mudar({ documento: v as FormPedido["documento"] })}
              className="flex flex-wrap gap-4"
            >
              <Opcao valor="nf" rotulo="Nota fiscal" />
              <Opcao valor="recibo" rotulo="Recibo" />
              <Opcao valor="nd" rotulo="Nota de débito" />
            </RadioGroup>
          </Campo>

          <Campo
            id="fat-forma"
            rotulo="À vista ou parcelado"
            erros={[...erroDe("forma"), ...erroDe("parcelas")]}
          >
            <div className="flex flex-wrap items-center gap-4">
              <RadioGroup
                id="fat-forma"
                value={form.forma ?? ""}
                onValueChange={(v) =>
                  mudar({
                    forma: v as FormPedido["forma"],
                    parcelas: v === "parcelado" ? form.parcelas || "2" : "",
                  })
                }
                className="flex gap-4"
              >
                <Opcao valor="avulso" rotulo="À vista" />
                <Opcao valor="parcelado" rotulo="Parcelado" />
              </RadioGroup>
              {form.forma === "parcelado" && (
                <label className="flex items-center gap-2 text-sm">
                  <span>Número de parcelas</span>
                  <Input
                    type="number"
                    min={2}
                    max={36}
                    value={form.parcelas}
                    onChange={(e) => mudar({ parcelas: e.target.value })}
                    className="num h-9 w-20"
                  />
                </label>
              )}
            </div>
          </Campo>

          <Campo id="fat-meio" rotulo="Boleto ou pix" erros={erroDe("meio")}>
            <RadioGroup
              id="fat-meio"
              value={form.meio ?? ""}
              onValueChange={(v) => mudar({ meio: v as FormPedido["meio"] })}
              className="flex gap-4"
            >
              <Opcao valor="boleto" rotulo="Boleto" />
              <Opcao valor="pix" rotulo="Pix" />
            </RadioGroup>
          </Campo>

          <Campo id="fat-vencimento" rotulo="1º vencimento" erros={erroDe("primeiro_vencimento")}>
            <Input
              id="fat-vencimento"
              type="date"
              value={form.primeiro_vencimento}
              onChange={(e) => mudar({ primeiro_vencimento: e.target.value })}
              className="num h-9 w-48"
            />
            {/* Vencimento no passado não bloqueia (decisão pendente da Ana); o campo só avisa. */}
            {avisoDoVencimento(form.primeiro_vencimento, hojeSP) && (
              <p className="text-[13px] text-muted-foreground">
                {avisoDoVencimento(form.primeiro_vencimento, hojeSP)}
              </p>
            )}
          </Campo>

          <Campo
            id="fat-competencia"
            rotulo="Competência (opcional)"
            ajuda="Vem com o mês do 1º vencimento e acompanha a data até você mudar à mão."
            erros={erroDe("competencia")}
          >
            <Select
              value={form.competencia_manual ? form.competencia : "automatica"}
              onValueChange={(v) =>
                v === "automatica"
                  ? mudar({ competencia: "", competencia_manual: false })
                  : mudar({ competencia: v, competencia_manual: true })
              }
            >
              <SelectTrigger id="fat-competencia" className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="automatica">
                  {competenciaDoFormulario({ ...form, competencia_manual: false })
                    ? `Mês do 1º vencimento (${rotuloMes(competenciaDoFormulario({ ...form, competencia_manual: false }))})`
                    : "Mês do 1º vencimento"}
                </SelectItem>
                {opcoesDeCompetencia(
                  mesCorrenteSP(),
                  form.competencia_manual ? form.competencia : null,
                ).map((o) => (
                  <SelectItem key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </div>
      </Secao>

      {/* Seção 4 */}
      <Secao titulo="Mais alguma coisa?">
        <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
          <Campo
            id="fat-departamento"
            rotulo="Departamento (opcional)"
            erros={erroDe("departamento")}
          >
            <Select
              value={form.departamento ?? "nenhum"}
              onValueChange={(v) => mudar({ departamento: v === "nenhum" ? null : v })}
            >
              <SelectTrigger id="fat-departamento" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Sem departamento</SelectItem>
                {(departamentos.data?.departamentos ?? []).map((d) => (
                  <SelectItem key={d.nome} value={d.nome}>
                    {d.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo
            id="fat-observacoes"
            rotulo="Observações"
            ajuda="Não é usado para regra: quem confere lê, o Omie não."
            erros={erroDe("observacoes")}
            largura="inteira"
          >
            <Textarea
              id="fat-observacoes"
              value={form.observacoes}
              rows={3}
              maxLength={4000}
              onChange={(e) => mudar({ observacoes: e.target.value })}
            />
          </Campo>
        </div>
      </Secao>

      <Secao
        titulo="Como o valor fica dividido?"
        descricao="A última parcela leva os centavos que sobram da divisão. As parcelas que valem são as gravadas no envio."
      >
        <PreviaParcelas
          pronta={previaPronta(valorNum, parcelasNum, form.primeiro_vencimento || null)}
          // Enquanto a prévia pedida não é a dos campos de agora (meio segundo depois de digitar), ou o
          // banco ainda responde, a tela espera: nunca mostra a divisão de outro valor.
          carregando={
            previa.isFetching ||
            previaPedida[0] !== valorNum ||
            previaPedida[1] !== parcelasNum ||
            previaPedida[2] !== (form.primeiro_vencimento || null)
          }
          parcelas={previa.data?.parcelas ?? null}
          total={previa.data?.total ?? null}
          erro={previa.error instanceof Error ? previa.error.message : null}
        />
      </Secao>

      {/* Rodapé fixo: o que acontece ao enviar e as ações. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background px-4 py-3 md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[13px] text-muted-foreground">
            {fraseAoEnviar({ souDono, nomeDono, apelido: emissora?.apelido ?? null, simulacao })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {podeDescartar && (
              <Button
                variant="outline"
                size="sm"
                disabled={ocupado}
                onClick={() => setDescartar(true)}
              >
                Descartar
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={ocupado} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Salvar rascunho"}
            </Button>
            {motivoEnvio ? (
              <BotaoComMotivo
                rotulo={rotuloEnviar({ souDono, nomeDono })}
                motivo={motivoEnvio}
                size="sm"
              />
            ) : (
              <Button size="sm" disabled={ocupado} onClick={clicarEnviar}>
                {enviar.isPending ? "Enviando…" : rotuloEnviar({ souDono, nomeDono })}
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={descartar} onOpenChange={setDescartar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar {salvo?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              O pedido não é apagado: vira Cancelado, com o motivo "descartado pelo autor", e não
              volta a ser editável.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => descartarPedido.mutate()}>
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={saida.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>O que não foi salvo se perde.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => saida.reset?.()}>
              Continuar editando
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => saida.proceed?.()}>Sair sem salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PaginaFaturamento>
  );
}

// ------------------------------------------------------------------ peças

function MensagemErro({ mensagem }: { mensagem: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-danger">
      <OctagonAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {mensagem}
    </p>
  );
}

/** Rótulo acima, ajuda abaixo, erro no campo (com ícone e texto, não só cor). */
function Campo({
  id,
  rotulo,
  ajuda,
  erros = [],
  largura,
  children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  erros?: string[];
  largura?: "inteira";
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", largura === "inteira" && "md:col-span-2")}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {ajuda && <p className="text-[13px] text-muted-foreground">{ajuda}</p>}
      {[...new Set(erros)].map((m) => (
        <MensagemErro key={m} mensagem={m} />
      ))}
    </div>
  );
}

function Opcao({ valor, rotulo }: { valor: string; rotulo: string }) {
  const id = `fat-opcao-${valor}`;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <RadioGroupItem id={id} value={valor} />
      {rotulo}
    </label>
  );
}

/** O quadro do cliente: nome, município, situação na Receita e de onde veio (contrato, Seção 1). */
function QuadroCliente({
  tipo,
  buscando,
  tomador,
  documento,
  semEmpresa,
  erro,
}: {
  tipo: "pj" | "pf";
  buscando: boolean;
  tomador: TomadorConferido | null;
  documento: string;
  semEmpresa: boolean;
  /** A recusa do banco (sem papel na empresa) ou a falha da busca, dita no quadro, sem alarme. */
  erro: string | null;
}) {
  if (semEmpresa)
    return (
      <div className="rounded-xl border border-dashed bg-card p-3 text-[13px] text-muted-foreground">
        Escolha a empresa que fatura: a busca do cliente é feita dentro dela.
      </div>
    );
  if (erro && !buscando)
    return (
      <div className="rounded-xl border bg-card p-3 text-[13px] text-muted-foreground">
        {erro} O nome do cliente pode ser digitado.
      </div>
    );
  if (buscando)
    return (
      <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground" role="status">
        Buscando o cliente…
      </div>
    );
  if (!tomador || normalizarDocumento(tomador.documento) !== normalizarDocumento(documento)) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-3 text-[13px] text-muted-foreground">
        {tipo === "pj"
          ? "Com o CNPJ válido, o portal busca o cliente na base e na Receita."
          : "PF: o portal confere o dígito; o nome é digitado."}
      </div>
    );
  }
  if (!tomador.valido)
    return (
      <div className="rounded-xl border bg-card p-3">
        <MensagemErro mensagem={tomador.erro ?? "Documento inválido."} />
      </div>
    );
  if (tipo === "pf")
    return (
      <div className="rounded-xl border bg-card p-3 text-sm text-foreground">
        CPF válido. Digite o nome do cliente.
      </div>
    );
  const ativa = tomador.situacao === "ATIVA";
  return (
    <div className="space-y-1.5 rounded-xl border bg-card p-3 text-sm">
      {tomador.nome ? (
        <p className="font-medium text-foreground">{tomador.nome}</p>
      ) : (
        <p className="text-foreground">
          Não achamos este CNPJ na base nem na Receita. Confira o número.
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">
        {[
          formatarDocumento(tomador.documento),
          tomador.municipio && `${tomador.municipio}${tomador.uf ? `/${tomador.uf}` : ""}`,
          tomador.nome_fonte && `de ${tomador.nome_fonte}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {tomador.situacao ? (
          <StatusBadge tom={ativa ? "sucesso" : "perigo"}>
            Receita: {tomador.situacao.toLowerCase()}
          </StatusBadge>
        ) : (
          <StatusBadge tom="neutro">situação não conferida</StatusBadge>
        )}
        {tomador.situacao_fonte && (
          <span className="text-[13px] text-muted-foreground">
            {tomador.situacao_fonte}
            {tomador.situacao_consultada_em
              ? ` em ${dataCompleta(tomador.situacao_consultada_em)}`
              : ""}
          </span>
        )}
      </div>
      {tomador.bloqueio && <MensagemErro mensagem={tomador.bloqueio.motivo} />}
      {!tomador.situacao && tomador.consulta_receita === "adiada" && (
        <p className="text-[13px] text-muted-foreground">
          A consulta à Receita ficou para daqui a pouco (limite de consultas). Saia do campo de novo
          em um minuto.
        </p>
      )}
      {!tomador.situacao && tomador.consulta_receita === "falhou" && (
        <p className="text-[13px] text-muted-foreground">
          A Receita não respondeu agora; a situação fica como não conferida.
        </p>
      )}
    </div>
  );
}

/** E-mails em fichas removíveis; Enter, vírgula ou sair do campo acrescentam. */
function Emails({ valor, aoMudar }: { valor: string[]; aoMudar: (v: string[]) => void }) {
  const [texto, setTexto] = useState("");
  const acrescentar = () => {
    const novos = texto.split(/[,;\s]+/).filter(Boolean);
    if (novos.length) aoMudar(juntarEmails(valor, novos));
    setTexto("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1">
      {valor.map((e) => (
        <span
          key={e}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full border bg-muted pl-2.5 pr-1 text-[13px]",
            !emailValido(e) && "border-danger",
          )}
        >
          {e}
          <button
            type="button"
            aria-label={`Tirar ${e}`}
            onClick={() => aoMudar(valor.filter((x) => x !== e))}
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id="fat-emails"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            acrescentar();
          } else if (e.key === "Backspace" && !texto && valor.length) aoMudar(valor.slice(0, -1));
        }}
        onBlur={acrescentar}
        placeholder={valor.length ? "" : "financeiro@cliente.com.br"}
        className="min-w-[12rem] flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  );
}

/** Busca no catálogo da empresa: descrição e, em 13px, o código de serviço. */
function CampoServico({
  emissora,
  servicos,
  carregando,
  semTributacao,
  escolhido,
  aoEscolher,
}: {
  emissora: string | null;
  servicos: ServicoCatalogo[] | null;
  carregando: boolean;
  semTributacao: number;
  escolhido: ServicoCatalogo | null;
  aoEscolher: (s: ServicoCatalogo) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const semAcento = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const filtrados = useMemo(
    () =>
      (servicos ?? []).filter((s) =>
        semAcento(`${s.descricao} ${s.codigo ?? ""} ${s.codigo_lc116 ?? ""}`).includes(
          semAcento(busca.trim()),
        ),
      ),
    [servicos, busca],
  );
  const aviso =
    semTributacao > 0 && emissora
      ? `${semTributacao} ${semTributacao === 1 ? "serviço" : "serviços"} da ${emissora} não ${semTributacao === 1 ? "aparece" : "aparecem"} porque falta a tributação no Omie. Peça à controladoria (Ana Carvalhais).`
      : null;

  if (!emissora)
    return (
      <BotaoComMotivo
        rotulo="Escolha o serviço"
        motivo="Escolha a empresa que fatura primeiro"
        variant="outline"
      />
    );
  if (carregando) return <p className="text-sm text-muted-foreground">Carregando o catálogo…</p>;
  if (servicos && servicos.length === 0)
    return (
      <BotaoComMotivo
        rotulo="Escolha o serviço"
        motivo={`A ${emissora} ainda não tem serviços liberados no portal. Peça à controladoria.`}
        variant="outline"
      />
    );
  return (
    <>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            id="fat-servico"
            variant="outline"
            className="h-auto min-h-9 w-full justify-start whitespace-normal py-1.5 text-left font-normal"
          >
            {escolhido ? (
              <span className="flex flex-col">
                <span>{escolhido.descricao}</span>
                <span className="text-[13px] text-muted-foreground">{escolhido.codigo}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Busque o serviço</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(36rem,90vw)] p-2">
          <label className="relative block">
            <span className="sr-only">Buscar serviço</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Descrição ou código"
              className="h-9 pl-8"
            />
          </label>
          <ul
            className="mt-2 max-h-72 overflow-auto"
            role="listbox"
            aria-label="Serviços da empresa"
          >
            {filtrados.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={escolhido?.id === s.id}
                  onClick={() => {
                    aoEscolher(s);
                    setAberto(false);
                    setBusca("");
                  }}
                  className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>{s.descricao}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {[s.codigo, s.codigo_lc116 && `LC 116 ${s.codigo_lc116}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            {filtrados.length === 0 && (
              <li className="px-2 py-1.5 text-[13px] text-muted-foreground">
                Nenhum serviço com esse texto. {aviso ?? ""}
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
      {aviso && <p className="text-[13px] text-muted-foreground">{aviso}</p>}
    </>
  );
}

/** "Sugerir serviço" (T5): só escolhe dentro do catálogo e nunca escolhe sozinho. */
function SugestaoServico({
  assistente,
  emissoraId,
  apelido,
  projeto,
  descricao,
  valor,
  nomeCliente,
  documento,
  servicos,
  aoUsar,
  gatilho,
}: {
  assistente: AssistenteServico;
  emissoraId: string;
  apelido: string;
  projeto: string;
  descricao: string;
  valor: number | null;
  nomeCliente: string | null;
  documento: string | null;
  servicos: ServicoCatalogo[];
  aoUsar: (s: ServicoCatalogo) => void;
  /** Muda quando o aviso de descrição pede "Sugerir outro serviço": dispara a sugestão. */
  gatilho: number;
}) {
  const [estado, setEstado] = useState<
    | { tipo: "nada" }
    | { tipo: "procurando" }
    | { tipo: "achou"; servico: ServicoCatalogo }
    | { tipo: "nenhum" }
    | { tipo: "incerto" }
    | { tipo: "falhou" }
  >({ tipo: "nada" });
  const semTexto = !projeto.trim() && !descricao.trim();
  const sugerir = async () => {
    setEstado({ tipo: "procurando" });
    try {
      const r = await Promise.race([
        assistente.sugerir({ emissoraId, projeto, descricao, valor, nomeCliente, documento }),
        // O servidor corta o Jev em 3 s; a tela espera um pouco mais pela ida e volta.
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("tempo")), TEMPO_JEV_MS + 1_000),
        ),
      ]);
      const s = r.servicoId ? servicos.find((x) => x.id === r.servicoId) : undefined;
      if (!s) setEstado({ tipo: "nenhum" });
      else if ((r.confianca ?? 0) < LIMIAR_SUGESTAO) setEstado({ tipo: "incerto" });
      else setEstado({ tipo: "achou", servico: s });
    } catch {
      setEstado({ tipo: "falhou" });
    }
  };
  // "Sugerir outro serviço", no aviso de descrição, dispara a mesma sugestão.
  const ultimoGatilho = useRef(gatilho);
  useEffect(() => {
    if (gatilho === ultimoGatilho.current) return;
    ultimoGatilho.current = gatilho;
    if (!semTexto) void sugerir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatilho]);
  return (
    <div className="space-y-1">
      {semTexto ? (
        <BotaoComMotivo
          rotulo="Sugerir serviço"
          motivo="Escreva o projeto ou a descrição primeiro"
          variant="outline"
          size="sm"
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={sugerir}
          disabled={estado.tipo === "procurando"}
        >
          {estado.tipo === "procurando" ? "Procurando…" : "Sugerir serviço"}
        </Button>
      )}
      {estado.tipo === "achou" && (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
          Sugestão: {estado.servico.descricao} ({estado.servico.codigo}).
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => {
              // Só vale serviço do catálogo atual da empresa (a sugestão não sobrevive à troca de empresa).
              const atual = servicos.find((x) => x.id === estado.servico.id);
              if (atual) aoUsar(atual);
              setEstado({ tipo: "nada" });
            }}
          >
            Usar esta
          </Button>
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => setEstado({ tipo: "nada" })}
          >
            Ignorar
          </Button>
        </p>
      )}
      {estado.tipo === "nenhum" && (
        <p className="text-[13px] text-muted-foreground">
          Nenhum serviço da {apelido} combina. Escolha na lista ou peça à controladoria.
        </p>
      )}
      {estado.tipo === "incerto" && (
        <p className="text-[13px] text-muted-foreground">
          Não há um serviço claro para esta descrição. Escolha na lista.
        </p>
      )}
      {estado.tipo === "falhou" && (
        <p className="text-[13px] text-muted-foreground">
          Não deu para sugerir agora. Escolha na lista.
        </p>
      )}
    </div>
  );
}

/** "Esta descrição não parece ser de …" (T5): aviso, não bloqueio. Se a checagem falhar, nada aparece. */
function AvisoDescricao({
  assistente,
  emissoraId,
  servicoId,
  servico,
  descricao,
  valor,
  nomeCliente,
  documento,
  aoSugerirOutro,
}: {
  assistente: AssistenteServico;
  emissoraId: string;
  servicoId: string;
  servico: string;
  descricao: string;
  valor: number | null;
  nomeCliente: string | null;
  documento: string | null;
  aoSugerirOutro?: () => void;
}) {
  const [naoCombina, setNaoCombina] = useState(false);
  useEffect(() => {
    if (!descricao.trim()) return setNaoCombina(false);
    let vivo = true;
    const t = setTimeout(() => {
      assistente
        .conferirDescricao({
          emissoraId,
          servicoId,
          descricao,
          valor,
          nomeCliente,
          documento,
          projeto: "",
        })
        .then((ok) => vivo && setNaoCombina(!ok))
        .catch(() => vivo && setNaoCombina(false));
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // valor e nome entram na conferência, mas não disparam outra: o gatilho é a descrição e o serviço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistente, emissoraId, servicoId, descricao]);
  if (!naoCombina) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      Esta descrição não parece ser de '{servico}'. Confira o serviço antes de enviar.
      {aoSugerirOutro && (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={aoSugerirOutro}>
          Sugerir outro serviço
        </Button>
      )}
    </p>
  );
}

function PreviaParcelas({
  pronta,
  carregando,
  parcelas,
  total,
  erro,
}: {
  pronta: boolean;
  carregando: boolean;
  parcelas: { n: number; vencimento: string; valor: number }[] | null;
  total: number | null;
  erro: string | null;
}) {
  if (!pronta)
    return (
      <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
        Preencha valor e 1º vencimento para ver as parcelas.
      </p>
    );
  if (erro)
    return (
      <div className="rounded-xl border bg-card p-4">
        <MensagemErro mensagem={erro} />
      </div>
    );
  if (carregando || !parcelas) return <Carregando variante="tabela" linhas={3} />;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parcela</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead className="num text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parcelas.map((x) => (
            <TableRow key={x.n}>
              <TableCell className="num">
                {x.n} de {parcelas.length}
              </TableCell>
              <TableCell className="num">{dataCompleta(x.vencimento)}</TableCell>
              <TableCell className="num text-right">{dinheiro(x.valor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-medium">
              Total
            </TableCell>
            <TableCell className="num text-right font-medium">{dinheiro(total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
