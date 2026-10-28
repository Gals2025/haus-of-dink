import { hasPermission, requirePermission } from "@/server/auth/authorize";
import { listFeaturedItems } from "@/server/featured/service";
import { defaultFeaturedItems } from "@/server/featured/contracts";
import { FeaturedEditor } from "./featured-editor";

export default async function FeaturedAdminPage() {
  const identity = await requirePermission("promotions:read");
  const canWrite = hasPermission(identity.staff.role, "promotions:write");
  const rows = await listFeaturedItems();
  const configured = rows.length === 3 ? rows : defaultFeaturedItems;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl">Featured content</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Manage the three in-store promotional slides shown in the storefront carousel. Use a Vercel Blob HTTPS URL for an image and a store-relative link such as /shop.
        </p>
      </div>
      <FeaturedEditor items={configured} canWrite={canWrite} />
    </div>
  );
}
