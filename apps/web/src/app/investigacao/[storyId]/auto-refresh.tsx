"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A Investigação roda AFK, fora da request: nada empurra o resultado para esta
 * tela. Enquanto o turno não termina, ela se recarrega sozinha — o Operador que
 * voltou olhar não precisa dar F5. (O push ao vivo é assunto da UI de sessão.)
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
