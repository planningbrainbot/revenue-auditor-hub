import { useState, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EstadoSemAcesso, StatusBadge } from "@/components/planning";
import type { Ficha, ProjetoFicha, Tese } from "@/lib/monetizacao/consultoria-ficha";
import { cn } from "@/lib/utils";

// Consultoria › Buscar empresa: os blocos que vêm do espelho da plataforma do Pedro Siqueira
// (ops.consultoria_empresa_ficha, montados em src/lib/monetizacao/consultoria-ficha.ts). Projetos com teses,
// gestores e prazo; propostas de todos os status; estoque de crédito mês a mês; faturas e recebimentos da
// Consultoria; follow-ups e histórico.

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
export const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : BRL.format(Math.round(v));
const INT = new Intl.NumberFormat("pt-BR");
export const ddmmaa = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const competencia = (c: string) =>
  /^\d{4}-\d{2}/.test(c) ? `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}` : c;
const pct = (v: number | null) =>
  v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function Bloco({
  titulo,
  children,
  nota,
}: {
  titulo: string;
  children: ReactNode;
  nota?: string;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{titulo}</h3>
        {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function TabelaTeses({ teses, comProjeto }: { teses: Tese[]; comProjeto?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Tese</TableHead>
            <TableHead className="text-xs">Tributos</TableHead>
            {comProjeto && <TableHead className="text-xs">Projeto</TableHead>}
            <TableHead className="text-xs">Situação</TableHead>
            <TableHead className="text-right text-xs">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teses.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="text-xs">
                {t.tema}
                {t.perfil && <span className="block text-muted-foreground">{t.perfil}</span>}
              </TableCell>
              <TableCell className="text-xs">{t.tributos ?? "—"}</TableCell>
              {comProjeto && (
                <TableCell className="text-xs">{t.projeto ?? "sem projeto"}</TableCell>
              )}
              <TableCell className="text-xs">
                <StatusBadge tom={t.status ? tomDe(t.status) : "neutro"} icone={false}>
                  {t.status ?? "sem status"}
                </StatusBadge>
                {t.statusOperacional && (
                  <span className="block text-muted-foreground">{t.statusOperacional}</span>
                )}
              </TableCell>
              <TableCell className="num text-right text-xs">{t.valor ? brl(t.valor) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Até 6 teses à mostra, do maior valor; o resto atrás de um botão. */
function TesesDoProjeto({ teses }: { teses: Tese[] }) {
  const [todas, setTodas] = useState(false);
  const ordem = [...teses].sort((a, b) => b.valor - a.valor);
  const vistas = todas ? ordem : ordem.slice(0, 6);
  return (
    <div>
      <TabelaTeses teses={vistas} />
      {teses.length > 6 && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          className="mt-2 text-xs text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {todas ? "Mostrar só as 6 maiores" : `Ver as ${INT.format(teses.length)} teses do projeto`}
        </button>
      )}
    </div>
  );
}

const tomDe = (s: string) =>
  s === "Sim"
    ? "sucesso"
    : s === "Declinado" || s === "Não"
      ? "perigo"
      : s === "Em Negociação" || s === "Em operação"
        ? "info"
        : "neutro";

function CartaoProjeto({ p }: { p: ProjetoFicha }) {
  const atrasado = !p.baixado && (p.prazo?.alem ?? 0) > 0;
  const cabeca = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold leading-snug">{p.produto ?? p.nome}</p>
        <p className="text-xs text-muted-foreground">
          {[p.departamento, p.semCliente ? "sem cliente cadastrado" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {p.baixado ? (
          <StatusBadge tom="neutro">Baixado {ddmmaa(p.dataBaixa)}</StatusBadge>
        ) : (
          <StatusBadge tom={atrasado ? "atencao" : "info"}>
            {p.etapa ?? "sem etapa"}
            {p.subStatus ? ` · ${p.subStatus}` : ""}
          </StatusBadge>
        )}
        {p.valor > 0 && (
          <span className="num text-sm font-semibold">{brl(p.valor)}</span>
        )}
      </div>
    </div>
  );
  const corpo = (
    <div className="mt-3 space-y-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
        <Dado rotulo="Entrada">{ddmmaa(p.entrada)}</Dado>
        <Dado rotulo="Documentos completos">{ddmmaa(p.documentosCompletos)}</Dado>
        <Dado rotulo="Entrega">{ddmmaa(p.entrega)}</Dado>
        <Dado rotulo="Na etapa">
          {p.baixado || !p.prazo || p.prazo.diasNaEtapa === null ? (
            "—"
          ) : (
            <span className={cn(atrasado && "font-semibold text-warning")}>
              {INT.format(p.prazo.diasNaEtapa)} dias
              {p.prazo.meta !== null ? ` · meta ${INT.format(p.prazo.meta)}` : ""}
              {atrasado ? ` · ${INT.format(p.prazo.alem ?? 0)} além` : ""}
            </span>
          )}
        </Dado>
        <Dado rotulo="Responsável">{p.responsavel ?? "—"}</Dado>
        <Dado rotulo="Canal de venda">{p.canal ?? "—"}</Dado>
        <Dado rotulo="Parceiro">{p.parceiro ?? "—"}</Dado>
        <Dado rotulo="Gestores">{p.gestores.length ? p.gestores.join(", ") : "—"}</Dado>
      </dl>
      {p.motivoBaixa && (
        <p className="text-xs text-muted-foreground">Motivo da baixa: {p.motivoBaixa}</p>
      )}
      {p.observacoes && (
        <p className="whitespace-pre-line rounded-lg bg-muted/40 p-2 text-xs">{p.observacoes}</p>
      )}
      {p.teses.length > 0 && <TesesDoProjeto teses={p.teses} />}
      {p.areas.length > 0 && (
        <ul className="space-y-1 text-xs">
          {p.areas.map((a, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{a.area}</span>
              {a.expectativa !== null && <span className="num">{brl(a.expectativa)}</span>}
              {a.notas && <span className="text-muted-foreground">{a.notas}</span>}
              {a.em && <span className="text-muted-foreground">· {ddmmaa(a.em)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  // Projeto baixado fica recolhido; o aberto, à mostra.
  return p.baixado ? (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer list-none outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {cabeca}
      </summary>
      {corpo}
    </details>
  ) : (
    <div className="rounded-lg border p-3">
      {cabeca}
      {corpo}
    </div>
  );
}

export function BlocosPlataforma({ f, semCnpj = false }: { f: Ficha; semCnpj?: boolean }) {
  const [historicoTodo, setHistoricoTodo] = useState(false);
  const semProjeto = f.teses.filter((t) => !t.projetoId);
  const historico = historicoTodo ? f.historico : f.historico.slice(0, 15);
  return (
    <>
      {f.projetos.length > 0 && (
        <Bloco
          titulo="Projetos na Consultoria"
          nota={`${INT.format(f.projetos.filter((p) => !p.baixado).length)} em aberto de ${INT.format(f.projetos.length)}`}
        >
          <div className="space-y-2">
            {f.projetos.map((p) => (
              <CartaoProjeto key={p.id} p={p} />
            ))}
          </div>
        </Bloco>
      )}

      {f.teses.length > 0 && (
        <Bloco titulo="Teses identificadas" nota="valor de cada tese, pelo status na plataforma">
          <ul className="flex flex-wrap gap-2">
            {f.tesesPorStatus.map((s) => (
              <li key={s.status} className="rounded-lg border px-3 py-2">
                <StatusBadge tom={s.tom} icone={false}>
                  {s.status}
                </StatusBadge>
                <p className="num mt-1 text-sm font-semibold">{brl(s.valor)}</p>
                <p className="text-xs text-muted-foreground">
                  {INT.format(s.teses)} {s.teses === 1 ? "tese" : "teses"}
                </p>
              </li>
            ))}
          </ul>
          {semProjeto.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[13px] text-muted-foreground">
                {INT.format(semProjeto.length)} teses importadas sem projeto, casadas pelo nome da
                empresa ({brl(f.valorSemProjeto)} fora as declinadas e as baixadas). A API não soma
                estas no valor identificado.
              </p>
              <TabelaTeses teses={semProjeto} />
            </div>
          )}
        </Bloco>
      )}

      {f.propostas.length > 0 && (
        <Bloco titulo="Propostas" nota="todos os status, como estão na plataforma">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Produto</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right text-xs">Valor</TableHead>
                  <TableHead className="text-right text-xs">Êxito</TableHead>
                  <TableHead className="text-xs">Envio</TableHead>
                  <TableHead className="text-xs">Follow-up</TableHead>
                  <TableHead className="text-xs">Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.propostas.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">
                      {p.produto ?? "—"}
                      {p.cobranca && (
                        <span className="block text-muted-foreground">
                          cobrança {p.cobranca}
                          {p.parcelas ? ` · ${INT.format(p.parcelas)} parcelas` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <StatusBadge tom={p.tom} icone={false}>
                        {p.rotuloStatus}
                      </StatusBadge>
                      {p.status === "aceita" && p.aceite && (
                        <span className="block text-muted-foreground">em {ddmmaa(p.aceite)}</span>
                      )}
                      {p.status === "perdida" && (
                        <span className="block text-muted-foreground">
                          {p.perda ? `em ${ddmmaa(p.perda)}` : ""}
                          {p.motivoPerda ? ` · ${p.motivoPerda}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="num text-right text-xs">
                      {brl(p.valorTotal ?? p.valorFixo)}
                    </TableCell>
                    <TableCell className="num text-right text-xs">{pct(p.exito)}</TableCell>
                    <TableCell className="text-xs">{ddmmaa(p.envio)}</TableCell>
                    <TableCell className="text-xs">
                      {p.ultimoFup ? `último ${ddmmaa(p.ultimoFup)}` : "—"}
                      {p.proximoFup && p.status === "em_negociacao" && (
                        <span className="block text-muted-foreground">
                          próximo {ddmmaa(p.proximoFup)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.responsavel ?? "—"}
                      {p.parceiro && p.parceiro !== p.responsavel && (
                        <span className="block text-muted-foreground">parceiro {p.parceiro}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Bloco>
      )}

      {f.estoques.length > 0 && (
        <Bloco titulo="Crédito em estoque" nota="aprovado, usado e saldo de cada crédito, mês a mês">
          <div className="space-y-3">
            {f.estoques.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{e.tipo ?? "Crédito"}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        e.inicio ? `desde ${ddmmaa(e.inicio)}` : null,
                        e.exitoPct !== null ? `êxito ${pct(e.exitoPct)}` : null,
                        e.formaConsumo ? `consumo ${e.formaConsumo.toLowerCase()}` : null,
                        e.gestorConta ? `gestor ${e.gestorConta}` : null,
                        e.parceiro ? `parceiro ${e.parceiro}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <StatusBadge tom={e.status === "ativo" ? "sucesso" : "neutro"} icone={false}>
                    {e.status ?? "—"}
                  </StatusBadge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
                  <Dado rotulo="Aprovado">
                    <span className="num">{brl(e.aprovado)}</span>
                  </Dado>
                  <Dado rotulo="Usado (recuperado)">
                    <span className="num">{brl(e.utilizado)}</span>
                  </Dado>
                  <Dado rotulo="Saldo">
                    <span className="num">{brl(e.saldo)}</span>
                  </Dado>
                  <Dado rotulo="Êxito gerado">
                    <span className="num">{brl(e.exitoGerado)}</span>
                  </Dado>
                </dl>
                {e.movimentos.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-primary-text outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {INT.format(e.movimentos.length)}{" "}
                      {e.movimentos.length === 1 ? "mês com movimento" : "meses com movimento"}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Competência</TableHead>
                            <TableHead className="text-right text-xs">Compensações</TableHead>
                            <TableHead className="text-right text-xs">Depósitos</TableHead>
                            <TableHead className="text-right text-xs">Pedidos</TableHead>
                            <TableHead className="text-right text-xs">Cobrança Planning</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {e.movimentos.map((m) => (
                            <TableRow key={m.competencia}>
                              <TableCell className="text-xs">{competencia(m.competencia)}</TableCell>
                              <TableCell className="num text-right text-xs">
                                {brl(m.compensacoes)}
                              </TableCell>
                              <TableCell className="num text-right text-xs">
                                {brl(m.depositos)}
                              </TableCell>
                              <TableCell className="num text-right text-xs">{brl(m.pedidos)}</TableCell>
                              <TableCell className="num text-right text-xs">{brl(m.cobranca)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Bloco>
      )}

      <Bloco
        titulo="Faturas e recebimentos da Consultoria"
        nota="o que a plataforma faturou e o que entrou no Omie dela"
      >
        {!f.portaFinanceiro.aberta || !f.financeiro ? (
          <EstadoSemAcesso oQueFalta="acesso ao Brain Financeiro com todas as empresas" />
        ) : !f.financeiro.faturas.length && !f.financeiro.recebimentos.length ? (
          <p className="text-sm text-muted-foreground">
            {semCnpj
              ? "Sem CNPJ, a plataforma não tem como ligar faturas e recebimentos a esta empresa."
              : "A plataforma não tem fatura nem recebimento deste CNPJ."}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px]">
              Faturado <span className="num font-semibold">{brl(f.financeiro.faturado)}</span> ·
              recebido <span className="num font-semibold">{brl(f.financeiro.recebido)}</span> · a
              receber <span className="num font-semibold">{brl(f.financeiro.aReceber)}</span>
              {f.financeiro.emAtraso > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-semibold text-danger">
                    em atraso {brl(f.financeiro.emAtraso)}
                  </span>
                </>
              )}
            </p>
            {f.financeiro.recebimentos.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Vencimento</TableHead>
                      <TableHead className="text-xs">Documento</TableHead>
                      <TableHead className="text-xs">Categoria</TableHead>
                      <TableHead className="text-right text-xs">Valor</TableHead>
                      <TableHead className="text-right text-xs">Recebido</TableHead>
                      <TableHead className="text-xs">Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {f.financeiro.recebimentos.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{ddmmaa(r.vencimento)}</TableCell>
                        <TableCell className="text-xs">{r.documento ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.categoria ?? "—"}</TableCell>
                        <TableCell className="num text-right text-xs">{brl(r.valor)}</TableCell>
                        <TableCell className="num text-right text-xs">
                          {r.recebido ? brl(r.recebido) : "—"}
                          {r.credito && (
                            <span className="block text-muted-foreground">
                              em {ddmmaa(r.credito)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.emAtraso ? (
                            <StatusBadge tom="perigo" icone={false}>
                              Em atraso
                            </StatusBadge>
                          ) : (
                            (r.status ?? "—")
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {f.financeiro.faturas.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-primary-text outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {INT.format(f.financeiro.faturas.length)} faturas emitidas pela plataforma
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Competência</TableHead>
                        <TableHead className="text-xs">Serviço</TableHead>
                        <TableHead className="text-right text-xs">Valor</TableHead>
                        <TableHead className="text-xs">Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {f.financeiro.faturas.map((x, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{ddmmaa(x.data)}</TableCell>
                          <TableCell className="text-xs">{x.competencia ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {x.descricao ?? x.categoria ?? "—"}
                          </TableCell>
                          <TableCell className="num text-right text-xs">{brl(x.valor)}</TableCell>
                          <TableCell className="text-xs">{x.status ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
          </div>
        )}
      </Bloco>

      {f.fups.length > 0 && (
        <Bloco titulo="Follow-ups" nota="o que a equipe escreveu nos projetos, do mais recente">
          <ul className="space-y-2">
            {f.fups.map((x, i) => (
              <li key={i} className="border-b pb-2 text-sm last:border-b-0">
                <p className="whitespace-pre-line">{x.texto}</p>
                <p className="text-xs text-muted-foreground">
                  {ddmmaa(x.data)} · {x.autor ?? "sem autor"} · {x.projeto}
                </p>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {f.historico.length > 0 && (
        <Bloco titulo="Histórico na plataforma" nota="mudanças de etapa, gestores, canal e baixas">
          <ul className="space-y-1.5">
            {historico.map((h, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="num w-16 shrink-0 text-xs text-muted-foreground">
                  {ddmmaa(h.data)}
                </span>
                <span>{h.texto}</span>
                {h.quem && <span className="text-xs text-muted-foreground">· {h.quem}</span>}
              </li>
            ))}
          </ul>
          {f.historico.length > 15 && (
            <button
              type="button"
              onClick={() => setHistoricoTodo((v) => !v)}
              className="mt-2 text-xs text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {historicoTodo ? "Mostrar só os 15 mais recentes" : `Ver os ${INT.format(f.historico.length)} eventos`}
            </button>
          )}
        </Bloco>
      )}
    </>
  );
}
