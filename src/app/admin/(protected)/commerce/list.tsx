import Link from "next/link";
import type { Filters } from "@/server/commerce/contracts";
export function ListFilters({filters,orders=false}:{filters:Filters;orders?:boolean}) {
  return <form className="flex flex-wrap items-end gap-3"><label>Search<input name="search" defaultValue={filters.search} maxLength={160} className="mt-1 block rounded-md border bg-background px-3 py-2"/></label>
    {orders&&<label>Status<select name="status" defaultValue={filters.status} className="mt-1 block rounded-md border bg-background px-3 py-2">{["all","awaiting_confirmation","confirmed","pending","fulfilled","cancelled"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>}
    <button className="rounded-md border px-4 py-2">Search</button>
  </form>;
}
export function Pagination({path,filters,hasMore}:{path:string;filters:Filters;hasMore:boolean}) {
  const href=(page:number)=>`${path}?${new URLSearchParams({search:filters.search,status:filters.status,page:String(page)})}`;
  return <nav aria-label="Pagination" className="flex gap-5 text-sm">{filters.page>1&&<Link className="underline" href={href(filters.page-1)}>Previous</Link>}<span>Page {filters.page}</span>{hasMore&&<Link className="underline" href={href(filters.page+1)}>Next</Link>}</nav>;
}
export function formatDate(value:string) {return new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
