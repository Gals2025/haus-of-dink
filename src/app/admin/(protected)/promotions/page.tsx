import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { listCommerce } from "@/server/commerce/service";
import { filtersInput,peso,type Promotion } from "@/server/commerce/contracts";
import { PromotionEditor } from "../commerce/forms";
import { ListFilters,Pagination,formatDate } from "../commerce/list";
export default async function Promotions({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const identity=await requirePermission("promotions:read");const params=filtersInput.safeParse(await searchParams);
  if(!params.success)return <p role="alert">Invalid search filters.</p>;
  const data=await listCommerce<Promotion>("promotions",params.data);const write=hasPermission(identity.staff.role,"promotions:write");
  return <div className="space-y-6"><h1 className="text-3xl">Promotions</h1><p className="text-muted-foreground">One code per order. Discounts apply to merchandise, exclude shipping, and round down to the nearest centavo. Cancelled orders release their code usage.</p>
    <ListFilters filters={data.filters}/>{write&&<details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer">Add promotion</summary><div className="mt-5"><PromotionEditor/></div></details>}
    {data.rows.map(p=><details key={p.id} className="rounded-xl border bg-card p-5"><summary className="cursor-pointer">{p.code} · {p.kind==="percent"?`${p.amount}%`:peso(p.amount)} · {p.used}/{p.usageLimit} used · {p.active?"Enabled":"Disabled"}</summary><p className="my-4 text-sm">{formatDate(p.startsAt)} – {formatDate(p.endsAt)} (Philippine time)</p>{write&&<PromotionEditor promotion={p}/>}</details>)}
    {!data.rows.length&&<p>No promotions found.</p>}<Pagination path="/admin/promotions" filters={data.filters} hasMore={data.hasMore}/></div>;
}
