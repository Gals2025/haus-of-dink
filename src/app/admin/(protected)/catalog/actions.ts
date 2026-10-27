"use server";
import { revalidatePath } from "next/cache";
import { catalogManagement } from "@/server/catalog/management";

function refresh() {
  try { revalidatePath("/admin/catalog", "layout"); revalidatePath("/admin/products", "layout"); revalidatePath("/admin/variants"); } catch { /* committed */ }
}
export async function saveCatalogEntity(kind: unknown, id: unknown, input: unknown) {
  const result = await catalogManagement.save(kind, id, input);
  if (result.ok) refresh();
  return result;
}
export async function removeCatalogEntity(kind: unknown, id: unknown) {
  const result = await catalogManagement.remove(kind, id);
  if (result.ok) refresh();
  return result;
}
