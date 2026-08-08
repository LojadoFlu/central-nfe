// Endpoints oficiais do Ambiente Nacional (RFB) para NFeDistribuicaoDFe.
// Confirmar sempre na Relação de Serviços Web oficial do portal NF-e.
export function urlDistribuicao(ambiente: "homologacao" | "producao"): string {
  return ambiente === "producao"
    ? "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
    : "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
}

// Recepção de eventos (manifestação) — ATENÇÃO: hosts ANTIGOS www.nfe/hom.nfe
// (diferente da distribuição, que usa www1/hom1). Confirmar na Relação de
// Serviços Web oficial antes de produção.
export function urlRecepcaoEvento(ambiente: "homologacao" | "producao"): string {
  return ambiente === "producao"
    ? "https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx"
    : "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
}

// Código IBGE da UF (cUFAutor).
export const UF_IBGE: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27",
  SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41",
  SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};
