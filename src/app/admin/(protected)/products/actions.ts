"use server";
import { createProductVariant } from "@/server/catalog/variant-mutations";
import { createCatalogOption } from "@/server/catalog/option-mutations";
import { revalidatePath } from "next/cache";
import { getPermissionSession } from "@/server/auth/authorize";
import { createProduct, updateProduct, archiveProduct, reactivateProduct } from "@/server/catalog/mutations";
import { createProductAdminActions } from "@/server/catalog/admin-actions";

const actions = createProductAdminActions({ authorize: getPermissionSession,
  create: createProduct, update: updateProduct, archive: archiveProduct, reactivate: reactivateProduct,
  refresh: (id) => {
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${id}`);
    revalidatePath(`/admin/products/${id}/edit`);
    revalidatePath("/admin/inventory");
  },
});
export async function createCatalogProduct(input: unknown) { return actions.create(input); }
export async function updateCatalogProduct(id: unknown, input: unknown) { return actions.update(id, input); }
export async function archiveCatalogProduct(id: unknown) { return actions.archive(id); }
export async function reactivateCatalogProduct(id: unknown) { return actions.reactivate(id); }

export async function createProductOption(kind: unknown, input: unknown) {
  const result = await createCatalogOption(kind, input);
  if (result.ok) {
    try { revalidatePath("/admin/products", "layout"); } catch { /* creation already committed */ }
  }
  return result;
}

export async function addProductVariant(input: unknown) {
  const result = await createProductVariant(input);
  if (result.ok) {
    try {
      revalidatePath(`/admin/products/${result.productId}`);
      revalidatePath("/admin/inventory");
    } catch { /* write already confirmed */ }
  }
  return result;
}
