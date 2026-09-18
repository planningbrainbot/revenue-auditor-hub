// Conteúdo comercial associado à conta. Nunca copia valores da venda anterior.
import { hasCanonicalProduct } from "./send.mjs";
export const numberId = (v) => Number(typeof v === "object" ? (v?.id ?? v?.value) : v) || null;
export const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export const plainText = (v) =>
  String(v ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_all, href, label) =>
        `${label}${safeLink(href.replace(/&amp;/g, "&")) ? ` (${safeLink(href.replace(/&amp;/g, "&"))})` : ""}`,
    )
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const phone = (v) => String(v ?? "").replace(/\D/g, "");
const present = (v) => v !== null && v !== undefined && v !== "";
export function safeLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !/api_token|access_token|service_role/i.test(u.search)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
const link = (url, label) =>
  safeLink(url)
    ? `<a href="${escapeHtml(safeLink(url))}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
const line = (name, value) =>
  `<p><strong>${escapeHtml(name)}:</strong> ${escapeHtml(present(value) ? value : "Não informado")}</p>`;
export function samePerson(person, contact) {
  const emails = (person.email || []).map((x) => norm(x.value));
  const phones = (person.phone || []).map((x) => phone(x.value));
  return !!(
    (contact.email && emails.includes(norm(contact.email))) ||
    (phone(contact.phone).length >= 10 && phones.includes(phone(contact.phone)))
  );
}
export function qualificationFields(fields, account, review = {}, source = {}, cnpjs = []) {
  const result = {};
  const names = {
    "faturamento anual": review.band || (!account.band_conflict && account.band),
    "qual e o regime tributario da sua empresa?":
      review.regime || (!account.regime_conflict && account.regime),
    "segmento - geral": review.segment || (!account.segment_conflict && account.segment),
    "unidade de negocio": account.unit_label,
  };
  for (const f of fields) {
    const n = norm(f.name),
      value = names[n];
    if (value) {
      const option = (f.options || []).find((o) => norm(o.label) === norm(value));
      if (option) result[f.key] = option.id;
    }
    // Só estes atributos reutilizam a qualificação original. Nunca value, receita ou data prevista.
    if (["sua empresa utiliza um erp?", "erp do cliente"].includes(n) && present(source[f.key])) {
      const values = String(source[f.key]).split(",");
      if (values.every((v) => (f.options || []).some((o) => String(o.id) === v)))
        result[f.key] = source[f.key];
    }
    if (/^cnpj(?: \d+)?$/.test(n)) {
      const index = n === "cnpj" ? 0 : Number(n.slice(5)) - 1;
      const c = cnpjs[index];
      if (/^\d{14}$/.test(c || "")) result[f.key] = f.field_type === "double" ? Number(c) : c;
    }
  }
  return result;
}
export function dossierNote(ctx, people, sourceDeals, warnings = []) {
  const a = ctx.account,
    r = ctx.review || {},
    d = ctx.detail || {};
  const product = { cella: "Cella", finance: "Finance", consultoria: "Consultoria" }[ctx.product];
  const marker = `[PB:${ctx.nonce}:dossier]`;
  return (
    `<h2>Preparação comercial · ${escapeHtml(product)}</h2><p>${marker}</p>` +
    line("Empresa", a.name) +
    line("CNPJ(s)", (ctx.cnpjs || []).join(" · ")) +
    line("Unidade", a.unit_label) +
    line("Faturamento anual cadastrado", r.band || a.band) +
    line("Regime tributário", r.regime || a.regime) +
    line("Segmento", r.segment || a.segment) +
    (a.driva?.group_revenue_band
      ? line("Estimativa Driva do grupo — não é faturamento declarado", a.driva.group_revenue_band)
      : "") +
    line(
      "Origem da carteira",
      a.base_origin?.reason || a.consultoria_origin?.reason || "Conferir na base de clientes",
    ) +
    line("Demanda / tese", r.demand) +
    line("Observação da lista", r.note) +
    line(
      "ECD",
      d.ecd_summary?.available
        ? `Registro disponível${d.ecd_summary.exercise ? " · " + d.ecd_summary.exercise : ""}. Consultar pela base de clientes.`
        : "Sem registro vinculado; não significa ausência de entrega.",
    ) +
    "<h3>Contatos</h3>" +
    (people.length
      ? people
          .map(
            (p) =>
              `<p>${link(`https://grupoplanning.pipedrive.com/person/${p.id}`, p.name)}${p.role ? " · " + escapeHtml(p.role) : ""}<br>${escapeHtml(
                (p.email || [])
                  .map((x) => x.value)
                  .filter(Boolean)
                  .join(" · "),
              )}<br>${escapeHtml(
                (p.phone || [])
                  .map((x) => x.value)
                  .filter(Boolean)
                  .join(" · "),
              )}</p>`,
          )
          .join("")
      : "<p>Nenhuma pessoa identificada. Solicitar indicação ao sócio da unidade.</p>") +
    (ctx.channels || []).map((c) => line(`${c.type} · ${c.source}`, c.value)).join("") +
    "<h3>Negócios de origem</h3>" +
    sourceDeals
      .map(
        (s) =>
          `<p>${link(`https://grupoplanning.pipedrive.com/deal/${s.id}`, s.title)} · ${escapeHtml(s.status)} · ${escapeHtml(s.add_time)}</p>`,
      )
      .join("") +
    "<h3>Documentos da base</h3>" +
    ((ctx.documents || []).length
      ? ctx.documents
          .map((d) => `<p>${link(d.url, d.title)} · ${escapeHtml(d.source)}</p>`)
          .join("")
      : "<p>Nenhum documento externo vinculado.</p>") +
    (warnings.length
      ? "<h3>Pendências</h3>" + warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join("")
      : "") +
    `<p>Preparado pelo Planning Brain em ${escapeHtml(new Date().toISOString())}. As notas e arquivos de origem identificados são trazidos para este negócio; dados ausentes continuam explícitos.</p>`
  );
}

// API e persistência injetadas permitem ensaiar falhas depois de efeitos remotos.
export async function fillHandoff(ctx, api) {
  const deadline = Date.now() + 45000;
  const warnings = [],
    errors = [],
    counts = { people: 0, notes: 0, files: 0, documents: (ctx.documents || []).length };
  const deal = (await api.pd(`deals/${ctx.deal_id}`)).data;
  if (numberId(deal.org_id) !== Number(ctx.org_id) || !hasCanonicalProduct(deal, ctx.product))
    throw new Error("O negócio mudou de empresa, produto ou funil. Conferir antes de completar.");
  const orgs = new Set([Number(ctx.org_id), ...(ctx.account.orgs || []).map(Number)]);
  const ids = [
    ...new Set(
      [ctx.account.pipedrive_contract_id, ...(ctx.contract_ids || [])]
        .map(Number)
        .filter((x) => x > 0 && x !== Number(ctx.deal_id)),
    ),
  ];
  const sourceDeals = [];
  for (const id of ids) {
    try {
      const source = (await api.pd(`deals/${id}`)).data;
      if (!orgs.has(numberId(source.org_id))) {
        warnings.push(`Negócio ${id} não pertence às organizações conciliadas; não copiado.`);
        continue;
      }
      sourceDeals.push(source);
    } catch {
      errors.push(`Não foi possível ler o negócio de origem ${id}.`);
    }
  }
  const targetNotes = await api.pages("notes", { deal_id: ctx.deal_id });
  const note = async (marker, content, pinned = false) => {
    const found = targetNotes.find((n) => String(n.content).includes(marker));
    if (found) {
      if (pinned) await api.pd(`notes/${found.id}`, {}, { content }, "PUT");
      return found.id;
    }
    const n = (
      await api.pd(
        "notes",
        {},
        { deal_id: ctx.deal_id, content, pinned_to_deal_flag: pinned ? 1 : 0 },
      )
    ).data;
    targetNotes.push({ ...n, content });
    return n.id;
  };
  let people = [];
  if (ctx.contacts_allowed) {
    people = (await api.pages(`organizations/${ctx.org_id}/persons`)).filter(
      (p) => p.active_flag !== false && numberId(p.org_id) === Number(ctx.org_id),
    );
    for (const c of ctx.contacts || []) {
      if (!c.name?.trim() || (!c.email && phone(c.phone).length < 10)) continue;
      if (people.some((p) => samePerson(p, c))) continue;
      // Se a resposta ao POST se perder, a próxima tentativa relê as pessoas da organização.
      try {
        const p = (
          await api.pd(
            "persons",
            {},
            {
              name: c.name.trim(),
              org_id: Number(ctx.org_id),
              owner_id: numberId(deal.user_id),
              ...(c.email ? { email: [{ value: c.email, label: "work", primary: true }] } : {}),
              ...(c.phone ? { phone: [{ value: c.phone, label: "work", primary: true }] } : {}),
            },
          )
        ).data;
        people.push({ ...p, role: c.role });
      } catch {
        errors.push("Um contato não pôde ser confirmado no CRM.");
        break;
      }
    }
    const preferred = sourceDeals
      .map((s) => numberId(s.person_id))
      .find((id) => people.some((p) => p.id === id));
    const primary = numberId(deal.person_id) || preferred || people[0]?.id;
    if (primary && !numberId(deal.person_id))
      await api.pd(`deals/${ctx.deal_id}`, {}, { person_id: primary }, "PUT");
    const participants = await api.pages(`deals/${ctx.deal_id}/participants`);
    for (const person of people) {
      if (person.id === primary || participants.some((p) => numberId(p.person_id) === person.id))
        continue;
      try {
        await api.pd(`deals/${ctx.deal_id}/participants`, {}, { person_id: person.id });
      } catch {
        errors.push(`Não foi possível vincular o participante ${person.id}.`);
      }
    }
  } else
    warnings.push("Contatos não copiados: o autor do envio não possui acesso à base de contatos.");
  counts.people = people.length;
  const fields = await api.pages("dealFields");
  const attributes = qualificationFields(
    fields,
    ctx.account,
    ctx.review,
    sourceDeals[0] || {},
    ctx.cnpjs,
  );
  const missing = Object.fromEntries(Object.entries(attributes).filter(([k]) => !present(deal[k])));
  if (Object.keys(missing).length) await api.pd(`deals/${ctx.deal_id}`, {}, missing, "PUT");
  // Uma ficha utilizável fica disponível antes das cópias complementares.
  await note(`[PB:${ctx.nonce}:dossier]`, dossierNote(ctx, people, sourceDeals, warnings), true);
  const targetFiles = await api.pages(`deals/${ctx.deal_id}/files`);
  const historySources = [
    ...sourceDeals.map((s) => ({ ...s, kind: "deal" })),
    { id: Number(ctx.org_id), title: ctx.account.name, kind: "organization" },
  ];
  for (const source of historySources) {
    const sourceUrl = `https://grupoplanning.pipedrive.com/${source.kind}/${source.id}`;
    try {
      const notes = await api.pages(
        "notes",
        source.kind === "deal" ? { deal_id: source.id } : { org_id: source.id },
      );
      for (const n of notes) {
        if (source.kind === "organization" && n.deal_id) continue;
        if (Date.now() > deadline) {
          errors.push("Histórico ainda em processamento; retomar preenchimento.");
          break;
        }
        if (String(n.content).includes("[PB:")) continue;
        const content = plainText(n.content),
          chunks = content.match(/[\s\S]{1,12000}/g) || [""];
        for (let i = 0; i < chunks.length; i++) {
          const marker = `[PB:${ctx.nonce}:note:${n.id}:${i}]`;
          await note(
            marker,
            `<h3>Histórico · ${escapeHtml(source.title)}</h3><p>${marker} · ${escapeHtml(n.add_time)} · ${escapeHtml(n.user?.name || n.user_id?.name || "")}</p><p>${link(sourceUrl, "Abrir origem")}</p><p>${escapeHtml(chunks[i]).replace(/\n/g, "<br>")}</p>`,
          );
        }
        counts.notes++;
      }
    } catch {
      errors.push(`Notas do negócio ${source.id} parcialmente copiadas; retomar preenchimento.`);
    }
    try {
      const files = await api.pages(
        `${source.kind === "deal" ? "deals" : "organizations"}/${source.id}/files`,
      );
      for (const f of files.filter(
        (f) =>
          f.active_flag !== false &&
          (source.kind === "deal"
            ? Number(f.deal_id) === Number(source.id)
            : !f.deal_id && Number(f.org_id) === Number(source.id)),
      )) {
        if (Date.now() > deadline) {
          errors.push("Arquivos ainda em processamento; retomar preenchimento.");
          break;
        }
        const filename =
          `PB-${ctx.nonce}-${f.id}-${String(f.name || f.file_name || "arquivo").replace(/[\\/\r\n]/g, "_")}`.slice(
            0,
            220,
          );
        if (targetFiles.some((t) => t.name === filename || t.file_name === filename)) {
          counts.files++;
          continue;
        }
        if (Number(f.file_size) > 20 * 1024 * 1024) {
          const marker = `[PB:${ctx.nonce}:file-link:${f.id}]`;
          await note(
            marker,
            `<p>${marker}</p><p>Arquivo acima de 20 MB: ${escapeHtml(f.name || f.file_name)}. ${link(sourceUrl, "Abrir arquivo na origem")}.</p>`,
          );
          warnings.push(`Arquivo ${f.id} acima de 20 MB: referência preservada na nota.`);
          continue;
        }
        try {
          const created = await api.copyFile(f.id, ctx.deal_id, filename);
          targetFiles.push({ ...created, name: filename });
          counts.files++;
        } catch {
          errors.push(
            `Arquivo ${f.id} não confirmado. Original preservado no negócio ${source.id}.`,
          );
        }
      }
    } catch {
      errors.push(`Arquivos do negócio ${source.id} não puderam ser listados.`);
    }
  }
  const verified = (await api.pd(`deals/${ctx.deal_id}`)).data;
  if (people.length && !numberId(verified.person_id))
    errors.push("Contato principal não confirmado no negócio.");
  const report = {
    status: errors.length ? "partial" : "complete",
    ...counts,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
  await note(
    `[PB:${ctx.nonce}:dossier]`,
    dossierNote(ctx, people, sourceDeals, [...warnings, ...errors]),
    true,
  );
  return report;
}
