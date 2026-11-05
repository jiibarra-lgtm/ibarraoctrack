import { expect, it } from "vitest";
import { processType, rubroOf } from "@/lib/rubros";

it("rubros y tipos de proceso", () => {
  expect(rubroOf("Adquisición de insumos para botiquines de PN Copo 2026")).toBe("salud");
  expect(rubroOf("AM Alquiler Concentrador de Oxigeno - PED 88")).toBe("salud");
  expect(rubroOf("Adquisición de Articulos de Limpieza y Afines")).toBe("limpieza");
  expect(rubroOf("Adquisición de artículos de bazar")).toBe("descartables");
  expect(rubroOf("Algo raro")).toBe("otros");
  expect(processType("74/35-0592-LPR26").label).toBe("Licitación privada");
  expect(processType("416-3920-CME26").label).toBe("Contratación menor");
});
