import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { useFilaCella, useKpisDaily } from "@/hooks/use-fila-cella";
import { exportRowsToXlsx } from "@/lib/xlsx-export";
import { calcularCobertura, dataBR, formatCnpj, type FilaContaRow } from "@/lib/fila-cella.types";
import { FilaCoberturaBar } from "@/components/fila-cella/fila-cobertura-bar";
import { FilaKpisDaily } from "@/components/fila-cella/fila-kpis-daily";
import { FilaHigieneBar, type FiltroHigiene } from "@/components/fila-cella/fila-higiene-bar";
import {
  FILTROS_INICIAIS,
  FilaFiltros,
  TODOS,
  type FiltrosFila,
} from "@/components/fila-cella/fila-filtros";
import { FilaTabela } from "@/components/fila-cella/fila-tabela";
import { ContaDetalheSheet } from "@/components/fila-cella/conta-detalhe-sheet";
import { ProcedenciaFooter } from "@/components/fila-cella/procedencia-footer";

// Compõe os blocos B, C, D, F e a grade, e decide entre os quatro estados do
// §6.6. A regra que vale para todos: número nunca afirma o que não sabe — se a
// fonte não está de pé, é `—`, não `0`.

export function FilaTab() {
  const { can } = usePermissions();
  const fila = useFilaCella();
  const kpis = useKpisDaily();
  const [filtros, setFiltros] = useState<FiltrosFila>(FILTROS_INICIAIS);
  const [higiene, setHigiene] = useState<FiltroHigiene | null>(null);
  const [selecionada, setSelecionada] = useState<FilaContaRow | null>(null);

  const podeEscrever = can("manage.fila_cella");
  // `?? []` cria um array novo a cada render e invalidaria os quatro useMemo
  // abaixo em todo render (react-hooks/exhaustive-deps acusava).
  const rows = useMemo(() => fila.data?.rows ?? [], [fila.data?.rows]);
  const estado = fila.data?.estado ?? "ok";
  const cobertura = useMemo(() => calcularCobertura(rows), [rows]);
  const segmentos = useMemo(
    () => [...new Set(rows.map((r) => r.segmento).filter(Boolean))].sort() as string[],
    [rows],
  );

  const filtradas = useMemo(() => {
    const busca = filtros.busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtros.ocultarDescartados && r.elegivel === "Não") return false;
      if (busca) {
        const alvo = [r.titulo, r.razao_social, r.cnpj_principal, r.dono_conta, r.unidade]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      if (filtros.curva !== TODOS && r.curva_declarada !== filtros.curva) return false;
      if (filtros.segmento !== TODOS && r.segmento !== filtros.segmento) return false;
      if (filtros.ecd && r.ecd_estado !== filtros.ecd) return false;
      if (filtros.forca !== TODOS && r.forca !== filtros.forca) return false;
      if (filtros.frente !== TODOS && r.frente !== filtros.frente) return false;
      if (filtros.estagio !== TODOS && r.estagio !== filtros.estagio) return false;
      if (filtros.relacionamento !== TODOS && r.relacionamento !== filtros.relacionamento) {
        return false;
      }
      if (
        higiene === "sem_proximo_passo" &&
        !(r.ciclo_id != null && (r.toques ?? 0) > 0 && !r.proximo_passo)
      ) {
        return false;
      }
      if (higiene === "parados_15d" && !r.esfriando) return false;
      if (higiene === "passo_vencido" && !r.passo_vencido) return false;
      if (higiene === "perdido_sem_motivo" && !(r.estagio === "Perdido" && !r.motivo_perda)) {
        return false;
      }
      return true;
    });
  }, [rows, filtros, higiene]);

  const exportar = () => {
    exportRowsToXlsx(
      filtradas.map((r) => ({
        Ordem: rows.indexOf(r) + 1,
        Score: r.vetado ? "FORA" : (r.score ?? ""),
        "Score comparável": r.score_comparavel ? "Sim" : "Não",
        Empresa: r.titulo,
        "Razão social": r.razao_social ?? "",
        CNPJ: r.cnpj_principal ? formatCnpj(r.cnpj_principal) : "",
        "Curva declarada": r.curva_declarada ?? "",
        "Curva ECD": r.curva_ecd ?? "",
        "Receita operacional ECD": r.receita_operacional ?? "",
        Segmento: r.segmento ?? "",
        Prioritário: r.segmento_prioritario ? "Sim" : "Não",
        MRR: r.mrr ?? "",
        "Estado ECD": r.ecd_estado,
        Gatilho: r.gatilho_principal_nome ?? "",
        Força: r.forca ?? "",
        Frente: r.frente ?? "",
        Relacionamento: r.relacionamento,
        Estágio: r.estagio,
        Ciclo: r.ciclo_num ?? "",
        Toques: r.toques ?? "",
        "Último toque": dataBR(r.ultimo_toque),
        "Próximo passo": r.proximo_passo ?? "",
        "Próximo passo em": dataBR(r.proximo_passo_em),
        Regime: r.regime_tributario ?? "",
        Elegível: r.elegivel,
        UF: r.uf ?? "",
        Unidade: r.unidade ?? "",
        "Dono da conta": r.dono_conta ?? "",
        Avisos: (r.avisos ?? []).join(" · "),
      })),
      "fila-cella",
      "Fila",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {estado === "ok" ? (
            <>
              <strong>{rows.length}</strong> contas da base instalada · vendedor exclusivo: Matheus
              · daily 13h30
            </>
          ) : (
            "Contas da base instalada · vendedor exclusivo: Matheus · daily 13h30"
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={estado !== "ok" || filtradas.length === 0}
          onClick={exportar}
        >
          <Download className="mr-1 h-4 w-4" />
          Exportar XLSX
        </Button>
      </div>

      <FilaCoberturaBar
        cobertura={cobertura}
        estado={estado}
        filtroEcd={filtros.ecd}
        onFiltrarEcd={(e) => setFiltros({ ...filtros, ecd: e })}
      />
      <FilaKpisDaily kpis={kpis.data} />
      <FilaHigieneBar kpis={kpis.data} filtro={higiene} onFiltrar={setHigiene} />

      <FilaFiltros
        filtros={filtros}
        onChange={setFiltros}
        segmentos={segmentos}
        desabilitado={estado !== "ok"}
      />

      {fila.isLoading && (
        <Card className="p-6 text-sm text-muted-foreground">Carregando a fila…</Card>
      )}

      {fila.error && (
        <Card className="border-red-300 p-6 text-sm text-red-600 dark:border-red-900">
          Falha ao ler <code>v_fila_cella</code>:{" "}
          {fila.error instanceof Error ? fila.error.message : "erro desconhecido"}
        </Card>
      )}

      {!fila.isLoading && !fila.error && estado === "nao_migrado" && (
        <Card className="space-y-2 p-6 text-sm">
          <p className="font-medium">A Fila Cella ainda não existe neste banco.</p>
          <p className="text-muted-foreground">{fila.data?.aviso}</p>
          {can("manage.fila_cella_sync") && (
            <p className="text-muted-foreground">
              Quem aplica migration neste projeto é o Victor (Eliezek). Depois de aplicadas,
              regenere <code>src/integrations/supabase/types.ts</code>.
            </p>
          )}
        </Card>
      )}

      {!fila.isLoading && !fila.error && estado === "nunca_sincronizado" && (
        <Card className="space-y-2 p-6 text-sm">
          <p className="font-medium">A fila ainda não foi sincronizada. Última tentativa: nunca.</p>
          <p className="text-muted-foreground">
            O job de sync (Growth <code>deals</code> → <code>fila_cella_contas</code>) é entregável
            separado — fase F1.
          </p>
        </Card>
      )}

      {!fila.isLoading && !fila.error && estado === "ok" && (
        <>
          {filtradas.length === 0 ? (
            <Card className="space-y-2 p-6 text-sm">
              <p>
                Nenhuma conta com esses filtros. <strong>{rows.length}</strong> no total.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFiltros(FILTROS_INICIAIS);
                  setHigiene(null);
                }}
              >
                Limpar filtros
              </Button>
            </Card>
          ) : (
            <Card className="p-0">
              <div className="border-b px-3 py-2 text-sm text-muted-foreground">
                {filtradas.length} de {rows.length} contas
                {filtros.ocultarDescartados && " · descartados ocultos"}
              </div>
              <FilaTabela rows={filtradas} onAbrir={setSelecionada} />
            </Card>
          )}
        </>
      )}

      <ProcedenciaFooter
        estado={estado}
        sincronizadoEm={fila.data?.sincronizadoEm ?? null}
        aviso={fila.data?.aviso ?? null}
      />

      <ContaDetalheSheet
        conta={selecionada}
        onOpenChange={(o) => !o && setSelecionada(null)}
        podeEscrever={podeEscrever}
      />
    </div>
  );
}
