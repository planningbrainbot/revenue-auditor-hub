import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { partesDoLink, primeiraTelaAcessivel } from "@/lib/areas";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * O que uma página mostra para quem não tem a área dela.
 *
 * Existe porque o comportamento anterior era pior do que negar acesso: a página
 * tentava carregar, as consultas voltavam vazias ou estouravam, e a pessoa via
 * "Esta página não carregou" — que parece defeito do sistema, não falta de
 * permissão. Aconteceu em 22/09/2026 com quem tem só Planning People e caiu em
 * `/rede-overview`.
 *
 * A diferença prática: aqui a pessoa entende o que houve e tem para onde ir.
 */
export function SemAcessoArea({ area }: { area: string }) {
  const { temArea, can } = usePermissions();
  const url = primeiraTelaAcessivel(temArea, can);
  const destino = url ? partesDoLink(url) : null;

  return (
    <div className="p-4 md:p-6">
      <Card className="flex max-w-xl items-start gap-3 p-6">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="space-y-3">
          <div>
            <div className="font-medium">Esta página é da área {area}.</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Seu acesso não inclui essa área. Se você precisa dela para trabalhar, peça a quem
              administra os acessos.
            </p>
          </div>
          {destino ? (
            <Button asChild size="sm">
              <Link to={destino.to} search={destino.search}>
                Ir para a sua primeira tela
              </Link>
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
