import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
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
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { usePlanoAcaoContatos } from "@/hooks/use-nps";
import type { EmpresaSemContatoRow } from "@/lib/contatos-cs.functions";
import { cnpjDvValido } from "@/lib/fila-cella.types";

const ALL = "todas";
const CHAVES_FILTRO = ["q", "unidade", "situacao"];
const FONTE = "empresas e contatos (Pipefy)";
const NUM = new Intl.NumberFormat("pt-BR");

const SITUACOES: { valor: EmpresaSemContatoRow["status"]; rotulo: string }[] = [
  { valor: "sem_contato", rotulo: "Sem nenhum contato" },
  { valor: "contato_sem_whatsapp", rotulo: "Tem contato, sem WhatsApp" },
  { valor: "contato_formato_invalido", rotulo: "WhatsApp com formato inválido" },
];

function situacaoBadge(status: EmpresaSemContatoRow["status"]) {
  if (status === "sem_contato") return <StatusBadge tom="perigo">Sem contato</StatusBadge>;
  if (status === "contato_formato_invalido") return <StatusBadge tom="atencao">Formato inválido</StatusBadge>;
  return <StatusBadge tom="atencao">Sem WhatsApp</StatusBadge>;
}

function Filtro({
  valor,
  aoMudar,
  todos,
  opcoes,
  rotulo,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  todos: string;
  opcoes: { valor: string; rotulo: string }[];
  rotulo: string;
}) {
  // Valor da URL que não existe mais nas opções continua visível (e removível).
  const lista =
    valor !== ALL && !opcoes.some((o) => o.valor === valor) ? [...opcoes, { valor, rotulo: valor }] : opcoes;
  return (
    <Select value={valor} onValueChange={(v) => aoMudar(v)}>
      <SelectTrigger className="h-8 w-auto min-w-[160px]" aria-label={rotulo}>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{todos}</SelectItem>
        {lista.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NpsPlanoAcaoTab() {
  const { data, isLoading, error, refetch, dataUpdatedAt } = usePlanoAcaoContatos();
  const [q, setQ] = useFiltroNaUrl("q", "");
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", ALL);
  const [status, setStatus] = useFiltroNaUrl("situacao", ALL);
  const limparFiltros = useLimparFiltrosNaUrl(CHAVES_FILTRO);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.empresasSemContato.filter((e) => {
      if (unidade !== ALL && e.unidade !== unidade) return false;
      if (status !== ALL && e.status !== status) return false;
      if (term) {
        const hay = [e.titulo, e.cnpj].filter(Boolean).map((v) => String(v).toLowerCase()).join(" ");
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [data, q, unidade, status]);

  const temFiltro = q !== "" || unidade !== ALL || status !== ALL;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Carregando variante="kpis" />
        <Carregando variante="tabela" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <EstadoErro
        titulo="Não foi possível carregar o plano de ação"
        detalhe={`Fonte: ${FONTE}: ${error instanceof Error ? error.message : String(error ?? "sem resposta")}`}
        tentarNovamente={() => void refetch()}
      />
    );
  }

  const coberturaPct =
    data.totalEmpresas > 0 ? Math.round((data.totalComContatoValido / data.totalEmpresas) * 100) : null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Lista de trabalho do CS: todo cliente ativo (Base Nova ou Antiga) precisa de pelo menos 1 contato com
        WhatsApp válido para entrar nos disparos de NPS. O contato se completa no Pipefy/CRM; cada linha leva à
        empresa em Clientes.
      </p>

      <KpiGrade colunas={4}>
        <KpiCard rotulo="Clientes ativos" valor={NUM.format(data.totalEmpresas)} nota="empresas ativas" />
        <KpiCard
          rotulo="Com WhatsApp válido (clientes ativos)"
          valor={NUM.format(data.totalComContatoValido)}
          unidade={coberturaPct === null ? undefined : `${coberturaPct}%`}
          nota="ao menos 1 contato vinculado com WhatsApp válido"
        />
        <KpiCard
          rotulo="Sem contato válido (clientes ativos)"
          valor={NUM.format(data.empresasSemContato.length)}
          nota="a lista abaixo"
        />
        <KpiCard
          rotulo="Contatos para classificar"
          valor={NUM.format(data.contatosParaClassificar.length)}
          nota="contatos sem empresa vinculada, com ou sem WhatsApp"
        />
      </KpiGrade>

      <Secao
        titulo="Quais clientes ativos ainda estão sem contato válido?"
        descricao="Por unidade e nome · a última coluna abre a empresa em Clientes"
        acoes={
          <span className="num text-[13px] text-muted-foreground">
            {NUM.format(filtered.length)} de {NUM.format(data.empresasSemContato.length)}
          </span>
        }
      >
        <BarraFiltros aoLimpar={temFiltro ? limparFiltros : undefined}>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar empresa ou CNPJ"
              aria-label="Buscar empresa ou CNPJ"
              className="h-8 w-60 pl-8"
            />
          </div>
          <Filtro
            rotulo="Unidade"
            valor={unidade}
            aoMudar={setUnidade}
            todos="Todas as unidades"
            opcoes={data.unidades.map((u) => ({ valor: u, rotulo: u }))}
          />
          <Filtro
            rotulo="Situação"
            valor={status}
            aoMudar={setStatus}
            todos="Todas as situações"
            opcoes={SITUACOES}
          />
        </BarraFiltros>

        {data.empresasSemContato.length === 0 ? (
          <EstadoVazio
            titulo="Todo cliente ativo tem contato válido"
            descricao="Nenhuma empresa ativa está sem WhatsApp válido."
          />
        ) : filtered.length === 0 ? (
          <EstadoVazio titulo="Nenhuma empresa com esses filtros" total={data.empresasSemContato.length} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card [&>div]:max-h-[600px]">
            <Table>
              <TableHeader grudavel>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Contatos existentes</TableHead>
                  <TableHead>Próxima ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => {
                  // /clientes não tem endereço de ficha por id: a busca por CNPJ
                  // deixa a empresa sozinha na lista. CNPJ que não fecha o dígito
                  // verificador (ou não tem 14 dígitos) acharia outra empresa ou
                  // nenhuma: aí a busca vai pelo nome.
                  const busca = (e.cnpj && cnpjDvValido(e.cnpj) ? e.cnpj.replace(/\D/g, "") : e.titulo) ?? "";
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.titulo ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{e.cnpj ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.unidade}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.origemDaBase ?? "—"}</TableCell>
                      <TableCell>{situacaoBadge(e.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.contatosNomes.length > 0 ? e.contatosNomes.join(", ") : "—"}
                      </TableCell>
                      <TableCell>
                        {busca ? (
                          <Link
                            to="/clientes"
                            search={{ q: busca }}
                            className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-input px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors duration-120 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          >
                            Abrir em Clientes →
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <Procedencia fonte={FONTE} atualizadoEm={dataUpdatedAt > 0 ? new Date(dataUpdatedAt) : null} />
      </Secao>

      {data.contatosParaClassificar.length > 0 && (
        <Secao
          titulo="Quais contatos ainda não têm empresa vinculada?"
          descricao="Com ou sem WhatsApp · não estão ligados a nenhuma empresa em Clientes"
        >
          <div className="overflow-hidden rounded-xl border bg-card [&>div]:max-h-[400px]">
            <Table>
              <TableHeader grudavel>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Cargo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.contatosParaClassificar.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.nomeCompleto ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.whatsapp ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.email ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.cargo ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Secao>
      )}
    </div>
  );
}
