"use client";

import { Button } from "@/components/ui/button";
export default function UsersError({ reset }: { reset: () => void }) {
  return <div className="space-y-4 rounded-xl border bg-card p-8"><h1 className="text-2xl">Accounts unavailable</h1>
    <p role="alert">We could not load team accounts. Try again or sign in again.</p><Button onClick={reset}>Try again</Button></div>;
}
