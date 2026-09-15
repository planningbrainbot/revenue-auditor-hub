// Valores previstos totais por contrato. Nunca presume participação nem receita realizada.
export const REVENUE_FIELDS={total:'a62c0a23d29d00e7a314531b1a4f6706a51474bf',partners:'f5a420c20bf1a3ae5692bca580c8f9a8a10e672c',unit:'3d5d07b1d0d2235c2928983229bf28d8deffe7f4',unit_name:'5684f15458abf85ed384837a8eb515294350f5cc'};
const UNITS={694:'Matriz',695:'Rio de Janeiro',696:'Patos de Minas',697:'Belém',698:'Curitiba',699:'Consultoria',700:'Construção Civil',701:'Agronegócio',719:'São Paulo',720:'ROIT',857:'Itaúna',929:'Fortaleza',930:'Campo Novo',931:'São Luis',984:'Maceió',1054:'Recife',1055:'São Bernardo',1056:'Sorocaba',1124:'BPO Financeiro - GYN'};
export function expectedRevenue(deal){
 const read=key=>{const value=deal[key],number=typeof value==='object'&&value!==null?value.value:value;
  if(number===null||number===undefined||number==='')return {amount:null,currency:null,invalid:false};
  const n=Number(number);return {amount:Number.isFinite(n)&&n>=0?Math.round(n*100)/100:null,currency:deal[key+'_currency']||value?.currency||null,invalid:!Number.isFinite(n)||n<0};};
 const total=read(REVENUE_FIELDS.total),partners=read(REVENUE_FIELDS.partners),unit=read(REVENUE_FIELDS.unit),parts=[partners,unit],values=[total,...parts].filter(x=>x.amount!==null);
 let status='missing',sum=null,difference=null;
 if([total,...parts].some(x=>x.invalid))status='invalid';
 else if(values.some(x=>!x.currency))status='currency_missing';
 else if(new Set(values.map(x=>x.currency)).size>1)status='currency_mismatch';
 else if(parts.every(x=>x.amount!==null)){
  sum=(Math.round(partners.amount*100)+Math.round(unit.amount*100))/100;
  difference=total.amount===null?null:(Math.round(total.amount*100)-Math.round(sum*100))/100;
  status=total.amount===null?'calculated':difference===0?'ok':'mismatch';
 }else if(total.amount!==null)status='split_missing';
 else if(values.length)status='partial';
 const unitName=UNITS[deal[REVENUE_FIELDS.unit_name]]||null;if(['ok','calculated'].includes(status)&&unit.amount>0&&!unitName)status='unit_missing';
 return {total,partners,unit,sum,difference,status,basis:'total_por_contrato',unit_name:UNITS[deal[REVENUE_FIELDS.unit_name]]||null};
}
