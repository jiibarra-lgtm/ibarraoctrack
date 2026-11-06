import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import forge from "node-forge";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCsr, inspectCertificate } from "@/lib/arca";
import { mapOrder, groupPacks } from "@/lib/ml-api";

describe("ARCA", () => {
  const { privateKeyPem, csrPem } = generateCsr("20-04424052-2", "octrack", "Ibarra Insumos");

  it("pedido de certificado con CUIT y alias", () => {
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    expect(csr.verify()).toBe(true);
    expect(csr.subject.getField("CN").value).toBe("octrack");
    expect(csr.subject.attributes.find((a) => a.type === "2.5.4.5")?.value).toBe("CUIT 20044240522");
  });

  it("acepta el certificado que corresponde a la clave y rechaza otro", () => {
    const key = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date("2026-11-06T00:00:00Z");
    cert.validity.notAfter = new Date("2028-11-06T00:00:00Z");
    const subj = [{ name: "commonName", value: "octrack" }, { type: "2.5.4.5", value: "CUIT 20044240522" }];
    cert.setSubject(subj); cert.setIssuer(subj);
    cert.sign(key, forge.md.sha256.create());
    const pem = forge.pki.certificateToPem(cert);
    expect(inspectCertificate(pem, privateKeyPem)).toEqual({ expiresAt: "2028-11-06T00:00:00.000Z", subjectCuit: "20044240522" });
    const other = generateCsr("20-04424052-2", "x", "y").privateKeyPem;
    expect(() => inspectCertificate(pem, other)).toThrow(/no corresponde/);

    // Firma CMS como la de WSAA, verificada con openssl
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer("<loginTicketRequest/>", "utf8");
    p7.addCertificate(cert);
    p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() as unknown as string }] });
    p7.sign();
    const dir = mkdtempSync(join(tmpdir(), "cms-"));
    writeFileSync(join(dir, "s.der"), Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary"));
    const out = execFileSync("openssl", ["cms", "-verify", "-noverify", "-inform", "DER", "-in", join(dir, "s.der")], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    expect(out).toBe("<loginTicketRequest/>");
  });
});

describe("Mercado Libre API", () => {
  it("une las órdenes de un carrito y suma comisiones de ventas", () => {
    const o = (id: number, title: string, price: number, fee: number) => ({ id, pack_id: 900, date_created: `2026-11-0${id}T10:00:00Z`, status: "paid", total_amount: price, tags: ["delivered"], order_items: [{ item: { title }, quantity: 1, unit_price: price, sale_fee: fee }], buyer: { nickname: "B" } });
    const g = groupPacks([mapOrder(o(2, "A", 100, 10), "venta"), mapOrder(o(1, "B", 50, 5), "venta")]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ order_id: "2", pack_id: "900", total: "150.00", fees: "15.00", date: "2026-11-01T10:00:00Z", delivered: true, counterpart: "B" });
    expect(g[0].items.map((i) => i.title)).toEqual(["A", "B"]);
  });
});
