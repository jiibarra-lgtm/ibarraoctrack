"use client";
import * as React from "react";
import { markMailRead } from "./actions";

export function MarkRead({ id, unread }: { id: string; unread: boolean }) {
  React.useEffect(() => { if (unread) void markMailRead(id); }, [id, unread]);
  return null;
}
