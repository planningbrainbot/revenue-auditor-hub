import type { ReformaTributariaData } from './xlsx-parser';

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMi(n: number): string {
  return (n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function getPhase(i: number): string {
  return [
    'CBS/IBS de teste',
    'CBS entra / IBS teste',
    'Continuação',
    'Gradual −10%',
    'Gradual −20%',
    'Gradual −30%',
    'Gradual −40%',
    'Regime final',
  ][i] ?? '';
}

export function generatePresentationHTML(d: ReformaTributariaData): string {
  const first = d.years[0];
  const last = d.years[d.years.length - 1];
  const deltaPp = ((last.carga - first.carga) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const deltaR = last.desembolso - first.desembolso;

  // Detect tax regime: ISS = services company; ICMS = commerce/industry
  const isServico = d.aliquotas.iss > 0;
  const tributosAtuais = isServico ? 'ISS e PIS/COFINS' : 'ICMS, PIS e COFINS';
  const transicaoFinal = isServico
    ? 'quando o ISS é substituído integralmente pelo IBS na alíquota cheia.'
    : 'quando o ICMS é substituído integralmente pelo IBS na alíquota cheia.';

  // CBS/IBS breakdown for regime final (section 02)
  const ibsRateTotal = d.aliquotas.ibsEstadual + d.aliquotas.ibsMunicipal;
  const totalNewRate = d.aliquotas.cbs + ibsRateTotal;
  const cbsValue  = totalNewRate > 0 ? last.desembolso * (d.aliquotas.cbs / totalNewRate) : 0;
  const ibsValue  = totalNewRate > 0 ? last.desembolso * (ibsRateTotal / totalNewRate) : 0;
  const ibsPct    = Math.round((ibsRateTotal / (totalNewRate || 1)) * 100);
  // Old tribute (ISS or ICMS): CBS is designed to replace PIS/COFINS at similar revenue,
  // so PIS/COFINS 2026 ≈ cbsValue, and old main tribute ≈ first.desembolso - cbsValue
  const oldTributeValue    = Math.max(0, first.desembolso - cbsValue);
  const oldTributeLabel    = isServico ? 'ISS' : 'ICMS';
  const reductionPerYearK  = Math.round(oldTributeValue * 0.1 / 1000); // -10%/ano a partir de 2029

  // Resultado operacional: use parsed values if available, else fallback
  const resAtual = d.resultadoAtual > 0 ? d.resultadoAtual : (d.faturamento - first.desembolso);
  const resPosReforma = d.resultadoPosReforma > 0 ? d.resultadoPosReforma : (d.faturamento - last.desembolso);
  const deltaResultado = resAtual - resPosReforma;

  const obsBlock = d.observacoes
    ? `<div style="background:#0f180f;border:1px solid #1e3a1e;border-radius:10px;padding:18px 22px;margin-top:24px;font-size:.82rem;color:#ccc;line-height:1.65;">
        <div style="font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#5FB77F;margin-bottom:8px;font-weight:600;">Nota da Auditora</div>
        ${d.observacoes.split('\n').map((l) => `<p style="margin-bottom:4px;">${l}</p>`).join('')}
       </div>`
    : '';

  const timelineItems = d.years
    .map(
      (y, i) => `
    <div style="flex:1;text-align:center;border:1px solid ${i === d.years.length - 1 ? '#5FB77F' : '#252525'};border-right:none;background:${i === d.years.length - 1 ? '#0b1a0b' : '#111'};padding:18px 6px 12px;">
      <div style="font-size:10px;color:#777;margin-bottom:6px;">${y.ano}</div>
      <div style="font-size:1rem;font-weight:800;color:${i === d.years.length - 1 ? '#5FB77F' : '#fff'};">${fmtPct(y.carga)}</div>
      <div style="font-size:8.5px;color:#777;margin-top:4px;">R$ ${fmtMi(y.desembolso)}mi</div>
      <div style="font-size:8px;color:#666;margin-top:5px;line-height:1.3;">${getPhase(i)}</div>
    </div>`,
    )
    .join('');
  // last item needs right border
  const tlLast = `border-right:1px solid #5FB77F;border-radius:0 12px 12px 0;`;

  const tableRows = d.years
    .map(
      (y, i) =>
        `<tr style="${i === d.years.length - 1 ? 'color:#5FB77F;font-weight:700;' : ''}">
          <td style="padding:11px 14px;border-bottom:1px solid #1a1a1a;font-weight:600;">${y.ano}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #1a1a1a;font-size:.78rem;color:#777;">${getPhase(i)}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #1a1a1a;color:#5FB77F;font-weight:700;">${fmtPct(y.carga)}</td>
          <td style="padding:11px 14px;border-bottom:1px solid #1a1a1a;text-align:right;">${fmtBRL(y.desembolso)}</td>
        </tr>`,
    )
    .join('');

  const chartLabels = JSON.stringify(d.years.map((y) => y.ano));
  const chartCargas = JSON.stringify(d.years.map((y) => parseFloat((y.carga * 100).toFixed(4))));
  const chartDesembolso = JSON.stringify(d.years.map((y) => y.desembolso));

  const logoSvg = `<img src="https://planning.opsboard.com.br/brand/planning-logo-dark.svg" style="height:22px;width:auto;display:block;" alt="Planning" />`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mapa da Reforma Tributária · ${d.empresa} · Planning</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
:root{--bg:#080808;--s1:#111;--s2:#181818;--s3:#202020;--b:#252525;--b2:#303030;--g:#5FB77F;--c:#4EBED8;--r:#ff5252;--w:#fff;--gr:#777;--gm:#aaa;--gl:#ccc;--font:-apple-system,'Inter','Helvetica Neue',Arial,sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--w);font-family:var(--font);-webkit-font-smoothing:antialiased;overflow-x:hidden;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:var(--bg);}::-webkit-scrollbar-thumb{background:#333;border-radius:2px;}

.topbar{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(8,8,8,.9);backdrop-filter:blur(16px);border-bottom:1px solid var(--b);display:flex;align-items:center;padding:0 48px;height:58px;gap:24px;}
.nav-links{display:flex;gap:4px;flex:1;}
.nav-link{font-size:11px;color:var(--gr);text-decoration:none;padding:5px 11px;border-radius:20px;transition:color .2s,background .2s;white-space:nowrap;}
.nav-link:hover{color:var(--w);background:var(--s3);}
.confid{margin-left:auto;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--gr);border:1px solid var(--b2);padding:4px 10px;border-radius:20px;}
.progress-line{position:fixed;top:58px;left:0;height:2px;background:linear-gradient(90deg,var(--g),var(--c));width:0%;z-index:99;transition:width .1s linear;}

section{padding:100px 0;}
.container{max-width:1080px;margin:0 auto;padding:0 48px;}
.divider{height:1px;background:linear-gradient(90deg,transparent,var(--b2) 20%,var(--b2) 80%,transparent);margin:0 48px;}

.reveal{opacity:0;transform:translateY(24px);transition:opacity .65s ease,transform .65s ease;}
.reveal.visible{opacity:1;transform:none;}
.d1{transition-delay:.1s;}.d2{transition-delay:.2s;}.d3{transition-delay:.3s;}

.eyebrow{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--g);font-weight:600;margin-bottom:12px;}
.section-title{font-size:clamp(1.5rem,2.8vw,2.2rem);font-weight:800;line-height:1.15;margin-bottom:10px;}
.section-sub{font-size:.93rem;color:var(--gl);line-height:1.7;max-width:620px;}
.ruled{position:relative;padding-bottom:20px;margin-bottom:20px;}
.ruled::after{content:'';position:absolute;bottom:0;left:0;width:44px;height:3px;background:linear-gradient(90deg,var(--g),var(--c));border-radius:2px;}

.cg{display:grid;gap:12px;}
.c2{grid-template-columns:repeat(2,1fr);}
.c3{grid-template-columns:repeat(3,1fr);}
.c4{grid-template-columns:repeat(4,1fr);}
.card{background:var(--s1);border:1px solid var(--b);border-radius:12px;padding:22px;transition:border-color .2s;}
.card:hover{border-color:var(--b2);}
.card.cg-border{border-color:rgba(95,183,127,.35);}
.card.cc-border{border-color:rgba(78,190,216,.35);}
.card.cr-border{border-color:rgba(255,82,82,.35);}
.cl{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--g);font-weight:600;margin-bottom:10px;}
.cl-c{color:var(--c);}.cl-r{color:var(--r);}
.cv{font-size:1.9rem;font-weight:800;line-height:1;margin-bottom:7px;}
.cd{font-size:.72rem;color:var(--gr);line-height:1.5;}

#hero{min-height:100vh;display:flex;align-items:center;padding:120px 0 80px;
  background:radial-gradient(ellipse 60% 50% at 80% 40%,rgba(95,183,127,.07) 0%,transparent 70%),
             radial-gradient(ellipse 40% 40% at 20% 80%,rgba(78,190,216,.05) 0%,transparent 70%),var(--bg);}
.hero-badge{display:inline-flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--gm);border:1px solid var(--b2);padding:6px 14px;border-radius:20px;margin-bottom:28px;}
.hero-badge span{color:var(--g);}
.hero-hl{font-size:clamp(2.8rem,5.5vw,5rem);font-weight:900;line-height:1.04;letter-spacing:-.02em;margin-bottom:24px;}
.hero-sub{font-size:1rem;color:var(--gl);line-height:1.7;max-width:540px;margin-bottom:44px;}
.hero-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--b);border:1px solid var(--b);border-radius:12px;overflow:hidden;max-width:660px;}
.hm{background:var(--s1);padding:16px 20px;}
.hml{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--g);margin-bottom:4px;font-weight:600;}
.hmv{font-size:.82rem;color:var(--gl);}

.impact-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--b);border:1px solid var(--b);border-radius:12px;overflow:hidden;margin-top:36px;}
.ig{background:var(--s1);padding:32px 28px;}
.ig.hl{background:#0b1a0b;}
.ig-label{font-size:9px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin-bottom:10px;}
.ig-row{display:flex;align-items:baseline;gap:6px;margin-bottom:8px;flex-wrap:wrap;}
.ig-v{font-size:1.5rem;font-weight:800;}
.ig-arrow{color:var(--gr);font-size:1.1rem;}
.ig-delta{font-size:.76rem;color:var(--gr);line-height:1.4;}

.bar-box{background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:26px 30px;margin-top:40px;}
.bar-title{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--gr);margin-bottom:20px;}
.bar-row{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
.bar-row:last-child{margin-bottom:0;}
.bar-yr{font-size:.74rem;color:var(--gr);min-width:32px;}
.bar-track{flex:1;height:7px;background:var(--s3);border-radius:4px;overflow:hidden;}
.bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--g),var(--c));width:0;transition:width 1.4s cubic-bezier(.16,1,.3,1);}
.bar-lbl{font-size:.82rem;font-weight:700;min-width:48px;text-align:right;}

.tabs-header{display:flex;gap:0;border-bottom:1px solid var(--b);}
.tab-btn{font-size:11.5px;font-weight:600;color:var(--gr);background:none;border:none;padding:11px 18px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .2s,border-color .2s;font-family:var(--font);letter-spacing:.03em;}
.tab-btn:hover{color:var(--gl);}
.tab-btn.active{color:var(--g);border-bottom-color:var(--g);}
.tab-panel{display:none;padding:28px 0 0;animation:fadeIn .3s ease;}
.tab-panel.active{display:block;}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}

.dt{width:100%;border-collapse:collapse;font-size:.8rem;}
.dt th{text-align:left;font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:var(--g);padding:9px 14px;border-bottom:1px solid var(--b2);font-weight:600;}
.dt td{padding:11px 14px;border-bottom:1px solid var(--b);color:var(--gl);vertical-align:middle;}
.dt tr:last-child td{border-bottom:none;}
.dt tr.last-row td{color:var(--g);font-weight:700;}
.dt tr.total-row td{font-weight:700;border-top:1px solid var(--b2);color:var(--w);}
.vg{color:var(--g);font-weight:700;}.vc{color:var(--c);font-weight:600;}.vr{color:var(--r);font-weight:700;}.vw{color:var(--w);font-weight:600;}
.mini-b{display:flex;align-items:center;gap:8px;}
.mini-t{width:110px;height:5px;background:var(--s3);border-radius:3px;overflow:hidden;}
.mini-f{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--g),var(--c));}

.chart-box{background:var(--s2);border:1px solid var(--b);border-radius:12px;padding:24px;}

.tl{display:flex;margin-top:36px;}
.ti{flex:1;border:1px solid var(--b);border-right:none;background:var(--s1);padding:18px 6px 12px;text-align:center;}
.ti:first-child{border-radius:12px 0 0 12px;}
.ti:last-child{border-right:1px solid var(--g);border-color:var(--g);border-radius:0 12px 12px 0;background:#0b1a0b;}
.ti:hover{background:var(--s2);}
.ti-year{font-size:10px;color:var(--gr);margin-bottom:6px;font-weight:600;}
.ti-pct{font-size:1.05rem;font-weight:800;}
.ti:last-child .ti-pct{color:var(--g);}
.ti-val{font-size:8.5px;color:var(--gr);margin-top:4px;}
.ti-ph{font-size:8px;color:var(--gr);margin-top:5px;line-height:1.3;}

.bb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:24px;}
.bb{background:var(--s1);border:1px solid var(--b);border-radius:12px;padding:20px;}
.bb.red-bb{border-color:rgba(255,82,82,.3);}
.bb-tax{font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:var(--gr);margin-bottom:7px;}
.bb-val{font-size:1.4rem;font-weight:800;margin-bottom:4px;}
.bb-sub{font-size:.72rem;font-weight:600;margin-bottom:6px;}
.bb-desc{font-size:.7rem;color:var(--gr);line-height:1.4;}

.ap-grid{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:start;margin-top:36px;}
.ap-row{display:grid;grid-template-columns:1fr 130px 130px;align-items:center;padding:10px 0;border-bottom:1px solid var(--b);font-size:.8rem;gap:10px;}
.ap-row:last-child{border-bottom:none;}
.ap-head{font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:var(--gr);padding-bottom:7px;border-bottom:1px solid var(--b2);}
.ap-group{font-weight:700;font-size:.83rem;padding-top:14px;}
.ap-indent{padding-left:18px;color:var(--gr);font-size:.76rem;}
.ap-total{border-top:1px solid var(--b2);border-bottom:none;font-weight:700;font-size:.86rem;padding-top:12px;margin-top:4px;color:var(--w);}
.ap-v1{text-align:right;color:var(--gl);}
.ap-v2{text-align:right;color:var(--c);font-weight:600;}
.ap-total .ap-v1{color:var(--w);}
.ap-total .ap-v2{color:var(--g);font-size:.95rem;}
.ap-kpis{display:flex;flex-direction:column;gap:11px;min-width:175px;}

.bs-row{display:flex;gap:11px;margin-top:28px;}
.bs{flex:1;background:var(--s1);border:1px solid var(--b);border-radius:12px;padding:20px 14px;text-align:center;transition:border-color .2s,background .2s;}
.bs:hover{border-color:var(--g);background:#0b1a0b;}
.bs-year{font-size:.78rem;font-weight:700;margin-bottom:8px;color:var(--gl);}
.bs-pct{font-size:2rem;font-weight:900;color:var(--g);line-height:1;margin-bottom:5px;}
.bs-label{font-size:.68rem;color:var(--g);font-weight:600;margin-bottom:6px;}
.bs-desc{font-size:.68rem;color:var(--gr);}

.nb{background:#0c180c;border:1px solid #1c361c;border-radius:10px;padding:16px 20px;font-size:.78rem;color:var(--gl);line-height:1.65;margin-top:20px;}
.nb-label{font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:var(--g);font-weight:600;margin-bottom:7px;}
.nb strong{color:var(--g);}

#cta{background:radial-gradient(ellipse 50% 60% at 50% 0%,rgba(95,183,127,.08) 0%,transparent 60%),var(--s1);border-top:1px solid var(--b);padding:120px 0;text-align:center;}
.cta-hl{font-size:clamp(2rem,4.5vw,3.8rem);font-weight:900;line-height:1.08;letter-spacing:-.02em;margin-bottom:22px;max-width:680px;margin-left:auto;margin-right:auto;}
.cta-sub{font-size:.95rem;color:var(--gl);line-height:1.7;max-width:500px;margin:0 auto 40px;}
.footer-line{width:100%;height:1px;background:var(--b);margin:52px 0 28px;}
.footer-txt{font-size:.76rem;color:var(--gr);}

@media(max-width:768px){
  .topbar{padding:0 20px;}.nav-links{display:none;}.container{padding:0 20px;}
  .c2,.c3,.c4,.impact-grid,.hero-meta{grid-template-columns:1fr;}
  .tl{flex-wrap:wrap;}.ti{border-right:1px solid var(--b);min-width:90px;}
  .bb-grid{grid-template-columns:1fr;}.ap-grid{grid-template-columns:1fr;}.bs-row{flex-wrap:wrap;}
}

@media print{
  @page{size:A4 landscape;margin:0;}
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  /* fundo escuro preenche cada página até a borda */
  body{background:#080808!important;}
  /* oculta chrome de navegação — sem topbar, sem barra de progresso */
  .topbar,.progress-line,.edit-bar-btm,.edit-toggle-btn,.tabs-header{display:none!important;}
  /* força visibilidade de todos os elementos com animação de reveal */
  .reveal{opacity:1!important;transform:none!important;transition:none!important;}
  /* hero sem viewport-height — ocupa só o espaço do conteúdo */
  #hero{min-height:auto!important;padding:60px 0 40px!important;}
  section{padding:40px 0!important;}
  .divider{display:none!important;}
  /* mostra apenas a aba ativa por padrão (não duplica conteúdo) */
  .tab-panel:not(.active){display:none!important;}
  .chart-box canvas{max-height:220px;}
  .bar-fill{transition:none!important;}
  a{color:inherit!important;text-decoration:none!important;}
}
.edit-bar-btm{display:none;position:fixed;bottom:0;left:0;right:0;z-index:200;background:rgba(10,26,10,.97);backdrop-filter:blur(12px);border-top:1px solid #1e3a1e;padding:11px 48px;align-items:center;gap:14px;}
body.edit-mode .edit-bar-btm{display:flex;}
[data-e]{transition:outline .15s,background .15s;}
body.edit-mode [data-e]{outline:1.5px dashed rgba(95,183,127,.35);outline-offset:3px;border-radius:3px;cursor:text;}
body.edit-mode [data-e]:hover{outline-color:rgba(95,183,127,.65);}
body.edit-mode [data-e][contenteditable="true"]:focus{outline:2px solid var(--g);background:rgba(95,183,127,.04);}
.eb-notice{font-size:11px;color:var(--g);flex:1;letter-spacing:.01em;}
.eb-btn{font-size:11px;font-weight:600;padding:7px 18px;border-radius:20px;cursor:pointer;border:none;font-family:var(--font);transition:opacity .15s,background .15s;}
.eb-dl{background:var(--g);color:#000;}.eb-dl:hover{opacity:.85;}
.eb-exit{background:transparent;color:var(--gr);border:1px solid var(--b2);}.eb-exit:hover{color:var(--gm);}
.edit-toggle-btn{display:flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--b2);color:var(--gr);padding:5px 13px;border-radius:20px;cursor:pointer;font-size:10px;font-family:var(--font);letter-spacing:.04em;transition:all .2s;white-space:nowrap;}
.edit-toggle-btn:hover{color:var(--gm);border-color:var(--gr);}
body.edit-mode .edit-toggle-btn{background:rgba(95,183,127,.08);border-color:rgba(95,183,127,.5);color:var(--g);}
</style>
</head>
<body>
<div class="edit-bar-btm">
  <span class="eb-notice">✏ Modo edição — clique nos textos destacados para editar</span>
  <button class="eb-btn eb-dl" onclick="downloadEdited()">Baixar com edições</button>
  <button class="eb-btn eb-exit" onclick="exitEdit()">Sair da edição</button>
</div>
<div class="progress-line" id="pl"></div>
<nav class="topbar">
  <a href="#" style="display:flex;align-items:center;text-decoration:none;">${logoSvg}</a>
  <div class="nav-links">
    <a class="nav-link" href="#premissas">Premissas</a>
    <a class="nav-link" href="#impacto">Impacto</a>
    <a class="nav-link" href="#evolucao">Evolução</a>
    <a class="nav-link" href="#composicao">Progressão</a>
    <a class="nav-link" href="#legal">Base Legal</a>
    <a class="nav-link" href="#beneficios">Benefícios</a>
    ${d.observacoes ? '<a class="nav-link" href="#notas">Notas</a>' : ''}
  </div>
  <button class="edit-toggle-btn" id="editToggleBtn" onclick="toggleEditMode()" title="Editar textos da apresentação">✏ Editar</button>
  <button class="edit-toggle-btn" onclick="window.print()" title="Baixar como PDF" style="gap:5px;">⬇ PDF</button>
  <span class="confid">Diagnóstico · Confidencial</span>
</nav>

<!-- ── HERO ── -->
<section id="hero">
<div class="container">
  <div class="hero-badge reveal"><span>Mapa da Reforma Tributária</span> · Simulação 2026 a 2033</div>
  <h1 class="hero-hl reveal d1" data-e>
    <span style="color:var(--g)">${d.empresa}</span><br>
    vai pagar <span style="color:var(--r)">+R$ ${Math.round(deltaR / 1000)}k</span><br>
    de imposto por ano.
  </h1>
  <p class="hero-sub reveal d2" data-e>${d.textoPrincipal || `A Reforma Tributária (LC 214) eleva sua carga de ${fmtPct(first.carga)} para ${fmtPct(last.carga)} até ${last.ano}. A carga hoje incide sobre ${tributosAtuais}. Este mapa mostra como esse aumento acontece — ano a ano, imposto a imposto — para que você planeje antes que a conta chegue.`}</p>
  <div class="hero-meta reveal d3">
    <div class="hm"><div class="hml">Empresa</div><div class="hmv">${d.empresa} · ${d.estado}</div></div>
    <div class="hm"><div class="hml">Atividade</div><div class="hmv" data-e>${d.atividade || 'a preencher'}</div></div>
    <div class="hm"><div class="hml">Elaboração</div><div class="hmv">Planning · ${d.referencia}</div></div>
  </div>
</div>
</section>

<div class="divider"></div>

<!-- ── PREMISSAS ── -->
<section id="premissas">
<div class="container">
  <div class="reveal"><div class="eyebrow">01 · Premissas</div>
  <h2 class="section-title ruled">Sobre o que esta simulação foi construída</h2>
  <p class="section-sub" data-e>Todo o mapa parte de dados reais da empresa: faturamento, volume de compras e atividade. A carga atual incide sobre ${tributosAtuais} — que a Reforma substitui por CBS e IBS.</p></div>
  <div class="cg c4" style="margin-top:36px;">
    <div class="card cg-border reveal d1"><div class="cl">Faturamento anual</div><div class="cv">R$ ${fmtMi(d.faturamento)}<span style="font-size:1rem">mi</span></div><div class="cd">Base de cálculo dos tributos sobre a receita</div></div>
    <div class="card reveal d2"><div class="cl">Aquisições anuais</div><div class="cv">R$ ${fmtMi(d.aquisicoes)}<span style="font-size:1rem">mi</span></div><div class="cd">Compras que geram crédito tributário</div></div>
    <div class="card cg-border reveal d3"><div class="cl">Carga efetiva hoje</div><div class="cv" style="color:var(--g)">${fmtPct(first.carga)}</div><div class="cd">Sobre ${tributosAtuais} a pagar</div></div>
    <div class="card reveal"><div class="cl">Atividade</div><div class="cv" style="font-size:1rem;line-height:1.25;" data-e>${d.atividade || 'a preencher'}</div><div class="cd">${d.estado}</div></div>
  </div>
  <div style="margin-top:48px;" class="reveal">
    <div class="eyebrow" style="margin-bottom:6px;">Alíquotas de referência</div>
    <div class="tabs-header">
      <button class="tab-btn active" onclick="tab('aliq','saem',this)">Tributos que saem</button>
      <button class="tab-btn" onclick="tab('aliq','entram',this)">Tributos que entram</button>
    </div>
    <div id="aliq-saem" class="tab-panel active">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">
        <table class="dt"><thead><tr><th>Tributo</th><th>Alíquota</th><th>Situação</th></tr></thead><tbody>
          ${isServico
            ? '<tr><td class="vw">ISS</td><td class="vg">' + fmtPct(d.aliquotas.iss) + '</td><td>Reduzido de 2029 a 2032 e substituído pelo IBS em 2033</td></tr>'
            : '<tr><td class="vw">ICMS</td><td class="vg">Variável</td><td>Extinto até 2033</td></tr>'
          }
          <tr><td class="vw">PIS/COFINS</td><td class="vg">${fmtPct(d.aliquotas.pisCofins)}</td><td>Sai em 2027</td></tr>
          ${!isServico && d.aliquotas.ipi > 0 ? '<tr><td class="vw">IPI</td><td>' + fmtPct(d.aliquotas.ipi) + '</td><td>Mantido em casos específicos</td></tr>' : ''}
        </tbody></table>
        <div class="nb"><div class="nb-label">Como sai</div>${isServico
          ? 'O ISS é reduzido progressivamente de 2029 a 2032 (−10% em 2029, −20% em 2030, −30% em 2031, −40% em 2032) e substituído integralmente pelo IBS em 2033. O PIS/COFINS sai em 2027, substituído pela CBS.'
          : 'O ICMS é reduzido progressivamente a partir de 2029 (−10%/ano), zerando em 2033. O PIS/COFINS sai de uma vez em 2027, substituído pela CBS.'
        }</div>
      </div>
    </div>
    <div id="aliq-entram" class="tab-panel">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">
        <table class="dt"><thead><tr><th>Tributo</th><th>Alíquota</th><th>Papel na Reforma</th></tr></thead><tbody>
          <tr><td class="vw">CBS</td><td class="vg">${fmtPct(d.aliquotas.cbs)}</td><td>Substitui PIS/COFINS (federal)</td></tr>
          <tr><td class="vw">IBS Estadual</td><td class="vg">${fmtPct(d.aliquotas.ibsEstadual)}</td><td>${isServico ? 'Substitui o ISS (municipal)' : 'Substitui o ICMS (estadual)'}</td></tr>
          <tr><td class="vw">IBS Municipal</td><td class="vg">${fmtPct(d.aliquotas.ibsMunicipal)}</td><td>Parcela municipal do IBS</td></tr>
        </tbody></table>
        <div class="nb"><div class="nb-label">Como entra</div>CBS entra em 2027 de forma plena. IBS começa em teste em 2027 e assume peso crescente a partir de 2029, atingindo <strong>alíquota cheia em 2033</strong> — nesse ponto mora o salto da carga.</div>
      </div>
    </div>
  </div>
</div>
</section>

<div class="divider"></div>

<!-- ── IMPACTO ── -->
<section id="impacto" style="background:var(--s1);">
<div class="container">
  <div class="reveal"><div class="eyebrow">02 · O impacto consolidado</div>
  <h2 class="section-title ruled">Hoje contra o regime final · <span style="color:var(--g)">2026</span> vs <span style="color:var(--c)">${last.ano}</span></h2>
  <p class="section-sub" data-e>A carga sobe, o imposto a pagar sobe, e o resultado operacional cai na mesma proporção.</p></div>
  <div class="impact-grid reveal">
    <div class="ig"><div class="ig-label cl">Carga efetiva</div>
      <div class="ig-row"><span class="ig-v" style="color:var(--g)">${fmtPct(first.carga)}</span><span class="ig-arrow">→</span><span class="ig-v" style="color:var(--c)">${fmtPct(last.carga)}</span></div>
      <div class="ig-delta">Acréscimo de <strong style="color:var(--c)">+${deltaPp} pontos percentuais</strong></div></div>
    <div class="ig hl"><div class="ig-label cl-r">Imposto a pagar / ano</div>
      <div class="ig-row"><span class="ig-v" style="color:var(--g)">R$ ${fmtMi(first.desembolso)}mi</span><span class="ig-arrow">→</span><span class="ig-v" style="color:var(--r)">R$ ${fmtMi(last.desembolso)}mi</span></div>
      <div class="ig-delta"><strong style="color:var(--r)">+R$ ${fmtBRL(deltaR)} por ano</strong> no regime final</div></div>
    <div class="ig"><div class="ig-label cl-r">Resultado operacional</div>
      <div class="ig-row"><span class="ig-v" style="color:var(--g)">R$ ${fmtMi(resAtual)}mi</span><span class="ig-arrow">→</span><span class="ig-v" style="color:var(--r)">R$ ${fmtMi(resPosReforma)}mi</span></div>
      <div class="ig-delta">Queda de <strong style="color:var(--r)">R$ ${fmtBRL(deltaResultado)}</strong> no resultado simulado</div></div>
  </div>
  <div class="bar-box reveal">
    <div class="bar-title">Carga efetiva sobre o consumo · hoje vs regime final</div>
    <div class="bar-row"><span class="bar-yr">2026</span><div class="bar-track"><div class="bar-fill" data-w="${Math.round(first.carga / last.carga * 100)}" style="background:linear-gradient(90deg,var(--g),var(--g));"></div></div><span class="bar-lbl" style="color:var(--g)">${fmtPct(first.carga)}</span></div>
    <div class="bar-row"><span class="bar-yr">${last.ano}</span><div class="bar-track"><div class="bar-fill" data-w="100"></div></div><span class="bar-lbl" style="color:var(--c)">${fmtPct(last.carga)}</span></div>
    <div style="text-align:right;margin-top:14px;font-size:1.7rem;font-weight:900;color:var(--c);">+${deltaPp} p.p.</div>
  </div>


</div>
</section>

<div class="divider"></div>

<!-- ── EVOLUÇÃO ── -->
<section id="evolucao">
<div class="container">
  <div class="reveal"><div class="eyebrow">03 · A transição não é de uma vez</div>
  <h2 class="section-title ruled">Oito anos de <span style="color:var(--g)">subida gradual</span> até o regime final</h2>
  <p class="section-sub" data-e>A carga sobe de forma quase imperceptível até 2032 — e dá o salto maior em 2033, ${transicaoFinal}</p></div>
  <div class="tl reveal">${d.years.map((y,i)=>`<div class="ti${i===d.years.length-1?' ti-last':''}"><div class="ti-year">${y.ano}</div><div class="ti-pct">${fmtPct(y.carga)}</div><div class="ti-val">R$ ${fmtMi(y.desembolso)}mi</div><div class="ti-ph">${getPhase(i)}</div></div>`).join('')}</div>
  <div class="reveal" style="margin-top:40px;">
    <div class="tabs-header">
      <button class="tab-btn active" onclick="tab('evo','tabela',this)">Tabela detalhada</button>
      <button class="tab-btn" onclick="tab('evo','grafico',this)">Gráfico</button>
    </div>
    <div id="evo-tabela" class="tab-panel active">
      <table class="dt"><thead><tr><th>Ano</th><th>Fase</th><th>Carga efetiva</th><th style="text-align:right;">Desembolso (R$)</th></tr></thead>
      <tbody>${tableRows}
        <tr class="total-row"><td colspan="2">Variação 2026 → ${last.ano}</td><td class="vr">+${deltaPp} p.p.</td><td class="vr" style="text-align:right;">+${fmtBRL(deltaR)}</td></tr>
      </tbody></table>
    </div>
    <div id="evo-grafico" class="tab-panel"><div class="chart-box"><canvas id="chartLine" height="100"></canvas></div></div>
  </div>
</div>
</section>

<div class="divider"></div>

<!-- ── COMPOSIÇÃO ── -->
<section id="composicao" style="background:var(--s1);">
<div class="container">
  <div class="reveal"><div class="eyebrow">04 · Progressão anual</div>
  <h2 class="section-title ruled">Desembolso total <span style="color:var(--g)">ano a ano</span></h2>
  <p class="section-sub" data-e>O imposto a pagar cresce gradualmente com a transição e dá o salto maior em 2033, ${transicaoFinal}</p></div>
  <div class="reveal" style="margin-top:32px;">
    <div class="tabs-header">
      <button class="tab-btn active" onclick="tab('comp','grafico',this)">Gráfico</button>
      <button class="tab-btn" onclick="tab('comp','tabela',this)">Tabela</button>
    </div>
    <div id="comp-grafico" class="tab-panel active"><div class="chart-box"><canvas id="chartBar" height="120"></canvas></div></div>
    <div id="comp-tabela" class="tab-panel">
      <table class="dt"><thead><tr><th>Ano</th><th>Fase</th><th style="text-align:right;">Carga efetiva</th><th style="text-align:right;">Total impostos (R$)</th><th style="text-align:right;">Var. vs 2026</th></tr></thead>
      <tbody>
        ${d.years.map((y, i) => { const delta = y.desembolso - first.desembolso; const deltaStr = i === 0 ? '—' : (delta >= 0 ? '+' : '') + 'R$ ' + fmtBRL(Math.abs(delta)); return '<tr' + (i === d.years.length - 1 ? ' class="last-row"' : '') + '><td>' + y.ano + '</td><td style="color:#777;font-size:.78rem;">' + getPhase(i) + '</td><td style="text-align:right;color:#5FB77F;font-weight:700;">' + fmtPct(y.carga) + '</td><td style="text-align:right;">' + fmtBRL(y.desembolso) + '</td><td style="text-align:right;color:' + (delta > 0 ? '#ff5252' : '#777') + ';">' + deltaStr + '</td></tr>'; }).join('')}
      </tbody></table>
    </div>
  </div>

  <!-- Resumo: tributo antigo → CBS → IBS -->
  <div class="reveal" style="margin-top:36px;">
    <div class="bar-title" style="margin-bottom:14px;">Como o imposto muda — de hoje até ${last.ano}</div>
    <div class="bb-grid">
      <div class="bb red-bb">
        <div class="bb-tax">${oldTributeLabel}</div>
        <div class="bb-val">R$ ${fmtMi(oldTributeValue)}<span style="font-size:.9rem">mi</span> → <span style="color:var(--g);font-weight:900">0</span></div>
        <div class="bb-sub" style="color:var(--r)">Encolhe e zera em 2033</div>
        <div class="bb-desc">Reduz ~R$ ${reductionPerYearK}k/ano a partir de 2029, substituído integralmente pelo IBS.</div>
      </div>
      <div class="bb cg-border">
        <div class="bb-tax">CBS</div>
        <div class="bb-val" style="color:var(--g)">R$ ${fmtMi(cbsValue)}<span style="font-size:.9rem">mi</span></div>
        <div class="bb-sub" style="color:var(--g)">Estável no regime final</div>
        <div class="bb-desc">Substitui o PIS/COFINS já em 2027. Alíquota federal: ${fmtPct(d.aliquotas.cbs)}.</div>
      </div>
      <div class="bb cc-border">
        <div class="bb-tax">IBS</div>
        <div class="bb-val" style="color:var(--c)">R$ ${fmtMi(ibsValue)}<span style="font-size:.9rem">mi</span></div>
        <div class="bb-sub" style="color:var(--c)">O grande peso de ${last.ano}</div>
        <div class="bb-desc">${ibsPct}% do imposto no regime final. ${isServico ? 'Substitui o ISS em 2033.' : 'Substitui o ICMS progressivamente de 2029 a 2033.'}</div>
      </div>
    </div>
  </div>
</div>
</section>

<div class="divider"></div>

<!-- ── LEGAL ── -->
<section id="legal" style="background:var(--s1);">
<div class="container">
  <div class="reveal"><div class="eyebrow">05 · Base legal</div>
  <h2 class="section-title ruled" data-e>O que sustenta os números</h2>
  <p class="section-sub" data-e>A simulação segue integralmente a Lei Complementar 214, que institui o IVA dual (CBS + IBS) e define as regras de transição de 2026 a 2033.</p></div>
  <div class="cg ${isServico ? 'c1' : 'c2'} reveal" style="margin-top:36px;">
    <div class="card cg-border"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;"><div class="cl">Base legal</div><span style="font-size:.95rem;font-weight:800;color:var(--g);">LC 214</span></div><div style="font-size:.88rem;font-weight:700;margin-bottom:8px;" data-e>Lei Complementar 214</div><div class="cd" data-e>Institui a CBS e o IBS e define as regras de transição entre 2026 e 2033. ${isServico ? 'Para prestadores de serviços, o ISS é substituído pelo IBS em 2033.' : 'O ICMS é reduzido progressivamente de 2029 a 2033.'}</div></div>
    ${!isServico ? '<div class="card cc-border"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;"><div class="cl cl-c">Benefício fiscal estadual</div><span style="font-size:.95rem;font-weight:800;color:var(--c);">Conv. 52/91</span></div><div style="font-size:.88rem;font-weight:700;margin-bottom:8px;" data-e>Convênio ICMS 52/91</div><div class="cd" data-e>Reduzido de forma escalonada durante a transição, acompanhando a consolidação do IBS.</div></div>' : ''}
  </div>
  <div class="reveal" style="margin-top:36px;">
    <div class="eyebrow" data-e style="margin-bottom:14px;">${isServico ? 'Redução gradativa do ISS durante a transição' : 'Redução gradativa dos benefícios fiscais estaduais'}</div>
    <div class="bs-row">
      <div class="bs"><div class="bs-year">2029</div><div class="bs-pct">10<span style="font-size:.9rem">%</span></div><div class="bs-label" data-e>Primeira redução</div><div class="bs-desc" data-e>${isServico ? 'ISS começa a ceder' : 'Início do escalonamento'}</div></div>
      <div class="bs"><div class="bs-year">2030</div><div class="bs-pct">20<span style="font-size:.9rem">%</span></div><div class="bs-label" data-e>Segunda redução</div><div class="bs-desc" data-e>IBS ganha peso</div></div>
      <div class="bs"><div class="bs-year">2031</div><div class="bs-pct">30<span style="font-size:.9rem">%</span></div><div class="bs-label" data-e>Terceira redução</div><div class="bs-desc" data-e>${isServico ? 'ISS perde força' : 'ICMS perde força'}</div></div>
      <div class="bs"><div class="bs-year">2032</div><div class="bs-pct">40<span style="font-size:.9rem">%</span></div><div class="bs-label" data-e>Quarta redução</div><div class="bs-desc" data-e>Véspera do regime final</div></div>
    </div>
    <div class="nb" data-e><div class="nb-label">Nota técnica</div>${isServico
      ? 'Todo o mapa foi elaborado em conformidade com a <strong>Lei Complementar 214</strong>. O <strong>ISS</strong> terá redução progressiva de <strong>10% em 2029, 20% em 2030, 30% em 2031 e 40% em 2032</strong>, sendo substituído integralmente pelo <strong>IBS em 2033</strong> com alíquota plena de <strong>' + fmtPct(d.aliquotas.ibsEstadual + d.aliquotas.ibsMunicipal) + '</strong>.'
      : 'Todo o mapa foi elaborado em conformidade com a <strong>Lei Complementar 214</strong>. Os benefícios do <strong>Convênio 52/91</strong> terão redução progressiva: <strong>10% em 2029, 20% em 2030, 30% em 2031 e 40% em 2032</strong>.'
    }</div>
  </div>
</div>
</section>

<div class="divider"></div>

<!-- ── BENEFÍCIOS ── -->
<section id="beneficios">
<div class="container">
  <div class="reveal"><div class="eyebrow">06 · Oportunidades com a Reforma</div>
  <h2 class="section-title ruled" data-e>O que a Reforma traz de <span style="color:var(--g)">positivo</span></h2>
  <p class="section-sub" data-e>A transição eleva custos, mas também moderniza o sistema. Entender os benefícios é parte essencial do planejamento tributário para os próximos sete anos.</p></div>
  <div class="cg c3" style="margin-top:36px;">
    <div class="card cg-border reveal d1">
      <div class="cl">Crédito pleno</div>
      <div style="font-size:.88rem;font-weight:700;margin-bottom:8px;">Não-cumulatividade total</div>
      <div class="cd">CBS e IBS permitem crédito sobre qualquer aquisição — insumos, serviços e ativo imobilizado. A cadeia toda vira crédito e reduz a base tributável.</div>
    </div>
    <div class="card reveal d2">
      <div class="cl cl-c">Simplificação</div>
      <div style="font-size:.88rem;font-weight:700;margin-bottom:8px;">5 tributos → 3</div>
      <div class="cd">ICMS, ISS, PIS e COFINS se tornam CBS e IBS. O IPI é mantido em casos específicos. Uma guia, um prazo e a alíquota exata visível em cada nota fiscal.</div>
    </div>
    <div class="card reveal d3">
      <div class="cl">Previsibilidade</div>
      <div style="font-size:.88rem;font-weight:700;margin-bottom:8px;">Curva conhecida até 2033</div>
      <div class="cd">A transição é pública e gradual. Isso permite planejar preço, margem, créditos e fluxo de caixa antes que o aumento chegue.</div>
    </div>
  </div>
  ${isServico
    ? `<div class="nb reveal" style="margin-top:24px;" data-e><div class="nb-label">Para prestadores de serviços</div>O ISS tinha mais de 5.570 alíquotas municipais distintas. O IBS substitui tudo por uma alíquota única nacional, com crédito pleno sobre serviços contratados — algo inexistente no regime atual.</div>`
    : `<div class="nb reveal" style="margin-top:24px;" data-e><div class="nb-label">Para comércio e indústria</div>O novo regime elimina o efeito cascata do ICMS, que incidia múltiplas vezes sobre o mesmo bem ao longo da cadeia. Com o IBS, cada elo da cadeia paga somente sobre o valor que adicionou.</div>`
  }
</div>
</section>

${d.observacoes ? `
<div class="divider"></div>
<section id="notas" style="background:var(--s1);">
<div class="container">
  <div class="reveal"><div class="eyebrow">Nota da Auditora</div>
  <h2 class="section-title ruled" data-e style="font-size:1.4rem;">Observações técnicas desta análise</h2></div>
  <div class="reveal" data-e style="margin-top:24px;background:#0f180f;border:1px solid #1e3a1e;border-radius:12px;padding:24px 28px;font-size:.88rem;color:#ccc;line-height:1.75;max-width:720px;">
    ${d.observacoes.split('\n').map((l) => '<p style="margin-bottom:6px;">' + (l.trim() || '&nbsp;') + '</p>').join('')}
  </div>
</div>
</section>` : ''}

<div class="divider"></div>

<!-- ── CTA ── -->
<section id="cta">
<div class="container">
  <div class="reveal">
    <div class="eyebrow" style="justify-content:center;display:flex;">O que fazer com este mapa</div>
    <h2 class="cta-hl" data-e>Você tem <span style="color:var(--g)">sete anos</span> para se preparar.<br>O custo de esperar é <span style="color:var(--g)">R$ ${Math.round(deltaR/1000)}k/ano.</span></h2>
    <p class="cta-sub" data-e>${d.textoFechamento || `A Reforma é gradual e previsível: a carga da ${d.empresa} sobe de ${fmtPct(first.carga)} para ${fmtPct(last.carga)} até ${last.ano}, com o salto maior no último ano. Conhecer essa curva agora permite planejar preço, margem, créditos e fluxo de caixa antes que o aumento chegue. A Planning acompanha cada etapa da transição com você.`}</p>
  </div>
  <div class="footer-line"></div>
  <div class="footer-txt"><strong style="color:#fff;">Mapa da Reforma Tributária · ${d.empresa}</strong><br>Elaboração: Planning · ${d.referencia} · Confidencial · Base: LC 214</div>
</div>
</section>

<script>
// Tabs
function tab(g,p,btn){
  document.querySelectorAll('[id^="'+g+'-"]').forEach(el=>el.classList.remove('active'));
  document.getElementById(g+'-'+p).classList.add('active');
  btn.closest('.tabs-header').querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(p==='grafico'&&g==='evo'&&!window.cLine) initLine();
  if(p==='grafico'&&g==='comp'&&!window.cBar) initBar();
}

// Scroll progress + nav active
window.addEventListener('scroll',()=>{
  const h=document.documentElement;
  document.getElementById('pl').style.width=(h.scrollTop/(h.scrollHeight-h.clientHeight)*100)+'%';
  ['premissas','impacto','evolucao','composicao','legal','beneficios','notas','cta'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&el.getBoundingClientRect().top<=80)
      document.querySelectorAll('.nav-link').forEach(l=>l.classList.toggle('active',l.getAttribute('href')==='#'+id));
  });
  // bars
  const imp=document.getElementById('impacto');
  if(imp&&imp.getBoundingClientRect().top<window.innerHeight*.8)
    document.querySelectorAll('.bar-fill').forEach(b=>{if(!b._done){b.style.width=b.dataset.w+'%';b._done=1;}});
});

// Reveal
new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible');}),{threshold:.1})
  .observe=((orig)=>function(el){orig.call(this,el);})(IntersectionObserver.prototype.observe);
const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible');}),{threshold:.1});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

// Charts
const anos=${chartLabels},cargas=${chartCargas},desemb=${chartDesembolso};
function initLine(){
  window.cLine=new Chart(document.getElementById('chartLine').getContext('2d'),{type:'line',
    data:{labels:anos,datasets:[{label:'Carga efetiva (%)',data:cargas,borderColor:'#5FB77F',backgroundColor:'rgba(95,183,127,.07)',fill:true,tension:.35,
      pointBackgroundColor:cargas.map((_,i)=>i===cargas.length-1?'#4EBED8':'#5FB77F'),
      pointRadius:cargas.map((_,i)=>i===cargas.length-1?8:4),pointBorderWidth:0}]},
    options:{responsive:true,animation:{duration:900},
      plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c1c1c',borderColor:'#333',borderWidth:1,
        callbacks:{label:c=>' Carga: '+c.parsed.y.toFixed(2)+'%',afterLabel:c=>' Desembolso: R$ '+desemb[c.dataIndex].toLocaleString('pt-BR')}}},
      scales:{x:{ticks:{color:'#666',font:{size:11}},grid:{color:'#1a1a1a'}},
              y:{min:${Math.floor(first.carga * 100 - 0.5)},ticks:{color:'#666',font:{size:11},callback:v=>v+'%'},grid:{color:'#1a1a1a'}}}}});
}
function initBar(){
  const colors=desemb.map((_,i)=>i===desemb.length-1?'#5FB77F':'#4EBED8');
  window.cBar=new Chart(document.getElementById('chartBar').getContext('2d'),{type:'bar',
    data:{labels:anos,datasets:[{label:'Total impostos a pagar (R$)',data:desemb,backgroundColor:colors,borderRadius:4}]},
    options:{responsive:true,animation:{duration:900},
      plugins:{legend:{display:false},
        tooltip:{backgroundColor:'#1c1c1c',borderColor:'#333',borderWidth:1,
          callbacks:{label:c=>'R$ '+c.parsed.y.toLocaleString('pt-BR')}}},
      scales:{x:{ticks:{color:'#666',font:{size:11}},grid:{color:'#1a1a1a'}},
              y:{ticks:{color:'#666',font:{size:11},callback:v=>'R$ '+(v/1000).toFixed(0)+'k'},grid:{color:'#1a1a1a'}}}}});
}
window.addEventListener('load',()=>setTimeout(initBar,100));

// Edit mode
function enableEdit(){
  document.body.classList.add('edit-mode');
  document.querySelectorAll('[data-e]').forEach(function(el){
    el.contentEditable='true';
    el.spellcheck=false;
  });
}
function exitEdit(){
  document.body.classList.remove('edit-mode');
  document.querySelectorAll('[data-e]').forEach(function(el){
    el.removeAttribute('contenteditable');
  });
  var btn=document.getElementById('editToggleBtn');
  if(btn) btn.textContent='✏ Editar';
  window.parent.postMessage({type:'reforma-exit-edit-confirm'},'*');
}
function toggleEditMode(){
  var btn=document.getElementById('editToggleBtn');
  if(document.body.classList.contains('edit-mode')){
    exitEdit();
  } else {
    enableEdit();
    if(btn) btn.textContent='✓ Sair da edição';
  }
}
function downloadEdited(){
  var was=document.body.classList.contains('edit-mode');
  if(was){
    document.body.classList.remove('edit-mode');
    document.querySelectorAll('[data-e]').forEach(function(el){el.removeAttribute('contenteditable');});
  }
  var html='<!DOCTYPE html>'+document.documentElement.outerHTML;
  if(was){
    document.body.classList.add('edit-mode');
    document.querySelectorAll('[data-e]').forEach(function(el){el.contentEditable='true';el.spellcheck=false;});
  }
  window.parent.postMessage({type:'reforma-download',html:html},'*');
}
window.addEventListener('message',function(e){
  if(!e.data) return;
  if(e.data.type==='reforma-enable-edit') enableEdit();
  if(e.data.type==='reforma-exit-edit') exitEdit();
});

// Print / PDF preparation
window.addEventListener('beforeprint',function(){
  // Show all hidden tab panels so charts and tables are visible
  var hidden=[];
  document.querySelectorAll('.tab-panel:not(.active)').forEach(function(p){
    p.style.display='block';
    hidden.push(p);
  });
  window._printHidden=hidden;
  // Force all reveal animations
  document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('visible');});
  // Animate bar fills
  document.querySelectorAll('.bar-fill').forEach(function(b){if(b.dataset.w)b.style.width=b.dataset.w+'%';});
  // Init charts that were lazy (now panels are visible so canvas has dimensions)
  if(!window.cLine) initLine();
  if(!window.cBar) initBar();
});
window.addEventListener('afterprint',function(){
  (window._printHidden||[]).forEach(function(p){p.style.display='';});
  window._printHidden=null;
});
<\/script>
</body>
</html>`;
}
