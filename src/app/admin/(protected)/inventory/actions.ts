"use server";
import { revalidatePath } from "next/cache";
import { inventory } from "@/server/inventory/service";
import { manualTypes, stockChange, type StockResult } from "@/server/inventory/contracts";

export async function recordStock(_previous: StockResult | null, form: FormData): Promise<StockResult> {
  const parsed = stockChange.safeParse({ requestId: form.get("requestId"), variantId: form.get("variantId"),
    locationId: form.get("locationId"), type: form.get("type"), quantity: Number(form.get("quantity")),
    reason: form.get("reason"), reference: form.get("reference") });
  if (!parsed.success || !manualTypes.some((type) => type === parsed.data.type)) {
    return { ok: false, error: "Choose a SKU and movement type, enter a whole quantity and a reason (at least 3 characters)." };
  }
  try {
    const result = await inventory.change(parsed.data);
    if (result.ok) {
      revalidatePath("/admin/inventory");
      revalidatePath("/admin/inventory/movements");
      revalidatePath("/admin/inventory/adjustments");
    }
    return result;
  } catch {
    return { ok: false, error: "Movement not confirmed. Check available stock and history before retrying. Opening stock must be the first movement. Keep the same request ID when retrying." };
  }
}
