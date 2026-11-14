import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: {} }));
const { weeklyBody } = await import("@/lib/push");

describe("resumen semanal", () => {
  it("muestra sólo lo que hay que hacer", () => {
    const t = weeklyBody({ due: 2, late: 1, receivable: 500000, overdue: 0, new_orders: 3, new_amount: 1210000, missing: 1 });
    expect(t).toMatch(/^2 entregas vencen esta semana · 1 atrasada · 1 OC sin cargar · /);
    expect(t).toContain("por cobrar");
    expect(t).toMatch(/3 OC nuevas la semana pasada/);
  });
  it("semana tranquila", () => {
    expect(weeklyBody({ due: 0, late: 0, receivable: 0, overdue: 0, new_orders: 0, new_amount: 0, missing: 0 })).toBe("sin OC nuevas la semana pasada");
  });
});
