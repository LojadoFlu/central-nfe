import * as https from "node:https";
import { URL } from "node:url";

export interface RespostaSoap {
  httpStatus: number;
  body: string;
}

/**
 * POST SOAP 1.2 com autenticação mútua (mTLS) usando o certificado A1 (.pfx).
 * O certificado nunca sai do backend. Não loga pfx/senha.
 */
export function postSoap(
  url: string,
  soapXml: string,
  pfx: Buffer,
  passphrase: string,
  soapAction: string,
): Promise<RespostaSoap> {
  const u = new URL(url);
  const data = Buffer.from(soapXml, "utf8");
  const options: https.RequestOptions = {
    host: u.hostname,
    path: u.pathname + u.search,
    port: 443,
    method: "POST",
    pfx,
    passphrase,
    minVersion: "TLSv1.2",
    headers: {
      "Content-Type": `application/soap+xml; charset=utf-8; action="${soapAction}"`,
      "Content-Length": data.length,
    },
    timeout: 30000,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () =>
        resolve({ httpStatus: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("timeout", () => req.destroy(new Error("Timeout na conexão com a SEFAZ.")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
