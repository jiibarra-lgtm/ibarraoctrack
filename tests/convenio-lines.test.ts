import { describe, expect, it } from "vitest";
import { contractFromFilename, parseConvenioLines, shortName } from "@/lib/convenio-lines";

const HEAD = ["Número de Línea", "Número de opción", "Código de ítem", "Descripción de ítem", "Unidad de medida", "Especificaciones técnicas", "Razón Social", "CUIT", "Precio unitario ofertado", "Precio actual", "Saldo stock", "Stock actual"];
const D = "BANDEJA PARA SERVIR COMIDA Demás especificaciones deberán ser indicadas por la repartición usuaria Modelo: De acero inoxidable ";
describe("Líneas del convenio marco", () => {
  it("agrupa por renglón y separa tu oferta", () => {
    const rows = [HEAD,
      [1, 1, "07.02.005.0028.3", D, "Unidad", "BANDEJA. marca JEI", "MI EMPRESA", "20111111112", 24800, 23900, 121, 125],
      [1, 1, "07.02.005.0028.3", D, "Unidad", "BANDEJA", "OTRO SA", "30222222223", 26600, 26600, 125, 125],
      [2, 1, "07.02.003.0035.1", "CACEROLA Modelo: aluminio", "Unidad", "CACEROLA", "OTRO SA", "30222222223", 103747, 65450, 17, 17]];
    const r = parseConvenioLines(rows, "20-11111111-2");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ line: 1, mine: true, current_price: 23900, best_other: 26600, offers: 2, code: "07.02.005.0028.3" });
    expect(r[0].name).toContain("BANDEJA PARA SERVIR COMIDA");
    expect(r[1]).toMatchObject({ line: 2, mine: false, current_price: null, best_other: 65450, name: "CACEROLA" });
  });
  it("nombre corto con presentación y marca", () => {
    expect(shortName("ACONDICIONADOR PARA CABELLO Nota: algo", "Caja x 12 envases \nMARCA POLYANA")).toBe("ACONDICIONADOR PARA CABELLO · Caja x 12 envases · marca POLYANA");
  });
  it("número de convenio del nombre del archivo", () => {
    expect(contractFromFilename("Lineas_del_Convenio_Marco_623-38-CM26_3.xlsx")).toBe("623-38-CM26");
  });
});

import { parseConvenioWindow } from "@/lib/inbound/convenio-window";
describe("Ventana de actualización de precios", () => {
  it("lee convenio, fechas y proceso", () => {
    const w = parseConvenioWindow({ id: "m", from: "Notificaciones BAC <notificacionesbac@buenosaires.gob.ar>", subject: "Inicio período de actualización de precios - convenio marco 623-38-CM26",
      body: "Estimado proveedor:Se informa que a partir del día 13/11/2026 se encuentra en vigencia el período de actualización\n\t\tde precios correspondiente al convenio marco Nº 623-38-CM26 Adquisición de Artículos de Tocador y Perfumería. en relación al proceso de\n\t\tcompra Nº 623-1245-LPU24 cuya duración se extenderá hasta 16/11/2026" });
    expect(w).toEqual({ message_id: "m", contract_number: "623-38-CM26", kind: "precios", starts_on: "2026-11-13", ends_on: "2026-11-16", contract_name: "Adquisición de Artículos de Tocador y Perfumería", process_number: "623-1245-LPU24" });
  });
});
