// O jsdom não implementa scrollIntoView. Não é um buraco do nosso código —
// todo navegador real tem —, então o teste ganha o método em vez de o app
// ganhar uma guarda que não protege de nada.
if (typeof window !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
export {};
