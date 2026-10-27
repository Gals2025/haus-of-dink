"use server";
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
