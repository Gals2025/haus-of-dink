"use server";

import { revalidatePath } from "next/cache";
import { userManagement } from "@/server/admin/service";
import type { ChangeResult } from "@/server/admin/contracts";

export async function changeUser(input: unknown): Promise<ChangeResult> {
  try {
    const result = await userManagement.change(input);
    if (result.ok) {
      revalidatePath("/admin/users");
      revalidatePath("/admin/audit");
    }
    return result;
  } catch {
    // Never serialize database errors, SQL parameters or session data.
    return { ok: false, error: "Unable to save the change. Refresh to check the account before retrying." };
  }
}
