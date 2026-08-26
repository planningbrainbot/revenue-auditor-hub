import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Aba 4 — estática de propósito. É a mesma aba Dicionário do xlsx que o Matheus
// já usa, versionada em vez de recriada a cada rebuild da planilha.

const GATILHOS: { g: string; nome: string; frente: string; forca: string; obs?: string }[] = [
  { g: "T1", nome: "Folha e encargos", frente: "Tese", forca: "—" },
  {
    g: "T2",
    nome: "ICMS-ST",
    frente: "Tese",
    forca: "—",
    obs: "icp404.py declara a tese encerrada e perdida (Tema 1231/STJ) — ver D6",
  },
  { g: "T5", nome: "Reserva de incentivo fiscal", frente: "Tese", forca: "—" },
  { g: "T6", nome: "Importação", frente: "Tese", forca: "—" },
  { g: "T7", nome: "Energia elétrica", frente: "Tese", forca: "—" },
  {
    g: "T8",
    nome: "Parcelamento tributário",
    frente: "Transação",
    forca: "Forte",
    obs: "presença sozinha classifica a conta como Forte",
  },
  { g: "T9", nome: "Tributos a recolher", frente: "Transação", forca: "—" },
  {
    g: "T10",
    nome: "Contingência tributária",
    frente: "Contencioso",
    forca: "Forte",
    obs: "nega DIFERID: IR diferido é diferimento contábil, não litígio",
  },
  {
    g: "T10b",
    nome: "Contingência trabalhista/cível",
    frente: "—",
    forca: "—",
    obs: "só na extração por empresa; não roda no lote das 404",
  },
  { g: "T11", nome: "Prejuízo acumulado", frente: "Transação", forca: "—" },
  { g: "T11b", nome: "Endividamento financeiro", frente: "—", forca: "—", obs: "sem frente no playbook" },
  {
    g: "T12",
    nome: "Crédito tributário no ativo",
    frente: "—",
    forca: "—",
    obs: "alerta, não é frente — vira chip de bloqueio",
  },
];

export function DicionarioTab() {
  return (
    <div className="space-y-4">
      <Card className="p-0">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Os 12 gatilhos</h3>
          <p className="text-xs text-muted-foreground">
            A numeração é descontínua: não existe T3 nem T4. São 12 rótulos, e 11 rodam em lote.
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gatilho</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Frente</TableHead>
                <TableHead>Dispara Forte</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {GATILHOS.map((g) => (
                <TableRow key={g.g}>
                  <TableCell className="font-mono">{g.g}</TableCell>
                  <TableCell>{g.nome}</TableCell>
                  <TableCell>{g.frente}</TableCell>
                  <TableCell>{g.forca}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{g.obs ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="space-y-2 p-4 text-sm">
        <h3 className="text-sm font-semibold">Como o score é calculado</h3>
        <p className="font-mono text-xs">
          curva (A=3 · B=2 · resto=1) + segmento prioritário (2) + força (Forte 3 · Moderado 2 ·
          Fraco 1 · sem força 0) + urgência (3) — teto 11
        </p>
        <p className="text-muted-foreground">
          Relacionamento = &quot;Alerta aberto&quot; devolve <strong>FORA</strong>: veto absoluto,
          não penalidade. E o score <strong>não é comparável</strong> entre linhas com e sem ECD —
          sem gatilho não há força, logo o teto cai para 5. A coluna{" "}
          <code>score_comparavel</code> existe para não deixar essa ressalva só no tooltip.
        </p>
        <p className="text-muted-foreground">
          Duas armadilhas herdadas de propósito do xlsx: <code>LEFT($C2,1)</code> faz &quot;A ·
          regime?&quot; valer 3 igual a &quot;A&quot; homologada (por isso a coluna de bloqueios
          existe), e a faixa declarada é auto-declarada em formulário, não faturamento homologado.
        </p>
      </Card>

      <Card className="space-y-2 p-4 text-sm">
        <h3 className="text-sm font-semibold">Força — D1 em aberto</h3>
        <p className="text-muted-foreground">
          Há três regras concorrentes de Força nas ferramentas do Matheus. A tela usa hoje a regra
          (a) de <code>casa_ecd.py:88-94</code>, como provisória:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>gatilho T8 ou T10 presente ⇒ Forte;</li>
          <li>folha / receita operacional &gt; 10% ⇒ Forte (mas 202 dos 404 não têm receita apurada, e nunca chegam a Forte por essa via);</li>
          <li>3 gatilhos ou mais ⇒ Moderado; abaixo disso, Fraco.</li>
        </ol>
        <p className="text-muted-foreground">
          Qual das três vale é decisão pendente (D1). Enquanto não fechar, a coluna mostra a regra
          (a) e o chip com † marca override manual.
        </p>
      </Card>

      <Card className="space-y-2 p-4 text-sm">
        <h3 className="text-sm font-semibold">Baseline congelado</h3>
        <p className="text-muted-foreground">
          <strong>0 de 138</strong> — janela 29/07 a 13/08/2026, leitura manual. É o ponto de
          partida do KR2 antes desta tela existir. Não é apuração automática e não deve ser
          comparado como se fosse: fica registrado para que a primeira medição com a tela tenha
          contra o que ser lida.
        </p>
      </Card>

      <Card className="space-y-2 p-4 text-sm">
        <h3 className="text-sm font-semibold">Procedência</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Fila: Growth <code>deals</code> (won, DISTINCT <code>org_id</code>), reconciliada contra
            o Ops por <code>pipedrive_id</code> / <code>pipedrive_deal_id</code>.
          </li>
          <li>
            Sinal: ECD do exercício <strong>2024</strong> — único exercício da base. Sem controle de
            retificadora: uma escrituração substituta não é distinguível da original.
          </li>
          <li>
            Regime e opção pelo Simples: base Receita 967. <code>Outros</code> e vazio significam{" "}
            <em>sem informação</em>, nunca &quot;não optante&quot;.
          </li>
          <li>
            Esta tela cobre o <strong>Funil B</strong> (canal dedicado, base instalada). A cadeia
            contratos → Tiago → análise não está aqui.
          </li>
        </ul>
      </Card>
    </div>
  );
}
