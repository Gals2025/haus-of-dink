"use client";
export default function CommerceError({reset}:{reset:()=>void}) {
  return <div role="alert" className="space-y-4"><h2 className="text-xl">Store operations are unavailable</h2><p>Refresh and try again. If this persists, ask your administrator to check database connectivity and migration 0010_commerce.</p><button onClick={reset} className="rounded-md border px-4 py-2">Try again</button></div>;
}
