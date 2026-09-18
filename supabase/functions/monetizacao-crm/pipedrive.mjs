// Transporte comum ao runtime e à verificação operacional; credencial apenas por injeção.
export function pipedriveApi(PD) {
  async function pd(path, params = {}, payload, method = "POST") {
    const query = new URLSearchParams({ ...params, api_token: PD });
    const res = await fetch(`https://api.pipedrive.com/v1/${path}?${query}`, {
      method: payload ? method : "GET",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`Pipedrive HTTP ${res.status}`);
    const body = await res.json();
    if (!body.success) throw new Error("Pipedrive não confirmou a operação");
    return body;
  }
  async function copyFile(file, deal, name) {
    const response = await fetch(
      `https://api.pipedrive.com/v1/files/${file}/download?${new URLSearchParams({ api_token: PD })}`,
      { signal: AbortSignal.timeout(25000) },
    );
    if (!response.ok || !response.body) throw new Error("Arquivo de origem indisponível");
    const reader = response.body.getReader(),
      parts = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Arquivo excede 20 MB");
      }
      parts.push(chunk.value);
    }
    const form = new FormData();
    form.set("deal_id", String(deal));
    form.set(
      "file",
      new Blob(parts, { type: response.headers.get("content-type") || "application/octet-stream" }),
      name,
    );
    const uploaded = await fetch(
      `https://api.pipedrive.com/v1/files?${new URLSearchParams({ api_token: PD })}`,
      { method: "POST", body: form, signal: AbortSignal.timeout(25000) },
    );
    if (!uploaded.ok) throw new Error("Upload de arquivo não confirmado");
    const body = await uploaded.json();
    if (!body.success || !body.data?.id) throw new Error("Upload de arquivo não confirmado");
    return body.data;
  }
  async function pages(path, params = {}) {
    const rows = [];
    let start = 0;
    for (let page = 0; page < 100; page++) {
      const body = await pd(path, { ...params, start, limit: 500 });
      if (body.data && !Array.isArray(body.data))
        throw new Error("Formato inesperado da paginação do CRM");
      rows.push(...(body.data || []));
      const pagination = body.additional_data?.pagination;
      if (!pagination?.more_items_in_collection) return rows;
      const next = Number(pagination.next_start);
      if (!Number.isFinite(next) || next <= start) throw new Error("Paginação do CRM não avançou");
      start = next;
    }
    throw new Error("CRM excedeu o limite de paginação. Carga anterior preservada.");
  }

  return { pd, pages, copyFile };
}
