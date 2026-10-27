import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { listCommerce } from "@/server/commerce/service";
import { filtersInput,type Customer } from "@/server/commerce/contracts";
import { CustomerEditor } from "../commerce/forms";
import { ListFilters,Pagination } from "../commerce/list";
export default async function Customers({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const identity=await requirePermission("customers:read");const params=filtersInput.safeParse(await searchParams);
  if(!params.success)return <p role="alert">Invalid filters. Use a valid page and search of up to 160 characters.</p>;
  const data=await listCommerce<Customer>("customers",params.data);const write=hasPermission(identity.staff.role,"customers:write");
  return <div className="space-y-6"><h1 className="text-3xl">Customers</h1><p className="text-muted-foreground">Manage contact details. Deactivate customers to prevent new orders while preserving order history.</p>
    <ListFilters filters={data.filters}/>{write&&<details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer">Add customer</summary><div className="mt-5"><CustomerEditor/></div></details>}
    <div className="space-y-3">{data.rows.map(c=><details key={c.id} className="rounded-xl border bg-card p-5"><summary className="cursor-pointer">{c.name} · {c.email} · {c.active?"Active":"Inactive"}</summary><div className="mt-4">{write?<CustomerEditor customer={c}/>:<p>{c.phone} · {c.address}</p>}</div></details>)}{!data.rows.length&&<p>No customers found.</p>}</div>
    <Pagination path="/admin/customers" filters={data.filters} hasMore={data.hasMore}/></div>;
}
