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
import type { Funcionario } from "@/lib/comissoes/tipos";
import { Aviso, mesLabel } from "./comum";

export function ImportarMetas({
  lojas,
  funcionarios,
  onImportado,
}: {
  lojas: StorePdv[];
  funcionarios: Funcionario[];
  onImportado: () => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<PreviaImportMetas | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  /**
   * Amarra um nome do arquivo a um funcionário — ou marca como fora do quadro.
   * Manda só o de-para de pessoas: o servidor preserva o resto da configuração.
   */
  async function amarrarVendedor(chave: string, valor: string) {
    if (!valor) return;
    setOcupado(true);
    setErro(null);
    try {
      const cfg = await obterConfig();
      await salvarConfig({
        ...cfg,
        vendedoresImport: { ...(cfg.vendedoresImport ?? {}), [chave]: valor },
      });
      await rodar(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

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

  // Defensivo de propósito: se a resposta vier com forma diferente da esperada,
  // a tela mostra o problema em vez de quebrar e esconder o problema.
  const erros = previa?.erros ?? [];
  const semCasar = previa?.semCasar ?? [];
  const ambiguos = previa?.ambiguos ?? [];
  const lojasNaoMapeadas = previa?.lojasNaoMapeadas ?? [];
  const resumo = previa?.resumo ?? [];
  const temProblema =
    !!previa && (erros.length > 0 || semCasar.length > 0 || ambiguos.length > 0);

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
            {resumo.map((r) => (
              <div key={r.competencia} className="rounded-md bg-muted/50 p-2.5">
                <p className="font-medium">
                  {mesLabel(r.competencia)} · {r.pessoas} pessoa(s) · {formatBRL(r.total)}
                </p>
                <p className="text-muted-foreground">
                  Semanas: {r.semanas.map((d) => formatarData(d)).join(", ")}
                </p>
                <p className="text-muted-foreground">
                  O arquivo <strong>substitui</strong> as metas por pessoa desta competência —
                  quem não estiver nele fica sem meta.
                </p>
                {r.lojas?.length ? (
                  <p className="text-muted-foreground">
                    Meta por loja:{" "}
                    {r.lojas
                      .map(
                        (x) =>
                          `${lojas.find((l) => l.id === x.lojaId)?.grupoNome ?? x.lojaId} ${formatBRL(x.total)}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null}
                {r.semMeta.length > 0 ? (
                  <p className="mt-1 text-warning">
                    Ficam sem meta: {r.semMeta.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}

            {lojasNaoMapeadas.length > 0 ? (
              <div className="space-y-1.5 rounded-md bg-warning/10 p-2.5">
                <p className="font-semibold text-warning">
                  Nomes de loja que eu não reconheci
                </p>
                <p className="text-muted-foreground">
                  Diga a qual loja daqui cada um corresponde — fica salvo e não pergunto de novo.
                  Sem isso, o nome do vendedor é procurado no quadro inteiro, o que aumenta a chance
                  de homônimo.
                </p>
                {lojasNaoMapeadas.map((nome) => (
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
                <p className="font-normal text-muted-foreground">
                  A meta de quem não está no quadro continua contando para a loja — e portanto para
                  o subgerente, o gerente e o supervisor. Amarrar só define de quem é a meta
                  individual.
                </p>
                {erros.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                {ambiguos.map((a, i) => (
                  <p key={`a${i}`}>Nome com mais de um cadastro: {a} — informe o código do PDV.</p>
                ))}
                {[...new Map(semCasar.map((s) => [s.chave, s])).values()].map((s) => (
                  <div key={s.chave} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      <strong>{s.nome ?? s.codigo}</strong>
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.loja ?? "sem loja"} ·{" "}
                        {semCasar.filter((x) => x.chave === s.chave).length} linha(s)
                      </span>
                    </span>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      defaultValue=""
                      disabled={ocupado}
                      onChange={(e) => amarrarVendedor(s.chave, e.target.value)}
                    >
                      <option value="">— quem é? —</option>
                      <option value="-">Não está no quadro (desligado)</option>
                      {funcionarios
                        .filter((f) => f.ativo)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : previa.linhas > 0 ? (
              <p className="flex items-center gap-1.5 text-success">
                <Check className="size-3.5" /> Todas as linhas casaram com o cadastro.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
