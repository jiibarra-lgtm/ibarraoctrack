import { expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

it("CSV para Excel AR", () => {
  const csv = toCsv([{ a: "Jarra; térmica", b: "64298.3", c: "2026-10-01" }], [
    { header: "Desc", value: (r) => r.a }, { header: "Total", value: (r) => r.b, type: "money" }, { header: "Fecha", value: (r) => r.c, type: "date" },
  ]);
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain('"Jarra; térmica";64298,30;01/10/2026');
});
