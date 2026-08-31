// Validação de FORMATO de telefone brasileiro — não confirma se o número
// existe de verdade nem se tem WhatsApp (a Cloud API não expõe isso antes de
// tentar enviar, por privacidade). Serve só pra pegar dado obviamente errado
// antes de gastar uma tentativa de disparo: número truncado, sem DDD, ou com
// dígitos a mais (caso real encontrado: duas linhas coladas na planilha
// original viraram um "telefone" de 20 dígitos).

export interface ValidacaoTelefone {
  valido: boolean;
  motivo: string | null;
  digitos: string;
}

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

export function validarTelefone(raw: string | null | undefined): ValidacaoTelefone {
  let d = (raw ?? "").replace(/\D/g, "");

  // remove código do país (55) se vier duplicado ou presente
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }
  if (d.startsWith("0")) d = d.slice(1);

  if (d.length < 10) {
    return { valido: false, motivo: "Menos de 10 dígitos — falta DDD ou número incompleto", digitos: d };
  }
  if (d.length > 11) {
    return { valido: false, motivo: `${d.length} dígitos — número longo demais (provável dado colado por engano)`, digitos: d };
  }

  const ddd = Number(d.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) {
    return { valido: false, motivo: `DDD ${ddd} não existe`, digitos: d };
  }

  // 8 dígitos = fixo (não precisa começar com 9); 9 dígitos = celular, precisa.
  const local = d.slice(2);
  if (local.length === 9 && local[0] !== "9") {
    return { valido: false, motivo: "Celular de 9 dígitos precisa começar com 9", digitos: d };
  }
  if (new Set(local).size === 1) {
    return { valido: false, motivo: "Número com todos os dígitos iguais — dado inválido", digitos: d };
  }

  return { valido: true, motivo: null, digitos: d };
}
