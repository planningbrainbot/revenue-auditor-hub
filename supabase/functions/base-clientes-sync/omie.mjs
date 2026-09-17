import { normalizeCnpj } from './domain.mjs';
import { strictDate } from '../_shared/strict-date.mjs';

export const CURITIBA_APPS = ['Curitiba', 'Planning CWB 01', 'Planning CWB 02'];

export function contractEvidence(app, contracts, customers, at) {
  if (!CURITIBA_APPS.includes(app)) throw new Error('Aplicativo Omie fora do escopo Curitiba');
  const clients = new Map(customers.map(c => [String(c.codigo_cliente_omie), c]));
  const taxes = new Map();
  const records = contracts.map(row => {
    const h = row.cabecalho;
    if (!h?.nCodCtr || !h.nCodCli || !clients.has(String(h.nCodCli)))
      throw new Error('Contrato sem cliente confirmado no mesmo aplicativo Omie');
    const client = clients.get(String(h.nCodCli));
    const cnpj = normalizeCnpj(client.cnpj_cpf);
    const flag = client.optante_simples_nacional;
    if (cnpj && ['S', 'N'].includes(flag)) taxes.set(String(h.nCodCli), {
      cnpj, fonte: 'Omie', registro_fonte: `${app}:${h.nCodCli}`,
      fora_simples: flag === 'N', regime: flag === 'S' ? 'Simples Nacional' : null,
      consultado_em: at,
    });
    return {
      aplicativo: app, contrato_id: String(h.nCodCtr), cliente_id: String(h.nCodCli),
      unidade: 'Curitiba', cnpj, vigencia_inicial: strictDate(h.dVigInicial),
      situacao: h.cCodSit ?? null, fonte_campo: 'cabecalho.dVigInicial', consultado_em: at,
    };
  });
  return { contracts: records, taxes: [...taxes.values()] };
}
