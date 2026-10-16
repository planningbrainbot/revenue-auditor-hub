import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exigeVigencia } from "./vigencia";

/** Os dois campos de data, só para estágio e terceiro. */
export function CamposVigencia({
  prefixo,
  vinculo,
  inicio,
  fim,
  aoMudarInicio,
  aoMudarFim,
}: {
  prefixo: string;
  vinculo: string;
  inicio: string;
  fim: string;
  aoMudarInicio: (v: string) => void;
  aoMudarFim: (v: string) => void;
}) {
  if (!exigeVigencia(vinculo)) return null;
  const doQue = vinculo === "estagio" ? "do TCE" : "do contrato";
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefixo}-vig-inicio`}>Início da vigência {doQue}</Label>
        <Input
          id={`${prefixo}-vig-inicio`}
          type="date"
          required
          value={inicio}
          onChange={(e) => aoMudarInicio(e.target.value)}
        />
      </div>
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
          O RH recebe aviso por e-mail 30 e 15 dias antes e no dia. Para renovar, mude o fim.
        </p>
      </div>
    </>
  );
}
