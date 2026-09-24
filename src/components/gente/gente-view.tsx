import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ShieldCheck } from "lucide-react";
import { listGente, type GentePessoaRow } from "@/lib/gente.functions";
import { ErroDaFonte } from "@/components/gente/estados-gente";
import { Card } from "@/components/ui/card";
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

// Cadastro (`/gente?tela=cadastro`), arquétipo Lista (contrato
// `docs/design/contratos/gente.md`). Filtros na URL (N7): `busca`, `unidade`,
// `departamento` e `status` (padrão "ativo"; "todos" tira o recorte).

const NA = "—";
// Valor do Select para "sem recorte". Na URL o recorte vazio simplesmente não
// aparece; este sentinela só existe porque o Select não aceita valor "".
const TODOS = "__todos__";
const CHAVES_FILTRO = ["busca", "unidade", "departamento", "status"];
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
  const limpar = useLimparFiltrosNaUrl(CHAVES_FILTRO);

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
      if (!termo) return true;
      return [p.nomeCompleto, p.email, p.cargo, p.gestorNome]
        .filter(Boolean)
        .some((c) => (c as string).toLowerCase().includes(termo));
    });
  }, [doStatus, busca, unidade, departamento]);

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

  if (!unidades.length && !pessoas.length) {
    return (
      <EstadoVazio
        titulo="O cadastro ainda não tem ninguém da sua unidade"
        // Dívida (contrato gente.md, "Visual"): nomes de unidade escritos no
        // código. Ficam até o cadastro dizer quem já entregou a planilha.
        descricao="As 4 unidades que usavam o Qulture já foram carregadas. Campo Novo, São Luís, Fortaleza e Maceió entram quando devolverem a planilha de cadastro."
      />
    );
  }

  const qualStatus = status === "todos" ? "todos os status" : (STATUS[status]?.plural ?? status);
  const filtroAtivo = !!busca || !!unidade || !!departamento || status !== "ativo";

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
              <Select value={unidade || TODOS} onValueChange={(v) => setUnidade(v === TODOS ? "" : v)}>
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
            </div>
          ) : null}

          {filtradas.length ? (
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Departamento</TableHead>
                    <TableHead>Gestor</TableHead>
                    <TableHead>Vínculo</TableHead>
                    <TableHead>Admissão</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Acesso ao Brain</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((p) => {
                    const st = STATUS[p.status];
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.nomeCompleto}</div>
                          <div className="text-[13px] text-muted-foreground">{p.email ?? NA}</div>
                        </TableCell>
                        <TableCell>{p.cargo ?? NA}</TableCell>
                        <TableCell>{p.departamento ?? NA}</TableCell>
                        <TableCell>
                          {p.gestorNome ?? <span className="text-muted-foreground">sem gestor</span>}
                        </TableCell>
                        <TableCell>
                          {p.tipoVinculo ? (VINCULO_LABEL[p.tipoVinculo] ?? p.tipoVinculo) : NA}
                        </TableCell>
                        <TableCell className="num">{fmtData(p.dataAdmissao)}</TableCell>
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
                          ) : (
                            <StatusBadge tom="neutro">sem login</StatusBadge>
                          )}
                        </TableCell>
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
