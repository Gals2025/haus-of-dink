"use server";
import { revalidatePath } from "next/cache";
import { saveFeaturedItems as save } from "@/server/featured/service";

export async function saveFeaturedItems(input: unknown) {
  const result = await save(input);
  if (result.ok) {
    try {
      revalidatePath("/");
      revalidatePath("/admin/featured");
    } catch {
      // The database write already succeeded; a later request will render fresh data.
    }
  }
  return result;
}
