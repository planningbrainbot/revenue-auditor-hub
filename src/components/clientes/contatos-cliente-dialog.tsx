import { useEffect, useState } from "react";
import { Mail, Phone, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Contatos vêm da database Pipefy "[PTRS-DB-03] Stakeholder" (307173446),
// espelhada em public.contatos (migration 21). O vínculo com o cliente é o
// connector "Empresa" do Pipefy: contatos.empresa_pipefy_record_id ->
// empresas.pipefy_record_id, já resolvido pro empresa_id no sync.
export type Contato = {
  id: number;
  nome_completo: string | null;
  cpf: string | null;
  email: string | null;
  whatsapp: string | null;
  cargo: string | null;
};

export type ClienteSelecionado = {
  id: number;
  nome: string;
  unidade: string | null;
};

function fmtWhatsapp(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) {
    return local.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  if (local.length === 10) {
    return local.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  return v;
}

function whatsappHref(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
}

export function ContatosClienteDialog({
  cliente,
  onOpenChange,
}: {
  cliente: ClienteSelecionado | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!cliente) return;
    let mounted = true;
    setLoading(true);
    setErro(null);
    setContatos([]);
    (async () => {
      const { data, error } = await supabase
        .from("contatos")
        .select("id,nome_completo,cpf,email,whatsapp,cargo")
        .eq("empresa_id", cliente.id)
        .order("nome_completo", { ascending: true });
      if (!mounted) return;
      if (error) setErro(error.message);
      else setContatos((data ?? []) as Contato[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [cliente]);

  return (
    <Dialog open={!!cliente} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Contatos — {cliente?.nome}
            {cliente?.unidade && (
              <Badge variant="secondary" className="font-normal">
                {cliente.unidade}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}

        {!loading && erro && (
          <p className="py-6 text-center text-sm text-destructive">
            Erro ao carregar contatos: {erro}
          </p>
        )}

        {!loading && !erro && contatos.length === 0 && (
          <div className="space-y-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum contato vinculado a este cliente.
            </p>
            <p className="text-xs text-muted-foreground">
              Contatos são cadastrados na database "Stakeholder" do Pipefy, com o campo "Empresa"
              apontando para o cliente.
            </p>
          </div>
        )}

        {!loading && !erro && contatos.length > 0 && (
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            {contatos.map((c) => {
              const zap = whatsappHref(c.whatsapp);
              return (
                <div key={c.id} className="rounded-md border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{c.nome_completo || "Sem nome"}</span>
                    {c.cargo && (
                      <Badge variant="outline" className="font-normal">
                        {c.cargo}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 pl-[22px] text-sm">
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {c.email}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        sem e-mail
                      </span>
                    )}
                    {c.whatsapp ? (
                      zap ? (
                        <a
                          href={zap}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {fmtWhatsapp(c.whatsapp)}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {fmtWhatsapp(c.whatsapp)}
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        sem WhatsApp
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
