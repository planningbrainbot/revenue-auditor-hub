import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { criarPessoa } from "@/lib/gente.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SEM_GESTOR = "__sem__";

const VINCULOS = [
  { v: "clt", t: "CLT" },
  { v: "pj", t: "PJ" },
  { v: "socio", t: "Sócio" },
  { v: "estagio", t: "Estágio" },
  { v: "prolabore", t: "Pró-labore" },
  { v: "terceiro", t: "Terceiro" },
];

type Vazio = {
  nomeCompleto: string;
  email: string;
  cargo: string;
  departamento: string;
  tipoVinculo: string;
  dataAdmissao: string;
  gestorId: string;
};

const VAZIO: Vazio = {
  nomeCompleto: "",
  email: "",
  cargo: "",
  departamento: "",
  tipoVinculo: "clt",
  dataAdmissao: "",
  gestorId: SEM_GESTOR,
};

export function NovaPessoaDialog({
  unidades,
  gestores,
}: {
  unidades: { id: number; nome: string }[];
  gestores: { id: number; nome: string; unidadeId: number | null }[];
}) {
  const fn = useServerFn(criarPessoa);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState<Vazio>(VAZIO);
  // Sócio regional tem uma unidade só: já vem escolhida.
  const [unidadeId, setUnidadeId] = useState<string>(
    unidades.length === 1 ? String(unidades[0].id) : "",
  );

  const set = (k: keyof Vazio) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const gestoresDaUnidade = gestores.filter((g) => String(g.unidadeId) === unidadeId);

  const criar = useMutation({
    mutationFn: async () =>
      fn({
        data: {
          nomeCompleto: f.nomeCompleto,
          email: f.email,
          unidadeId: Number(unidadeId),
          cargo: f.cargo,
          departamento: f.departamento,
          tipoVinculo: f.tipoVinculo,
          dataAdmissao: f.dataAdmissao,
          gestorId: f.gestorId === SEM_GESTOR ? null : Number(f.gestorId),
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.vinculouLogin
          ? "Pessoa cadastrada e ligada ao login que ela já tem."
          : "Pessoa cadastrada. Ela ainda não tem login no Brain.",
      );
      setF(VAZIO);
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["gente"] });
      qc.invalidateQueries({ queryKey: ["gente-menu"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!unidades.length) return null;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          Nova pessoa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar pessoa</DialogTitle>
          <DialogDescription>
            Entra no cadastro da unidade. Se o e-mail já tiver login no Brain, o vínculo é feito na
            hora.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="np-nome">Nome completo</Label>
            <Input
              id="np-nome"
              value={f.nomeCompleto}
              onChange={(e) => set("nomeCompleto")(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-email">E-mail</Label>
            <Input
              id="np-email"
              type="email"
              value={f.email}
              onChange={(e) => set("email")(e.target.value)}
              placeholder="nome@planning.com.br"
              required
            />
          </div>

          {unidades.length > 1 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="np-unidade">Unidade</Label>
              <Select
                value={unidadeId}
                onValueChange={(v) => {
                  setUnidadeId(v);
                  set("gestorId")(SEM_GESTOR);
                }}
              >
                <SelectTrigger id="np-unidade">
                  <SelectValue placeholder="Escolha a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {unidades.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="np-cargo">Cargo</Label>
              <Input
                id="np-cargo"
                value={f.cargo}
                onChange={(e) => set("cargo")(e.target.value)}
                placeholder="Ex.: Líder de RH"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-depto">Departamento</Label>
              <Input
                id="np-depto"
                value={f.departamento}
                onChange={(e) => set("departamento")(e.target.value)}
                placeholder="Ex.: RH"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-vinculo">Vínculo</Label>
              <Select value={f.tipoVinculo} onValueChange={set("tipoVinculo")}>
                <SelectTrigger id="np-vinculo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VINCULOS.map((v) => (
                    <SelectItem key={v.v} value={v.v}>
                      {v.t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-admissao">Admissão</Label>
              <Input
                id="np-admissao"
                type="date"
                value={f.dataAdmissao}
                onChange={(e) => set("dataAdmissao")(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="np-gestor">Gestor</Label>
            <Select value={f.gestorId} onValueChange={set("gestorId")} disabled={!unidadeId}>
              <SelectTrigger id="np-gestor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_GESTOR}>Sem gestor por enquanto</SelectItem>
                {gestoresDaUnidade.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={criar.isPending || !unidadeId}>
              {criar.isPending ? "Salvando…" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
