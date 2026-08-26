import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CoberturaFila, EcdEstado, EstadoFonte } from "@/lib/fila-cella.types";

// Bloco B do §6.2. Cobertura ruim é a primeira coisa visível, não uma célula
// vazia no meio da tabela. Cada número é botão e vira filtro da tabela.

export function FilaCoberturaBar({
  cobertura,
  estado,
  filtroEcd,
  onFiltrarEcd,
}: {
  cobertura: CoberturaFila;
  estado: EstadoFonte;
  filtroEcd: EcdEstado | null;
  onFiltrarEcd: (e: EcdEstado | null) => void;
}) {
  const indisponivel = estado !== "ok";

  const Num = ({ valor, estadoAlvo }: { valor: number; estadoAlvo?: EcdEstado }) => {
    if (indisponivel) return <span className="font-semibold text-muted-foreground">—</span>;
    if (!estadoAlvo) return <span className="font-semibold">{valor}</span>;
    const ativo = filtroEcd === estadoAlvo;
    return (
      <button
        type="button"
        onClick={() => onFiltrarEcd(ativo ? null : estadoAlvo)}
        className={cn(
          "font-semibold underline-offset-2 hover:underline",
          ativo && "text-primary underline",
        )}
      >
        {valor}
      </button>
    );
  };

  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <span>
        <Num valor={cobertura.semCnpj} estadoAlvo="sem_cnpj" /> sem CNPJ
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        <Num valor={cobertura.comEcd} /> com ECD,{" "}
        <Num valor={cobertura.comSinal} estadoAlvo="ecd_com_sinal" /> com sinal
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        <Num valor={cobertura.ecdSemNomeDeConta} estadoAlvo="ecd_sem_nome_de_conta" /> sem plano de
        contas
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        <Num valor={cobertura.ecdSemSinal} estadoAlvo="ecd_sem_sinal" /> com ECD e sem sinal
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        <Num valor={cobertura.semRegime} /> sem regime confirmado
      </span>
      <div className="ml-auto">
        <Button
          variant="outline"
          size="sm"
          disabled={indisponivel || cobertura.semCnpj === 0}
          onClick={() => onFiltrarEcd("sem_cnpj")}
        >
          Resolver CNPJ →
        </Button>
      </div>
    </Card>
  );
}
