import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Info } from "lucide-react";
import {
  listLideranca,
  segundaDaSemana,
  type LiderancaResult,
} from "@/lib/gente-lideranca.functions";
import { listAvaliacao, type AvaliacaoResult } from "@/lib/gente-avaliacao.functions";
import { listPdi, type PdiResult } from "@/lib/gente-pdi.functions";
import { listAdocao, type AdocaoRow } from "@/lib/gente-adocao.functions";
import { GenteUmAUmTab } from "@/components/gente/gente-conversas-tab";
import { GenteLiderancaTab } from "@/components/gente/gente-lideranca-tab";
import { GenteAvaliacaoTab } from "@/components/gente/gente-avaliacao-tab";
import { GentePdiTab } from "@/components/gente/gente-pdi-tab";
import { ErroDaFonte, SemCadastroNaRede } from "@/components/gente/estados-gente";
import type { Tela } from "@/routes/_authenticated/gente";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Carregando,
  EstadoVazio,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// As duas visões de rotina do Planning People ("Minha vez" e "Meu time") e a
// tabela de adoção.
//
// Até 22/09/2026 a tela era organizada por MÓDULO (Cadastro, 1:1, Liderança,
// Feedback, Elogios, Avaliação, PDI, Clima), que é o desenho do Qulture. O
// efeito prático: um colaborador abria oito abas e seis não eram para ele.
// As duas visões de rotina são o que sobrou da organização por QUEM VOCÊ É: o
// mesmo módulo aparece com recortes diferentes (pulso é formulário em "Minha
// vez" e tabela em "Meu time").
//
// Nenhuma visão inventa permissão: quem recorta linha continua sendo a RLS, e
// aqui só se decide o que faz sentido mostrar.

// ---------------------------------------------------------------- pendências

type Pendencia = { texto: string; tom: TomStatus; rotulo: string; para?: Tela };

/** `nome` entra na frase do erro ("Não foi possível ler {nome}"); `curto`, na procedência. */
type Fonte = { nome: string; curto: string; q: UseQueryResult<unknown> };

/**
 * "O que espera por você". Separa os quatro estados (contrato gente.md): enquanto
 * qualquer fonte carrega, esqueleto (antes dizia "Nada pendente" durante a
 * carga); fonte que falhou aparece com o nome e "Tentar de novo"; "em dia" só
 * quando todas as fontes responderam.
 */
function Pendencias({
  itens,
  fontes,
  emDia,
}: {
  itens: Pendencia[];
  fontes: Fonte[];
  emDia: string;
}) {
  const carregando = fontes.some((f) => f.q.isLoading);
  const falhas = fontes.filter((f) => f.q.isError);
  const atualizadoEm = Math.min(
    ...fontes.map((f) => f.q.dataUpdatedAt).filter((t) => t > 0),
  );

  return (
    <Secao
      titulo="O que espera por você"
      descricao="Cada item leva à tela onde se resolve."
    >
      {carregando ? (
        <Carregando variante="tabela" linhas={3} />
      ) : (
        <>
          {falhas.map((f) => (
            <ErroDaFonte key={f.nome} fonte={f.nome} erro={f.q.error} tentar={() => f.q.refetch()} />
          ))}
          {itens.length > 0 ? (
            <Card className="divide-y p-0">
              {itens.map((item, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <StatusBadge tom={item.tom}>{item.rotulo}</StatusBadge>
                  <span className="min-w-0 flex-1 text-foreground">{item.texto}</span>
                  {item.para && (
                    <Link
                      to="/gente"
                      search={{ tela: item.para }}
                      className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Abrir
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  )}
                </div>
              ))}
            </Card>
          ) : falhas.length === 0 ? (
            <Card className="flex items-center gap-3 p-4 text-sm">
              <StatusBadge tom="sucesso">Em dia</StatusBadge>
              <span className="text-muted-foreground">{emDia}</span>
            </Card>
          ) : null}
          {Number.isFinite(atualizadoEm) && (
            <Procedencia
              fonte={`Planning People: ${fontes.map((f) => f.curto).join(", ")}`}
              atualizadoEm={new Date(atualizadoEm)}
            />
          )}
        </>
      )}
    </Secao>
  );
}

// Lê do mesmo cache que os blocos da visão já usam (`queryKey` igual), então
// não custa requisição a mais.
function useDados() {
  const fnLideranca = useServerFn(listLideranca);
  const fnAvaliacao = useServerFn(listAvaliacao);
  const fnPdi = useServerFn(listPdi);
  const lideranca = useQuery<LiderancaResult>({
    queryKey: ["gente-lideranca"],
    queryFn: () => fnLideranca({}),
  });
  const avaliacao = useQuery<AvaliacaoResult>({
    queryKey: ["gente-avaliacao"],
    queryFn: () => fnAvaliacao({}),
  });
  const pdi = useQuery<PdiResult>({ queryKey: ["gente-pdi"], queryFn: () => fnPdi({}) });
  return { lideranca, avaliacao, pdi };
}

const FONTE_LIDERANCA = "o pulso e as prioridades";
const FONTE_AVALIACAO = "as avaliações";
const FONTE_PDI = "os PDIs";

function Explicacao({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Minha vez

export function VisaoMinhaVez() {
  const q = useDados();
  const lideranca = q.lideranca.data;
  const avaliacao = q.avaliacao.data;
  const pdi = q.pdi.data;
  const semana = segundaDaSemana();

  const itens: Pendencia[] = [];
  if (lideranca?.minhaPessoaId) {
    if (!lideranca.meusSentimentos.some((s) => s.periodoEm === semana))
      itens.push({
        texto: "Você ainda não disse como foi sua semana.",
        tom: "atencao",
        rotulo: "Pulso",
        para: "lideranca",
      });
    const prio = lideranca.minhasPrioridades.find((p) => p.periodoEm === semana);
    if (!prio || prio.prioridades.length === 0)
      itens.push({
        texto: "Suas prioridades da semana estão em branco.",
        tom: "atencao",
        rotulo: "Prioridades",
        para: "lideranca",
      });
  }
  if (avaliacao?.fila.length)
    itens.push({
      texto: `${avaliacao.fila.length} avaliação(ões) esperando sua resposta.`,
      tom: "perigo",
      rotulo: "Avaliação",
      para: "avaliacao",
    });
  const meuAtraso = (pdi?.planos ?? [])
    .filter((p) => p.souEu)
    .flatMap((p) => p.metas.flatMap((m) => m.acoes))
    .filter((a) => a.atrasada).length;
  if (meuAtraso > 0)
    itens.push({
      texto: `${meuAtraso} ação(ões) do seu PDI passaram do prazo.`,
      tom: "perigo",
      rotulo: "Atrasado",
      para: "pdi",
    });

  return (
    <div className="space-y-6">
      {/* A fila do dia, e só. 1:1, feedback e elogios têm item próprio no
          menu desde 22/09/2026 e não se repetem aqui: "Minha vez" é o que
          espera por mim, não um índice de tudo. */}
      <Pendencias
        itens={itens}
        emDia="Nada pendente para você agora."
        fontes={[
          { nome: FONTE_LIDERANCA, curto: "pulso e prioridades", q: q.lideranca },
          { nome: FONTE_AVALIACAO, curto: "avaliações", q: q.avaliacao },
          { nome: FONTE_PDI, curto: "PDI", q: q.pdi },
        ]}
      />
      <GenteLiderancaTab escopo="eu" />
      <GenteAvaliacaoTab escopo="eu" />
      <GentePdiTab escopo="eu" />
    </div>
  );
}

// -------------------------------------------------------------------- Meu time

export function VisaoMeuTime() {
  const q = useDados();
  const lideranca = q.lideranca.data;
  const pdi = q.pdi.data;

  // O time vem do pulso (`listLideranca`): sem ele não há como dizer se a pessoa
  // lidera alguém. Carregando e erro não viram "Você não lidera ninguém".
  if (q.lideranca.isLoading) return <Carregando variante="tabela" linhas={4} />;
  if (q.lideranca.isError) {
    return (
      <ErroDaFonte
        fonte="o seu time (cadastro, pulso e cadências)"
        erro={q.lideranca.error}
        tentar={() => q.lideranca.refetch()}
      />
    );
  }
  if (!lideranca?.minhaPessoaId) return <SemCadastroNaRede oQueDepende="Meu time" />;
  if (!lideranca.meuTime.length) {
    return (
      <EstadoVazio
        titulo="Você não lidera ninguém no cadastro da rede"
        descricao="Quem define o time é o campo gestor de cada pessoa, no Cadastro. Se isso estiver errado, é lá que se corrige."
        acao={
          <Link
            to="/gente"
            search={{ tela: "cadastro" }}
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abrir Cadastro
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
    );
  }

  const atrasados = lideranca.cadencias.filter((c) => c.atrasado).length;
  const semCadencia = lideranca.meuTime.filter(
    (p) => !lideranca.cadencias.some((c) => c.lideradoId === p.id),
  ).length;
  const semanaAtual = segundaDaSemana();
  const responderam = new Set(
    lideranca.sentimentosDoTime.filter((s) => s.periodoEm === semanaAtual).map((s) => s.pessoaId),
  );
  const semPulso = lideranca.meuTime.filter((p) => !responderam.has(p.id)).length;
  const pdiSemMeta = (pdi?.planos ?? []).filter((p) => !p.souEu && p.metas.length === 0).length;

  const itens: Pendencia[] = [];
  if (atrasados)
    itens.push({
      texto: `${atrasados} 1:1 atrasado(s).`,
      tom: "perigo",
      rotulo: "Atrasado",
      para: "um-a-um",
    });
  if (semCadencia)
    itens.push({
      texto: `${semCadencia} pessoa(s) do time sem cadência de 1:1 combinada.`,
      tom: "atencao",
      rotulo: "Sem cadência",
      para: "lideranca",
    });
  if (semPulso)
    itens.push({
      texto: `${semPulso} pessoa(s) não responderam o pulso desta semana.`,
      tom: "atencao",
      rotulo: "Pulso",
      para: "lideranca",
    });
  if (pdiSemMeta)
    itens.push({
      texto: `${pdiSemMeta} PDI(s) do time sem nenhuma meta escrita.`,
      tom: "atencao",
      rotulo: "PDI sem meta",
      para: "pdi",
    });

  return (
    <div className="space-y-6">
      <Pendencias
        itens={itens}
        emDia="Seu time está em dia."
        fontes={[
          { nome: FONTE_LIDERANCA, curto: "pulso e prioridades", q: q.lideranca },
          { nome: FONTE_PDI, curto: "PDI", q: q.pdi },
        ]}
      />
      <Explicacao>
        Você enxerga o time que lidera, em qualquer profundidade. Sócio-diretor da unidade não
        aparece aqui por ser dono dela: unidade é o teto, hierarquia é a régua dentro dele.
      </Explicacao>
      <GenteLiderancaTab escopo="time" />
      <GenteUmAUmTab escopo="time" />
      <GentePdiTab escopo="time" />
    </div>
  );
}

// ------------------------------------------------------------------- adoção

// A tabela de quem implanta. Tudo agregado, sem nome dentro, porque quem
// implanta precisa saber onde a ferramenta pegou e não quem respondeu o quê.
export function Adocao() {
  const fn = useServerFn(listAdocao);
  const { data } = useQuery<AdocaoRow[]>({ queryKey: ["gente-adocao"], queryFn: () => fn({}) });
  if (!data?.length) return null;

  const pct = (parte: number, todo: number) =>
    todo === 0 ? "—" : `${Math.round((parte / todo) * 100)}%`;

  return (
    <Card className="p-4">
      <h3 className="mb-1 font-semibold">Adoção por unidade</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Onde a ferramenta pegou e onde não saiu do chão. Números agregados, sem nome: quem implanta
        não precisa saber quem respondeu o quê.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidade</TableHead>
              <TableHead className="text-right">Pessoas</TableHead>
              <TableHead className="text-right">Com login</TableHead>
              <TableHead className="text-right">Pulso na semana</TableHead>
              <TableHead className="text-right">Pulso em 30 dias</TableHead>
              <TableHead className="text-right">Prioridades</TableHead>
              <TableHead className="text-right">1:1 em 90 dias</TableHead>
              <TableHead className="text-right">PDI com meta</TableHead>
              <TableHead className="text-right">Em ciclo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((linha) => (
              <TableRow key={linha.unidadeId}>
                <TableCell className="font-medium">{linha.unidade}</TableCell>
                <TableCell className="text-right tabular-nums">{linha.pessoas}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {linha.comLogin === 0 ? <Badge variant="destructive">0</Badge> : linha.comLogin}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {linha.pulsoNaSemana}{" "}
                  <span className="text-muted-foreground">
                    ({pct(linha.pulsoNaSemana, linha.pessoas)})
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {linha.pulsoEm30Dias}{" "}
                  <span className="text-muted-foreground">
                    ({pct(linha.pulsoEm30Dias, linha.pessoas)})
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {linha.prioridadesNaSemana}
                </TableCell>
                <TableCell className="text-right tabular-nums">{linha.com1a1Em90Dias}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {linha.comPdiComMeta}{" "}
                  <span className="text-muted-foreground">de {linha.comPdi}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{linha.avaliadosEmCiclo}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Coluna &quot;Com login&quot; é o gargalo conhecido: sem conta no Ops a pessoa não responde
        nada, por mais que a unidade esteja cadastrada.
      </p>
    </Card>
  );
}

// --------------------------------------------------------------- Minha unidade

// ----------------------------------------------------------------------- Rede

// -------------------------------------------------------------- Administração
