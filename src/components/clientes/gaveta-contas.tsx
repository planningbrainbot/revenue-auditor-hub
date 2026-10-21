// O número aberto numa gaveta à direita (Pedro, 21/10/2026: "clicar em cada gráfico e em cada filtro e conseguir auditar
// nominalmente o número, assim como acontece com tudo"). Mesmo padrão da Consultoria (20/10): a lista abre na gaveta e a
// empresa abre a ficha por cima, com "Voltar". A gaveta recebe as contas que o número soma; o total do cabeçalho é o
// tamanho da lista (N2), e a barra de certeza filtra dentro dela.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EstadoVazio } from "@/components/planning";
import { downloadCsv, FOCO_VISIVEL, number } from "@/components/monetizacao/common";
import { AccountDetail } from "@/components/monetizacao/account-detail";
import { faturamentoDeclarado } from "@/lib/monetizacao/model";
import { PORTES, SEM_UF, type PerfilRecorte } from "@/lib/clientes/recorte";
import {
  casaBusca,
  contarFaixas,
  FAIXA_META,
  faixaDaConta,
  porCerteza,
  type Faixa,
} from "@/lib/clientes/regra-cliente";
import type { Conta, Negocio } from "@/lib/monetizacao/types";
import { BarraConfianca, TabelaContas } from "./regra-cliente";

export interface NumeroAberto {
  titulo: string;
  /** A régua do número, numa frase. */
  descricao: string;
  contas: Conta[];
  /** Atalho para a tela de trabalho com o mesmo recorte (a lista de Clientes, Contratos e churn). */
  ir?: { rotulo: string; onClick: () => void };
}

export function GavetaContas({
  numero,
  fechar,
  perfil,
  cards,
}: {
  numero: NumeroAberto | null;
  fechar: () => void;
  perfil: (a: Conta) => PerfilRecorte;
  cards: Negocio[];
}) {
  const [faixa, setFaixa] = useState<Faixa | null>(null),
    [busca, setBusca] = useState(""),
    [pagina, setPagina] = useState(1),
    [ficha, setFicha] = useState<Conta | null>(null);
  // Outro número começa limpo.
  const titulo = numero?.titulo;
  useEffect(() => {
    setFaixa(null);
    setBusca("");
    setPagina(1);
    setFicha(null);
  }, [titulo]);
  const contas = useMemo(() => (numero?.contas ?? []).slice().sort(porCerteza), [numero]);
  const contagem = useMemo(() => contarFaixas(contas), [contas]);
  const linhas = useMemo(
    () =>
      contas.filter(
        (a) => (!faixa || faixaDaConta(a) === faixa) && (!busca.trim() || casaBusca(a, busca)),
      ),
    [contas, faixa, busca],
  );
  const exportar = () => {
    downloadCsv("base-clientes-numero.csv", [
      [
        "Empresa",
        "CNPJ",
        "Situação",
        "Pode citar",
        "Unidade",
        "UF",
        "UF de onde",
        "Região",
        "Segmento",
        "Porte",
        "Faturamento",
        "Motivo da regra",
      ],
      ...linhas.map((a) => {
        const p = perfil(a);
        const m = FAIXA_META[faixaDaConta(a)];
        return [
          a.name,
          a.base?.cnpjs.join(" / ") || "",
          m.rotulo,
          m.cita,
          a.unit_label || "A confirmar",
          p.uf === SEM_UF ? "" : p.uf,
          p.fonteUf === "empresa" ? "Empresa" : p.fonteUf === "unidade" ? "Unidade" : "",
          p.regiao === SEM_UF ? "Sem UF" : p.regiao,
          p.segmento,
          PORTES.find((x) => x.chave === p.porte)?.rotulo ?? p.porte,
          faturamentoDeclarado(a),
          a.base?.situacao?.motivo ?? "",
        ];
      }),
    ]);
  };
  const voltar = `${titulo ?? "a lista"} · ${number(contas.length)}`;
  return (
    <Sheet open={!!numero} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-5xl">
        {numero && (
          <>
            <SheetHeader className="pr-8 text-left">
              <SheetTitle className="flex flex-wrap items-baseline gap-x-3">
                {numero.titulo}
                <span className="num text-2xl font-semibold text-primary-text">
                  {number(contas.length)}
                </span>
              </SheetTitle>
              <SheetDescription>{numero.descricao}</SheetDescription>
            </SheetHeader>
            {numero.ir && (
              <button
                type="button"
                onClick={numero.ir.onClick}
                className={`inline-flex items-center gap-1 self-start text-[13px] font-medium text-primary-text hover:underline ${FOCO_VISIVEL}`}
              >
                {numero.ir.rotulo}
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
            )}
            {contas.length > 0 && (
              <div className="rounded-xl border bg-card p-4">
                <BarraConfianca
                  contagem={contagem}
                  selecionada={faixa}
                  aoEscolher={(f) => {
                    setFaixa(f);
                    setPagina(1);
                  }}
                />
              </div>
            )}
            {contas.length === 0 ? (
              <EstadoVazio
                titulo="Nenhuma empresa neste número"
                descricao="Com os filtros de agora, nenhuma conta entra aqui."
              />
            ) : (
              <>
                <label className="relative">
                  <Search
                    className="absolute left-3 top-2.5 size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    aria-label="Buscar nesta lista"
                    className="pl-9"
                    value={busca}
                    placeholder="Buscar nesta lista"
                    onChange={(e) => {
                      setBusca(e.target.value);
                      setPagina(1);
                    }}
                  />
                </label>
                <TabelaContas
                  titulo={
                    faixa || busca.trim()
                      ? `${number(linhas.length)} de ${number(contas.length)} empresas`
                      : `${number(contas.length)} empresas`
                  }
                  subtitulo="Das de mais certeza para as de menos · toque na empresa para abrir a ficha"
                  contas={linhas}
                  colunas={["certeza", "unidade", "local", "segmento", "porte"]}
                  perfil={perfil}
                  pagina={pagina}
                  aoMudarPagina={setPagina}
                  aoAbrir={setFicha}
                  acoes={
                    <Button size="sm" variant="outline" onClick={exportar}>
                      <Download className="mr-2 size-4" aria-hidden />
                      Exportar
                    </Button>
                  }
                />
              </>
            )}
          </>
        )}
        {/* A ficha fica DENTRO da gaveta: como irmã, o clique nela contava como fora e fechava as duas. */}
        <AccountDetail account={ficha} cards={cards} close={() => setFicha(null)} voltar={voltar} />
      </SheetContent>
    </Sheet>
  );
}
