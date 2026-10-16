import { FileClock } from "lucide-react";
import type { GentePessoaRow } from "@/lib/gente.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/planning";
import { faixaVigencia, passaDoisAnos, situacaoVigencia } from "./vigencia";

// Contratos de estágio (TCE) e de terceiro a renovar (pedido do RH de Maceió,
// 13/10/2026). Mostra quem vence em até 30 dias, quem já venceu e quem está sem a
// vigência informada; o mesmo aviso sai por e-mail ao RH da unidade.

export function VigenciasCard({
  pessoas,
  aoVerTodos,
}: {
  pessoas: GentePessoaRow[];
  aoVerTodos: () => void;
}) {
  const lista = pessoas
    .map((p) => ({ p, faixa: faixaVigencia(p), s: situacaoVigencia(p.vigenciaFim) }))
    .filter((x) => x.faixa === "vencido" || x.faixa === "vence30" || x.faixa === "sem")
    .sort((a, b) => a.s.ordem - b.s.ordem);
  if (!lista.length) return null;
  const semVigencia = lista.filter((x) => x.faixa === "sem").length;

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <FileClock className="h-4 w-4 text-primary-text" />
        <h3 className="font-semibold">Contratos de estágio e terceiro</h3>
        <span className="num text-[13px] text-muted-foreground">({lista.length})</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={aoVerTodos}>
          Filtrar a lista
        </Button>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Quem vence em até 30 dias ou já venceu. Para renovar, mude o fim da vigência no Editar da
        pessoa.
        {semVigencia
          ? ` ${semVigencia} pessoa${semVigencia === 1 ? "" : "s"} sem a vigência informada: complete pelo Editar ou pela planilha.`
          : ""}
      </p>
      <ul className="divide-y text-sm">
        {lista.map(({ p, s }) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium">{p.nomeCompleto}</span>
            <span className="text-[13px] text-muted-foreground">
              {p.tipoVinculo === "estagio" ? "Estágio (TCE)" : "Terceiro"}
              {p.unidade ? ` · ${p.unidade}` : ""}
              {passaDoisAnos(p) ? " · passa de 2 anos de estágio (Lei 11.788, art. 11)" : ""}
            </span>
            <span className="ml-auto">
              <StatusBadge tom={s.tom}>{s.texto}</StatusBadge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
