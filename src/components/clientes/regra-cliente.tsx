// Regra de cliente na Base (Pedro, 15/10/2026, proposta "Base à Prova de Criança", versão 14). A regra decide se a
// empresa é cliente; o grau (4 a 1) diz a certeza dentro de quem é cliente. A regra mora no banco
// (`ops.base_conta_situacao`, migration 20261015170000) e chega pronta em `base.situacao`: a tela só desenha.
import { useMemo, type ReactNode } from "react";
import { EstadoVazio, KpiCard, KpiGrade, StatusBadge } from "@/components/planning";
import { BotaoComMotivo, FOCO_VISIVEL, number } from "@/components/monetizacao/common";
import type { Conta } from "@/lib/monetizacao/types";
import {
  casaBusca,
  contarFaixas,
  ehCliente,
  ehExCliente,
  FAIXA_META,
  FAIXAS,
  faixaDaConta,
  faixaDe,
  porCerteza,
  totalClientes,
  type Faixa,
} from "@/lib/clientes/regra-cliente";
import {
  PORTES,
  SEM_SEGMENTO,
  SEM_UF,
  type PerfilRecorte,
  type Porte,
} from "@/lib/clientes/recorte";
import { cn } from "@/lib/utils";

/** Quatro barrinhas: quanto mais cheias, mais certeza. Só para cliente. */
export function MedidorGrau({
  grau,
  className,
}: {
  grau: number | null | undefined;
  className?: string;
}) {
  if (!grau) return null;
  return (
    <span
      className={cn("inline-flex items-end gap-0.5", className)}
      role="img"
      aria-label={`Grau ${grau} de 4`}
      title={`Grau ${grau} de 4`}
    >
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={cn(
            "w-1 rounded-sm",
            n <= grau ? FAIXA_META[`g${grau}` as Faixa].barra : "bg-muted",
            n === 1 ? "h-1.5" : n === 2 ? "h-2" : n === 3 ? "h-2.5" : "h-3",
          )}
        />
      ))}
    </span>
  );
}

/** Quatro degraus que sobem com o porte (micro acende um, grande os quatro); sem porte, todos apagados. */
export function MedidorPorte({ porte, className }: { porte: Porte; className?: string }) {
  const nivel = PORTES.find((p) => p.chave === porte)?.nivel ?? 0;
  return (
    <span className={cn("inline-flex items-end gap-0.5", className)} aria-hidden>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={cn(
            "w-1.5 rounded-sm",
            n <= nivel ? "bg-primary" : "bg-muted-foreground/20",
            n === 1 ? "h-1.5" : n === 2 ? "h-2.5" : n === 3 ? "h-3.5" : "h-[18px]",
          )}
        />
      ))}
    </span>
  );
}

/** O porte na linha da tabela: o medidor e o nome, com a régua no title. */
export function SeloPorte({ porte }: { porte: Porte }) {
  const p = PORTES.find((x) => x.chave === porte);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
      title={p ? `${p.rotulo}: ${p.dica}` : undefined}
    >
      <MedidorPorte porte={porte} />
      <span className={cn(porte === "sem_porte" && "text-xs text-muted-foreground")}>
        {p?.rotulo ?? porte}
      </span>
    </span>
  );
}

/** O selo da conta: a faixa, com o medidor de grau quando é cliente. */
export function SeloSituacao({ conta, compacto }: { conta: Conta; compacto?: boolean }) {
  const s = conta.base?.situacao;
  const f = faixaDe(s);
  const m = FAIXA_META[f];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <MedidorGrau grau={s?.estado === "cliente" ? s.grau : null} />
      <StatusBadge tom={m.tom} icone={compacto ? false : undefined}>
        {s?.estado === "cliente" ? m.rotulo : (s?.rotulo ?? m.rotulo)}
      </StatusBadge>
    </span>
  );
}

/** "Pode citar?" em uma palavra, com a cor do tom. */
export function EmReuniao({ conta }: { conta: Conta }) {
  const f = faixaDaConta(conta);
  const m = FAIXA_META[f];
  return (
    <span
      className={cn(
        "text-xs font-semibold",
        m.tom === "sucesso"
          ? "text-success"
          : m.tom === "atencao"
            ? "text-warning"
            : "text-muted-foreground",
      )}
    >
      {m.cita}
    </span>
  );
}

/**
 * A barra de confiança: cada pedaço é uma faixa, e o clique filtra a lista. `faixas` limita o que aparece (quem não é
 * admin não recebe fornecedor nem grupo do banco, então os dois nem entram).
 */
export function BarraConfianca({
  contagem,
  selecionada,
  aoEscolher,
}: {
  contagem: Record<Faixa, number>;
  selecionada?: Faixa | null;
  aoEscolher?: (f: Faixa | null) => void;
}) {
  const faixas = ([...FAIXAS, "sem_situacao"] as Faixa[]).filter((f) => contagem[f] > 0);
  const total = faixas.reduce((s, f) => s + contagem[f], 0);
  if (!total) return null;
  const clientes = totalClientes(contagem);
  return (
    <div className="space-y-2">
      <div className="flex gap-0.5 text-xs font-semibold" aria-hidden>
        {clientes > 0 && (
          <span
            className="truncate border-t-2 border-success pt-1 text-success"
            style={{ flexGrow: clientes, flexBasis: 0 }}
          >
            Clientes pela regra · {number(clientes)}
          </span>
        )}
        {total - clientes > 0 && (
          <span
            className="truncate border-t-2 border-muted-foreground/40 pt-1 text-muted-foreground"
            style={{ flexGrow: total - clientes, flexBasis: 0 }}
          >
            Fora da regra · {number(total - clientes)}
          </span>
        )}
      </div>
      <div
        className="flex h-9 gap-0.5 overflow-hidden rounded-lg"
        role="group"
        aria-label="Contas por faixa"
      >
        {faixas.map((f) => {
          const m = FAIXA_META[f];
          const n = contagem[f];
          const ativa = selecionada === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={ativa}
              aria-label={`${m.rotulo}: ${number(n)} empresas`}
              title={`${m.rotulo} · ${number(n)} empresas · ${m.cita}`}
              onClick={() => aoEscolher?.(ativa ? null : f)}
              className={cn(
                "min-w-1 text-xs font-semibold",
                m.barra,
                FOCO_VISIVEL,
                ativa && "ring-2 ring-inset ring-foreground",
                selecionada && !ativa && "opacity-40",
              )}
              style={{ flexGrow: n, flexBasis: 0 }}
            >
              {n / total > 0.07 ? <span className="num">{number(n)}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {faixas.map((f) => (
          <span key={f} className="inline-flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm", FAIXA_META[f].barra)} aria-hidden />
            {FAIXA_META[f].rotulo}{" "}
            <span className="num text-foreground">{number(contagem[f])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const POR_PAGINA = 50;

function Paginacao({
  pagina,
  total,
  aoMudar,
}: {
  pagina: number;
  total: number;
  aoMudar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const atual = Math.min(pagina, paginas);
  return (
    <footer className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
      <span>
        Página {atual} de {paginas} · {POR_PAGINA} por página · {number(total)} empresas
      </span>
      <div className="flex gap-2">
        <BotaoComMotivo
          variant="outline"
          size="sm"
          disabled={atual === 1}
          motivo={atual === 1 ? "Já é a primeira página" : null}
          onClick={() => aoMudar(atual - 1)}
        >
          Anterior
        </BotaoComMotivo>
        <BotaoComMotivo
          variant="outline"
          size="sm"
          disabled={atual === paginas}
          motivo={atual === paginas ? "Já é a última página" : null}
          onClick={() => aoMudar(atual + 1)}
        >
          Próxima
        </BotaoComMotivo>
      </div>
    </footer>
  );
}

type Coluna = "unidade" | "certeza" | "reuniao" | "motivo" | "local" | "segmento" | "porte";

/** UF da conta e de onde ela veio, numa célula ("PR", "AL · pela unidade", "Sem UF"). */
export function LocalDaConta({ p }: { p: PerfilRecorte }) {
  if (p.uf === SEM_UF) return <span className="text-xs text-muted-foreground">Sem UF</span>;
  return (
    <span className="whitespace-nowrap text-sm">
      <span className="font-medium">{p.uf}</span>
      <span className="text-xs text-muted-foreground">
        {" "}
        · {p.regiao}
        {p.fonteUf === "unidade" ? " · pela unidade" : ""}
      </span>
    </span>
  );
}

/** A tabela das telas da Base: nome e CNPJ, e as colunas pedidas. A linha abre a ficha. */
export function TabelaContas({
  contas,
  colunas,
  pagina,
  aoMudarPagina,
  aoAbrir,
  titulo,
  subtitulo,
  acoes,
  perfil,
}: {
  contas: Conta[];
  colunas: Coluna[];
  pagina: number;
  aoMudarPagina: (p: number) => void;
  aoAbrir: (a: Conta) => void;
  titulo: string;
  subtitulo?: string;
  acoes?: ReactNode;
  /** Região, segmento e porte de cada conta (`perfilRecorte`): obrigatório com as colunas local, segmento e porte. */
  perfil?: (a: Conta) => PerfilRecorte;
}) {
  const paginas = Math.max(1, Math.ceil(contas.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas);
  const cabecalho: Record<Coluna, string> = {
    unidade: "Unidade",
    certeza: "Certeza",
    reuniao: "Em reunião",
    motivo: "Por quê",
    local: "UF · região",
    segmento: "Segmento",
    porte: "Porte",
  };
  const cols = perfil
    ? colunas
    : colunas.filter((c) => !["local", "segmento", "porte"].includes(c));
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <h2 className="font-semibold">{titulo}</h2>
          {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
        {acoes}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Empresa / CNPJ</th>
              {cols.map((c) => (
                <th key={c} className="px-4 py-3">
                  {cabecalho[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contas.slice((atual - 1) * POR_PAGINA, atual * POR_PAGINA).map((a) => (
              <tr key={a.key} className="border-t hover:bg-muted/20">
                <td className="max-w-xs px-4 py-3">
                  <button
                    type="button"
                    className={`text-left font-medium hover:text-primary-text hover:underline ${FOCO_VISIVEL}`}
                    onClick={() => aoAbrir(a)}
                  >
                    {a.name}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.base?.cnpjs.join(" · ") || "CNPJ a refinar"}
                  </p>
                </td>
                {cols.map((c) => (
                  <td key={c} className="px-4 py-3 align-top">
                    {c === "unidade" ? (
                      <span className="text-sm">{a.unit_label || "A confirmar"}</span>
                    ) : c === "local" && perfil ? (
                      <LocalDaConta p={perfil(a)} />
                    ) : c === "segmento" && perfil ? (
                      <span
                        className={cn(
                          "text-sm",
                          perfil(a).segmento === SEM_SEGMENTO && "text-xs text-muted-foreground",
                        )}
                      >
                        {perfil(a).segmento}
                      </span>
                    ) : c === "porte" && perfil ? (
                      <SeloPorte porte={perfil(a).porte} />
                    ) : c === "certeza" ? (
                      <SeloSituacao conta={a} />
                    ) : c === "reuniao" ? (
                      <EmReuniao conta={a} />
                    ) : (
                      <span className="block max-w-sm text-xs text-muted-foreground">
                        {a.base?.situacao?.motivo ??
                          "A regra roda na próxima atualização da carteira."}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao pagina={atual} total={contas.length} aoMudar={aoMudarPagina} />
    </section>
  );
}

/**
 * Tela Clientes (15/10/2026, segunda rodada): a lista de clientes com o resumo Ativos · Inativos · Base Antiga · Base
 * Nova, que também filtra. A busca do topo acha qualquer empresa do escopo e diz se ela é cliente: quem não é aparece
 * num cartão "não cite", fora da lista. Ativo = cliente pela regra; inativo = ex-cliente (distrato concluído).
 */
export function VisaoClientes({
  contas,
  contasBusca = contas,
  perfil,
  aoLimparRecorte,
  busca,
  sit,
  base,
  aoMudar,
  pagina,
  aoMudarPagina,
  aoAbrir,
}: {
  /** As contas da busca e da unidade, já no recorte de região, porte e segmento. */
  contas: Conta[];
  /**
   * As mesmas contas sem o recorte (21/10/2026). A busca diz se a empresa é cliente: o recorte não pode esconder quem não
   * é (o cartão "não cite") nem fazer um cliente parecer não cliente.
   */
  contasBusca?: Conta[];
  perfil?: (a: Conta) => PerfilRecorte;
  aoLimparRecorte?: () => void;
  busca: string;
  sit: "clientes" | "ex";
  base: "antiga" | "nova" | null;
  aoMudar: (f: { sit?: "ex"; base?: "antiga" | "nova" }) => void;
  pagina: number;
  aoMudarPagina: (p: number) => void;
  aoAbrir: (a: Conta) => void;
}) {
  const clientes = useMemo(() => contas.filter(ehCliente).sort(porCerteza), [contas]);
  const ex = useMemo(() => contas.filter(ehExCliente).sort(porCerteza), [contas]);
  const antigas = useMemo(() => clientes.filter((a) => a.base?.origin === "antiga"), [clientes]);
  const novas = useMemo(() => clientes.filter((a) => a.base?.origin !== "antiga"), [clientes]);
  const termo = busca.trim();
  const buscando = termo.length >= 2;
  const foraDaLista = buscando
    ? contasBusca.filter((a) => !ehCliente(a) && !ehExCliente(a)).sort(porCerteza)
    : [];
  // Clientes e ex-clientes que a busca achou mas o recorte deixou de fora: a tela diz quantos, em vez de "não é cliente".
  const escondidosPeloRecorte = buscando
    ? contasBusca.filter((a) => ehCliente(a) || ehExCliente(a)).length - clientes.length - ex.length
    : 0;
  const lista =
    sit === "ex" ? ex : base === "antiga" ? antigas : base === "nova" ? novas : clientes;
  const resumo = [
    {
      rotulo: "Ativos",
      n: clientes.length,
      nota: "Clientes pela regra de cliente",
      ativo: sit === "clientes" && !base,
      ir: () => aoMudar({}),
    },
    {
      rotulo: "Inativos",
      n: ex.length,
      nota: "Distrato concluído na Central de Tratativas",
      ativo: sit === "ex",
      ir: () => aoMudar({ sit: "ex" }),
    },
    {
      rotulo: "Base Antiga",
      n: antigas.length,
      nota: "Ativos com origem Base Antiga",
      ativo: sit === "clientes" && base === "antiga",
      ir: () => aoMudar({ base: "antiga" }),
    },
    {
      rotulo: "Base Nova",
      n: novas.length,
      nota: "Ativos com origem Base Nova ou a confirmar",
      ativo: sit === "clientes" && base === "nova",
      ir: () => aoMudar({ base: "nova" }),
    },
  ];
  return (
    <div className="space-y-4">
      <KpiGrade colunas={4}>
        {resumo.map((r) => (
          <KpiCard
            key={r.rotulo}
            rotulo={r.rotulo}
            valor={number(r.n)}
            nota={`${r.nota}${r.ativo ? " · filtro aplicado" : ""}`}
            abrir={{ rotulo: r.ativo ? "Na lista abaixo" : "Ver na lista", onClick: r.ir }}
            className={r.ativo ? "border-primary-text" : undefined}
          />
        ))}
      </KpiGrade>
      {buscando && foraDaLista.length > 0 && (
        <div className="space-y-2">
          {foraDaLista.map((a) => {
            const s = a.base?.situacao;
            const confirmar = s?.estado === "a_confirmar";
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => aoAbrir(a)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-4 text-left",
                  confirmar
                    ? "border-warning/40 bg-warning-soft"
                    : "border-danger/30 bg-danger-soft",
                  FOCO_VISIVEL,
                )}
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full text-lg font-bold text-background",
                    confirmar ? "bg-warning" : "bg-danger",
                  )}
                  aria-hidden
                >
                  {confirmar ? "!" : "✕"}
                </span>
                <span className="space-y-1">
                  <span className="block font-semibold">
                    {a.name} ·{" "}
                    {confirmar
                      ? "A confirmar · confirme antes de citar"
                      : `${s?.rotulo ?? "Não é cliente"} · não cite`}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {s?.motivo ?? "A regra roda na próxima atualização da carteira."}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {lista.length ? (
        <TabelaContas
          titulo={
            sit === "ex"
              ? "Inativos"
              : base === "antiga"
                ? "Ativos da Base Antiga"
                : base === "nova"
                  ? "Ativos da Base Nova"
                  : "Ativos"
          }
          subtitulo={
            sit === "ex"
              ? "Distrato concluído na Central de Tratativas · para reconquista, com o sócio da unidade"
              : "Das de mais certeza para as de menos · toque na empresa para abrir a ficha"
          }
          contas={lista}
          colunas={["certeza", "unidade", "local", "segmento", "porte", "reuniao"]}
          perfil={perfil}
          pagina={pagina}
          aoMudarPagina={aoMudarPagina}
          aoAbrir={aoAbrir}
        />
      ) : escondidosPeloRecorte > 0 ? (
        <EstadoVazio
          titulo={`${number(escondidosPeloRecorte)} ${escondidosPeloRecorte === 1 ? "cliente com esse nome ou CNPJ fica" : "clientes com esse nome ou CNPJ ficam"} fora do recorte de região, porte ou segmento`}
          descricao="É cliente pela regra: tire o recorte para ver na lista."
          acao={
            aoLimparRecorte ? (
              <BotaoComMotivo variant="outline" size="sm" onClick={aoLimparRecorte}>
                Tirar o recorte
              </BotaoComMotivo>
            ) : undefined
          }
        />
      ) : (
        <EstadoVazio
          titulo={
            buscando
              ? foraDaLista.length
                ? "Nenhum cliente com esse nome ou CNPJ"
                : "Nenhuma empresa com esse nome ou CNPJ na sua Base: não é cliente, não cite"
              : sit === "ex"
                ? "Nenhum inativo neste recorte"
                : "Nenhum cliente neste recorte"
          }
          descricao={
            buscando
              ? undefined
              : "A regra de cliente roda na atualização da carteira, a cada poucos minutos."
          }
        />
      )}
    </div>
  );
}

/** Cartões por unidade: clientes pela regra, pagamento visto e ex-clientes. O clique escolhe a unidade. */
export function CartoesUnidades({
  unidades,
  contaPorChave,
  selecionada,
  aoEscolher,
}: {
  unidades: { key: string; name: string; account_keys: string[] }[];
  contaPorChave: Map<string, Conta>;
  selecionada: string | null;
  aoEscolher: (u: { key: string; name: string } | null) => void;
}) {
  const linhas = useMemo(
    () =>
      unidades
        .map((u) => {
          const contas = u.account_keys
            .map((k) => contaPorChave.get(k))
            .filter((a): a is Conta => !!a);
          const c = contarFaixas(contas);
          return { u, c, clientes: totalClientes(c) };
        })
        .filter((l) => l.clientes + l.c.ex_cliente > 0)
        .sort((a, b) => b.clientes - a.clientes || a.u.name.localeCompare(b.u.name, "pt-BR")),
    [unidades, contaPorChave],
  );
  if (!linhas.length) return null;
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2"
      role="group"
      aria-label="Unidades"
    >
      {linhas.map(({ u, c, clientes }) => {
        const ativa = selecionada === u.key;
        return (
          <button
            key={u.key}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoEscolher(ativa ? null : u)}
            title={`${u.name}: ${number(clientes)} clientes · ${number(c.g4)} com pagamento visto · ${number(c.ex_cliente)} ex-clientes${c.a_confirmar ? ` · ${number(c.a_confirmar)} a confirmar` : ""}`}
            className={cn(
              "grid gap-1.5 rounded-xl border bg-card p-3 text-left",
              ativa ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/30",
              FOCO_VISIVEL,
            )}
          >
            <span className="truncate text-sm font-semibold">{u.name}</span>
            <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>
                <b className="num text-sm text-success">{number(clientes)}</b> clientes
              </span>
              <span className="num">{number(c.ex_cliente)} ex</span>
            </span>
            <span className="flex h-1.5 gap-px overflow-hidden rounded-full bg-muted" aria-hidden>
              {(["g4", "g3", "g2", "g1", "ex_cliente"] as Faixa[]).map((f) =>
                c[f] ? (
                  <span
                    key={f}
                    className={FAIXA_META[f].barra}
                    style={{ flexGrow: c[f], flexBasis: 0 }}
                  />
                ) : null,
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** O bloco do topo da ficha: é cliente? com o grau, o "pode citar?" e o motivo, numa frase. */
export function BlocoSituacao({ conta }: { conta: Conta }) {
  const s = conta.base?.situacao;
  const f = faixaDe(s);
  const m = FAIXA_META[f];
  const p = conta.base?.prova;
  const frase =
    f === "sem_situacao"
      ? "A regra de cliente roda na próxima atualização da carteira"
      : s?.estado === "cliente"
        ? "É cliente · pode citar"
        : s?.estado === "a_confirmar"
          ? "A confirmar · confirme antes de citar"
          : `${s?.rotulo ?? m.rotulo} · não cite`;
  const datas = [
    p?.recebido_em ? `último recebimento em ${p.recebido_em.split("-").reverse().join("/")}` : null,
    p?.contrato_ativo ? "contrato ativo no Omie" : null,
    p?.faturado_grupo_em
      ? `faturada${p.faturado_por?.length ? ` por ${p.faturado_por.join(", ")}` : " pelo grupo"} em ${p.faturado_grupo_em.slice(5, 7)}/${p.faturado_grupo_em.slice(0, 4)}`
      : null,
  ].filter(Boolean);
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl p-4",
        m.tom === "sucesso"
          ? "bg-success-soft"
          : m.tom === "atencao"
            ? "bg-warning-soft"
            : m.tom === "info"
              ? "bg-info-soft"
              : m.tom === "perigo"
                ? "bg-danger-soft"
                : "bg-muted",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full text-lg font-bold text-background",
          m.tom === "sucesso"
            ? "bg-success"
            : m.tom === "atencao"
              ? "bg-warning"
              : m.tom === "info"
                ? "bg-info"
                : m.tom === "perigo"
                  ? "bg-danger"
                  : "bg-muted-foreground",
        )}
        aria-hidden
      >
        {m.tom === "sucesso" ? "✓" : m.tom === "atencao" ? "!" : "✕"}
      </span>
      <div className="space-y-1">
        <p className="font-semibold">{frase}</p>
        {s && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <SeloSituacao conta={conta} />
          </p>
        )}
        <p className="text-sm text-muted-foreground">{s?.motivo}</p>
        {datas.length > 0 && (
          <p className="text-xs text-muted-foreground">Sinais: {datas.join(" · ")}.</p>
        )}
      </div>
    </div>
  );
}
