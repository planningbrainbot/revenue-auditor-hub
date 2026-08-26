import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ECD_ESTADO_LABEL,
  ESTAGIOS,
  FORCAS,
  FRENTES,
  RELACIONAMENTOS,
  type EcdEstado,
} from "@/lib/fila-cella.types";

// Bloco F do §6.2. O toggle "ocultar descartados" nasce LIGADO: Simples Nacional
// degrada, não some (auditabilidade), mas sai da fila operacional por padrão.
//
// Estado sobe por props; nada de search param na v1 — a rota não declara
// `validateSearch` e a fila não é compartilhada por link ainda.

export const TODOS = "__todos__";

export interface FiltrosFila {
  busca: string;
  curva: string;
  segmento: string;
  ecd: EcdEstado | null;
  forca: string;
  frente: string;
  estagio: string;
  relacionamento: string;
  ocultarDescartados: boolean;
}

export const FILTROS_INICIAIS: FiltrosFila = {
  busca: "",
  curva: TODOS,
  segmento: TODOS,
  ecd: null,
  forca: TODOS,
  frente: TODOS,
  estagio: TODOS,
  relacionamento: TODOS,
  ocultarDescartados: true,
};

function Campo({
  rotulo,
  valor,
  onChange,
  opcoes,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[150px]">
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

export function FilaFiltros({
  filtros,
  onChange,
  segmentos,
  desabilitado,
}: {
  filtros: FiltrosFila;
  onChange: (f: FiltrosFila) => void;
  segmentos: string[];
  desabilitado: boolean;
}) {
  const set = (patch: Partial<FiltrosFila>) => onChange({ ...filtros, ...patch });
  const sujo =
    JSON.stringify({ ...filtros, ocultarDescartados: true }) !==
    JSON.stringify({ ...FILTROS_INICIAIS, ocultarDescartados: true });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Buscar empresa, CNPJ, dono…"
        value={filtros.busca}
        disabled={desabilitado}
        onChange={(e) => set({ busca: e.target.value })}
        className="h-9 w-[260px]"
      />
      <Campo
        rotulo="Curva"
        valor={filtros.curva}
        onChange={(v) => set({ curva: v })}
        opcoes={["A", "B", "C"].map((c) => ({ valor: c, rotulo: `Curva ${c}` }))}
      />
      <Campo
        rotulo="Segmento"
        valor={filtros.segmento}
        onChange={(v) => set({ segmento: v })}
        opcoes={segmentos.map((s) => ({ valor: s, rotulo: s }))}
      />
      <Campo
        rotulo="ECD"
        valor={filtros.ecd ?? TODOS}
        onChange={(v) => set({ ecd: v === TODOS ? null : (v as EcdEstado) })}
        opcoes={(Object.keys(ECD_ESTADO_LABEL) as EcdEstado[]).map((e) => ({
          valor: e,
          rotulo: ECD_ESTADO_LABEL[e],
        }))}
      />
      <Campo
        rotulo="Força"
        valor={filtros.forca}
        onChange={(v) => set({ forca: v })}
        opcoes={FORCAS.map((f) => ({ valor: f, rotulo: f }))}
      />
      <Campo
        rotulo="Frente"
        valor={filtros.frente}
        onChange={(v) => set({ frente: v })}
        opcoes={FRENTES.map((f) => ({ valor: f, rotulo: f }))}
      />
      <Campo
        rotulo="Estágio"
        valor={filtros.estagio}
        onChange={(v) => set({ estagio: v })}
        opcoes={ESTAGIOS.map((e) => ({ valor: e, rotulo: e }))}
      />
      <Campo
        rotulo="Relacion."
        valor={filtros.relacionamento}
        onChange={(v) => set({ relacionamento: v })}
        opcoes={RELACIONAMENTOS.map((r) => ({ valor: r, rotulo: r }))}
      />
      <div className="flex items-center gap-2">
        <Switch
          id="ocultar-descartados"
          checked={filtros.ocultarDescartados}
          disabled={desabilitado}
          onCheckedChange={(v) => set({ ocultarDescartados: v })}
        />
        <Label htmlFor="ocultar-descartados" className="text-xs text-muted-foreground">
          ocultar descartados
        </Label>
      </div>
      {sujo && (
        <Button variant="ghost" size="sm" onClick={() => onChange(FILTROS_INICIAIS)}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
