"use client";
export default function ProductsError({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4"><h2 className="text-2xl">Products could not be loaded</h2><p>Try again. If a save was interrupted, check the product before repeating it.</p>
    <button onClick={reset} className="rounded-md border px-4 py-2">Try again</button></div>;
}
