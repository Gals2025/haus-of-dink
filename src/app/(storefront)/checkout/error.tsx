"use client";
export default function CheckoutError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-4xl space-y-4 p-8"><h1 className="text-2xl">Checkout is temporarily unavailable</h1><p>Please try again shortly or contact the store.</p><button onClick={reset} className="underline">Try again</button></div>;
}
