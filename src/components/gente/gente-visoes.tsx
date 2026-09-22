import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// As quatro visões do Planning People.
//
// Até 22/09/2026 a tela era organizada por MÓDULO (Cadastro, 1:1, Liderança,
// Feedback, Elogios, Avaliação, PDI, Clima), que é o desenho do Qulture. O
// efeito prático: um colaborador abria oito abas e seis não eram para ele.
//
// Agora a organização é por QUEM VOCÊ É. O mesmo módulo aparece em visões
// diferentes com recortes diferentes: pulso de sentimento é formulário em
// "Minha vez" e tabela em "Meu time"; avaliação é fila em "Minha vez" e
// calibração em "Administração".
//
// Nenhuma visão inventa permissão: quem recorta linha continua sendo a RLS, e
// aqui só se decide o que faz sentido mostrar.

// ---------------------------------------------------------------- pendências

type Pendencia = { texto: string; grave?: boolean };

function Pendencias({ itens, vazio }: { itens: Pendencia[]; vazio: string }) {
  if (!itens.length) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{vazio}</span>
      </Card>
    );
  }
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">
          O que espera por você
          <Badge variant="secondary" className="ml-2">
            {itens.length}
          </Badge>
        </h3>
      </div>
      <ul className="space-y-1 text-sm">
        {itens.map((item, i) => (
          <li key={i} className={item.grave ? "text-destructive" : "text-muted-foreground"}>
            {item.texto}
          </li>
        ))}
      </ul>
    </Card>
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
  return { lideranca: lideranca.data, avaliacao: avaliacao.data, pdi: pdi.data };
}

function Explicacao({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Minha vez

export function VisaoMinhaVez() {
  const { lideranca, avaliacao, pdi } = useDados();
  const semana = segundaDaSemana();

  const itens: Pendencia[] = [];
  if (lideranca?.minhaPessoaId) {
    if (!lideranca.meusSentimentos.some((s) => s.periodoEm === semana))
      itens.push({ texto: "Você ainda não disse como foi sua semana." });
    const prio = lideranca.minhasPrioridades.find((p) => p.periodoEm === semana);
    if (!prio || prio.prioridades.length === 0)
      itens.push({ texto: "Suas prioridades da semana estão em branco." });
  }
  if (avaliacao?.fila.length)
    itens.push({
      texto: `${avaliacao.fila.length} avaliação(ões) esperando sua resposta.`,
      grave: true,
    });
  const meuAtraso = (pdi?.planos ?? [])
    .filter((p) => p.souEu)
    .flatMap((p) => p.metas.flatMap((m) => m.acoes))
    .filter((a) => a.atrasada).length;
  if (meuAtraso > 0)
    itens.push({ texto: `${meuAtraso} ação(ões) do seu PDI passaram do prazo.`, grave: true });

  return (
    <div className="space-y-4">
      {/* A fila do dia, e só. 1:1, feedback e elogios têm item próprio no
          menu desde 22/09/2026 e não se repetem aqui: "Minha vez" é o que
          espera por mim, não um índice de tudo. */}
      <Pendencias itens={itens} vazio="Nada pendente para você agora." />
      <GenteLiderancaTab escopo="eu" />
      <GenteAvaliacaoTab escopo="eu" />
      <GentePdiTab escopo="eu" />
    </div>
  );
}

// -------------------------------------------------------------------- Meu time

export function VisaoMeuTime() {
  const { lideranca, pdi } = useDados();

  const atrasados = (lideranca?.cadencias ?? []).filter((c) => c.atrasado).length;
  const semCadencia = (lideranca?.meuTime ?? []).filter(
    (p) => !(lideranca?.cadencias ?? []).some((c) => c.lideradoId === p.id),
  ).length;
  const semanaAtual = segundaDaSemana();
  const responderam = new Set(
    (lideranca?.sentimentosDoTime ?? [])
      .filter((s) => s.periodoEm === semanaAtual)
      .map((s) => s.pessoaId),
  );
  const semPulso = (lideranca?.meuTime ?? []).filter((p) => !responderam.has(p.id)).length;
  const pdiSemMeta = (pdi?.planos ?? []).filter((p) => !p.souEu && p.metas.length === 0).length;

  const itens: Pendencia[] = [];
  if (atrasados) itens.push({ texto: `${atrasados} 1:1 atrasado(s).`, grave: true });
  if (semCadencia)
    itens.push({ texto: `${semCadencia} pessoa(s) do time sem cadência de 1:1 combinada.` });
  if (semPulso)
    itens.push({ texto: `${semPulso} pessoa(s) não responderam o pulso desta semana.` });
  if (pdiSemMeta) itens.push({ texto: `${pdiSemMeta} PDI(s) do time sem nenhuma meta escrita.` });

  if (!lideranca?.meuTime.length) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Você não lidera ninguém no cadastro da rede. Se isso estiver errado, o campo que define time
        é o gestor de cada pessoa, no cadastro.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Pendencias itens={itens} vazio="Seu time está em dia." />
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
