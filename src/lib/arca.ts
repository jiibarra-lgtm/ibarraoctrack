import "server-only";
import https from "node:https";
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

/**
 * ARCA (ex AFIP): pedido de certificado, login WSAA (firma CMS) y web service de facturación WSFEv1.
 * Producción. Los servidores de ARCA usan claves DH chicas: se baja el nivel de seguridad de TLS sólo para ellos.
 */
const WSAA = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const WSFE = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";
const agent = new https.Agent({ ciphers: "DEFAULT@SECLEVEL=1", keepAlive: false });

export const cleanCuit = (s: string) => s.replace(/\D/g, "");

/** Genera clave privada (queda en el sistema) y el pedido de certificado (.csr) para subir a ARCA. */
export function generateCsr(cuit: string, alias: string, org: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const key = forge.pki.privateKeyFromPem(privateKey);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  csr.setSubject([
    { name: "countryName", value: "AR" },
    { name: "organizationName", value: org.normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 60) || "Empresa" },
    { name: "commonName", value: alias },
    { type: "2.5.4.5", value: `CUIT ${cleanCuit(cuit)}` },
  ]);
  csr.sign(key, forge.md.sha256.create());
  return { privateKeyPem: forge.pki.privateKeyToPem(key), csrPem: forge.pki.certificationRequestToPem(csr) };
}

/** Valida que el .crt de ARCA corresponda a la clave guardada; devuelve vencimiento y CUIT. */
export function inspectCertificate(certPem: string, privateKeyPem: string) {
  let cert: forge.pki.Certificate;
  try { cert = forge.pki.certificateFromPem(certPem.trim()); } catch { throw new Error("El archivo no es un certificado .crt válido"); }
  const key = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  if (pub.n.compareTo(key.n) !== 0) throw new Error("Este certificado no corresponde al pedido generado en el sistema (¿subiste el de otro alias?)");
  const serial = cert.subject.attributes.find((a) => a.type === "2.5.4.5")?.value as string | undefined;
  return { expiresAt: cert.validity.notAfter.toISOString(), subjectCuit: serial ? cleanCuit(serial) : null };
}

function post(url: string, body: string, action: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", agent, timeout: 25_000, headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action, "Content-Length": Buffer.byteLength(body) } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("timeout", () => req.destroy(new Error("ARCA no respondió a tiempo")));
    req.on("error", (e) => reject(new Error(`No se pudo conectar con ARCA: ${e.message}`)));
    req.end(body);
  });
}

const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Login en WSAA: firma el pedido de acceso (CMS) con el certificado y devuelve token y sign (12 horas). */
export async function wsaaLogin(certPem: string, keyPem: string, service = "wsfe") {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now / 1000)}</uniqueId><generationTime>${iso(now - 10 * 60_000)}</generationTime><expirationTime>${iso(now + 10 * 60_000)}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
  const cert = forge.pki.certificateFromPem(certPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem), certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date(now) as unknown as string },
    ],
  });
  p7.sign();
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
  const env = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const res = await post(WSAA, env, "");
  const fault = tag(res, "faultstring");
  if (fault) throw new Error(`ARCA (login): ${unescapeXml(fault)}`);
  const ret = tag(res, "loginCmsReturn");
  if (!ret) throw new Error("ARCA (login) respondió algo inesperado");
  const ta = unescapeXml(ret);
  const token = tag(ta, "token"), sign = tag(ta, "sign"), exp = tag(ta, "expirationTime");
  if (!token || !sign || !exp) throw new Error("ARCA no devolvió el acceso");
  return { token, sign, expiresAt: new Date(exp).toISOString() };
}

export type ArcaAuth = { token: string; sign: string; cuit: string };

async function wsfe(method: string, auth: ArcaAuth, inner: string) {
  const env = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soap:Body><ar:${method}><ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${auth.cuit}</ar:Cuit></ar:Auth>${inner}</ar:${method}></soap:Body></soap:Envelope>`;
  const res = await post(WSFE, env, `http://ar.gov.afip.dif.FEV1/${method}`);
  const fault = tag(res, "faultstring");
  if (fault) throw new Error(`ARCA: ${unescapeXml(fault)}`);
  const errs = [...res.matchAll(/<Err>\s*<Code>(\d+)<\/Code>\s*<Msg>([\s\S]*?)<\/Msg>\s*<\/Err>/g)].map((m) => `${m[1]}: ${unescapeXml(m[2])}`);
  return { xml: res, errors: errs };
}

/** Número del último comprobante autorizado (A=1, B=6, C=11) en un punto de venta. */
export async function lastVoucher(auth: ArcaAuth, pointOfSale: number, voucherType: number) {
  const r = await wsfe("FECompUltimoAutorizado", auth, `<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${voucherType}</ar:CbteTipo>`);
  if (r.errors.length) throw new Error(`ARCA: ${r.errors.join(" · ")}`);
  return Number(tag(r.xml, "CbteNro") ?? 0);
}

export type ArcaRpc = (action: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Obtiene (o reutiliza) el acceso de WSAA. ARCA no da uno nuevo mientras el anterior siga vigente: se guarda. */
export async function arcaAuth(rpc: ArcaRpc): Promise<ArcaAuth & { pointOfSale: number | null }> {
  const c = await rpc("creds");
  if (!c.certificate) throw new Error("Falta subir el certificado de ARCA");
  if (!c.cuit) throw new Error("Falta el CUIT");
  if (c.ta_token && c.ta_sign) return { token: String(c.ta_token), sign: String(c.ta_sign), cuit: String(c.cuit), pointOfSale: (c.point_of_sale as number) ?? null };
  const ta = await wsaaLogin(String(c.certificate), String(c.private_key));
  await rpc("save_ta", { token: ta.token, sign: ta.sign, expires_at: ta.expiresAt });
  return { token: ta.token, sign: ta.sign, cuit: String(c.cuit), pointOfSale: (c.point_of_sale as number) ?? null };
}
