import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/planning";
import {
  listarBasePipefyUnidades,
  salvarUnidade,
  type RegistroPipefyComVinculo,
} from "@/lib/unidades-cadastro.functions";
import { lerNumeroBr, pendenciasDaUnidade, type TipoUnidade } from "@/lib/unidades-cadastro";

/** A linha de ops.unidades como a lista de Unidades e a ficha leem. */
export type UnidadeCadastro = {
  id: number;
  nome_da_praca: string | null;
  tipo: string | null;
  razao_social: string | null;
  cnpj: string | null;
  data_inauguracao: string | null;
  royalties_percentual: number | null;
  csc_valor_fixo: number | null;
  csc_percentual_base_antiga: number | null;
  midia_mensal: number | null;
  midia_cac: boolean | null;
  paga_cac: boolean | null;
  cac_desde: string | null;
  absorve_midia: boolean | null;
  id_omie: string | null;
  id_asaas: string | null;
  pipefy_id: string | null;
  pipedrive_opcao_id: number | null;
  observacoes_financeiras: string | null;
};

type Form = {
  nome_da_praca: string;
  tipo: TipoUnidade;
  razao_social: string;
  cnpj: string;
  data_inauguracao: string;
  royalties_percentual: string;
  csc_valor_fixo: string;
  csc_percentual_base_antiga: string;
  midia_mensal: string;
  midia_cac: boolean;
  paga_cac: boolean;
  cac_desde: string;
  absorve_midia: boolean;
  id_omie: string;
  id_asaas: string;
  pipefy_id: string;
  pipedrive_opcao_id: string;
  observacoes_financeiras: string;
};

const numParaCampo = (v: number | null | undefined) =>
  v == null ? "" : String(v).replace(".", ",");

function formDe(u: UnidadeCadastro | null): Form {
  return {
    nome_da_praca: u?.nome_da_praca ?? "",
    tipo: u?.tipo === "interna" ? "interna" : "regional",
    razao_social: u?.razao_social ?? "",
    cnpj: u?.cnpj ?? "",
    data_inauguracao: u?.data_inauguracao ?? "",
    royalties_percentual: numParaCampo(u?.royalties_percentual),
    csc_valor_fixo: numParaCampo(u?.csc_valor_fixo),
    csc_percentual_base_antiga: numParaCampo(u?.csc_percentual_base_antiga),
    midia_mensal: numParaCampo(u?.midia_mensal),
    midia_cac: !!u?.midia_cac,
    // Unidade nova da Expansão paga CAC (São Bernardo, Recife e Sorocaba); quem não paga desliga.
    paga_cac: u ? !!u.paga_cac : true,
    cac_desde: u?.cac_desde ?? "",
    absorve_midia: !!u?.absorve_midia,
    id_omie: u?.id_omie ?? "",
    id_asaas: u?.id_asaas ?? "",
    pipefy_id: u?.pipefy_id ?? "",
    pipedrive_opcao_id: u?.pipedrive_opcao_id == null ? "" : String(u.pipedrive_opcao_id),
    observacoes_financeiras: u?.observacoes_financeiras ?? "",
  };
}

/** Campo numérico: vazio é null; texto que não é número fica marcado, nunca vira 0. */
function numeroDoCampo(v: string): { valor: number | null; invalido: boolean } {
  if (!v.trim()) return { valor: null, invalido: false };
  const n = lerNumeroBr(v);
  return { valor: n, invalido: n == null };
}

function Campo({
  id,
  rotulo,
  ajuda,
  erro,
  children,
  className,
}: {
  id: string;
  rotulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="mt-1">{children}</div>
      {erro ? (
        <p id={`${id}-erro`} className="mt-1 text-xs text-danger">
          {erro}
        </p>
      ) : ajuda ? (
        <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  );
}

function Interruptor({
  id,
  rotulo,
  ajuda,
  marcado,
  aoMudar,
}: {
  id: string;
  rotulo: string;
  ajuda: string;
  marcado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={marcado} onCheckedChange={aoMudar} className="mt-0.5" />
      <div>
        <Label htmlFor={id}>{rotulo}</Label>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </div>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </legend>
      {children}
    </fieldset>
  );
}

export function UnidadeDialog({
  aberto,
  aoMudarAberto,
  unidade,
  noFaturamentoDoCsc,
  podeEditarCsc,
  aoSalvar,
}: {
  aberto: boolean;
  aoMudarAberto: (v: boolean) => void;
  /** null = unidade nova. */
  unidade: UnidadeCadastro | null;
  /** Se a unidade já está em ops.csc_unidades; null quando quem edita não lê essa tabela. */
  noFaturamentoDoCsc: boolean | null;
  podeEditarCsc: boolean;
  aoSalvar: () => void;
}) {
  const nova = unidade == null;
  const salvar = useServerFn(salvarUnidade);
  const listarPipefy = useServerFn(listarBasePipefyUnidades);

  const [f, setF] = useState<Form>(() => formDe(unidade));
  const [salvando, setSalvando] = useState(false);
  const [registros, setRegistros] = useState<RegistroPipefyComVinculo[] | null>(null);
  const [erroPipefy, setErroPipefy] = useState<string | null>(null);
  const [registroEscolhido, setRegistroEscolhido] = useState<string>("");
  const [incluirCsc, setIncluirCsc] = useState(false);
  const [sigla, setSigla] = useState("");
  const [emailsCsc, setEmailsCsc] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setF(formDe(unidade));
    setRegistroEscolhido("");
    setIncluirCsc(false);
    setSigla("");
    setEmailsCsc("");
  }, [aberto, unidade]);

  // A base do Pipefy só é lida para unidade nova: na edição ela não sobrescreve nada
  // (o Pipefy diz 6% para Patos de Minas, o cadastro do Ops diz 8%).
  // Lida de novo a cada abertura: o registro ligado no cadastro anterior já não é livre.
  useEffect(() => {
    if (!aberto || !nova) return;
    let vivo = true;
    setRegistros(null);
    setErroPipefy(null);
    listarPipefy()
      .then((r) => vivo && setRegistros(r))
      .catch((e: unknown) => vivo && setErroPipefy(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
    // listarPipefy fica de fora: a identidade pode mudar a cada render e a leitura repetiria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, nova]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  function aplicarRegistro(pipefyId: string) {
    setRegistroEscolhido(pipefyId);
    const r = registros?.find((x) => x.pipefy_id === pipefyId);
    if (!r) return;
    setF((p) => ({
      ...p,
      nome_da_praca: r.unidade_de_negocio ?? r.titulo,
      razao_social: r.razao_social ?? p.razao_social,
      cnpj: r.cnpj ?? p.cnpj,
      data_inauguracao: r.data_inauguracao ?? p.data_inauguracao,
      royalties_percentual: numParaCampo(r.royalties_percentual) || p.royalties_percentual,
      csc_valor_fixo: numParaCampo(r.csc_valor_fixo) || p.csc_valor_fixo,
      id_omie: r.id_omie ?? p.id_omie,
      id_asaas: r.id_asaas ?? p.id_asaas,
      observacoes_financeiras: r.observacoes_financeiras ?? p.observacoes_financeiras,
      pipefy_id: r.pipefy_id,
    }));
    if (r.sigla) setSigla(r.sigla);
    if (r.emails.length) setEmailsCsc(r.emails.join("\n"));
  }

  const nums = {
    royalties_percentual: numeroDoCampo(f.royalties_percentual),
    csc_valor_fixo: numeroDoCampo(f.csc_valor_fixo),
    csc_percentual_base_antiga: numeroDoCampo(f.csc_percentual_base_antiga),
    midia_mensal: numeroDoCampo(f.midia_mensal),
  };
  const opcao = f.pipedrive_opcao_id.trim();
  const opcaoInvalida = opcao !== "" && !/^\d+$/.test(opcao);
  const nomeVazio = !f.nome_da_praca.trim();
  const algumInvalido = Object.values(nums).some((n) => n.invalido) || opcaoInvalida || nomeVazio;

  const pendencias = useMemo(
    () =>
      pendenciasDaUnidade(
        {
          tipo: f.tipo,
          cnpj: f.cnpj.trim() || null,
          razao_social: f.razao_social.trim() || null,
          data_inauguracao: f.data_inauguracao || null,
          royalties_percentual: nums.royalties_percentual.valor,
          pipedrive_opcao_id: opcao && !opcaoInvalida ? Number(opcao) : null,
          pipefy_id: f.pipefy_id.trim() || null,
          id_omie: f.id_omie.trim() || null,
        },
        incluirCsc ? true : noFaturamentoDoCsc,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, incluirCsc, noFaturamentoDoCsc],
  );

  // O registro de CSC precisa do cliente no Omie e do valor: sem eles a fatura não sai.
  const cscPossivel = !!f.id_omie.trim() && (nums.csc_valor_fixo.valor ?? 0) > 0;
  const mostrarCsc = podeEditarCsc && noFaturamentoDoCsc !== true && f.tipo === "regional";

  async function aoConfirmar() {
    if (algumInvalido) {
      toast.error("Corrija os campos marcados antes de salvar.");
      return;
    }
    setSalvando(true);
    try {
      const r = await salvar({
        data: {
          unidade: {
            id: unidade?.id,
            nome_da_praca: f.nome_da_praca,
            tipo: f.tipo,
            razao_social: f.razao_social,
            cnpj: f.cnpj,
            data_inauguracao: f.data_inauguracao || null,
            royalties_percentual: nums.royalties_percentual.valor,
            csc_valor_fixo: nums.csc_valor_fixo.valor,
            csc_percentual_base_antiga: nums.csc_percentual_base_antiga.valor,
            midia_mensal: nums.midia_mensal.valor,
            midia_cac: f.midia_cac,
            paga_cac: f.paga_cac,
            cac_desde: f.cac_desde || null,
            absorve_midia: f.absorve_midia,
            id_omie: f.id_omie,
            id_asaas: f.id_asaas,
            pipefy_id: f.pipefy_id,
            pipedrive_opcao_id: opcao ? Number(opcao) : null,
            observacoes_financeiras: f.observacoes_financeiras,
          },
          csc: incluirCsc && cscPossivel ? { sigla, emails: [emailsCsc] } : null,
        },
      });
      const nome = f.nome_da_praca.trim();
      toast.success(r.criada ? `${nome} cadastrada.` : `${nome} atualizada.`);
      if (r.avisoCsc) toast.error(`A unidade foi salva, mas o CSC não: ${r.avisoCsc}`);
      aoSalvar();
      aoMudarAberto(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a unidade.");
    } finally {
      setSalvando(false);
    }
  }

  const livres = (registros ?? []).filter((r) => !r.unidade_vinculada);
  const vinculados = (registros ?? []).filter((r) => r.unidade_vinculada);

  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {nova ? "Nova unidade" : `Editar ${unidade?.nome_da_praca ?? "unidade"}`}
          </DialogTitle>
          <DialogDescription>
            {nova
              ? "A unidade passa a existir para royalties, CAC, CSC, carteira e escopo de acesso assim que for salva."
              : "A mudança vale para as próximas leituras de royalties, CAC e CSC."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {nova && (
            <Bloco titulo="Partir da base de Unidades do Pipefy">
              <Campo
                id="unidade-pipefy-registro"
                rotulo="Registro no Pipefy"
                ajuda="Preenche nome, razão social, CNPJ, Omie, inauguração, CSC e royalties com o que está no Pipefy. Confira na Receita: a base guarda algumas razões sociais encurtadas."
                erro={erroPipefy ? `Não foi possível ler o Pipefy: ${erroPipefy}` : null}
              >
                <Select
                  value={registroEscolhido}
                  onValueChange={aplicarRegistro}
                  disabled={!registros || livres.length === 0}
                >
                  <SelectTrigger id="unidade-pipefy-registro">
                    <SelectValue
                      placeholder={
                        registros == null
                          ? erroPipefy
                            ? "Pipefy indisponível"
                            : "Carregando a base do Pipefy…"
                          : livres.length === 0
                            ? "Todos os registros já estão ligados a uma unidade"
                            : `Escolha um dos ${livres.length} registros sem unidade`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {livres.map((r) => (
                      <SelectItem key={r.pipefy_id} value={r.pipefy_id}>
                        {r.titulo}
                        {r.unidade_de_negocio && r.unidade_de_negocio !== r.titulo
                          ? ` · ${r.unidade_de_negocio}`
                          : ""}
                        {r.cnpj ? ` · ${r.cnpj.split("\n")[0]}` : ""}
                      </SelectItem>
                    ))}
                    {vinculados.map((r) => (
                      <SelectItem key={r.pipefy_id} value={r.pipefy_id} disabled>
                        {r.titulo} · já é {r.unidade_vinculada}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
            </Bloco>
          )}

          <Bloco titulo="Identificação">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Campo
                id="unidade-nome"
                rotulo="Nome da unidade"
                ajuda="É por este nome que contratos, clientes e apurações casam com a unidade."
                erro={nomeVazio ? "Obrigatório." : null}
              >
                <Input
                  id="unidade-nome"
                  value={f.nome_da_praca}
                  onChange={(e) => set("nome_da_praca", e.target.value)}
                  aria-invalid={nomeVazio}
                  placeholder="Ex.: Natal"
                />
              </Campo>
              <Campo
                id="unidade-tipo"
                rotulo="Tipo"
                ajuda="Interna não entra em royalties, NPS nem saúde de carteira (como Goiânia e São Paulo)."
              >
                <Select value={f.tipo} onValueChange={(v) => set("tipo", v as TipoUnidade)}>
                  <SelectTrigger id="unidade-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regional">Regional (rede)</SelectItem>
                    <SelectItem value="interna">Interna</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo id="unidade-razao" rotulo="Razão social" className="md:col-span-2">
                <Input
                  id="unidade-razao"
                  value={f.razao_social}
                  onChange={(e) => set("razao_social", e.target.value)}
                />
              </Campo>
              <Campo
                id="unidade-cnpj"
                rotulo="CNPJ"
                ajuda="Um por linha, quando a unidade tem mais de uma entidade."
              >
                <Textarea
                  id="unidade-cnpj"
                  rows={2}
                  value={f.cnpj}
                  onChange={(e) => set("cnpj", e.target.value)}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-inauguracao"
                rotulo="Data de inauguração"
                ajuda="Futura deixa a unidade como Futura; vazia, ela aparece como Ativa."
              >
                <Input
                  id="unidade-inauguracao"
                  type="date"
                  value={f.data_inauguracao}
                  onChange={(e) => set("data_inauguracao", e.target.value)}
                />
              </Campo>
            </div>
          </Bloco>

          <Bloco titulo="Regra de repasse">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Campo
                id="unidade-royalties"
                rotulo="Royalties (%)"
                ajuda="Vazio: a apuração não gera royalties, só CAC e CSC."
                erro={nums.royalties_percentual.invalido ? "Use só número, ex.: 12 ou 8,5." : null}
              >
                <Input
                  id="unidade-royalties"
                  inputMode="decimal"
                  value={f.royalties_percentual}
                  onChange={(e) => set("royalties_percentual", e.target.value)}
                  aria-invalid={nums.royalties_percentual.invalido}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-csc-fixo"
                rotulo="CSC fixo (R$ por mês)"
                erro={nums.csc_valor_fixo.invalido ? "Use só número, ex.: 5.000,00." : null}
              >
                <Input
                  id="unidade-csc-fixo"
                  inputMode="decimal"
                  value={f.csc_valor_fixo}
                  onChange={(e) => set("csc_valor_fixo", e.target.value)}
                  aria-invalid={nums.csc_valor_fixo.invalido}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-csc-pct"
                rotulo="CSC sobre a base antiga (%)"
                ajuda="Só para unidade que já tinha carteira ao entrar na rede."
                erro={nums.csc_percentual_base_antiga.invalido ? "Use só número." : null}
              >
                <Input
                  id="unidade-csc-pct"
                  inputMode="decimal"
                  value={f.csc_percentual_base_antiga}
                  onChange={(e) => set("csc_percentual_base_antiga", e.target.value)}
                  aria-invalid={nums.csc_percentual_base_antiga.invalido}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-midia"
                rotulo="Mídia mensal (R$)"
                erro={nums.midia_mensal.invalido ? "Use só número." : null}
              >
                <Input
                  id="unidade-midia"
                  inputMode="decimal"
                  value={f.midia_mensal}
                  onChange={(e) => set("midia_mensal", e.target.value)}
                  aria-invalid={nums.midia_mensal.invalido}
                  className="num"
                />
              </Campo>
            </div>
            <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-2">
              <Interruptor
                id="unidade-paga-cac"
                rotulo="Paga CAC"
                ajuda="Duas parcelas de 50%: no fechamento da venda e depois do 1º honorário."
                marcado={f.paga_cac}
                aoMudar={(v) => set("paga_cac", v)}
              />
              {f.paga_cac && (
                <Campo
                  id="unidade-cac-desde"
                  rotulo="CAC desde"
                  ajuda="Venda anterior a esta data não conta como falha no funil de CAC."
                >
                  <Input
                    id="unidade-cac-desde"
                    type="date"
                    value={f.cac_desde}
                    onChange={(e) => set("cac_desde", e.target.value)}
                  />
                </Campo>
              )}
              <Interruptor
                id="unidade-midia-cac"
                rotulo="Mídia é o CAC"
                ajuda="A verba de mídia substitui o CAC (o caso de Patos de Minas)."
                marcado={f.midia_cac}
                aoMudar={(v) => set("midia_cac", v)}
              />
              <Interruptor
                id="unidade-absorve-midia"
                rotulo="Absorve mídia"
                ajuda="A unidade paga a própria mídia."
                marcado={f.absorve_midia}
                aoMudar={(v) => set("absorve_midia", v)}
              />
            </div>
          </Bloco>

          <Bloco titulo="Vínculos com os sistemas">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Campo
                id="unidade-pipedrive"
                rotulo="Opção no Pipedrive"
                ajuda="Número do item no campo Unidade de Negócio (Configurações › Campos do negócio). Sem ele, contrato vendido para a unidade grava o número no lugar do nome."
                erro={opcaoInvalida ? "Só número inteiro." : null}
              >
                <Input
                  id="unidade-pipedrive"
                  inputMode="numeric"
                  value={f.pipedrive_opcao_id}
                  onChange={(e) => set("pipedrive_opcao_id", e.target.value)}
                  aria-invalid={opcaoInvalida}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-pipefy"
                rotulo="Registro no Pipefy"
                ajuda="Id do registro na base de Unidades. Sem ele, cliente cadastrado no Pipefy não cai nesta unidade."
              >
                <Input
                  id="unidade-pipefy"
                  inputMode="numeric"
                  value={f.pipefy_id}
                  onChange={(e) => set("pipefy_id", e.target.value)}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-omie"
                rotulo="Cliente no Omie da Partners"
                ajuda="Código do cliente que recebe a fatura de CSC e royalties."
              >
                <Input
                  id="unidade-omie"
                  inputMode="numeric"
                  value={f.id_omie}
                  onChange={(e) => set("id_omie", e.target.value)}
                  className="num"
                />
              </Campo>
              <Campo
                id="unidade-asaas"
                rotulo="Cliente no Asaas"
                ajuda="Ex.: cus_000198464357. Só para quem cobra pelo Asaas."
              >
                <Input
                  id="unidade-asaas"
                  value={f.id_asaas}
                  onChange={(e) => set("id_asaas", e.target.value)}
                />
              </Campo>
            </div>
          </Bloco>

          {mostrarCsc && (
            <Bloco titulo="Faturamento do CSC">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="unidade-csc-incluir"
                  checked={incluirCsc}
                  onCheckedChange={(v) => setIncluirCsc(v === true)}
                  disabled={!cscPossivel}
                  className="mt-0.5"
                />
                <div>
                  <Label htmlFor="unidade-csc-incluir">Incluir em Emitir faturas</Label>
                  <p className="text-xs text-muted-foreground">
                    {cscPossivel
                      ? "Entra com emissão manual, fora da rotina automática do 5º dia útil, como São Bernardo, Recife e Sorocaba."
                      : "Precisa do cliente no Omie da Partners e do CSC fixo preenchidos."}
                  </p>
                </div>
              </div>
              {incluirCsc && cscPossivel && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Campo id="unidade-csc-sigla" rotulo="Sigla" ajuda="2 a 5 letras, ex.: NAT.">
                    <Input
                      id="unidade-csc-sigla"
                      value={sigla}
                      onChange={(e) => setSigla(e.target.value.toUpperCase())}
                      maxLength={5}
                    />
                  </Campo>
                  <Campo
                    id="unidade-csc-emails"
                    rotulo="E-mails da fatura"
                    ajuda="Um por linha. O financeiro da matriz entra se for para receber cópia."
                    className="md:col-span-2"
                  >
                    <Textarea
                      id="unidade-csc-emails"
                      rows={3}
                      value={emailsCsc}
                      onChange={(e) => setEmailsCsc(e.target.value)}
                    />
                  </Campo>
                </div>
              )}
            </Bloco>
          )}

          <Campo id="unidade-obs" rotulo="Observações financeiras">
            <Textarea
              id="unidade-obs"
              rows={2}
              value={f.observacoes_financeiras}
              onChange={(e) => set("observacoes_financeiras", e.target.value)}
            />
          </Campo>

          <div className="rounded-lg border bg-muted/30 p-3" aria-live="polite">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium">O que ainda falta nesta unidade?</span>
              {pendencias.length === 0 ? (
                <StatusBadge tom="sucesso">Cadastro completo</StatusBadge>
              ) : (
                <StatusBadge tom="atencao">
                  {pendencias.length} {pendencias.length === 1 ? "pendência" : "pendências"}
                </StatusBadge>
              )}
            </div>
            {pendencias.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {pendencias.map((p) => (
                  <li key={p.chave}>{p.texto}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Pode salvar com pendência. O cliente no Omie da Partners e o acesso dos sócios são
              criados fora desta tela.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => aoMudarAberto(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={aoConfirmar} disabled={salvando || algumInvalido}>
            {salvando ? "Salvando…" : nova ? "Cadastrar unidade" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
