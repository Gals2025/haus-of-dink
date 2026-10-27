import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { listCommerce } from "@/server/commerce/service";
import type { Settings } from "@/server/commerce/contracts";
import { SettingsEditor } from "../commerce/forms";
export default async function StoreSettings() {
  const identity=await requirePermission("settings:read"); const data=await listCommerce<Settings>("settings",{});const canWrite=hasPermission(identity.staff.role,"settings:write");
  return <div className="max-w-3xl space-y-6"><h1 className="text-3xl">Store settings</h1><p className="text-muted-foreground">Business contact details and the default shipping fee for new orders. {canWrite?"":"Only a super administrator can save changes."}</p><div className="rounded-xl border bg-card p-5"><SettingsEditor settings={data.rows[0]??{name:"Haus of Dink",email:"",phone:"",address:"",shippingFee:0}} canWrite={canWrite}/></div></div>;
}
