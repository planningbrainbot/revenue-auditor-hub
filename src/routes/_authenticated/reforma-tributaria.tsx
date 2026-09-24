import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Upload,
  FileSpreadsheet,
  Download,
  Printer,
  Maximize2,
  RefreshCw,
  X,
  Pencil,
} from 'lucide-react';
import { DEFAULT_DATA, parseReformaTributariaXlsx, type ReformaTributariaData } from '@/components/reforma-tributaria/xlsx-parser';
import { FUNDO_APRESENTACAO, generatePresentationHTML } from '@/components/reforma-tributaria/html-generator';
import { EstadoErro, PageHeader, StatusBadge } from "@/components/planning";

export const Route = createFileRoute('/_authenticated/reforma-tributaria')({
  component: ReformaTributariaPage,
});

const ESTADOS = [
  'Acre (AC)', 'Alagoas (AL)', 'Amapá (AP)', 'Amazonas (AM)', 'Bahia (BA)',
  'Ceará (CE)', 'Distrito Federal (DF)', 'Espírito Santo (ES)', 'Goiás (GO)',
  'Maranhão (MA)', 'Mato Grosso (MT)', 'Mato Grosso do Sul (MS)',
  'Minas Gerais (MG)', 'Pará (PA)', 'Paraíba (PB)', 'Paraná (PR)',
  'Pernambuco (PE)', 'Piauí (PI)', 'Rio de Janeiro (RJ)',
  'Rio Grande do Norte (RN)', 'Rio Grande do Sul (RS)', 'Rondônia (RO)',
  'Roraima (RR)', 'Santa Catarina (SC)', 'São Paulo (SP)',
  'Sergipe (SE)', 'Tocantins (TO)',
];

function pct(v: number) {
  return (v * 100).toFixed(2);
}

function fmtPct(n: number) {
  return (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function maskCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Campo numérico que mostra o que foi digitado. Antes o valor era `n || ''`:
 * 0 digitado sumia e o campo vazio parecia 0. O texto fica local; o número
 * que sobe continua `parseFloat(...) || 0`, então o cálculo trata vazio como 0
 * como sempre. Quando o dado vem de fora (arquivo carregado ou descartado), a
 * página troca a `key` e o campo recomeça do valor novo.
 */
function CampoNumero({
  valor,
  onValor,
  zeroComoVazio,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  valor: number;
  onValor: (n: number) => void;
  /** Sem arquivo, o 0 do padrão é "não preenchido": começa vazio. */
  zeroComoVazio: boolean;
}) {
  const [texto, setTexto] = useState(() => (zeroComoVazio && valor === 0 ? '' : String(valor)));
  return (
    <Input
      {...props}
      type="number"
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        onValor(parseFloat(e.target.value) || 0);
      }}
    />
  );
}

function computeDefaultTextos(d: ReformaTributariaData): Pick<ReformaTributariaData, 'textoPrincipal' | 'textoFechamento'> {
  const first = d.years[0];
  const last = d.years[d.years.length - 1];
  const isServico = d.aliquotas.iss > 0;
  const tributosAtuais = isServico ? 'ISS e PIS/COFINS' : 'ICMS, PIS e COFINS';
  return {
    textoPrincipal: `A Reforma Tributária (LC 214) eleva sua carga de ${fmtPct(first.carga)} para ${fmtPct(last.carga)} até ${last.ano}. A carga hoje incide sobre ${tributosAtuais}. Este mapa mostra como esse aumento acontece — ano a ano, imposto a imposto — para que você planeje antes que a conta chegue.`,
    textoFechamento: `A Reforma é gradual e previsível: a carga da ${d.empresa || 'empresa'} sobe de ${fmtPct(first.carga)} para ${fmtPct(last.carga)} até ${last.ano}, com o salto maior no último ano. Conhecer essa curva agora permite planejar preço, margem, créditos e fluxo de caixa antes que o aumento chegue. A Planning acompanha cada etapa da transição com você.`,
  };
}

function ReformaTributariaPage() {
  const [data, setData] = useState<ReformaTributariaData>({ ...DEFAULT_DATA });
  const [fileName, setFileName] = useState('');
  const [parsing, setIsParsing] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Motivo da última falha de leitura do arquivo: fica na tela além do toast.
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [carregadoEm, setCarregadoEm] = useState<Date | null>(null);
  // Troca quando o dado vem de fora (arquivo carregado ou descartado): os
  // campos numéricos recomeçam do valor novo.
  const [versaoCampos, setVersaoCampos] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Depois de "Descartar", o botão que abriu o diálogo some junto com o
  // arquivo: o foco vai para o campo de arquivo que volta no lugar dele.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descartouRef = useRef(false);

  const updatePreview = useCallback((d: ReformaTributariaData) => {
    setPreviewUpdating(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const html = generatePresentationHTML(d);
      setHtmlContent(html);
      setPreviewUpdating(false);
    }, 400);
  }, []);

  useEffect(() => {
    if (!editMode) updatePreview(data);
  }, [data, updatePreview, editMode]);

  // Handle messages from the presentation iframe (edit mode download + exit)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === 'reforma-download') {
        const html = e.data.html as string;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const slug = data.empresa
          ? data.empresa.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
          : 'cliente';
        a.download = `mapa-reforma-tributaria-${slug}.html`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success('Apresentação baixada com edições.');
        setEditMode(false);
      }
      if (e.data.type === 'reforma-exit-edit-confirm') {
        setEditMode(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [data.empresa]);

  const processFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      const motivo = `"${file.name}" não é uma planilha. Use o arquivo .xlsx do Mapa da Reforma.`;
      setErroArquivo(motivo);
      toast.error('Formato inválido. Use o arquivo .xlsx do Mapa da Reforma.');
      return;
    }
    setErroArquivo(null);
    setIsParsing(true);
    setFileName(file.name);
    try {
      const parsed = await parseReformaTributariaXlsx(file);
      // Exit edit mode and reset state on new file — prevents stale editMode blocking preview
      setEditMode(false);
      iframeRef.current?.contentWindow?.postMessage({ type: 'reforma-exit-edit' }, '*');
      const baseData = { ...DEFAULT_DATA, ...parsed };
      setData({ ...baseData, ...computeDefaultTextos(baseData) });
      setCarregadoEm(new Date());
      setVersaoCampos((v) => v + 1);
      toast.success('Arquivo carregado. Confirme a Razão Social e preencha a Atividade.');
    } catch (err) {
      const motivo = err instanceof Error ? err.message : 'Erro ao processar o arquivo.';
      // O nome já tinha sido gravado: sem isso a tela dizia "Dados importados".
      setFileName('');
      setErroArquivo(`${file.name}: ${motivo}`);
      toast.error(motivo);
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const setField = <K extends keyof ReformaTributariaData>(k: K, v: ReformaTributariaData[K]) =>
    setData((prev) => ({ ...prev, [k]: v }));

  const setYearField = (idx: number, field: 'desembolso' | 'carga', value: number) =>
    setData((prev) => {
      const years = prev.years.map((y, i) => (i === idx ? { ...y, [field]: value } : y));
      return { ...prev, years };
    });

  const handleDownload = () => {
    const html = generatePresentationHTML(data);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = data.empresa ? data.empresa.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : 'cliente';
    a.download = `mapa-reforma-tributaria-${slug}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Apresentação baixada.');
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Popup bloqueado. Permita popups nesta página e tente novamente.');
      return;
    }
    const html = generatePresentationHTML(data);
    // Inject auto-print inside the window so it runs in its own context (Chrome blocks w.print() from parent)
    const autoprint = '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},1800);});<\/script>';
    w.document.write(html.replace('</body>', autoprint + '\n</body>'));
    w.document.close();
  };

  const handleFullscreen = () => {
    iframeRef.current?.requestFullscreen?.();
  };

  const handleToggleEdit = () => {
    if (editMode) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'reforma-exit-edit' }, '*');
      setEditMode(false);
    } else {
      iframeRef.current?.contentWindow?.postMessage({ type: 'reforma-enable-edit' }, '*');
      setEditMode(true);
      toast.info('Clique nos textos destacados para editar. Use "Baixar com edições" na barra inferior da apresentação.');
    }
  };

  const clearFile = () => {
    setFileName('');
    setEditMode(false);
    setCnpj('');
    iframeRef.current?.contentWindow?.postMessage({ type: 'reforma-exit-edit' }, '*');
    setData({ ...DEFAULT_DATA });
    setErroArquivo(null);
    setCarregadoEm(null);
    setVersaoCampos((v) => v + 1);
  };

  const lookupCnpj = async (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 14) return;
    setLookingUpCnpj(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) throw new Error('não encontrado');
      const info = await res.json() as {
        razao_social?: string;
        cnae_fiscal_descricao?: string;
        uf?: string;
        municipio?: string;
      };
      const atividade = info.cnae_fiscal_descricao ?? '';
      const uf = info.uf ?? '';
      const estadoMatch = ESTADOS.find((e) => e.endsWith(`(${uf})`)) ?? '';
      setData((prev) => ({
        ...prev,
        ...(atividade ? { atividade } : {}),
        ...(estadoMatch ? { estado: estadoMatch } : {}),
        ...(info.razao_social && !prev.empresa ? { empresa: info.razao_social } : {}),
      }));
      toast.success(`CNPJ consultado · ${atividade || uf}`);
    } catch {
      toast.error('CNPJ não encontrado. Verifique o número.');
    } finally {
      setLookingUpCnpj(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Cabeçalho em largura cheia, acima das duas colunas (antes ficava na de 420px). */}
      <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          titulo="Reforma Tributária"
          pergunta="Quanto a reforma muda a carga deste cliente, e como mostro isso a ele?"
          descricao="Simulação de um cliente · 2026–2033 · dados do arquivo ou digitados; nada é gravado no banco"
          procedencia={{
            fonte: fileName ? `Arquivo ${fileName}` : 'Dados digitados no formulário',
            atualizadoEm: fileName ? carregadoEm : null,
          }}
          acoes={<StatusBadge tom="atencao">Confidencial</StatusBadge>}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── LEFT COLUMN — FORM ── */}
      <div className="w-[420px] shrink-0 flex flex-col border-r border-border">
        <div className="p-4 space-y-5 flex-1 overflow-y-auto">
          {/* ── UPLOAD ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              1 · Arquivo Excel
            </Label>
            {erroArquivo && (
              <EstadoErro
                titulo="Não foi possível ler o arquivo"
                detalhe={erroArquivo}
                className="mb-3 p-4"
              />
            )}
            {!fileName ? (
              <label
                className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ${isDragging ? 'border-success bg-success/5' : 'border-border hover:border-success/50 hover:bg-accent/30'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                {/* sr-only em vez de hidden: o campo continua alcançável pelo teclado. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="sr-only"
                  onChange={handleFileInput}
                  aria-label="Carregar o arquivo Excel do Mapa da Reforma Tributária"
                />
                {parsing ? (
                  <RefreshCw className="h-6 w-6 text-success animate-spin" />
                ) : (
                  <Upload className="h-6 w-6 text-muted-foreground" />
                )}
                <div className="text-center">
                  <p className="text-sm font-medium">{parsing ? 'Processando...' : 'Arraste ou clique para carregar'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Mapa da Reforma Tributária (.xlsx)</p>
                </div>
              </label>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-success/5 border border-success/20">
                <FileSpreadsheet className="h-5 w-5 text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{fileName}</p>
                  <p className="text-xs text-success">Dados importados</p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      aria-label="Limpar arquivo e descartar a simulação carregada"
                      title="Limpar arquivo"
                    >
                      <X aria-hidden />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent
                    onCloseAutoFocus={(e) => {
                      if (!descartouRef.current) return;
                      descartouRef.current = false;
                      e.preventDefault();
                      requestAnimationFrame(() => fileInputRef.current?.focus());
                    }}
                  >
                    <AlertDialogHeader>
                      <AlertDialogTitle>Descartar a simulação carregada?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Os números do arquivo, o CNPJ, os textos e as observações voltam ao padrão. Nada
                        foi gravado no banco: para recuperar, carregue o arquivo de novo.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Manter</AlertDialogCancel>
                      <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={() => {
                          descartouRef.current = true;
                          clearFile();
                        }}
                      >
                        Descartar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </section>

          {/* ── EMPRESA ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              2 · Dados da empresa
            </Label>
            <div className="space-y-3">
              <div>
                <Label className="text-xs mb-1 block">CNPJ</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="00.000.000/0000-00"
                    value={cnpj}
                    onChange={(e) => {
                      const masked = maskCnpj(e.target.value);
                      setCnpj(masked);
                      if (masked.replace(/\D/g, '').length === 14) lookupCnpj(masked);
                    }}
                    className="text-sm h-8 font-mono flex-1"
                    maxLength={18}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 shrink-0 text-xs"
                    onClick={() => lookupCnpj(cnpj)}
                    disabled={lookingUpCnpj || cnpj.replace(/\D/g, '').length !== 14}
                  >
                    {lookingUpCnpj ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Buscar'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Preenche atividade e estado via Receita Federal</p>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Razão Social</Label>
                <Input
                  placeholder="Ex: Primo Rolamentos Ltda"
                  value={data.empresa}
                  onChange={(e) => setField('empresa', e.target.value)}
                  className="text-sm h-8"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Estado</Label>
                <Select value={data.estado} onValueChange={(v) => setField('estado', v)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (
                      <SelectItem key={e} value={e} className="text-sm">{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Atividade / CNAE</Label>
                <Input
                  placeholder="Ex: Comércio atacadista industrial"
                  value={data.atividade}
                  onChange={(e) => setField('atividade', e.target.value)}
                  className="text-sm h-8"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Referência</Label>
                <Input
                  placeholder="Ex: Junho de 2026"
                  value={data.referencia}
                  onChange={(e) => setField('referencia', e.target.value)}
                  className="text-sm h-8"
                />
              </div>
            </div>
          </section>

          {/* ── BASE ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              3 · Base da simulação
            </Label>
            <div className="space-y-3">
              <div>
                <Label className="text-xs mb-1 block">Faturamento anual (R$)</Label>
                <CampoNumero
                  key={`faturamento-${versaoCampos}`}
                  placeholder="0"
                  valor={data.faturamento}
                  zeroComoVazio={!fileName}
                  onValor={(n) => setField('faturamento', n)}
                  aria-label="Faturamento anual (R$)"
                  className="text-sm h-8 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Aquisições anuais (R$)</Label>
                <CampoNumero
                  key={`aquisicoes-${versaoCampos}`}
                  placeholder="0"
                  valor={data.aquisicoes}
                  zeroComoVazio={!fileName}
                  onValor={(n) => setField('aquisicoes', n)}
                  aria-label="Aquisições anuais (R$)"
                  className="text-sm h-8 font-mono"
                />
              </div>
            </div>
          </section>

          {/* ── ANOS ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              4 · Progressão ano a ano
            </Label>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-2 text-muted-foreground font-medium">Ano</th>
                      <th className="text-right p-2 text-muted-foreground font-medium">Carga (%)</th>
                      <th className="text-right p-2 text-muted-foreground font-medium">Desembolso (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.years.map((y, i) => (
                      <tr
                        key={y.ano}
                        className={`border-b border-border last:border-0 ${i === data.years.length - 1 ? 'bg-success/5' : ''}`}
                      >
                        <td className="p-2 font-medium">{y.ano}</td>
                        <td className="p-1">
                          <CampoNumero
                            key={`carga-${y.ano}-${versaoCampos}`}
                            step="0.0001"
                            min="0"
                            max="1"
                            valor={y.carga}
                            zeroComoVazio={!fileName}
                            onValor={(n) => setYearField(i, 'carga', n)}
                            aria-label={`Carga de ${y.ano} (decimal)`}
                            className="h-7 border-transparent bg-transparent px-1 py-0.5 text-right font-mono text-xs md:text-xs"
                            title={`${pct(y.carga)}%`}
                          />
                        </td>
                        <td className="p-1">
                          <CampoNumero
                            key={`desembolso-${y.ano}-${versaoCampos}`}
                            step="1"
                            min="0"
                            valor={y.desembolso}
                            zeroComoVazio={!fileName}
                            onValor={(n) => setYearField(i, 'desembolso', n)}
                            aria-label={`Desembolso de ${y.ano} (R$)`}
                            className="h-7 border-transparent bg-transparent px-1 py-0.5 text-right font-mono text-xs md:text-xs"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <p className="text-xs text-muted-foreground mt-1">Carga em decimal (ex: 0.0759 = 7,59%)</p>
          </section>

          {/* ── ALÍQUOTAS ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              5 · Alíquotas
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['CBS', 'cbs'],
                  ['IBS Estadual', 'ibsEstadual'],
                  ['IBS Municipal', 'ibsMunicipal'],
                  ['IPI', 'ipi'],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <Label className="text-xs mb-1 block">{label}</Label>
                  <CampoNumero
                    key={`${key}-${versaoCampos}`}
                    step="0.0001"
                    min="0"
                    max="1"
                    valor={data.aliquotas[key]}
                    zeroComoVazio={!fileName}
                    onValor={(n) =>
                      setData((prev) => ({
                        ...prev,
                        aliquotas: { ...prev.aliquotas, [key]: n },
                      }))
                    }
                    aria-label={`Alíquota ${label} (decimal)`}
                    className="text-sm h-8 font-mono"
                    title={`${pct(data.aliquotas[key])}%`}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ── OBSERVAÇÕES ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              6 · Observações da auditora
            </Label>
            <Textarea
              placeholder="Adicione notas técnicas, contextos relevantes ou recomendações para o cliente..."
              value={data.observacoes}
              onChange={(e) => {
                const obs = e.target.value;
                // Update state AND preview directly — observações must always sync, even in edit mode
                setData((prev) => ({ ...prev, observacoes: obs }));
                updatePreview({ ...data, observacoes: obs });
              }}
              className="text-sm resize-none"
              rows={4}
            />
            <p className="text-xs text-muted-foreground mt-1">Aparece como "Nota da Auditora" na apresentação</p>
          </section>

          {/* ── TEXTOS ── */}
          <section>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              7 · Textos da apresentação
            </Label>
            <div className="space-y-3">
              <div>
                <Label className="text-xs mb-1 block">Parágrafo de abertura</Label>
                <Textarea
                  placeholder="Carregue o arquivo para gerar o texto automaticamente..."
                  value={data.textoPrincipal}
                  onChange={(e) => setField('textoPrincipal', e.target.value)}
                  className="text-sm resize-none"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground mt-1">Aparece abaixo do título principal</p>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Parágrafo de fechamento</Label>
                <Textarea
                  placeholder="Carregue o arquivo para gerar o texto automaticamente..."
                  value={data.textoFechamento}
                  onChange={(e) => setField('textoFechamento', e.target.value)}
                  className="text-sm resize-none"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground mt-1">Aparece no bloco final antes do rodapé</p>
              </div>
            </div>
          </section>
        </div>

        {/* ── ACTION BUTTONS ── */}
        <div className="p-4 border-t border-border shrink-0 space-y-2">
          <Button
            className="w-full text-sm h-9"
            onClick={() => {
              if (editMode) {
                iframeRef.current?.contentWindow?.postMessage({ type: 'reforma-exit-edit' }, '*');
                setEditMode(false);
                toast.warning('Modo edição encerrado. Preview atualizado com dados do formulário.');
              }
              updatePreview(data);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            {editMode ? 'Sair da edição e atualizar' : 'Atualizar preview'}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="text-sm h-9" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5 mr-2" />
              Baixar HTML
            </Button>
            <Button variant="outline" className="text-sm h-9" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-2" />
              Imprimir / PDF
            </Button>
          </div>
        </div>
      </div>

      {/* ── RIGHT COLUMN — PREVIEW ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${previewUpdating ? 'bg-warning animate-pulse' : 'bg-success'}`} />
            <span className="text-xs text-muted-foreground">
              {previewUpdating ? 'Atualizando preview...' : 'Preview da apresentação'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {data.empresa && (
              <Badge variant="outline" className="text-xs">{data.empresa}</Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 text-xs gap-1.5 ${editMode ? 'text-success bg-success/10 hover:bg-success/15' : 'text-muted-foreground'}`}
              onClick={handleToggleEdit}
              title={editMode ? 'Sair do modo edição' : 'Editar textos da apresentação'}
            >
              <Pencil className="h-3 w-3" />
              {editMode ? 'Sair da edição' : 'Editar'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleFullscreen}
              aria-label="Ver a prévia em tela cheia"
              title="Tela cheia"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            className="w-full h-full border-0"
            style={{ background: FUNDO_APRESENTACAO }}
            title="Preview da apresentação"
            sandbox="allow-scripts"
          />
        </div>
      </div>
      </div>
    </div>
  );
}
