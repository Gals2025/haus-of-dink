import { requirePermission } from "@/server/auth/authorize";
import { getPosOptions } from "@/server/pos/service";
import { PosTerminal } from "./pos-terminal";

export default async function PosPage() {
  await requirePermission("pos:sell");
  const options = await getPosOptions();
  return <div className="space-y-6">
    <div><p className="text-xs tracking-widest text-primary">HAUS OF DINK / IN-STORE</p>
      <h1 className="mt-3 text-4xl">Point of sale</h1>
      <p className="mt-3 text-muted-foreground">Record walk-in purchases, collect payment, and deduct stock from the store location.</p></div>
    {options.locations.length === 0
      ? <p className="rounded-xl border bg-card p-5">Add an active inventory location before opening the POS.</p>
      : options.products.length === 0
        ? <p className="rounded-xl border bg-card p-5">No active PHP variants are available. Add active product variants to the catalog first.</p>
        : <PosTerminal locations={options.locations} products={options.products} />}
  </div>;
}
