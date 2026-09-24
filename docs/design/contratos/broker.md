# Contrato · Broker (`/broker` e `/broker/admin`)

**Dono de produto:** Eliezek (Broker)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Saldo, preço, multiplicador, CAC e permissões (`manage.broker`) não mudam.

## `/broker` · Oportunidades (Fila de trabalho)
- **Pergunta:** "Que oportunidade eu pego agora, e quanto de CashBrain ela custa?"
- **Universo:** "Fila da rede · saldo da unidade em CashBrain (CB)".
- Números: Disponível (saldo CB; nota crédito recebido e comprado) · Reservado (CB bloqueado · {n} clientes) · Investido. Cards crus → `KpiCard`.
- Ação principal: **Reservar** (diálogo já diz quanto bloqueia). **[apresentação]** Com saldo menor que o preço, o botão fica desabilitado com o motivo "saldo insuficiente" (hoje o erro só volta do servidor). A regra de saldo continua no servidor.
- Busca na URL. Estados já completos; passam para os componentes do DS.

## `/broker/admin` · Matriz (Configuração + Lista)
- **Pergunta:** "Quanto a rede tem a comprar, reservou e deve de CAC?"
- **N11:** "Reservado" lá é contagem e aqui era valor; os rótulos passam a "Reservadas (oportunidades)" na Matriz e "Reservado (CB)" na unidade. "Valor disponível" passa a "Valor da fila (soma dos preços)".
- **N7:** as 6 abas internas vão para `?aba=`.
- **Confirmação (V6):** "Liberar" oportunidade e "Dar baixa" na fatura (credita saldo) pedem `AlertDialog` com o efeito e o valor. Os diálogos que já avisam imutabilidade ficam.
- Status "matriz" em `violet` (V3-matiz) → `StatusBadge tom="neutro"`.
- Extrato de CAC truncado em 120 linhas: diz "mostrando 120 de N".
- Sem `manage.broker`: selo "Somente leitura" (já existe) e botões desabilitados com motivo, em vez de ocultos (N8).
