// Componentes Planning: a camada de produto sobre os primitivos de ui/.
// Regras de uso: docs/design/DESIGN.md e docs/design/ARQUETIPOS.md.
export { PageHeader, Secao } from "./page-header";
export { KpiCard, KpiGrade, type EstadoKpi, type KpiCardProps } from "./kpi-card";
export { StatusBadge, type TomStatus } from "./status-badge";
export { EstadoVazio, EstadoErro, EstadoSemAcesso, Carregando } from "./estados";
export { Procedencia, formatarQuando } from "./procedencia";
export { Degrau, AnelArea, GradeCirculos, Filete } from "./grafismos";
export { BarraFiltros, ChipFiltro } from "./barra-filtros";
