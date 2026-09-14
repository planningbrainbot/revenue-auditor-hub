import { useTheme } from "@/hooks/use-theme";

export function PlanningLogo({ className = "h-8 w-auto" }: { className?: string }) {
  const { theme } = useTheme();
  const src = theme === "escuro" ? "/brand/planning-logo-white.svg" : "/brand/planning-logo-dark.svg";
  return <img src={src} alt="Planning" className={className} />;
}
