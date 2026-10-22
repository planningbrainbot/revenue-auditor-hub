import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { BarraFiltros, KpiCard, KpiGrade, StatusBadge } from "@/components/planning";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { criarTarefa } from "@/lib/tarefas/tarefas.functions";
import {
  formatarPrazo,
  PRIORIDADES,
  ROTULO_PRIORIDADE,
  situacaoDoPrazo,
  type BuscaTarefas,
  type Contagem,
  type Prioridade,
} from "@/lib/tarefas/regras";

// Peças comuns às duas telas da área Tarefas (contrato docs/design/contratos/tarefas.md).

export const CHAVE = ["tarefas"] as const;

/** Radix Select não aceita valor vazio: "todos" e "nenhum" viram sentinelas. */
export const TODOS = "_todos";
export const NENHUM = "_nenhum";

export function SeloPrioridade({ prioridade }: { prioridade: Prioridade }) {
  // Só a alta grita. Média e baixa ficam neutras para a alta continuar sendo sinal.
  return (
    <StatusBadge tom={prioridade === "alta" ? "perigo" : "neutro"} icone={false}>
      {ROTULO_PRIORIDADE[prioridade]}
    </StatusBadge>
  );
}

export function SeloPrazo({
  prazo,
  hoje,
  concluida,
}: {
  prazo: string | null;
  hoje: string;
  concluida: boolean;
}) {
  if (!prazo) return <span className="text-xs text-muted-foreground">Sem prazo</span>;
  const texto = prazo === hoje ? "Hoje" : formatarPrazo(prazo, hoje);
  if (concluida) return <span className="text-xs text-muted-foreground">{texto}</span>;
  const s = situacaoDoPrazo(prazo, hoje);
  if (s === "atrasada") return <StatusBadge tom="perigo">{texto}</StatusBadge>;
  if (s === "semana") return <StatusBadge tom="atencao">{texto}</StatusBadge>;
  return <span className="text-xs text-muted-foreground">{texto}</span>;
}

/** Os quatro cartões do topo; cada um filtra a lista pelo que contou. */
export function CartoesDoTopo({
  contagem,
  aoFiltrar,
}: {
  contagem: Contagem;
  aoFiltrar: (b: Partial<BuscaTarefas>) => void;
}) {
  return (
    <KpiGrade colunas={4}>
      <KpiCard
        rotulo="Abertas"
        valor={contagem.abertas}
        nota="fora da coluna de concluídas"
        abrir={{
          onClick: () => aoFiltrar({ prazo: undefined, status: undefined }),
          rotulo: "Ver as abertas",
        }}
      />
      <KpiCard
        rotulo="Atrasadas"
        valor={contagem.atrasadas}
        nota="o dia do prazo já passou"
        tom={contagem.atrasadas > 0 ? "perigo" : undefined}
        abrir={{
          onClick: () => aoFiltrar({ prazo: "atrasadas", status: undefined }),
          rotulo: "Ver as atrasadas",
        }}
      />
      <KpiCard
        rotulo="Vencem nesta semana"
        valor={contagem.semana}
        nota="de hoje até domingo"
        tom={contagem.semana > 0 ? "atencao" : undefined}
        abrir={{
          onClick: () => aoFiltrar({ prazo: "semana", status: undefined }),
          rotulo: "Ver as da semana",
        }}
      />
      <KpiCard
        rotulo="Sem prazo"
        valor={contagem.semPrazo}
        nota="abertas sem data"
        abrir={{
          onClick: () => aoFiltrar({ prazo: "sem", status: undefined }),
          rotulo: "Ver as sem prazo",
        }}
      />
    </KpiGrade>
  );
}

type Opcao = { valor: string; rotulo: string };

export function FiltroSelect({
  rotulo,
  valor,
  opcoes,
  aoMudar,
  largura = "w-44",
}: {
  rotulo: string;
  valor: string | undefined;
  opcoes: Opcao[];
  aoMudar: (v: string | undefined) => void;
  largura?: string;
}) {
  return (
    <Select value={valor ?? TODOS} onValueChange={(v) => aoMudar(v === TODOS ? undefined : v)}>
      <SelectTrigger className={`h-8 ${largura}`} aria-label={rotulo}>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A barra de filtros das duas telas. `extra` entra antes dos filtros comuns. */
export function FiltrosTarefas({
  busca,
  aoMudar,
  aoLimpar,
  extra,
  projetos,
  departamentos,
}: {
  busca: BuscaTarefas;
  aoMudar: (b: Partial<BuscaTarefas>) => void;
  aoLimpar?: () => void;
  extra?: React.ReactNode;
  projetos: Opcao[];
  departamentos: Opcao[];
}) {
  const [texto, setTexto] = useState(busca.busca ?? "");
  return (
    <BarraFiltros aoLimpar={aoLimpar}>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          aoMudar({ busca: texto.trim() || undefined });
        }}
      >
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => aoMudar({ busca: texto.trim() || undefined })}
          placeholder="Buscar no título ou descrição"
          aria-label="Buscar"
          className="h-8 w-60 pl-8"
        />
      </form>
      {extra}
      <FiltroSelect
        rotulo="Prioridade"
        valor={busca.prioridade}
        opcoes={PRIORIDADES.map((p) => ({ valor: p, rotulo: ROTULO_PRIORIDADE[p] }))}
        aoMudar={(v) => aoMudar({ prioridade: v as Prioridade | undefined })}
        largura="w-36"
      />
      <FiltroSelect
        rotulo="Prazo"
        valor={busca.prazo}
        opcoes={[
          { valor: "atrasadas", rotulo: "Atrasadas" },
          { valor: "semana", rotulo: "Vencem nesta semana" },
          { valor: "sem", rotulo: "Sem prazo" },
        ]}
        aoMudar={(v) => aoMudar({ prazo: v as BuscaTarefas["prazo"] })}
      />
      {projetos.length > 0 && (
        <FiltroSelect
          rotulo="Projeto"
          valor={busca.projeto}
          opcoes={projetos}
          aoMudar={(v) => aoMudar({ projeto: v })}
        />
      )}
      {departamentos.length > 0 && (
        <FiltroSelect
          rotulo="Departamento"
          valor={busca.departamento}
          opcoes={departamentos}
          aoMudar={(v) => aoMudar({ departamento: v })}
        />
      )}
    </BarraFiltros>
  );
}

/**
 * Nova tarefa a partir de Minhas tarefas: escolhe o quadro, a tarefa nasce na primeira coluna
 * e comigo de responsável. O resto se completa na ficha.
 */
export function DialogoNovaTarefa({
  aberto,
  aoFechar,
  quadros,
  primeiraColuna,
  eu,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  quadros: { id: string; nome: string }[];
  primeiraColuna: (quadroId: string) => string | undefined;
  eu: string;
  aoCriar: (id: string) => void;
}) {
  const client = useQueryClient();
  const [quadroId, setQuadroId] = useState(quadros[0]?.id ?? "");
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("media");
  const criarFn = useServerFn(criarTarefa);
  const criar = useMutation({
    mutationFn: () => {
      const colunaId = primeiraColuna(quadroId);
      if (!colunaId) throw new Error("Esse quadro não tem coluna.");
      return criarFn({
        data: {
          quadroId,
          colunaId,
          titulo,
          prazo: prazo || null,
          prioridade,
          responsavelId: eu,
          ordem: Date.now() / 1000,
        },
      });
    },
    onSuccess: (r) => {
      toast.success("Tarefa criada.");
      client.invalidateQueries({ queryKey: CHAVE });
      setTitulo("");
      setPrazo("");
      aoCriar(r.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>
            Ela nasce com você de responsável, na primeira coluna do quadro.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (titulo.trim() && quadroId) criar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="nt-quadro">Quadro</Label>
            <Select value={quadroId} onValueChange={setQuadroId}>
              <SelectTrigger id="nt-quadro">
                <SelectValue placeholder="Escolha o quadro" />
              </SelectTrigger>
              <SelectContent>
                {quadros.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-titulo">Título</Label>
            <Input
              id="nt-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nt-prazo">Prazo</Label>
              <Input
                id="nt-prazo"
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-prioridade">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as Prioridade)}>
                <SelectTrigger id="nt-prioridade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORIDADES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {ROTULO_PRIORIDADE[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!titulo.trim() || !quadroId || criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar tarefa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
