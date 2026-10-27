import { connection } from "next/server";
import { getDb } from "@/server/db";
import { storeSettings } from "@/server/db/schema";
export async function StoreContact() {
  await connection();
  let store: { name: string; email: string; phone: string; address: string } | undefined;
  try {
    // Public projection: no sessions, customer records, internal settings or audit data.
    [store]=await getDb().select({name:storeSettings.name,email:storeSettings.email,phone:storeSettings.phone,address:storeSettings.address}).from(storeSettings).limit(1);
  } catch { /* A missing migration or database must not prevent storefront browsing. */ }
  if(store)return <div className="space-y-1"><span className="font-serif text-xl text-primary">{store.name}</span><p>{store.email} {store.phone}</p>{store.address&&<p className="whitespace-pre-wrap">{store.address}</p>}</div>;
  return <span className="font-serif text-xl text-primary">Haus of Dink</span>;
}
