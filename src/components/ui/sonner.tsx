import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/*
 * O shadcn original lê o tema do next-themes, que este app não usa: o tema é a
 * classe `dark` no <html>, posta por lib/tema-compartilhado.ts (script do head
 * e botão de tema). Observar a classe mantém o toast no mesmo tema da tela,
 * inclusive quando a pessoa troca o tema com um toast aberto.
 */
function useTemaDoDocumento(): "dark" | "light" {
  const [tema, setTema] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const raiz = document.documentElement;
    const ler = () => setTema(raiz.classList.contains("dark") ? "dark" : "light");
    ler();
    const obs = new MutationObserver(ler);
    obs.observe(raiz, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return tema;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const tema = useTemaDoDocumento();
  return (
    <Sonner
      theme={tema}
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg group-[.toaster]:font-sans",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Ícone na cor do status; o texto continua em foreground (status nunca só por cor).
          success: "[&_[data-icon]]:text-success",
          warning: "[&_[data-icon]]:text-warning",
          error: "[&_[data-icon]]:text-danger",
          info: "[&_[data-icon]]:text-info",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
