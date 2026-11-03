export type PriceUnit = "centavos" | "pesos";

/** Convert explicitly selected units exactly; never round fractional centavos. */
export function normalizePrice(value: string, unit: PriceUnit): string {
  const text = value.trim();
  if (!text) return "";
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Use a nonnegative amount with up to two decimal places (for example 14,995.00).");
  }
  const [whole = "", fraction = ""] = text.replaceAll(",", "").split(".");
  const decimal = BigInt(fraction.padEnd(2, "0"));
  if (unit === "centavos" && decimal !== BigInt(0)) {
    throw new Error("Fractional centavos are not allowed. If these amounts are pesos, select Pesos under Prices in file.");
  }
  const cents = unit === "pesos" ? BigInt(whole) * BigInt(100) + decimal : BigInt(whole);
  if (cents > BigInt(2_147_483_647)) throw new Error("Amount exceeds the supported price limit.");
  return cents.toString();
}
