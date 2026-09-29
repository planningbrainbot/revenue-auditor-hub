import { PRODUCT } from "./crm.mjs";
export const PRODUCT_OPTIONS = { cella: 1128, consultoria: 1129, finance: 1130 };
// Pipe de destino de cada produto (29/09): Consultoria, Cella e Finance vão para Monetização · Caixa (39),
// com o campo Caixa · Produto; Recon vai para o pipe do Recon (38, ainda "Conciliador" no Pipedrive), sem ele.
export const PIPE_DO_PRODUTO = { cella: 39, consultoria: 39, finance: 39, recon: 38 };
const LABELS = { cella: "Cella", consultoria: "Consultoria", finance: "Finance", recon: "Recon" };
export function dealPayload({ account, product, org, owner, stage, nonce }) {
  if (!Object.hasOwn(PIPE_DO_PRODUTO, product)) throw new Error("Produto canônico inválido");
  if (![org, owner, stage].every((v) => Number.isInteger(v) && v > 0))
    throw new Error("Destino do envio incompleto");
  const deal = {
    title: `${account.name.trim()} · ${LABELS[product]} [AQ:${nonce}]`,
    org_id: org,
    user_id: owner,
    pipeline_id: PIPE_DO_PRODUTO[product],
    stage_id: stage,
  };
  return Object.hasOwn(PRODUCT_OPTIONS, product)
    ? { ...deal, [PRODUCT]: PRODUCT_OPTIONS[product] }
    : deal;
}
export function hasCanonicalProduct(deal, product) {
  if (product === "recon") return deal?.pipeline_id === PIPE_DO_PRODUTO.recon;
  return (
    Object.hasOwn(PRODUCT_OPTIONS, product) &&
    deal?.pipeline_id === 39 &&
    String(deal[PRODUCT]) === String(PRODUCT_OPTIONS[product])
  );
}
// Negócio do mesmo produto já existente na organização: no pipe do produto e, no Caixa, com o mesmo Caixa · Produto.
export function sameProductDeal(deal, product) {
  if (deal?.pipeline_id !== PIPE_DO_PRODUTO[product]) return false;
  return product === "recon" || String(deal[PRODUCT]) === String(PRODUCT_OPTIONS[product]);
}
