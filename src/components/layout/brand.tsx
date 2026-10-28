import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex flex-col items-start text-primary"
      aria-label="Haus of Dink home"
    >
      <span className="font-serif text-[1.75rem] leading-[0.83] tracking-tight">
        HAUS <span className="text-[0.7em] italic">of</span><br />DINK
      </span>
      <span className="mt-1 text-[0.48rem] font-bold tracking-[0.12em]">
        PICKLEBALL ESSENTIALS
      </span>
    </Link>
  );
}

