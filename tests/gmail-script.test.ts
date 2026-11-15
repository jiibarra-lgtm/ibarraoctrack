import { describe, expect, it } from "vitest";
import { gmailScript } from "@/app/(app)/configuracion/gmail-script";

describe("script de Gmail", () => {
  it("es JavaScript válido (se pega tal cual en Apps Script)", () => {
    const code = gmailScript("https://ejemplo.vercel.app/api/inbound/gmail", "x".repeat(40));
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain("URL.replace(/\\/gmail$/, '/backup')");
  });
});
