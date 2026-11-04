const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-10" → "oct 26" */
export const monthLabel = (k: string) => {
  const [y, m] = String(k).split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : String(k);
};
