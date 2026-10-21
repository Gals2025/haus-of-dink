import Link from "next/link";
import { CircleDot } from "lucide-react";

export function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-3 font-bold tracking-tight"
      aria-label="Haus of Dink home"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CircleDot aria-hidden="true" className="size-5" />
      </span>
      <span className="text-lg">
        HAUS OF DINK<span className="ml-1 text-primary">.</span>
      </span>
    </Link>
  );
}
