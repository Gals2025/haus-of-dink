"use client";
export default function InventoryError({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4"><h2 className="text-2xl">Inventory could not be loaded.</h2><p>Try again shortly. If this is a new installation, check that the inventory migration has been applied.</p><button onClick={reset} className="rounded-md border px-4 py-2">Try again</button></div>;
}
