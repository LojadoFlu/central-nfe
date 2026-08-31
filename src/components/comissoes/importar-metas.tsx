"use client";

// Importação das metas por vendedor, vindas do Controle de Vez.
// Sempre em dois tempos: confere primeiro, grava depois. Meta importada às
// cegas é folha errada no fim do mês.

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatBRL, formatarData } from "@/lib/utils";
import { Check, TriangleAlert, Upload } from "lucide-react";
import { importarMetas, obterConfig, salvarConfig, type PreviaImportMetas } from "@/lib/comissoes/repo";
import type { StorePdv } from "@/lib/nfe/repo";
import { Aviso, mesLabel } from "./comum";

export function ImportarMetas({
  lojas,
  onImportado,
}: {
  lojas: StorePdv[];
  onImportado: () => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<PreviaImportMetas | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function rodar(confirmar: boolean) {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      const r = await importarMetas(texto, confirmar);
      setPrevia(r);
      if (confirmar) {
        await onImportado();
        setOk(`Metas importadas: ${r.resumo.map((x) => mesLabel(x.competencia)).join(", ")}.`);
        setTexto("");
        setPrevia(null);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const temProblema =
    !!previa && (previa.erros.length > 0 || previa.semCasar.length > 0 || previa.ambiguos.length > 0);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h2 className="text-[0.95rem] font-semibold tracking-tight">Importar metas do Controle de Vez</h2>
        <p className="text-xs text-muted-foreground">
          A meta de cada vendedor vem pronta de lá — aqui ela só é conferida e guardada. A meta da
          loja passa a ser a <strong>soma</strong> das metas dos vendedores dela. O arquivo pode vir
          sem cabeçalho, no formato{" "}
          <code className="text-[10px]">Loja;início;fim;nome;meta</code>.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={arquivoRef}
            type="file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setTexto(await f.text());
              setPrevia(null);
            }}
          />
          <Button size="sm" variant="outline" onClick={() => arquivoRef.current?.click()}>
            <Upload /> Escolher arquivo
          </Button>
          <Button size="sm" variant="outline" disabled={ocupado || !texto.trim()} onClick={() => rodar(false)}>
            Conferir
          </Button>
          {previa && previa.linhas > 0 ? (
            <Button size="sm" disabled={ocupado} onClick={() => rodar(true)}>
              <Check /> Importar {previa.linhas} linha(s)
            </Button>
          ) : null}
        </div>

        <textarea
          className="h-24 w-full rounded-md border border-input bg-background p-2 font-mono text-[11px]"
          placeholder={"semana_inicio;codigo_pdv;nome;loja;meta\n04/08/2026;09120002;LUIZ GUSTAVO;FLU BARRA;12.000,00"}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setPrevia(null);
          }}
        />

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

        {previa ? (
          <div className="space-y-2 text-xs">
            {previa.resumo.map((r) => (
              <div key={r.competencia} className="rounded-md bg-muted/50 p-2.5">
                <p className="font-medium">
                  {mesLabel(r.competencia)} · {r.pessoas} pessoa(s) · {formatBRL(r.total)}
                </p>
                <p className="text-muted-foreground">
                  Semanas: {r.semanas.map((d) => formatarData(d)).join(", ")}
                </p>
                {r.semMeta.length > 0 ? (
                  <p className="mt-1 text-warning">
                    Ficam sem meta: {r.semMeta.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}

            {previa.lojasNaoMapeadas.length > 0 ? (
              <div className="space-y-1.5 rounded-md bg-warning/10 p-2.5">
                <p className="font-semibold text-warning">
                  Nomes de loja que eu não reconheci
                </p>
                <p className="text-muted-foreground">
                  Diga a qual loja daqui cada um corresponde — fica salvo e não pergunto de novo.
                  Sem isso, o nome do vendedor é procurado no quadro inteiro, o que aumenta a chance
                  de homônimo.
                </p>
                {previa.lojasNaoMapeadas.map((nome) => (
                  <div key={nome} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{nome}</span>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      defaultValue=""
                      disabled={ocupado}
                      onChange={async (e) => {
                        if (!e.target.value) return;
                        setOcupado(true);
                        try {
                          const cfg = await obterConfig();
                          await salvarConfig({
                            ...cfg,
                            lojasImport: {
                              ...(cfg.lojasImport ?? {}),
                              [nome]: Number(e.target.value),
                            },
                          });
                          await rodar(false);
                        } catch (err) {
                          setErro((err as Error).message);
                        } finally {
                          setOcupado(false);
                        }
                      }}
                    >
                      <option value="">— escolher loja —</option>
                      {lojas.map((l) => (
                        <option key={l.id} value={String(l.id)}>
                          {l.grupoNome || l.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}

            {temProblema ? (
              <div className="space-y-1 rounded-md bg-destructive/10 p-2.5 text-destructive">
                <p className="flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="size-3.5" /> Confira antes de importar
                </p>
                {previa.erros.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                {previa.ambiguos.map((a, i) => (
                  <p key={`a${i}`}>Nome com mais de um cadastro: {a} — informe o código do PDV.</p>
                ))}
                {previa.semCasar.map((s, i) => (
                  <p key={`s${i}`}>
                    Linha {s.linha}: {s.nome ?? s.codigo} ({formatBRL(s.meta)}) não casou com ninguém
                    do quadro.
                  </p>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-success">
                <Check className="size-3.5" /> Todas as linhas casaram com o cadastro.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
