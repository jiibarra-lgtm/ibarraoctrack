import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { reminderPayload } from "@/lib/reminder-push";

describe("reminderPayload", () => {
  const base = { id: "a", title: "Llamar al hospital", notes: null, link_path: "/ordenes/x", link_label: null, token: "t", count: 0, priority: "normal" as const };
  it("arma título, link y botones", () => {
    const p = reminderPayload(base);
    expect(p.title).toBe("⏰ Llamar al hospital");
    expect(p.url).toBe("/ordenes/x");
    expect(p.tag).toBe("reminder-a");
    expect(p.reminder).toEqual({ id: "a", token: "t" });
    expect(p.body).toBe("Tocá para abrirlo");
  });
  it("importante, insistido y con enlace", () => {
    const p = reminderPayload({ ...base, priority: "alta", count: 2, notes: "Interno 214", link_label: "OC 417-1-OC26" });
    expect(p.title).toBe("‼️ Llamar al hospital (otra vez)");
    expect(p.body).toBe("Interno 214\n→ OC 417-1-OC26");
  });
});
