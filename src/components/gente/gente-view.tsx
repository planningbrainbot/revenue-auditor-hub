import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Building2, GitBranch, ShieldCheck, Search, AlertCircle } from "lucide-react";
import { listGente, type GentePessoaRow } from "@/lib/gente.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const NA = "—";
const TODOS = "__todos__";

const VINCULO_LABEL: Record<string, string> = {
  socio: "Sócio",
  clt: "CLT",
  pj: "PJ",
  estagio: "Estágio",
  prolabore: "Pró-labore",
  terceiro: "Terceiro",
};

const fmtData = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : NA;

function Kpi({
  icone: Icone,
  valor,
  rotulo,
  detalhe,
}: {
  icone: typeof Users;
  valor: string | number;
  rotulo: string;
  detalhe?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Icone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums leading-tight">{valor}</div>
          <div className="text-sm text-muted-foreground">{rotulo}</div>
          {detalhe ? <div className="mt-0.5 text-xs text-muted-foreground">{detalhe}</div> : null}
        </div>
      </div>
    </Card>
  );
}

export function GenteView() {
  const fn = useServerFn(listGente);
  const q = useQuery({ queryKey: ["gente"], queryFn: () => fn(), staleTime: 60_000 });

  const [busca, setBusca] = useState("");
  const [unidade, setUnidade] = useState(TODOS);
  const [departamento, setDepartamento] = useState(TODOS);
  const [status, setStatus] = useState("ativo");

  const pessoas = useMemo(() => q.data?.pessoas ?? [], [q.data]);
  const unidades = useMemo(() => q.data?.unidades ?? [], [q.data]);
  const podeIndividual = q.data?.podeIndividual ?? false;
  const semNada = !unidades.length && !pessoas.length;

  const listaUnidades = useMemo(
    () => Array.from(new Set(pessoas.map((p) => p.unidade).filter(Boolean) as string[])).sort(),
    [pessoas],
  );
  const listaDepartamentos = useMemo(
    () =>
      Array.from(new Set(pessoas.map((p) => p.departamento).filter(Boolean) as string[])).sort(),
    [pessoas],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pessoas.filter((p: GentePessoaRow) => {
      if (status !== TODOS && p.status !== status) return false;
      if (unidade !== TODOS && p.unidade !== unidade) return false;
      if (departamento !== TODOS && p.departamento !== departamento) return false;
      if (!termo) return true;
      return [p.nomeCompleto, p.email, p.cargo, p.gestorNome]
        .filter(Boolean)
        .some((c) => (c as string).toLowerCase().includes(termo));
    });
  }, [pessoas, busca, unidade, departamento, status]);

  const totais = useMemo(() => {
    const pessoasTotal = unidades.reduce((s, u) => s + u.pessoas, 0);
    const comGestor = unidades.reduce((s, u) => s + u.comGestor, 0);
    const gestores = unidades.reduce((s, u) => s + u.gestores, 0);
    return { pessoasTotal, comGestor, gestores };
  }, [unidades]);

  if (q.isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando o cadastro…</Card>;
  }

  if (q.isError) {
    return (
      <Card className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div>
          <div className="font-medium">Não deu para ler o cadastro.</div>
          <div className="text-sm text-muted-foreground">
            {(q.error as Error)?.message ?? "Erro desconhecido."}
          </div>
        </div>
      </Card>
    );
  }

  if (!q.data?.podeVer) {
    return (
      <Card className="flex items-start gap-3 p-6">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">Você não tem acesso ao cadastro de gente.</div>
          <div className="text-sm text-muted-foreground">
            Peça a chave <code className="text-xs">view.gente</code> em Admin, Permissões.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {semNada ? (
        <Card className="flex items-start gap-3 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <div className="font-medium">O cadastro ainda não tem ninguém da sua unidade.</div>
            <p className="mt-1 text-muted-foreground">
              As 4 unidades que usavam o Qulture já foram carregadas. Campo Novo, São Luís,
              Fortaleza e Maceió entram quando devolverem a planilha de cadastro.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icone={Users} valor={totais.pessoasTotal} rotulo="Pessoas na rede" />
        <Kpi icone={Building2} valor={unidades.length} rotulo="Unidades com cadastro" />
        <Kpi
          icone={GitBranch}
          valor={totais.comGestor}
          rotulo="Com gestor definido"
          detalhe={`${totais.gestores} gestores distintos`}
        />
        <Kpi
          icone={ShieldCheck}
          valor={podeIndividual ? "Individual" : "Agregado"}
          rotulo="Seu nível de acesso"
          detalhe={podeIndividual ? "pessoa a pessoa, na sua unidade" : "números por unidade"}
        />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Por unidade</h2>
        <div className="overflow-x-auto">
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
                  <TableCell className="text-right tabular-nums">{u.pessoas}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.ativos}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.clt}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.pj}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.socios}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.comGestor}
                    <span className="ml-1 text-xs text-muted-foreground">de {u.pessoas}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {!podeIndividual ? (
        <Card className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-medium">Aqui você vê número por unidade, não nome por nome.</div>
            <p className="mt-1 text-muted-foreground">
              Decisão de governança: quem é avaliado é empregado da unidade, não da Partners. A
              Matriz acompanha o agregado para decidir investimento e sucessão, e o detalhe
              individual fica com quem responde pela unidade. A chave que separa os dois é{" "}
              <code className="text-xs">view.gente.individual</code>.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              Pessoas
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {filtradas.length} de {pessoas.length}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="gente-busca"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nome, e-mail, cargo ou gestor"
                  className="w-56 pl-8"
                />
              </div>
              {listaUnidades.length > 1 ? (
                <Select value={unidade} onValueChange={setUnidade}>
                  <SelectTrigger className="w-40" id="gente-unidade">
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
              <Select value={departamento} onValueChange={setDepartamento}>
                <SelectTrigger className="w-44" id="gente-departamento">
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
                <SelectTrigger className="w-32" id="gente-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativos</SelectItem>
                  <SelectItem value="afastado">Afastados</SelectItem>
                  <SelectItem value="desligado">Desligados</SelectItem>
                  <SelectItem value={TODOS}>Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Gestor</TableHead>
                  <TableHead>Vínculo</TableHead>
                  <TableHead>Admissão</TableHead>
                  <TableHead>Acesso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.nomeCompleto}</div>
                      <div className="text-xs text-muted-foreground">{p.email ?? NA}</div>
                    </TableCell>
                    <TableCell className="text-sm">{p.cargo ?? NA}</TableCell>
                    <TableCell className="text-sm">{p.departamento ?? NA}</TableCell>
                    <TableCell className="text-sm">
                      {p.gestorNome ?? <span className="text-muted-foreground">sem gestor</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {p.tipoVinculo ? (VINCULO_LABEL[p.tipoVinculo] ?? p.tipoVinculo) : NA}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {fmtData(p.dataAdmissao)}
                    </TableCell>
                    <TableCell>
                      {p.temLogin ? (
                        <Badge className="text-xs">tem login</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem login</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!filtradas.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Nenhuma pessoa com esses filtros.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          {q.data?.semUnidade ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {q.data.semUnidade} pessoa(s) sem unidade definida, contas administrativas herdadas do
              Qulture. Precisam de unidade antes de contar em qualquer indicador.
            </p>
          ) : null}
        </Card>
      )}
    </div>
  );
}
