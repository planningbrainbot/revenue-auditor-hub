import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPeriodosVigencia } from "@/lib/gente.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exigeVigencia } from "./vigencia";

const fmt = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const TIPO = { inicial: "Contrato", renovacao: "Renovação", correcao: "Correção do fim" };

/**
 * Fim da vigência, só para estágio e terceiro. O início é a data de início do
 * cadastro (a admissão); renovar é mudar o fim, e cada período fica registrado.
 */
export function CamposVigencia({
  prefixo,
  vinculo,
  fim,
  inicio,
  aoMudarFim,
}: {
  prefixo: string;
  vinculo: string;
  fim: string;
  /** Data de início do cadastro, para o fim não ficar antes dela. */
  inicio: string;
  aoMudarFim: (v: string) => void;
}) {
  if (!exigeVigencia(vinculo)) return null;
  const doQue = vinculo === "estagio" ? "do TCE" : "do contrato";
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`${prefixo}-vig-fim`}>Fim da vigência {doQue}</Label>
      <Input
        id={`${prefixo}-vig-fim`}
        type="date"
        required
        min={inicio || undefined}
        value={fim}
        onChange={(e) => aoMudarFim(e.target.value)}
      />
      <p className="text-[12px] text-muted-foreground">
        O RH recebe aviso por e-mail 30 e 15 dias antes e no dia. Para renovar, mude o fim: o
        período novo fica registrado.
      </p>
    </div>
  );
}

/** Períodos registrados do contrato (contrato inicial, renovações e correções). */
export function PeriodosVigencia({ pessoaId }: { pessoaId: number }) {
  const fn = useServerFn(listPeriodosVigencia);
  const q = useQuery({
    queryKey: ["gente-vigencia-periodos", pessoaId],
    queryFn: () => fn({ data: { pessoaId } }),
  });
  if (!q.data?.length) return null;
  return (
    <div className="grid gap-1 rounded-md border p-3 text-[13px] sm:col-span-2">
      <span className="font-medium">Períodos do contrato</span>
      <ul className="grid gap-0.5 text-muted-foreground">
        {q.data.map((p, i) => (
          <li key={i}>
            {TIPO[p.tipo]}: {fmt(p.inicio)} a {fmt(p.fim)}
            <span className="text-[12px]"> · registrado em {fmt(p.registradoEm)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
