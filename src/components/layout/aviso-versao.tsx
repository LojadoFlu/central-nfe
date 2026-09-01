"use client";

// Avisa quando o que está aberto não é mais o que está no ar.
//
// O app instalado abre numa janela própria e fica dias de pé: sem isso, a
// pessoa confere números de hoje numa tela de ontem — o que já custou algumas
// idas e vindas por aqui.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { precisaAtualizar, versaoEmUso } from "@/lib/versao";

/** De 5 em 5 minutos, e sempre que a janela volta para a frente. */
const INTERVALO_MS = 5 * 60 * 1000;

export function AvisoVersao() {
  const [nova, setNova] = useState(false);

  const conferir = useCallback(async () => {
    try {
      // `no-store` para não perguntar ao cache do próprio navegador, que é
      // justamente quem está desatualizado.
      const r = await fetch("/api/versao", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { ref?: unknown };
      setNova(precisaAtualizar(versaoEmUso(), d?.ref));
    } catch {
      // Sem rede não se conclui nada: fica quieto.
    }
  }, []);

  useEffect(() => {
    void conferir();
    const t = setInterval(() => void conferir(), INTERVALO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void conferir();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [conferir]);

  if (!nova) return null;

  async function atualizar() {
    // Limpeza defensiva: se algum dia um service worker ou cache ficar pelo
    // caminho, recarregar sozinho não bastaria.
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const nomes = await caches.keys();
        await Promise.all(nomes.map((n) => caches.delete(n)));
      }
    } catch {
      // Se a limpeza falhar, o reload ainda resolve o caso comum.
    }
    window.location.reload();
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-warning/40 bg-warning/15 px-4 py-2 text-xs backdrop-blur">
      <span>
        Há uma versão nova no ar — esta tela é de antes e pode mostrar números
        desatualizados.
      </span>
      <Button size="sm" onClick={() => void atualizar()}>
        <RefreshCw /> Atualizar
      </Button>
    </div>
  );
}
