export const PRODUCT_KEY='0646513ee16829605c0af8b15b415ebf05beb6c5';
export const PRODUCT_LABELS={cella:'Cella',consultoria:'Consultoria',finance:'Finance',sem_produto:'Sem produto'};
export const METRICS=['loaded','started','scheduled','meeting','validated','signed'];
export function localDate(value){
 if(!value)return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 const s=String(value).replace(' ','T');const d=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)?s:s+'Z');
 return Number.isNaN(+d)?null:new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
export const today=()=>localDate(new Date().toISOString());
