import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex flex-col items-start text-primary"
      aria-label="Haus of Dink home"
    >
      <span className="font-serif text-[1.75rem] leading-none tracking-tight">
        HAUS <span className="text-[0.7em] italic">of</span> DINK
      </span>
      <span className="mt-2 text-[0.55rem] font-bold tracking-[0.22em]">
        PICKLEBALL ESSENTIALS
      </span>
    </Link>
  );
}

