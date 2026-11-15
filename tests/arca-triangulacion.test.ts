import { describe, expect, it } from "vitest";
import { parseApocrifos } from "@/lib/apocrifos";
import { guessJurisdiction } from "@/lib/jurisdictions";

describe("parseApocrifos", () => {
  it("lee CUIT y fechas, sin duplicados", () => {
    const t = "CUIT,Fecha condicion,Fecha publicacion\r\n20-12345678-9,01/02/2020,05/02/2020\n30123456789;10/10/2021;11/10/2021\n20123456789,01/02/2020,05/02/2020\nbasura";
    expect(parseApocrifos(t)).toEqual([
      { cuit: "20123456789", since: "2020-02-01", published: "2020-02-05" },
      { cuit: "30123456789", since: "2021-10-10", published: "2021-10-11" },
    ]);
  });
});

describe("guessJurisdiction", () => {
  it("reconoce organismos por nombre", () => {
    expect(guessJurisdiction("GOBIERNO DE LA CIUDAD AUTONOMA DE BUENOS AIRES", "34999032089")).toBe("CABA");
    expect(guessJurisdiction("INSTITUTO DE VIVIENDA DE LA CIUDAD", "30999999999")).toBe("CABA");
    expect(guessJurisdiction("POLICIA DE LA PROVINCIA DE MISIONES", "30999999998")).toBe("Misiones");
    expect(guessJurisdiction("PODER JUDICIAL DE LA PROVINCIA DE SANTA FE", "30999999997")).toBe("Santa Fe");
    expect(guessJurisdiction("UNIVERSIDAD DE CORDOBA", "30999999996")).toBe("Córdoba");
  });
});
