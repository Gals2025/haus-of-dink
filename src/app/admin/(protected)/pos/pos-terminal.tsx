"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { peso } from "@/server/commerce/contracts";
import type { PosLocation, PosProduct } from "@/server/pos/contracts";
import { filterPosProducts } from "@/lib/pos/filters";
import { submitPosSale } from "./actions";

type Line = { variantId: string; quantity: number };
const field = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const input = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

export function PosTerminal({ locations, products }: { locations: PosLocation[]; products: PosProduct[] }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState("cash");
  const [cash, setCash] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [message, setMessage] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [receipt, setReceipt] = useState<{ total: number; change: number; method: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const request = useRef({ body: "", id: "" });
  const subtotal = useMemo(() => lines.reduce((total, line) => total + (products.find(p => p.id === line.variantId)?.price ?? 0) * line.quantity, 0), [lines, products]);
  const tendered = method === "cash" ? parseMoney(cash) : subtotal;
  const change = Math.max(0, tendered - subtotal);
  const categories = useMemo(() => [...new Map(products.map(product => [product.categoryId, { id: product.categoryId, name: product.categoryName }])).values()].sort((a,b) => a.name.localeCompare(b.name)), [products]);
  const brands = useMemo(() => [...new Map(products.filter(product => !categoryId || product.categoryId === categoryId).map(product => [product.brandId, { id: product.brandId, name: product.brandName }])).values()].sort((a,b) => a.name.localeCompare(b.name)), [products, categoryId]);
  const matchingProducts = filterPosProducts(products, { search, categoryId, brandId });
  const visibleProducts = matchingProducts.slice(0, 40);

  function changeCategory(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    if (brandId && !products.some(product => product.brandId === brandId && (!nextCategoryId || product.categoryId === nextCategoryId))) {
      setBrandId("");
    }
  }

  function add(product: PosProduct) {
    if (pending || (product.stock[locationId] ?? 0) <= 0) return;
    setLines(current => {
      const existing = current.find(line => line.variantId === product.id);
      return existing ? current.map(line => line.variantId === product.id ? { ...line, quantity: Math.min(10000, product.stock[locationId] ?? 0, line.quantity + 1) } : line) : [...current, { variantId: product.id, quantity: 1 }];
    });
  }
  function setQuantity(variantId: string, quantity: number) {
    if (pending || !Number.isSafeInteger(quantity) || quantity < 1) return;
    const max = Math.min(10000, products.find(p => p.id === variantId)?.stock[locationId] ?? 0);
    if (max < 1) return;
    setLines(current => current.map(line => line.variantId === variantId ? { ...line, quantity: Math.min(max, quantity) } : line));
  }
  function removeLine(variantId: string) {
    if (!pending) setLines(current => current.filter(line => line.variantId !== variantId));
  }

  function checkout() {
    setMessage(""); setReceiptId(""); setReceipt(null);
    if (!locationId || !lines.length) { setMessage("Choose a location and add at least one product."); return; }
    if (method === "cash" && tendered < subtotal) { setMessage("Cash received must cover the total."); return; }
    const data = { locationId, customerName: customerName.trim(), paymentMethod: method, amountTendered: tendered, items: lines };
    const body = JSON.stringify(data);
    if (request.current.body !== body) request.current = { body, id: crypto.randomUUID() };
    startTransition(async () => {
      try {
        const result = await submitPosSale({ ...data, requestId: request.current.id });
        if (!result.ok) { setMessage(result.error); return; }
        setReceiptId(result.id);
        setReceipt({ total: subtotal, change: method === "cash" ? Math.max(0, tendered - subtotal) : 0, method });
        setMessage("Sale recorded and inventory updated.");
        setLines([]); setCash(""); setCustomerName(""); request.current = { body: "", id: "" };
        router.refresh();
      } catch {
        setMessage("The result could not be confirmed. Retry without changing the sale to avoid creating a duplicate.");
      }
    });
  }

  return <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
    <Card className="min-w-0 gap-4">
      <CardHeader><CardTitle className="text-xl">Products</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 min-[68.75rem]:grid-cols-2">
          <label className="text-sm">Store location<select disabled={pending} className={field} value={locationId} onChange={event => { setLocationId(event.target.value); setLines([]); }}>
            {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select></label>
          <label className="text-sm">Search by name, SKU, or barcode<input className={input} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const term = search.trim().toLowerCase();
            const exact = matchingProducts.find(product => (product.barcode?.toLowerCase() === term || product.sku.toLowerCase() === term) && (product.stock[locationId] ?? 0) > 0);
            if (exact) { add(exact); setSearch(""); }
          }} placeholder="Scan or type to search…" /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 min-[68.75rem]:grid-cols-2">
          <label className="text-sm">Category<select className={field} value={categoryId} onChange={event => changeCategory(event.target.value)}>
            <option value="">All categories</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          <label className="text-sm">Brand<select className={field} value={brandId} onChange={event => setBrandId(event.target.value)}>
            <option value="">All brands</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select></label>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Showing {visibleProducts.length} of {matchingProducts.length} matching products</span>
          {(categoryId || brandId || search) && <button type="button" onClick={() => { setCategoryId(""); setBrandId(""); setSearch(""); }} className="min-h-11 px-2 underline underline-offset-4">Clear filters</button>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-2">
          {visibleProducts.map(product => {
            const available = product.stock[locationId] ?? 0;
            return <PosProductCard key={product.id} product={product} disabled={pending || available <= 0} onAdd={() => add(product)} />;
          })}
          {visibleProducts.length === 0 && <p className="p-4 text-sm text-muted-foreground">No matching products.</p>}
        </div>
      </CardContent>
    </Card>
    <Card className="min-w-0 gap-4">
      <CardHeader><CardTitle className="text-xl">Current sale</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm">Customer name <span className="text-muted-foreground">(optional)</span><input className={input} maxLength={160} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Walk-in customer" /></label>
        <div className="divide-y rounded-lg border">
          {lines.map(line => {
            const product = products.find(p => p.id === line.variantId)!;
            const max = Math.min(10000, product.stock[locationId] ?? 0);
            const label = `${product.name} (${product.sku})`;
            return <div key={line.variantId} className="space-y-3 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="break-words font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku} · {peso(product.price)} each</p></div>
                <span className="shrink-0 text-right tabular-nums">{peso(product.price * line.quantity)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <QuantityControl label={label} value={line.quantity} max={max} disabled={pending} onChange={quantity => setQuantity(line.variantId, quantity)} />
                <button type="button" disabled={pending} onClick={() => removeLine(line.variantId)} aria-label={`Remove ${label} from current sale`} className="min-h-11 rounded-md px-3 text-destructive underline underline-offset-4 hover:bg-destructive/10 disabled:opacity-50">Remove</button>
              </div>
            </div>;
          })}
          {lines.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">Add products to start a sale.</p>}
        </div>
        <div className="flex justify-between border-t pt-3 text-lg font-semibold"><span>Total</span><span>{peso(subtotal)}</span></div>
        <label className="block text-sm">Payment method<select className={field} value={method} onChange={event => { setMethod(event.target.value); setCash(""); }}>
          <option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option>
        </select></label>
        {method === "cash" && <><label className="block text-sm">Cash received (PHP)<input className={input} inputMode="decimal" value={cash} onChange={event => setCash(event.target.value)} placeholder="0.00" /></label><div className="flex justify-between text-sm"><span>Change due</span><strong>{peso(change)}</strong></div></>}
        {message && <div role="status" className="rounded-md border p-3 text-sm">{message}{receiptId && <><p className="mt-1 break-all text-xs text-muted-foreground">Sale reference: {receiptId}</p>{receipt && <p className="mt-2">{peso(receipt.total)} · {receipt.method.replaceAll("_", " ")}{receipt.method === "cash" ? ` · change ${peso(receipt.change)}` : " · paid"}</p>}<Link href="/admin/orders" className="mt-2 inline-block text-xs underline">View sales and orders</Link></>}</div>}
        <Button className="w-full" disabled={pending || !lines.length || subtotal <= 0} onClick={checkout}>{pending ? "Recording sale…" : "Complete sale"}</Button>
        <p className="text-xs text-muted-foreground">Completing records a paid, fulfilled POS order. Stock is deducted only for items with stock counting enabled.</p>
      </CardContent>
    </Card>
  </div>;
}

function PosProductCard({product,disabled,onAdd}:{product:PosProduct;disabled:boolean;onAdd:()=>void}) {
  const [failedImage,setFailedImage]=useState<string|null>(null);
  const showImage=Boolean(product.imageUrl)&&failedImage!==product.imageUrl;
  return <button type="button" disabled={disabled} onClick={onAdd} aria-label={`Add ${product.name} (${product.sku}), ${peso(product.price)}`} title={`${product.name} · ${product.sku}`} className="flex aspect-square w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-background text-left transition hover:border-primary hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
    <span className="relative block min-h-0 w-full flex-1 bg-muted/40">
      {showImage ? <Image src={product.imageUrl!} alt="" fill unoptimized sizes="(min-width: 1280px) 300px, (min-width: 1024px) 400px, 50vw" className="object-contain p-2" onError={()=>setFailedImage(product.imageUrl)}/> : <span className="flex h-full items-center justify-center" aria-hidden="true"><ImageIcon className="size-10 text-muted-foreground/40"/></span>}
    </span>
    <span className="block w-full space-y-1 border-t bg-card p-2"><span className="line-clamp-2 text-sm font-medium leading-tight">{product.name}</span><span className="block text-sm font-semibold text-primary">{peso(product.price)}</span></span>
  </button>;
}

function QuantityControl({ label, value, max, disabled, onChange }: { label: string; value: number; max: number; disabled: boolean; onChange: (quantity: number) => void }) {
  const [draft, setDraft] = useState({ quantity: value, text: String(value) });
  const text = draft.quantity === value ? draft.text : String(value);
  const button = "flex min-h-11 w-11 items-center justify-center rounded-md border bg-background text-xl hover:bg-muted disabled:opacity-40";
  return <div className="flex items-center gap-1" role="group" aria-label={`Quantity controls for ${label}`}>
    <button type="button" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} aria-label={`Decrease quantity for ${label}`} className={button}>−</button>
    <input aria-label={`Quantity for ${label}`} className="min-h-11 w-16 rounded-md border bg-background px-1 text-center" type="number" inputMode="numeric" min="1" max={max} step="1" disabled={disabled || max < 1} value={text}
      onChange={event => {
        const next = event.target.value;
        setDraft({ quantity: value, text: next });
        if (next !== "" && /^\d+$/.test(next) && Number.isSafeInteger(Number(next)) && Number(next) >= 1) {
          const quantity = Math.min(max, Number(next));
          setDraft({ quantity, text: String(quantity) });
          onChange(quantity);
        }
      }}
      onBlur={() => setDraft({ quantity: value, text: String(value) })}
    />
    <button type="button" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`Increase quantity for ${label}`} className={button}>+</button>
  </div>;
}

function parseMoney(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) return 0;
  const [whole, cents = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}
