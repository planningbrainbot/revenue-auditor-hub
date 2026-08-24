import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNpsCoverage } from "@/hooks/use-nps";

// Extraído de nps-painel-tab.tsx (era a aba "Cobertura da base" do Painel) —
// mudou de casa pra Base de Contatos porque é sobre completude de contato
// de WhatsApp, não sobre resultado de pesquisa.
export function NpsCoberturaTab() {
  const { data: coverage, isLoading, error } = useNpsCoverage();

  return (
    <div className="space-y-4">
      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando cobertura…</Card>}
      {error && <Card className="p-6 text-sm text-red-600">Erro ao carregar cobertura.</Card>}
      {coverage && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Clientes ativos</div>
              <div className="mt-1 text-2xl font-semibold">{coverage.totalEmpresas}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Já disparadas (empresas distintas)</div>
              <div className="mt-1 text-2xl font-semibold">{coverage.totalJaDisparadas}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Com WhatsApp válido pra disparo</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-600">
                {coverage.totalComWhatsapp}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  ({coverage.totalEmpresas > 0 ? Math.round((coverage.totalComWhatsapp / coverage.totalEmpresas) * 100) : 0}%)
                </span>
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Sem contato — não disparará</div>
              <div className="mt-1 text-2xl font-semibold text-red-600">{coverage.totalEmpresas - coverage.totalComWhatsapp}</div>
            </Card>
          </div>

          <Card className="p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Atenção:</strong> a coluna "Já disparadas" conta só pesquisas com empresa
            vinculada — hoje {coverage.pesquisasComEmpresaResolvida} de {coverage.pesquisasTotal} pesquisas
            enviadas têm esse vínculo resolvido ({coverage.pesquisasTotal > 0 ? Math.round((coverage.pesquisasComEmpresaResolvida / coverage.pesquisasTotal) * 100) : 0}%).
            O número real de empresas já pesquisadas é maior do que o mostrado aqui.
            <br />
            O denominador ("clientes ativos") usa a mesma régua de <code>/clientes</code>: franquia, unidade
            regional ativa e sem card de churn em Tratativas — por isso pode ser menor que a contagem bruta de
            empresas cadastradas por unidade.
          </Card>

          <Card>
            <div className="border-b p-3 text-sm font-medium">Cobertura por unidade — quem está pronto pro disparo</div>
            <div className="table-wrap overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead className="text-right">Empresas</TableHead>
                    <TableHead className="text-right">Já disparadas</TableHead>
                    <TableHead className="text-right">— Base Antiga</TableHead>
                    <TableHead className="text-right">— Base Nova</TableHead>
                    <TableHead className="text-right">Com WhatsApp</TableHead>
                    <TableHead className="text-right">Sem contato</TableHead>
                    <TableHead className="text-right">Cobertura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coverage.rows.map((u) => {
                    const pct = u.empresas > 0 ? Math.round((u.comWhatsapp / u.empresas) * 100) : 0;
                    const color = pct >= 70 ? "text-emerald-600" : pct >= 30 ? "text-amber-600" : "text-red-600";
                    return (
                      <TableRow key={u.unidade}>
                        <TableCell className="font-medium">{u.unidade}</TableCell>
                        <TableCell className="text-right">{u.empresas}</TableCell>
                        <TableCell className="text-right">{u.jaDisparadas}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{u.jaDisparadasBaseAntiga}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{u.jaDisparadasBaseNova}</TableCell>
                        <TableCell className="text-right">{u.comWhatsapp}</TableCell>
                        <TableCell className="text-right text-red-600">{u.empresas - u.comWhatsapp}</TableCell>
                        <TableCell className={`text-right font-semibold ${color}`}>{pct}%</TableCell>
                      </TableRow>
                    );
                  })}
                  {coverage.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                        Sem dados de cobertura.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
