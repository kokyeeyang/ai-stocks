export function normalizeTicker(input) {
  const raw = String(input || "").trim().toUpperCase().replace(/\.US$/, "");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(raw)) return null;
  return raw;
}

export function toStooqSymbol(input) {
  const normalized = normalizeTicker(input);
  if (!normalized) return null;
  return `${normalized.toLowerCase()}.us`;
}
