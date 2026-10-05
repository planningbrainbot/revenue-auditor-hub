import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ShieldCheck } from "lucide-react";
import { listGente, type GentePessoaRow } from "@/lib/gente.functions";
import { ErroDaFonte } from "@/components/gente/estados-gente";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { DarAcessoDialog, EditarPessoaDialog, NovaPessoaDialog } from "./nova-pessoa-dialog";
import { ImportarPessoasDialog } from "./importar-pessoas-dialog";
import { GestorEmLoteDialog } from "./gestor-em-lote-dialog";
import { aniversarioDeEmpresaNoMes, diasDeCasa, fmtTempoDeCasa } from "./tempo-de-casa";

// Cadastro (`/gente?tela=cadastro`), arquétipo Lista (contrato
// `docs/design/contratos/gente.md`). Filtros na URL (N7): `busca`, `unidade`,
// `departamento`, `status` (padrão "ativo"; "todos" tira o recorte), `casa`
// (faixa de tempo de casa) e `admissao_de`/`admissao_ate`.

const NA = "—";
// Valor do Select para "sem recorte". Na URL o recorte vazio simplesmente não
// aparece; este sentinela só existe porque o Select não aceita valor "".
const TODOS = "__todos__";
const CHAVES_FILTRO = [
  "busca",
  "unidade",
  "departamento",
  "status",
  "casa",
  "admissao_de",
  "admissao_ate",
];

// Faixas pensadas para a avaliação de experiência (45 e 90 dias): o RH filtra
// quem está na janela antes de mandar a pesquisa. Pedido do RH de Maceió,
// 30/09/2026, no lugar de um ciclo automático por admissão.
// "Aniversário de empresa no mês" entrou em 01/10/2026, também a pedido dela,
// para homenagear quem completa 1, 2, 3 anos.
const FAIXAS_CASA: Record<string, { rotulo: string; cabe: (admissao: string | null) => boolean }> =
  {
    ate45: { rotulo: "Até 45 dias", cabe: (a) => (diasDeCasa(a) ?? Infinity) <= 45 },
    "46a90": {
      rotulo: "De 46 a 90 dias",
      cabe: (a) => {
        const d = diasDeCasa(a);
        return d != null && d > 45 && d <= 90;
      },
    },
    mais90: { rotulo: "Mais de 90 dias", cabe: (a) => (diasDeCasa(a) ?? -1) > 90 },
    aniversario: {
      rotulo: "Aniversário de empresa no mês",
      cabe: (a) => aniversarioDeEmpresaNoMes(a) != null,
    },
    sem: { rotulo: "Sem data de admissão", cabe: (a) => !a },
  };
const NUM = new Intl.NumberFormat("pt-BR");

const VINCULO_LABEL: Record<string, string> = {
  socio: "Sócio",
  clt: "CLT",
  pj: "PJ",
  estagio: "Estágio",
  prolabore: "Pró-labore",
  terceiro: "Terceiro",
};

const STATUS: Record<string, { rotulo: string; plural: string; tom: TomStatus }> = {
  ativo: { rotulo: "Ativo", plural: "ativas", tom: "sucesso" },
  afastado: { rotulo: "Afastado", plural: "afastadas", tom: "atencao" },
  desligado: { rotulo: "Desligado", plural: "desligadas", tom: "neutro" },
};

// `data_admissao` é `date` (sem hora): meio-dia local evita virar o dia.
const fmtData = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : NA;

export function GenteView() {
  const fn = useServerFn(listGente);
  const q = useQuery({ queryKey: ["gente"], queryFn: () => fn(), staleTime: 60_000 });

  const [busca, setBusca] = useFiltroNaUrl("busca", "");
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", "");
  const [departamento, setDepartamento] = useFiltroNaUrl("departamento", "");
  const [status, setStatus] = useFiltroNaUrl("status", "ativo");
  const [casa, setCasa] = useFiltroNaUrl("casa", "");
  const [admissaoDe, setAdmissaoDe] = useFiltroNaUrl("admissao_de", "");
  const [admissaoAte, setAdmissaoAte] = useFiltroNaUrl("admissao_ate", "");
  const limpar = useLimparFiltrosNaUrl(CHAVES_FILTRO);
  // Seleção para ações em lote (Definir gestor). Não mora na URL: é rascunho.
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());

  const pessoas = useMemo(() => q.data?.pessoas ?? [], [q.data]);
  const unidades = useMemo(() => q.data?.unidades ?? [], [q.data]);
  const podeIndividual = q.data?.podeIndividual ?? false;

  const listaUnidades = useMemo(
    () => Array.from(new Set(pessoas.map((p) => p.unidade).filter(Boolean) as string[])).sort(),
    [pessoas],
  );
  const listaDepartamentos = useMemo(
    () =>
      Array.from(new Set(pessoas.map((p) => p.departamento).filter(Boolean) as string[])).sort(),
    [pessoas],
  );

  // O universo da contagem "N de M": as pessoas do status escolhido. Os outros
  // filtros recortam dentro dele.
  const doStatus = useMemo(
    () => (status === "todos" ? pessoas : pessoas.filter((p) => p.status === status)),
    [pessoas, status],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return doStatus.filter((p: GentePessoaRow) => {
      if (unidade && p.unidade !== unidade) return false;
      if (departamento && p.departamento !== departamento) return false;
      if (casa && FAIXAS_CASA[casa] && !FAIXAS_CASA[casa].cabe(p.dataAdmissao)) {
        return false;
      }
      const adm = p.dataAdmissao?.slice(0, 10) ?? null;
      if (admissaoDe && (!adm || adm < admissaoDe)) return false;
      if (admissaoAte && (!adm || adm > admissaoAte)) return false;
      if (!termo) return true;
      return [p.nomeCompleto, p.email, p.cargo, p.gestorNome]
        .filter(Boolean)
        .some((c) => (c as string).toLowerCase().includes(termo));
    });
  }, [doStatus, busca, unidade, departamento, casa, admissaoDe, admissaoAte]);

  const totais = useMemo(() => {
    const pessoasTotal = unidades.reduce((s, u) => s + u.pessoas, 0);
    const ativos = unidades.reduce((s, u) => s + u.ativos, 0);
    const comGestor = unidades.reduce((s, u) => s + u.comGestor, 0);
    const gestores = unidades.reduce((s, u) => s + u.gestores, 0);
    return { pessoasTotal, ativos, comGestor, gestores };
  }, [unidades]);

  if (q.isLoading) return <Carregando variante="kpis" />;
  if (q.isError) {
    return <ErroDaFonte fonte="o cadastro de gente" erro={q.error} tentar={() => q.refetch()} />;
  }
  if (!q.data) return <Carregando variante="kpis" />;
  if (!q.data.podeVer) return <EstadoSemAcesso oQueFalta="view.gente" />;

  // Quem implanta o People na unidade cadastra direto daqui (main, 1783e31).
  const podeCadastrar = q.data.unidadesCadastro.length > 0;
  const novaPessoa = podeCadastrar ? (
    <div className="flex flex-wrap gap-2">
      <ImportarPessoasDialog unidades={q.data.unidadesCadastro} existentes={q.data.gestores} />
      <NovaPessoaDialog unidades={q.data.unidadesCadastro} gestores={q.data.gestores} />
    </div>
  ) : null;

  if (!unidades.length && !pessoas.length) {
    return (
      <EstadoVazio
        titulo="O cadastro ainda não tem ninguém da sua unidade"
        descricao={
          podeCadastrar
            ? "Comece pela liderança: quem cuida de gente e os gestores. Os liderados entram depois, já apontando para o gestor."
            : "Peça a quem implanta o Planning People na sua unidade para cadastrar o time."
        }
        acao={novaPessoa ?? undefined}
      />
    );
  }

  const qualStatus = status === "todos" ? "todos os status" : (STATUS[status]?.plural ?? status);
  const filtroAtivo =
    !!busca ||
    !!unidade ||
    !!departamento ||
    status !== "ativo" ||
    !!casa ||
    !!admissaoDe ||
    !!admissaoAte;

  return (
    <div className="space-y-6">
      <KpiGrade>
        <KpiCard
          rotulo="Pessoas cadastradas (todos os status)"
          valor={NUM.format(totais.pessoasTotal)}
          // Os totais vêm da view por unidade: quem está sem unidade fica fora.
          nota={
            q.data.semUnidade > 0
              ? `${NUM.format(totais.ativos)} ativas · sem contar ${NUM.format(q.data.semUnidade)} sem unidade`
              : `${NUM.format(totais.ativos)} ativas`
          }
        />
        <KpiCard rotulo="Unidades com cadastro" valor={NUM.format(unidades.length)} />
        <KpiCard
          rotulo="Com gestor definido"
          valor={NUM.format(totais.comGestor)}
          nota={`de ${NUM.format(totais.pessoasTotal)} cadastradas · ${NUM.format(totais.gestores)} gestores distintos`}
        />
        <KpiCard
          rotulo="Seu nível de acesso"
          valor={podeIndividual ? "Individual" : "Agregado"}
          nota={podeIndividual ? "pessoa a pessoa, na sua unidade" : "números por unidade"}
        />
      </KpiGrade>

      <Secao
        titulo="Quantas pessoas cada unidade tem?"
        descricao="Contagem de todos os status; a coluna Ativos separa quem está na ativa."
      >
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Pessoas</TableHead>
                <TableHead className="text-right">Ativos</TableHead>
                <TableHead className="text-right">CLT</TableHead>
                <TableHead className="text-right">PJ</TableHead>
                <TableHead className="text-right">Sócios</TableHead>
                <TableHead className="text-right">Com gestor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unidades.map((u) => (
                <TableRow key={u.unidadeId}>
                  <TableCell className="font-medium">{u.unidade}</TableCell>
                  <TableCell className="num text-right">{u.pessoas}</TableCell>
                  <TableCell className="num text-right">{u.ativos}</TableCell>
                  <TableCell className="num text-right">{u.clt}</TableCell>
                  <TableCell className="num text-right">{u.pj}</TableCell>
                  <TableCell className="num text-right">{u.socios}</TableCell>
                  <TableCell className="num text-right">
                    {u.comGestor}
                    <span className="ml-1 text-[13px] text-muted-foreground">de {u.pessoas}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Secao>

      {!podeIndividual ? (
        <Card className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Aqui você vê número por unidade, não nome por nome.</p>
            <p className="mt-1 text-muted-foreground">
              Decisão de governança: quem é avaliado é empregado da unidade, não da Partners. A
              Matriz acompanha o agregado para decidir investimento e sucessão, e o detalhe
              individual fica com quem responde pela unidade. A chave que separa os dois é{" "}
              <code className="text-xs">view.gente.individual</code>.
            </p>
          </div>
        </Card>
      ) : (
        <Secao
          titulo="Quem está no cadastro?"
          descricao={
            <>
              <span className="num">{NUM.format(filtradas.length)}</span> de{" "}
              <span className="num">{NUM.format(doStatus.length)}</span> ({qualStatus})
            </>
          }
          acoes={novaPessoa}
        >
          <BarraFiltros aoLimpar={filtroAtivo ? limpar : undefined}>
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="gente-busca"
                aria-label="Buscar por nome, e-mail, cargo ou gestor"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, e-mail, cargo ou gestor"
                className="h-8 w-56 pl-8"
              />
            </div>
            {listaUnidades.length > 1 ? (
              <Select
                value={unidade || TODOS}
                onValueChange={(v) => setUnidade(v === TODOS ? "" : v)}
              >
                <SelectTrigger className="h-8 w-40" id="gente-unidade" aria-label="Unidade">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todas as unidades</SelectItem>
                  {listaUnidades.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select
              value={departamento || TODOS}
              onValueChange={(v) => setDepartamento(v === TODOS ? "" : v)}
            >
              <SelectTrigger className="h-8 w-44" id="gente-departamento" aria-label="Departamento">
                <SelectValue placeholder="Departamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os departamentos</SelectItem>
                {listaDepartamentos.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-36" id="gente-status" aria-label="Status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativas</SelectItem>
                <SelectItem value="afastado">Afastadas</SelectItem>
                <SelectItem value="desligado">Desligadas</SelectItem>
                <SelectItem value="todos">Todos os status</SelectItem>
              </SelectContent>
            </Select>
            <Select value={casa || TODOS} onValueChange={(v) => setCasa(v === TODOS ? "" : v)}>
              <SelectTrigger className="h-8 w-48" id="gente-casa" aria-label="Tempo de casa">
                <SelectValue placeholder="Tempo de casa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Qualquer tempo de casa</SelectItem>
                {Object.entries(FAIXAS_CASA).map(([v, f]) => (
                  <SelectItem key={v} value={v}>
                    {f.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <label htmlFor="gente-admissao-de">Admissão de</label>
              <Input
                id="gente-admissao-de"
                type="date"
                value={admissaoDe}
                max={admissaoAte || undefined}
                onChange={(e) => setAdmissaoDe(e.target.value)}
                className="h-8 w-36"
              />
              <label htmlFor="gente-admissao-ate">até</label>
              <Input
                id="gente-admissao-ate"
                type="date"
                value={admissaoAte}
                min={admissaoDe || undefined}
                onChange={(e) => setAdmissaoAte(e.target.value)}
                className="h-8 w-36"
              />
            </div>
          </BarraFiltros>

          {filtroAtivo ? (
            <div className="flex flex-wrap items-center gap-2">
              {busca ? (
                <ChipFiltro rotulo="Busca" valor={busca} aoRemover={() => setBusca("")} />
              ) : null}
              {unidade ? (
                <ChipFiltro rotulo="Unidade" valor={unidade} aoRemover={() => setUnidade("")} />
              ) : null}
              {departamento ? (
                <ChipFiltro
                  rotulo="Departamento"
                  valor={departamento}
                  aoRemover={() => setDepartamento("")}
                />
              ) : null}
              {status !== "ativo" ? (
                <ChipFiltro
                  rotulo="Status"
                  valor={status === "todos" ? "Todos" : (STATUS[status]?.rotulo ?? status)}
                  aoRemover={() => setStatus("ativo")}
                />
              ) : null}
              {casa && FAIXAS_CASA[casa] ? (
                <ChipFiltro
                  rotulo="Tempo de casa"
                  valor={FAIXAS_CASA[casa].rotulo}
                  aoRemover={() => setCasa("")}
                />
              ) : null}
              {admissaoDe || admissaoAte ? (
                <ChipFiltro
                  rotulo="Admissão"
                  valor={`${admissaoDe ? fmtData(admissaoDe) : "início"} a ${admissaoAte ? fmtData(admissaoAte) : "hoje"}`}
                  aoRemover={() => {
                    setAdmissaoDe("");
                    setAdmissaoAte("");
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {podeCadastrar && selecionadas.size ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span>
                <span className="num">{selecionadas.size}</span> selecionada(s)
              </span>
              <GestorEmLoteDialog
                pessoaIds={[...selecionadas]}
                gestores={q.data.gestores}
                unidadeIds={Array.from(
                  new Set(pessoas.filter((p) => selecionadas.has(p.id)).map((p) => p.unidadeId)),
                )}
                aoConcluir={() => setSelecionadas(new Set())}
              />
              <Button size="sm" variant="ghost" onClick={() => setSelecionadas(new Set())}>
                Limpar seleção
              </Button>
            </div>
          ) : null}

          {filtradas.length ? (
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {podeCadastrar ? (
                      <TableHead className="w-0">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todas as pessoas da lista"
                          checked={
                            filtradas.length > 0 && filtradas.every((p) => selecionadas.has(p.id))
                          }
                          onChange={(e) =>
                            setSelecionadas((s) => {
                              const n = new Set(s);
                              for (const p of filtradas) {
                                if (e.target.checked) n.add(p.id);
                                else n.delete(p.id);
                              }
                              return n;
                            })
                          }
                        />
                      </TableHead>
                    ) : null}
                    <TableHead>Nome</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Departamento</TableHead>
                    <TableHead>Gestor</TableHead>
                    <TableHead>Vínculo</TableHead>
                    <TableHead>Admissão</TableHead>
                    <TableHead>Tempo de casa</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Acesso ao Brain</TableHead>
                    {podeCadastrar ? <TableHead className="w-0" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((p) => {
                    const st = STATUS[p.status];
                    return (
                      <TableRow key={p.id}>
                        {podeCadastrar ? (
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`Selecionar ${p.nomeCompleto}`}
                              checked={selecionadas.has(p.id)}
                              onChange={(e) =>
                                setSelecionadas((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(p.id);
                                  else n.delete(p.id);
                                  return n;
                                })
                              }
                            />
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <div className="font-medium">{p.nomeCompleto}</div>
                          <div className="text-[13px] text-muted-foreground">{p.email ?? NA}</div>
                        </TableCell>
                        <TableCell>{p.cargo ?? NA}</TableCell>
                        <TableCell>{p.departamento ?? NA}</TableCell>
                        <TableCell>
                          {p.gestorNome ?? (
                            <span className="text-muted-foreground">sem gestor</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.tipoVinculo ? (VINCULO_LABEL[p.tipoVinculo] ?? p.tipoVinculo) : NA}
                        </TableCell>
                        <TableCell className="num">{fmtData(p.dataAdmissao)}</TableCell>
                        <TableCell className="num">
                          {fmtTempoDeCasa(p.dataAdmissao)}
                          {aniversarioDeEmpresaNoMes(p.dataAdmissao) ? (
                            <div className="text-[12px] text-success">
                              faz {aniversarioDeEmpresaNoMes(p.dataAdmissao)}{" "}
                              {aniversarioDeEmpresaNoMes(p.dataAdmissao) === 1 ? "ano" : "anos"} em{" "}
                              {fmtData(p.dataAdmissao).slice(0, 5)}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {st ? (
                            <StatusBadge tom={st.tom}>{st.rotulo}</StatusBadge>
                          ) : (
                            <StatusBadge tom="neutro">{p.status}</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.temLogin ? (
                            <StatusBadge tom="sucesso">tem login</StatusBadge>
                          ) : podeCadastrar ? (
                            <DarAcessoDialog
                              pessoaId={p.id}
                              nome={p.nomeCompleto}
                              email={p.email}
                            />
                          ) : (
                            <StatusBadge tom="neutro">sem login</StatusBadge>
                          )}
                        </TableCell>
                        {podeCadastrar ? (
                          <TableCell>
                            <EditarPessoaDialog pessoa={p} gestores={q.data.gestores} />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <EstadoVazio
              titulo={
                doStatus.length
                  ? "Nenhuma pessoa com esses filtros"
                  : `Nenhuma pessoa no cadastro que você enxerga (${qualStatus})`
              }
              total={doStatus.length ? doStatus.length : undefined}
            />
          )}

          {q.data.semUnidade ? (
            <p className="text-[13px] text-muted-foreground">
              <span className="num">{NUM.format(q.data.semUnidade)}</span> pessoa(s) sem unidade
              definida, contas administrativas herdadas do Qulture. Precisam de unidade antes de
              contar em qualquer indicador.
            </p>
          ) : null}
        </Secao>
      )}

      <Procedencia
        fonte="Planning People: cadastro de gente (carga inicial do Qulture)"
        atualizadoEm={q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null}
        regua="cada unidade vê só a sua; totais por unidade somam todos os status"
      />
    </div>
  );
}
