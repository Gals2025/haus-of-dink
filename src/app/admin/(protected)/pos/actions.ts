"use server";
import { revalidatePath } from "next/cache";
import { createPosSale } from "@/server/pos/service";

export async function submitPosSale(input: unknown) {
  const result = await createPosSale(input);
  if (result.ok) {
    for (const path of ["/admin/pos", "/admin/orders", "/admin/inventory", "/admin/reports"]) revalidatePath(path, "layout");
  }
  return result;
}
