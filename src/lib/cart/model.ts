export type CartLine = { variantId: string; quantity: number };
export const maxCartLines = 30;
export const maxCartQuantity = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Store identifiers/quantities only. Catalog prices and stock always come from the server.
export function decodeCart(raw: string): CartLine[] {
  try {
    if (raw.length > 16384) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > maxCartLines) return [];
    const lines = new Map<string,number>();
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const line = entry as Record<string,unknown>;
      if (typeof line.variantId !== "string" || !uuid.test(line.variantId) || typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity<1 || line.quantity>maxCartQuantity) continue;
      const id=line.variantId.toLowerCase();
      lines.set(id,Math.min(maxCartQuantity,(lines.get(id)??0)+line.quantity));
    }
    return [...lines].map(([variantId,quantity])=>({variantId,quantity}));
  } catch { return []; }
}
export function addCartLine(lines: CartLine[], variantId: string, available: number): {lines:CartLine[];error?:string} {
  const max=Math.min(maxCartQuantity,Math.max(0,Math.floor(available)));
  if (!uuid.test(variantId) || !Number.isFinite(max) || max<1) return {lines,error:"This item is not available."};
  const existing=lines.find(line=>line.variantId===variantId);
  if (existing && existing.quantity>=max) return {lines,error:`You can add up to ${max} of this item.`};
  if (!existing && lines.length>=maxCartLines) return {lines,error:"Your cart can contain up to 30 different items."};
  return {lines:existing?lines.map(line=>line.variantId===variantId?{...line,quantity:line.quantity+1}:line):[...lines,{variantId,quantity:1}]};
}
export function setCartLineQuantity(lines: CartLine[],variantId:string,quantity:number,available:number): CartLine[] {
  if (quantity===0) return lines.filter(line=>line.variantId!==variantId);
  if (!Number.isSafeInteger(quantity) || quantity<1 || !Number.isFinite(available) || available<1) return lines;
  const next=Math.min(quantity,maxCartQuantity,Math.floor(available));
  return lines.map(line=>line.variantId===variantId?{...line,quantity:next}:line);
}
export function subtractPurchasedLines(lines: CartLine[],purchased:CartLine[]):CartLine[] {
  return lines.map(line=>({...line,quantity:Math.max(0,line.quantity-(purchased.find(item=>item.variantId===line.variantId)?.quantity??0))})).filter(line=>line.quantity>0);
}
