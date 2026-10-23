// Confirmação antes de liberar ou marcar como pago (contrato docs/design/contratos/comissoes.md, Ações).
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function Confirmar({
  rotulo,
  titulo,
  texto,
  confirmar,
  aoConfirmar,
  desabilitado,
}: {
  rotulo: string;
  titulo: string;
  texto: ReactNode;
  confirmar: string;
  aoConfirmar: () => void;
  desabilitado?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={desabilitado}>{rotulo}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{texto}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={aoConfirmar}>{confirmar}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
