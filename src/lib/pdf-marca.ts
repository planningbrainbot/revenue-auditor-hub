import type jsPDF from "jspdf";

// Marca da Planning nos PDFs gerados no navegador (demonstrativo de royalties, memória de cálculo do ROAS).

export const BRAND_GREEN: [number, number, number] = [16, 185, 129];
export const BRAND_DARK: [number, number, number] = [31, 41, 55];
const LOGO_ASPECT_RATIO = 1163.3 / 239.6;

export async function addPlanningLogo(doc: jsPDF, pageWidth: number) {
  try {
    const res = await fetch("/brand/planning-logo-dark.png");
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
    const dataUrl = `data:image/png;base64,${btoa(binary)}`;
    const w = 100;
    const h = w / LOGO_ASPECT_RATIO;
    doc.addImage(dataUrl, "PNG", pageWidth - 40 - w, 26, w, h);
  } catch {
    // logo é decorativo — segue gerando o PDF sem ele
  }
}
