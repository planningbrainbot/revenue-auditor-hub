import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { registrarContatoFila } from "@/lib/monetizacao/consultoria-funil.functions";
import {
  GRUPOS_FILA,
  ORIGENS,
  RESULTADOS,
  ROTULO_GRUPO,
  ROTULO_RESULTADO,
  chaveDaFicha,
  montarFila,
  porCliente,
  resumoFila,
  type FunilBruto,
  type GrupoFila,
  type ItemFila,
  type Origem,
  type Resultado,
} from "@/lib/monetizacao/consultoria-funil";
import { cn } from "@/lib/utils";
import { inputClass } from "./common";
import { GavetaFicha } from "./consultoria-empresa";
import { brlCurto, origensDaBusca, useFunilConsultoria } from "./consultoria-funil";
import type { BuscaMonetizacao } from "./busca";

// Consultoria › Fila de cobrança (contrato docs/design/contratos/monetizacao-consultoria-funil.md). Quem tem dinheiro na
// mesa e não virou honorário, na ordem de cobrança: disse sim e não faturamos; faturado em atraso; diagnóstico com
// dinheiro, do mais antigo. Cada contato fica registrado no Brain (ops.consultoria_fila_registros). Pedido do CEO em
// 16/10/2026: "se tem dinheiro e não monetizou, a gente vai atrás" e "você vai ter que criar um jeito de controlar".

const TITULO = "Consultoria";
const PERGUNTA = "Quem a gente cobra hoje para o dinheiro da Consultoria sair?";
const INT = new Intl.NumberFormat("pt-BR");
const TODAS: Origem[] = ["inside_sales", "socios", "goiania", "outra"];
const ddmmaa = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";

export function ConsultoriaFila({
  busca,
  mudarBusca,
  abas,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
}) {
  const q = useFunilConsultoria();
  if (!q.data) {
    const erro = q.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={TITULO} pergunta={PERGUNTA} />
        {abas}
        {!erro ? (
          <Carregando variante="tabela" />
        ) : /^Seu acesso não inclui/.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao com todas as unidades" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: plataforma da Consultoria. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  return <PainelFila bruto={q.data} busca={busca} mudarBusca={mudarBusca} abas={abas} />;
}

export function PainelFila({
  bruto,
  busca,
  mudarBusca,
  abas,
  hoje = hojeSP(),
}: {
  bruto: FunilBruto;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
  hoje?: string;
}) {
  const origens = origensDaBusca(busca, TODAS);
  // Uma linha por cliente da plataforma, como no Funil (20/10/2026).
  const todos = useMemo(() => montarFila(porCliente(bruto.empresas), hoje), [bruto.empresas, hoje]);
  const daOrigem = useMemo(() => todos.filter((x) => origens.includes(x.e.origem)), [todos, origens]);
  const grupo = busca.grupo ?? null;
  const itens = useMemo(() => (grupo ? daOrigem.filter((x) => x.grupo === grupo) : daOrigem), [daOrigem, grupo]);
  const resumo = resumoFila(daOrigem);
  const [registrando, setRegistrando] = useState<ItemFila | null>(null);
  const fichaAberta = busca.empresa ? (todos.find((x) => chaveDaFicha(x.e) === busca.empresa) ?? null) : null;
  // A última ficha aberta continua marcada na fila depois de fechada: a pessoa vê onde parou.
  const [ultima, setUltima] = useState<string | null>(null);
  useEffect(() => {
    if (busca.empresa) setUltima(busca.empresa);
  }, [busca.empresa]);

  const alternarOrigem = (o: Origem) => {
    const nova = origens.includes(o) ? origens.filter((x) => x !== o) : [...origens, o];
    const ordem = TODAS.filter((x) => nova.includes(x));
    mudarBusca({ origem: ordem.length === 0 || ordem.length === TODAS.length ? undefined : ordem.join(",") });
  };

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao="As empresas com dinheiro na mesa que ainda não viraram honorário, na ordem de cobrança. Registre cada contato aqui: a próxima pessoa vê o que já foi feito, e a semana fecha com o que andou."
        procedencia={{
          fonte: "Plataforma da Consultoria (a cada 15 min) · contatos registrados no Brain",
          atualizadoEm: bruto.frescor.plataforma ?? bruto.lido_em,
          regua: "disse sim → em atraso → parado há mais tempo → maior valor",
        }}
      />
      {abas}

      <KpiGrade colunas={4}>
        <KpiCard rotulo="Na fila" valor={INT.format(resumo.empresas)} nota="empresas com dinheiro parado" />
        <KpiCard rotulo="Dinheiro em jogo" valor={brlCurto(resumo.valor)} tom="atencao" nota="aceito, em atraso ou achado" />
        <KpiCard
          rotulo="Contatadas nos últimos 7 dias"
          valor={INT.format(resumo.contatadas7)}
          tom={resumo.contatadas7 > 0 ? "sucesso" : undefined}
          nota={`de ${INT.format(resumo.empresas)} na fila`}
        />
        <KpiCard
          rotulo="Nunca contatadas"
          valor={INT.format(resumo.nuncaContatadas)}
          tom={resumo.nuncaContatadas > 0 ? "perigo" : undefined}
          nota="sem registro no Brain nem follow-up na plataforma"
        />
      </KpiGrade>

      <section aria-label="Filtros" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip ativo={!grupo} onClick={() => mudarBusca({ grupo: undefined })}>
            Toda a fila <span className="num text-muted-foreground">{INT.format(daOrigem.length)}</span>
          </Chip>
          {GRUPOS_FILA.map((g) => {
            const n = daOrigem.filter((x) => x.grupo === g).length;
            if (!n) return null;
            return (
              <Chip key={g} ativo={grupo === g} onClick={() => mudarBusca({ grupo: grupo === g ? undefined : g })}>
                {ROTULO_GRUPO[g].titulo} <span className="num text-muted-foreground">{INT.format(n)}</span>
              </Chip>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Origem:</span>
          {ORIGENS.map((o) => (
            <Chip key={o.id} ativo={origens.includes(o.id)} onClick={() => alternarOrigem(o.id)}>
              {o.curto}
            </Chip>
          ))}
        </div>
      </section>

      <Secao
        titulo={grupo ? ROTULO_GRUPO[grupo].titulo : "Toda a fila"}
        descricao={`${INT.format(itens.length)} ${itens.length === 1 ? "empresa" : "empresas"} · ${brlCurto(itens.reduce((s, x) => s + x.valor, 0))} em jogo`}
      >
        {itens.length === 0 ? (
          <EstadoVazio titulo="Ninguém aqui" descricao="Nenhuma empresa com dinheiro parado neste recorte." />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Prioridade</TableHead>
                  <TableHead className="text-xs">Empresa</TableHead>
                  <TableHead className="text-right text-xs">Em jogo</TableHead>
                  <TableHead className="text-xs">Entrega do diagnóstico</TableHead>
                  <TableHead className="text-xs">Último contato</TableHead>
                  <TableHead className="text-xs">Próximo passo</TableHead>
                  <TableHead className="text-xs">
                    <span className="sr-only">Registrar</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.slice(0, 400).map((x) => {
                  const chave = chaveDaFicha(x.e);
                  return (
                    <LinhaFila
                      key={x.e.chave}
                      x={x}
                      aberta={chave !== null && chave === (busca.empresa ?? ultima)}
                      registrar={() => setRegistrando(x)}
                      abrirFicha={chave ? () => mudarBusca({ empresa: chave }) : undefined}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>

      {registrando && <RegistrarContato item={registrando} fechar={() => setRegistrando(null)} />}
      <GavetaFicha
        chave={busca.empresa ?? null}
        resumo={fichaAberta ? { nome: fichaAberta.e.nome, cnpj: fichaAberta.e.cnpj, linhas: [ROTULO_GRUPO[fichaAberta.grupo].titulo] } : null}
        fechar={() => mudarBusca({ empresa: undefined })}
        abrir={(chave) => mudarBusca({ empresa: chave })}
      />
    </main>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        ativo
          ? "border-primary-text/50 bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:border-primary-text/40",
      )}
    >
      {children}
    </button>
  );
}

function LinhaFila({
  x,
  aberta,
  registrar,
  abrirFicha,
}: {
  x: ItemFila;
  aberta: boolean;
  registrar: () => void;
  abrirFicha?: () => void;
}) {
  const g = ROTULO_GRUPO[x.grupo];
  const r = x.e.registro;
  const semContato = x.diasSemContato === null || x.diasSemContato > 7;
  const origem = ORIGENS.find((o) => o.id === x.e.origem)?.curto ?? x.e.origem;
  return (
    <TableRow aria-current={aberta ? "true" : undefined} className={cn(aberta && "bg-muted/60")}>
      <TableCell className="text-xs">
        <StatusBadge tom={g.tom} icone={false}>
          {g.titulo}
        </StatusBadge>
      </TableCell>
      <TableCell className="text-xs">
        {abrirFicha ? (
          <button
            type="button"
            onClick={abrirFicha}
            className="text-left font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {x.e.nome}
          </button>
        ) : (
          <span className="font-medium">{x.e.nome}</span>
        )}
        <span className="block text-muted-foreground">
          {[origem, x.e.unidade, x.e.canais[0]].filter(Boolean).join(" · ")}
        </span>
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right text-sm font-semibold">{brlCurto(x.valor)}</TableCell>
      <TableCell className="text-xs">
        {x.e.entregue_em ? ddmmaa(x.e.entregue_em) : "—"}
        {x.diasDesdeEntrega !== null && (
          <span className="block text-muted-foreground">há {INT.format(x.diasDesdeEntrega)} dias</span>
        )}
      </TableCell>
      <TableCell className="text-xs">
        {x.ultimoContato ? (
          <>
            <span className={cn(semContato && "font-semibold text-warning")}>
              {ddmmaa(x.ultimoContato.em)} · há {INT.format(x.diasSemContato ?? 0)} dias
            </span>
            <span className="block text-muted-foreground">
              {x.ultimoContato.fonte === "brain"
                ? `${x.ultimoContato.por ?? "Brain"}${r ? ` · ${ROTULO_RESULTADO[r.resultado].rotulo}` : ""}`
                : "follow-up na plataforma"}
            </span>
          </>
        ) : (
          <span className="font-semibold text-danger">Nunca contatada</span>
        )}
      </TableCell>
      <TableCell className="max-w-[16rem] text-xs">
        {r?.proximo ? <span className="block">volta em {ddmmaa(r.proximo)}</span> : null}
        {r?.nota ? <span className="line-clamp-2 text-muted-foreground">{r.nota}</span> : !r?.proximo && "—"}
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" onClick={registrar}>
          Registrar contato
        </Button>
      </TableCell>
    </TableRow>
  );
}

function RegistrarContato({ item, fechar }: { item: ItemFila; fechar: () => void }) {
  const registrar = useServerFn(registrarContatoFila);
  const qc = useQueryClient();
  const { user } = useAuth();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [nota, setNota] = useState("");
  const [proximo, setProximo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (!resultado || !item.e.cliente_id) return;
    setSalvando(true);
    try {
      await registrar({
        data: { clienteId: item.e.cliente_id, resultado, nota, proximo: proximo || null },
      });
      toast.success("Contato registrado", { description: item.e.nome });
      await qc.invalidateQueries({ queryKey: ["consultoria-funil", user?.id] });
      fechar();
    } catch (err) {
      toast.error("O contato não foi salvo", { description: (err as Error).message });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !salvando && fechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar contato</DialogTitle>
          <DialogDescription>
            {item.e.nome} · {brlCurto(item.valor)} em jogo
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Como foi?</legend>
          <div className="flex flex-wrap gap-2">
            {RESULTADOS.map((r) => (
              <Chip key={r} ativo={resultado === r} onClick={() => setResultado(r)}>
                {ROTULO_RESULTADO[r].rotulo}
              </Chip>
            ))}
          </div>
        </fieldset>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">O que ficou combinado</span>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            maxLength={2000}
            className={cn(inputClass, "h-auto w-full py-2")}
            placeholder="Ex.: falei com o financeiro; vão assinar o aceite da tese de PIS até sexta."
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Próximo contato</span>
          <input
            type="date"
            value={proximo}
            min={hojeSP()}
            onChange={(e) => setProximo(e.target.value)}
            className={cn(inputClass, "w-full")}
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!resultado || salvando}>
            {salvando ? "Salvando…" : "Salvar contato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
