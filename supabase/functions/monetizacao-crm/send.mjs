import { PRODUCT } from './crm.mjs';
export const PRODUCT_OPTIONS = { cella: 1128, consultoria: 1129, finance: 1130 };
const LABELS = { cella: 'Cella', consultoria: 'Consultoria', finance: 'Finance' };
export function dealPayload({ account, product, org, owner, stage, nonce }) {
  if (!Object.hasOwn(PRODUCT_OPTIONS, product)) throw new Error('Produto canônico inválido');
  if (![org, owner, stage].every(v => Number.isInteger(v) && v > 0)) throw new Error('Destino do envio incompleto');
  return { title: `${account.name.trim()} · ${LABELS[product]} [AQ:${nonce}]`, org_id: org, user_id: owner, pipeline_id: 39, stage_id: stage, [PRODUCT]: PRODUCT_OPTIONS[product] };
}
export function hasCanonicalProduct(deal, product) {
  return Object.hasOwn(PRODUCT_OPTIONS, product) && deal?.pipeline_id === 39 && String(deal[PRODUCT]) === String(PRODUCT_OPTIONS[product]);
}
