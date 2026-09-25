# Contrato · Reforma Tributária (`/reforma-tributaria`)

**Dono de produto:** a confirmar (consultoria); casca do Eliezek   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). O parser do `.xlsx`, o gerador de HTML e o cálculo da apresentação não mudam.

## Propósito
- **Pergunta (N1):** "Quanto a reforma muda a carga deste cliente, e como mostro isso a ele?"
- **Público:** consultor, que monta a apresentação para o cliente.
- **Ação:** carregar a simulação, conferir os números e baixar a apresentação (HTML ou PDF).
- **Arquétipo:** Ficha (um cliente, uma simulação), com a prévia ao lado.
- **Universo (`descricao`):** "Simulação de um cliente · 2026–2033 · dados do arquivo ou digitados; nada é gravado no banco".

## Correções de exibição
1. O `PageHeader` sobe para o topo da página, em largura cheia (hoje fica dentro da coluna de 420px). O selo "Confidencial" vai para `acoes` como `StatusBadge tom="atencao"`.
2. "Limpar arquivo" descarta tudo sem perguntar: passa a `AlertDialog` ("Descartar a simulação carregada?") e o botão ganha `aria-label`.
3. Campo numérico vazio aparecia como 0, e 0 como vazio: o campo mostra o valor digitado, inclusive 0, e o vazio fica vazio (o cálculo segue tratando vazio como 0, como hoje).
4. Na prévia, diferença negativa aparecia "+R$ -X": o sinal sai do número.
5. Upload e erro de leitura: `EstadoErro` com o motivo, além do toast.

## O que NÃO entra
O HTML gerado (tem cor e fonte próprias, é material impresso, fora do lint); a busca automática de CNPJ na BrasilAPI (continua como está: dispara ao completar 14 dígitos).

## Para onde manda
Nenhum destino de negócio.

## Achado para o dono
Com diferença negativa (a carga ou o imposto caem), o sinal agora sai certo, mas o texto em volta do número no HTML gerado fica contraditório: "Acréscimo de −X pontos percentuais" e "Queda de −R$ X no resultado simulado". O texto do HTML está fora do escopo desta migração; a frase precisa mudar conforme o sentido da diferença (decisão do dono do material).
