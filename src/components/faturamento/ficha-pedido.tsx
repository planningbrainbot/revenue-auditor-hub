import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useFichaPedido } from "@/hooks/use-faturamento";
import { partesDoLink } from "@/lib/areas";
import { tipoDoErro } from "@/lib/faturamento/erros";
import { eventoLegivel } from "@/lib/faturamento/eventos";
import {
  faixaDaSituacao,
  linhasIntegracao,
  oQueIriaAoOmie,
  resumoDaFicha,
} from "@/lib/faturamento/ficha";
import {
  dataCompleta,
  diaEHora,
  diaSP,
  dinheiro,
  documento,
  primeiroNome,
  rotuloMes,
} from "@/lib/faturamento/formato";
import { fraseLeituraOmie } from "@/lib/faturamento/rotulos";
import type { FichaPedido, SituacaoParcela } from "@/lib/faturamento/tipos";
import { cn } from "@/lib/utils";
import { BotoesDoPedido } from "./acoes-pedido";
import { AREA_FATURAMENTO, ErroDaArea, PaginaFaturamento, SeloSituacao } from "./moldura";

/**
 * Ficha do pedido (`/faturamento/pedido/$id`), arquétipo Ficha. Contrato
 * `docs/design/contratos/faturamento-pedido.md`: "Este pedido já virou nota, e o cliente pagou?".
 *
 * Tudo vem de `ops.fat_pedido`. Fora do escopo o banco recusa e a tela não mostra nenhum dado do pedido
 * (CA-09). Os números do resumo vêm prontos (a Ficha não recalcula, ARQUETIPOS §4), e os botões seguem o que
 * o banco diz que a pessoa pode fazer agora (`acoes`).
 */

const PERGUNTA = "Este pedido já virou nota, e o cliente pagou?";

const ORIGEM: { prefixo: string; rotulo: string }[] = [
  { prefixo: "/faturamento/pedidos", rotulo: "Pedidos" },
  { prefixo: "/faturamento/tesouraria", rotulo: "Fila da tesouraria" },
  { prefixo: "/faturamento", rotulo: "Meu faturamento" },
];

function Trilha({ volta, numero }: { volta: string; numero: string }) {
  const destino = partesDoLink(volta);
  const rotulo = ORIGEM.find((o) => volta.startsWith(o.prefixo))?.rotulo ?? "Pedidos";
  return (
    <nav
      aria-label="Trilha"
      className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground"
    >
      <span>Faturamento</span>
      <ChevronRight className="size-3.5" aria-hidden />
      <Link
        to={destino.to as never}
        search={destino.search as never}
        className="text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {rotulo}
      </Link>
      <ChevronRight className="size-3.5" aria-hidden />
      <span className="font-medium text-foreground">{numero}</span>
    </nav>
  );
}

export function FichaDoPedido({ id, volta }: { id: string; volta?: string }) {
  const ficha = useFichaPedido(id);
  const origem = volta ?? "/faturamento/pedidos";

  if (ficha.isPending)
    return (
      <PaginaFaturamento>
        <Carregando variante="pagina" />
      </PaginaFaturamento>
    );

  if (ficha.error || !ficha.data) {
    const tipo = tipoDoErro(ficha.error);
    return (
      <PaginaFaturamento>
        <PageHeader area={AREA_FATURAMENTO} titulo="Pedido" pergunta={PERGUNTA} />
        {tipo === "sem_acesso" ? (
          <EstadoSemAcesso oQueFalta="ser dono, autor ou gestor da empresa deste pedido" />
        ) : tipo === "nao_encontrado" ? (
          <EstadoVazio
            titulo="Pedido não encontrado."
            acao={
              <Button asChild variant="outline" size="sm">
                <Link to="/faturamento/pedidos">Ver pedidos</Link>
              </Button>
            }
          />
        ) : (
          <ErroDaArea erro={ficha.error} tentarNovamente={() => void ficha.refetch()} />
        )}
      </PaginaFaturamento>
    );
  }

  return <Conteudo f={ficha.data} volta={origem} />;
}

function Conteudo({ f, volta }: { f: FichaPedido; volta: string }) {
  const p = f.pedido;
  const hoje = diaSP(new Date()) as string;
  const faixa = faixaDaSituacao(f);
  const resumo = resumoDaFicha(f);
  const universo = [
    p.tomador.nome ?? "cliente sem nome",
    p.projeto,
    p.emissora.apelido,
    p.dono ? `dono: ${p.dono.nome}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const procedencia = {
    fonte: `Portal de Faturamento · ${fraseLeituraOmie([{ omie: { indisponivel: false, motivo: null, bloqueada_ate: null, ultimo_ok_em: p.omie.lido_em } }], new Date())} (a cada 4 h em dia útil)`,
    atualizadoEm: p.atualizado_em,
  };

  return (
    <PaginaFaturamento>
      <Trilha volta={volta} numero={p.numero} />
      <PageHeader
        area={AREA_FATURAMENTO}
        titulo={p.numero}
        pergunta={PERGUNTA}
        descricao={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <SeloSituacao situacao={p.status} />
            {p.simulacao && p.status !== "simulado" && (
              <StatusBadge tom="info" icone={false}>
                em simulação
              </StatusBadge>
            )}
            <span>{universo}</span>
          </span>
        }
        procedencia={procedencia}
        acoes={<BotoesDoPedido ficha={f} />}
      />

      {faixa && (
        <p className="rounded-xl border bg-card px-4 py-3 text-sm text-foreground" role="status">
          {faixa}
        </p>
      )}

      <KpiGrade colunas={4}>
        {resumo.map((n) => (
          <KpiCard
            key={n.rotulo}
            rotulo={n.rotulo}
            valor={n.valor}
            nota={n.nota}
            estado={n.estado}
          />
        ))}
      </KpiGrade>

      <OQueFoiPedido f={f} />
      <Parcelas f={f} />
      <OmieEPipefy f={f} hoje={hoje} />
      <LinhaDoTempo f={f} />

      <Procedencia fonte="Portal de Faturamento · ops.fat_pedido" atualizadoEm={p.atualizado_em} />
    </PaginaFaturamento>
  );
}

// ------------------------------------------------------------------ o que foi pedido

function Grupo({ titulo, itens }: { titulo: string; itens: [string, ReactNode][] }) {
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(9rem,auto)_1fr]">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="text-[13px] text-muted-foreground">{rotulo}</dt>
            <dd className="text-sm text-foreground">{valor ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const DOCUMENTO = { nf: "Nota fiscal", recibo: "Recibo", nd: "Nota de débito" } as const;

function OQueFoiPedido({ f }: { f: FichaPedido }) {
  const p = f.pedido;
  const t = p.tomador;
  const contrato = p.contratos_outra_emissora[0];
  return (
    <Secao titulo="O que foi pedido?">
      <div className="grid gap-3 lg:grid-cols-3">
        <Grupo
          titulo="Quem fatura, e para quem?"
          itens={[
            ["Empresa que fatura", `${p.emissora.apelido} · ${p.emissora.razao_social}`],
            ["Dono da receita", p.dono?.nome ?? "—"],
            [t.tipo === "pf" ? "CPF" : "CNPJ", documento(t.documento) ?? "—"],
            ["Cliente", t.nome ?? "—"],
            ["Município", t.municipio ? `${t.municipio}${t.uf ? `/${t.uf}` : ""}` : "—"],
            [
              "Situação na Receita",
              t.situacao_conferida && t.situacao ? (
                <StatusBadge tom={t.situacao === "ATIVA" ? "sucesso" : "perigo"}>
                  {t.situacao.toLowerCase()}
                </StatusBadge>
              ) : (
                "situação não conferida"
              ),
            ],
            ["E-mails para envio", p.emails_envio.length ? p.emails_envio.join(", ") : "—"],
            ...(p.confirmou_emissora && contrato
              ? ([
                  [
                    "Empresa confirmada",
                    `sim · o cliente tem contrato vigente na ${contrato.emissora.apelido}`,
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        <Grupo
          titulo="O que foi feito?"
          itens={[
            ["Projeto", p.projeto ?? "—"],
            [
              "Serviço",
              p.servico
                ? `${p.servico.descricao}${p.servico.codigo ? ` · ${p.servico.codigo}` : ""}`
                : "—",
            ],
            ["Descrição da nota", p.descricao_nf ?? "—"],
            ["Departamento", p.departamento ?? "—"],
            ["Observações", p.observacoes ?? "—"],
          ]}
        />
        <Grupo
          titulo="Quanto e como cobrar?"
          itens={[
            ["Valor", <span className="num">{dinheiro(p.valor)}</span>],
            ["Documento", p.documento ? DOCUMENTO[p.documento] : "—"],
            [
              "Forma",
              p.forma === "avulso"
                ? "À vista"
                : p.forma === "parcelado"
                  ? `Parcelado em ${p.parcelas}`
                  : "—",
            ],
            ["Cobrança", p.meio === "pix" ? "Pix" : p.meio === "boleto" ? "Boleto" : "—"],
            ["1º vencimento", dataCompleta(p.primeiro_vencimento) ?? "—"],
            ["Competência", rotuloMes(p.competencia) ?? "—"],
            ["Autor", p.solicitante?.nome ?? "—"],
            ["Criado em", diaEHora(p.criado_em) ?? "—"],
          ]}
        />
      </div>
    </Secao>
  );
}

// ------------------------------------------------------------------ parcelas

const PARCELA: Record<SituacaoParcela, { rotulo: string; tom: TomStatus }> = {
  a_vencer: { rotulo: "A vencer", tom: "neutro" },
  pago: { rotulo: "Pago", tom: "sucesso" },
  em_atraso: { rotulo: "Em atraso", tom: "perigo" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

function Parcelas({ f }: { f: FichaPedido }) {
  return (
    <Secao
      titulo="Como o valor foi dividido?"
      descricao="As parcelas gravadas no envio, não a prévia do formulário · R$ por parcela"
    >
      {f.parcelas.length === 0 ? (
        <EstadoVazio
          titulo="As parcelas ainda não foram gravadas."
          descricao="Elas são gravadas quando o pedido entra na fila do Omie."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parcela</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="num text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Pago em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.parcelas.map((x) => {
                const s = x.situacao ? PARCELA[x.situacao] : null;
                return (
                  <TableRow key={x.n}>
                    <TableCell className="num">
                      {x.n} de {f.parcelas.length}
                    </TableCell>
                    <TableCell className="num">{dataCompleta(x.vencimento)}</TableCell>
                    <TableCell className="num text-right">{dinheiro(x.valor)}</TableCell>
                    <TableCell>
                      {s ? <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge> : "—"}
                    </TableCell>
                    <TableCell className="num">{dataCompleta(x.pago_em) ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="num text-right font-medium">
                  {dinheiro(f.resumo.valor ?? f.pedido.valor)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </Secao>
  );
}

// ------------------------------------------------------------------ Omie e Pipefy

function OmieEPipefy({ f, hoje }: { f: FichaPedido; hoje: string }) {
  const p = f.pedido;
  const linhas = linhasIntegracao(f, hoje);
  const simulado = p.simulacao || p.status === "simulado";
  const tecnicos = [...(f.omie.envios ?? []), ...(f.pipefy.envios ?? [])].some(
    (e) => "payload" in e || "resposta" in e,
  );
  const simuladoEm = f.eventos.find((e) => e.evento === "omie_simulado")?.em ?? p.status_em;

  return (
    <Secao titulo="Onde está no Omie e no Pipefy?">
      {simulado && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="text-sm text-foreground">
            Simulado{simuladoEm ? ` em ${dataCompleta(simuladoEm)}` : ""}: nada foi gravado no Omie
            da {p.emissora.apelido}. Isto é o que iria:
          </p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(10rem,auto)_1fr]">
            {oQueIriaAoOmie(f).map((l) => (
              <div key={l.rotulo} className="contents">
                <dt className="text-[13px] text-muted-foreground">{l.rotulo}</dt>
                <dd className="text-sm text-foreground">{l.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <ul className="divide-y rounded-xl border bg-card">
        {linhas.map((l) => (
          <li key={l.chave} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[13px] text-muted-foreground">{l.titulo}</p>
              <p className={cn("text-sm", l.erro ? "text-danger" : "text-foreground")}>{l.texto}</p>
            </div>
            {l.link && (
              <Button asChild variant="outline" size="sm">
                <a href={l.link.href} target="_blank" rel="noreferrer">
                  {l.link.rotulo}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {tecnicos && (
        <details className="rounded-xl border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Detalhes técnicos
          </summary>
          <p className="mt-2 text-[13px] text-muted-foreground">
            O envio completo ao Omie e ao Pipefy, como o conector guardou (sem chave). Só a
            tesouraria e a controladoria veem.
          </p>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs text-foreground">
            {JSON.stringify({ omie: f.omie.envios, pipefy: f.pipefy.envios }, null, 2)}
          </pre>
        </details>
      )}
    </Secao>
  );
}

// ------------------------------------------------------------------ linha do tempo

function LinhaDoTempo({ f }: { f: FichaPedido }) {
  return (
    <Secao
      titulo="O que aconteceu com este pedido?"
      descricao="Do mais recente para o mais antigo · nada aqui se edita"
    >
      {f.eventos.length === 0 ? (
        <EstadoVazio titulo="Nenhum evento ainda." />
      ) : (
        <ol className="divide-y rounded-xl border bg-card">
          {f.eventos.map((e) => {
            const l = eventoLegivel(e);
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm text-foreground">{l.texto}</p>
                  {l.mudancas.length > 0 && (
                    <ul className="space-y-0.5 text-[13px] text-muted-foreground">
                      {l.mudancas.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="num shrink-0 text-[13px] text-muted-foreground">
                  {l.quem === "Portal" ? "Portal" : primeiroNome(l.quem) || l.quem} ·{" "}
                  {diaEHora(l.em)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Secao>
  );
}
