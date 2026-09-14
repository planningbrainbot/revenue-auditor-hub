/**
 * Tema compartilhado entre Ops, Growth e Financeiro.
 *
 * O problema que isto resolve: cada produto guardava a preferência com a sua
 * própria chave, o seu próprio vocabulário e o seu próprio padrão. O Ops usava
 * `planning-theme` com claro/escuro/automático (e o automático seguia o
 * relógio: claro das 6h às 18h), o Growth usava `pb:tema` com "claro" ou
 * ausência, e o Financeiro usava `theme` com dark/light. Resultado: quem
 * trabalhava no escuro do Growth e clicava em Ops às 10h da manhã tomava uma
 * tela branca na cara. Três produtos, três verdades.
 *
 * Agora a verdade é uma só:
 *
 * - **chave** `pb:tema`, a mesma nos três;
 * - **valores** `escuro` | `claro` | `auto`;
 * - **padrão** escuro, quando ninguém escolheu nada;
 * - **cookie** no domínio raiz além do localStorage, porque o Growth também
 *   atende em growth.planningbrain.com.br, que é outra origem e portanto outro
 *   localStorage. O cookie atravessa; o localStorage não.
 *
 * Cada app aplica AS DUAS convenções de CSS ao mesmo tempo (a classe `.dark`
 * que o Ops e o Financeiro usam, e o atributo `data-theme` do Growth), porque
 * unificar as folhas de estilo é outro trabalho — e sem isso a preferência
 * viajaria sem ter efeito no destino.
 */

export type Tema = "escuro" | "claro";
export type ModoTema = Tema | "auto";

export const CHAVE_TEMA = "pb:tema";
export const COOKIE_TEMA = "pb_tema";
const DOMINIO_COOKIE = ".planningbrain.com.br";
const ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

/** Horário considerado "dia" no modo automático, que segue opcional. */
const DIA_INICIO_HORA = 6;
const DIA_FIM_HORA = 18;

export function temaPeloRelogio(): Tema {
  const hora = new Date().getHours();
  return hora >= DIA_INICIO_HORA && hora < DIA_FIM_HORA ? "claro" : "escuro";
}

function lerCookie(nome: string): string | null {
  if (typeof document === "undefined") return null;
  const alvo = `${nome}=`;
  for (const parte of document.cookie.split("; ")) {
    if (parte.startsWith(alvo)) return decodeURIComponent(parte.slice(alvo.length));
  }
  return null;
}

/** Cookie primeiro: é ele que atravessa subdomínio. */
export function lerModo(): ModoTema {
  const bruto = lerCookie(COOKIE_TEMA) ?? safeLocal();
  if (bruto === "claro" || bruto === "escuro" || bruto === "auto") return bruto;
  return "escuro";
}

function safeLocal(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_TEMA);
  } catch {
    // Aba anônima e storage bloqueado estouram aqui. Perder a persistência é
    // degradação aceitável; quebrar a tela não é.
    return null;
  }
}

export function gravarModo(modo: ModoTema) {
  try {
    window.localStorage.setItem(CHAVE_TEMA, modo);
  } catch {
    /* sem persistência local, o cookie abaixo ainda resolve */
  }
  if (typeof document !== "undefined") {
    const dominio = window.location.hostname.endsWith("planningbrain.com.br")
      ? `; domain=${DOMINIO_COOKIE}`
      : "";
    document.cookie = `${COOKIE_TEMA}=${modo}; path=/${dominio}; max-age=${ANO_EM_SEGUNDOS}; samesite=lax`;
  }
}

export function aplicarTema(tema: Tema) {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  raiz.classList.toggle("dark", tema === "escuro");
  raiz.setAttribute("data-theme", tema);
}

/**
 * Script síncrono para o <head>, antes de qualquer pintura.
 *
 * Sem ele o HTML chega no tema errado e o React corrige depois da hidratação:
 * quem está no claro vê um lampejo preto de tela cheia a cada navegação. Vai
 * como string porque precisa rodar antes do bundle.
 */
export const SCRIPT_TEMA_COMPARTILHADO = `(function(){try{
var c=document.cookie.match(/(?:^|; )pb_tema=([^;]*)/);
var m=c?decodeURIComponent(c[1]):null;
if(!m){try{m=localStorage.getItem('pb:tema');}catch(e){}}
if(m!=='claro'&&m!=='escuro'&&m!=='auto'){m='escuro';}
var t=m;
if(m==='auto'){var h=new Date().getHours();t=(h>=6&&h<18)?'claro':'escuro';}
var r=document.documentElement;
if(t==='escuro'){r.classList.add('dark');}else{r.classList.remove('dark');}
r.setAttribute('data-theme',t);
}catch(e){}})();`;
