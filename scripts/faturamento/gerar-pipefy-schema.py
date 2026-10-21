"""Gera supabase/functions/faturamento-omie/pipefy-307098392.ts, o schema do pipe 307098392 (Contas a Receber) que o
conector usa para montar e validar as mutations do Pipefy.

Fonte: PM Work/execution/portal-faturamento-prd-20261013/e1/pipefy-307098392-schema.json (GraphQL lido em 20/10/2026,
só estrutura), com a "Mudança de 20/10" do mapa (e1/pipefy-307098392-mapa.md) aplicada aqui por código, porque o JSON
é de antes dela: CPF e CNPJ do cliente deixaram de ser obrigatórios no formulário, e a fase SOLICITAÇÃO ABERTA ganhou o
checklist obrigatório cpf_cnpj_do_cliente_conferido.

Uso: python3 -I scripts/faturamento/gerar-pipefy-schema.py [caminho do schema.json]
     depois: npx prettier --write supabase/functions/faturamento-omie/pipefy-307098392.ts (o lint do repo usa o prettier)
Se o pipe mudar, leia o schema de novo (e1) e rode este script; a lista de mudanças abaixo só vale até a próxima leitura.
"""
import json
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
PADRAO = RAIZ.parents[0] / "portal-faturamento-prd-20261013" / "e1" / "pipefy-307098392-schema.json"
SAIDA = RAIZ / "supabase" / "functions" / "faturamento-omie" / "pipefy-307098392.ts"

OPCAO_CONFERIDO = ("Conferido: o card tem o CPF (pessoa física) ou o CNPJ (pessoa jurídica) do cliente, "
                   "e o número está certo")
MUDANCAS = [
    "20/10/2026: cnpj_cliente_1 e cpf_do_cliente deixaram de ser obrigatórios no formulário (OK do Pedro).",
    "20/10/2026: SOLICITAÇÃO ABERTA ganhou cpf_cnpj_do_cliente_conferido (checklist_vertical, obrigatório), "
    "que o portal marca ao criar o card.",
]


def campo(f: dict) -> dict:
    c = {"label": f["label"], "tipo": f["type"], "obrigatorio": bool(f["required"])}
    if f.get("options"):
        c["opcoes"] = list(f["options"])
    repo = f.get("connectedRepo") or {}
    if f["type"] == "connector" and repo.get("id"):
        c["tabela"] = repo["id"]
    return c


def main():
    fonte = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else PADRAO
    d = json.loads(fonte.read_text())
    p = d["pipe"]
    inicio = {f["id"]: campo(f) for f in p["start_form_fields"]}
    for k in ("cnpj_cliente_1", "cpf_do_cliente"):
        inicio[k]["obrigatorio"] = False
    fases = {}
    for ph in p["phases"]:
        fases[ph["id"]] = {
            "nome": ph["name"],
            "concluida": bool(ph["done"]),
            "pode_ir_para": [x["id"] if isinstance(x, dict) else str(x) for x in (ph.get("cards_can_be_moved_to_phases") or [])],
            "campos": {f["id"]: campo(f) for f in (ph.get("fields") or [])},
        }
    aberta = fases["342815180"]["campos"]
    aberta["cpf_cnpj_do_cliente_conferido"] = {
        "label": "CPF/CNPJ do cliente conferido", "tipo": "checklist_vertical", "obrigatorio": True,
        "opcoes": [OPCAO_CONFERIDO]}
    obrig = sorted(k for k, v in inicio.items() if v["obrigatorio"])
    if len(obrig) != 17:
        raise SystemExit(f"esperava 17 obrigatórios no formulário depois da mudança de 20/10, vieram {len(obrig)}")
    t = d["tabela_colaboradores_1Vck_P6q"]
    pipe = {
        "id": p["id"], "uuid": p["uuid"], "organizacao": p["organizationId"], "fase_inicial": p["startFormPhaseId"],
        "lido_em": d["consultado_em"], "mudancas": MUDANCAS,
        "colaboradores": {"tabela": t["id"], "email": "e_mail_comercial"},
    }
    ts = (
        "// Gerado por scripts/faturamento/gerar-pipefy-schema.py a partir de\n"
        "// PM Work/execution/portal-faturamento-prd-20261013/e1/pipefy-307098392-schema.json, com a Mudança de 20/10.\n"
        "// Não edite à mão: leia o pipe de novo e rode o script.\n\n"
        "export type CampoPipefy = { label: string; tipo: string; obrigatorio: boolean; opcoes?: string[]; tabela?: string };\n"
        "export type FasePipefy = { nome: string; concluida: boolean; pode_ir_para: string[]; campos: Record<string, CampoPipefy> };\n\n"
        f"export const PIPE = {json.dumps(pipe, ensure_ascii=False, indent=2)} as const;\n\n"
        f"export const OPCAO_CONFERIDO = {json.dumps(OPCAO_CONFERIDO, ensure_ascii=False)};\n\n"
        f"export const CAMPOS_INICIO: Record<string, CampoPipefy> = {json.dumps(inicio, ensure_ascii=False, indent=2)};\n\n"
        f"export const FASES: Record<string, FasePipefy> = {json.dumps(fases, ensure_ascii=False, indent=2)};\n"
    )
    SAIDA.write_text(ts)
    print(json.dumps({"saida": str(SAIDA.relative_to(RAIZ)), "campos_inicio": len(inicio), "obrigatorios": len(obrig),
                      "fases": len(fases)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
