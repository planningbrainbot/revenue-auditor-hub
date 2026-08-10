import * as XLSX from 'xlsx';

export interface YearData {
  ano: number;
  desembolso: number;
  carga: number; // decimal, ex: 0.0759
}

export interface AliquotasData {
  cbs: number;
  ibsEstadual: number;
  ibsMunicipal: number;
  ipi: number;
  iss: number;
  pisCofins: number;
}

export interface ReformaTributariaData {
  empresa: string;
  estado: string;
  atividade: string;
  referencia: string;
  faturamento: number;
  aquisicoes: number;
  aliquotas: AliquotasData;
  years: YearData[];
  observacoes: string;
  resultadoAtual: number;
  resultadoPosReforma: number;
  textoPrincipal: string; // hero sub — editable, auto-computed on file load
  textoFechamento: string; // CTA sub — editable, auto-computed on file load
}

export const DEFAULT_DATA: ReformaTributariaData = {
  empresa: '',
  estado: 'São Paulo (SP)',
  atividade: '',
  referencia: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  faturamento: 0,
  aquisicoes: 0,
  aliquotas: { cbs: 0.0943, ibsEstadual: 0.17, ibsMunicipal: 0.02, ipi: 0.065, iss: 0, pisCofins: 0.0925 },
  years: [
    { ano: 2026, desembolso: 0, carga: 0 },
    { ano: 2027, desembolso: 0, carga: 0 },
    { ano: 2028, desembolso: 0, carga: 0 },
    { ano: 2029, desembolso: 0, carga: 0 },
    { ano: 2030, desembolso: 0, carga: 0 },
    { ano: 2031, desembolso: 0, carga: 0 },
    { ano: 2032, desembolso: 0, carga: 0 },
    { ano: 2033, desembolso: 0, carga: 0 },
  ],
  observacoes: '',
  resultadoAtual: 0,
  resultadoPosReforma: 0,
  textoPrincipal: '',
  textoFechamento: '',
};

// Mapa de colunas por ano (Sheet2)
// Row 31 = Total impostos a pagar (desembolso R$)
// Row 32 = Carga efetiva (decimal, ex: 0.1092 = 10.92%)
// 2033 uses a separate column block: AE30 (desembolso), AE31 (carga)
const YEAR_COLS: Record<number, string> = {
  2026: 'C',
  2027: 'G',
  2028: 'K',
  2029: 'O',
  2030: 'S',
  2031: 'W',
  2032: 'AA',
};

function numCell(sheet: XLSX.WorkSheet, ref: string): number {
  const cell = sheet[ref];
  if (!cell) return 0;
  // Prefer cached formula result (v), fall back to raw value
  const v = cell.v;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v.replace(',', '.'));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Scan column A for a row whose label contains `keyword` (accent/case-insensitive).
// Returns the row number, or null if not found. Used to locate cells by their label
// instead of hardcoded row numbers, which vary between template versions.
function findLabelRow(sheet: XLSX.WorkSheet, keyword: string, startRow = 4, endRow = 25): number | null {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const kw = norm(keyword);
  for (let r = startRow; r <= endRow; r++) {
    const cell = sheet[`A${r}`];
    if (!cell || typeof cell.v !== 'string') continue;
    if (norm(cell.v).includes(kw)) return r;
  }
  return null;
}

// Find sheet by partial/fuzzy name match (handles accents, case, spacing variants)
function findSheet(wb: XLSX.WorkBook, keywords: string[]): XLSX.WorkSheet | null {
  const names = wb.SheetNames;
  // Normalize: lowercase, remove accents
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

  for (const name of names) {
    const n = norm(name);
    if (keywords.every((kw) => n.includes(norm(kw)))) return wb.Sheets[name];
  }
  return null;
}

export async function parseReformaTributariaXlsx(
  file: File,
): Promise<Partial<ReformaTributariaData>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, {
          type: 'array',
          cellFormula: false, // don't parse formulas — just read cached values
          raw: true,          // read raw numeric values (avoids format string issues)
        });

        // Flexible sheet matching — handles accents, spacing, case differences
        const sheet2 =
          findSheet(wb, ['simulacao', 'reforma']) ??
          findSheet(wb, ['simulacao']) ??
          wb.Sheets[wb.SheetNames[1]]; // fallback: second sheet

        const sheet4 =
          findSheet(wb, ['resumo', 'apuracao']) ??
          findSheet(wb, ['resumo']) ??
          findSheet(wb, ['as is']) ??
          findSheet(wb, ['asis']) ??
          wb.Sheets[wb.SheetNames[3]] ?? // fallback: fourth sheet
          wb.Sheets[wb.SheetNames[wb.SheetNames.length - 1]]; // last sheet

        if (!sheet2) {
          reject(
            new Error(
              `Planilha inválida. Abas encontradas: ${wb.SheetNames.join(', ')}. Esperado: "Simulação da Reforma Tributária" e "Resumo da Apuração".`,
            ),
          );
          return;
        }

        // Dados base — detected by label in column A, not hardcoded row numbers.
        // Template versions differ: some have faturamento at B11, others at B12.
        const fatRow = findLabelRow(sheet2, 'faturamento') ?? 12;
        const faturamento = numCell(sheet2, `B${fatRow}`);

        // Aquisições: row labeled "Base dos Créditos" or "crédito", column C.
        const aqRow = findLabelRow(sheet2, 'credito') ?? 16;
        const aquisicoes = numCell(sheet2, `C${aqRow}`) || numCell(sheet2, 'C16');

        // Alíquotas — rates are stored as decimals (0.0925 = 9.25%), never > 1.
        // Guard: if a cell returns a monetary amount, clamp to 0 to prevent absurd display.
        const rate = (v: number): number => (Number.isFinite(v) && v > 0 && v <= 1) ? v : 0;

        // CBS/IBS/IPI: B5-B8 are consistent across templates.
        // ISS: only present in services templates (row labeled "ISS" in column A).
        //   Commerce templates (ICMS-based) have no ISS row — B9 holds PIS/COFINS cumulativo.
        // Search range extended to 20 to handle template variants where ISS sits below row 14.
        // Also accept labels like "ISS Municipal" or "Aliq ISS" via the 'iss' keyword match.
        const issRow = findLabelRow(sheet2, 'iss', 4, 20);
        const iss = issRow !== null ? rate(numCell(sheet2, `B${issRow}`)) : 0;

        // PIS/COFINS: pick the highest valid rate in the alíquotas block (rows 4-16).
        // Cumulativo (~3.65%) < Não-cumulativo (~9.25%) — want the higher applicable one.
        // Scan all B cells in the block and pick the max valid rate (0.001–1 range).
        const pisCandidates: number[] = [];
        for (let r = 4; r <= 16; r++) {
          const label = sheet2[`A${r}`]?.v as string | undefined;
          if (typeof label === 'string' && /pis|cofins/i.test(label)) {
            const v = numCell(sheet2, `B${r}`);
            if (v > 0.001 && v <= 1) pisCandidates.push(v);
          }
        }
        const pisCofinsRate = pisCandidates.length > 0 ? Math.max(...pisCandidates) : 0;

        const aliquotas: AliquotasData = {
          cbs: rate(numCell(sheet2, 'B5')),
          ibsEstadual: rate(numCell(sheet2, 'B6')),
          ibsMunicipal: rate(numCell(sheet2, 'B7')),
          ipi: rate(numCell(sheet2, 'B8')),
          iss,
          pisCofins: pisCofinsRate,
        };

        // Resultado operacional: Sheet4 E37 (atual) e H37 (pós reforma)
        const resultadoAtual = sheet4 ? numCell(sheet4, 'E37') : 0;
        const resultadoPosReforma = sheet4 ? numCell(sheet4, 'H37') : 0;

        // Anos 2026–2032 (Sheet2)
        // Auto-detect row offset: templates may store data at rows 30/31 or 31/32.
        // Desembolso (R$) is a monetary amount >> 100; rates are small decimals.
        // Probe column C (2026) to determine which row has the R$ value.
        const probeRow30 = numCell(sheet2, 'C30');
        const desRow = probeRow30 > 100 ? 30 : 31;
        const cargaRow = desRow + 1;

        const years: YearData[] = Object.entries(YEAR_COLS).map(([ano, col]) => ({
          ano: parseInt(ano),
          desembolso: numCell(sheet2, `${col}${desRow}`),
          carga: numCell(sheet2, `${col}${cargaRow}`),
        }));

        // 2033: column block AC-AE in Sheet2 (offset: Total at row 30, Carga at row 31)
        // Fallback: Sheet4 O11=desembolso, O12=carga
        const desembolso2033 = numCell(sheet2, 'AE30') || (sheet4 ? numCell(sheet4, 'O11') : 0);
        const carga2033 = numCell(sheet2, 'AE31') || (sheet4 ? numCell(sheet4, 'O12') : 0);
        years.push({ ano: 2033, desembolso: desembolso2033, carga: carga2033 });

        // Extract empresa name from filename — most reliable source.
        // Pattern: "Mapa da Reforma Tributaria_NOME DA EMPRESA 1.xlsx"
        // Sheet3 A3 is unreliable (template often reused without updating company name).
        let empresa = '';
        const base = file.name.replace(/\.xlsx?$/i, '');
        const idx = base.indexOf('_');
        if (idx >= 0) {
          empresa = base.slice(idx + 1).replace(/\s+\d+$/, '').trim();
        }

        const referencia = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        resolve({ empresa, faturamento, aquisicoes, aliquotas, years, resultadoAtual, resultadoPosReforma, referencia });
      } catch (err) {
        reject(
          new Error(
            'Erro ao ler o arquivo. Verifique se é o modelo correto do Mapa da Reforma Tributária.',
          ),
        );
      }
    };

    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
