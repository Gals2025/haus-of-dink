import Link from "next/link";
import { ArrowRight, CircleDot, Layers3, MoveUpRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const collections = [
  {
    number: "01",
    name: "Paddles",
    description: "Find your feel. Make every shot count.",
    icon: CircleDot,
  },
  {
    number: "02",
    name: "Accessories",
    description: "The little things that elevate your game.",
    icon: Layers3,
  },
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:px-10 lg:py-24">
        <div>
          <Badge variant="outline" className="mb-7">
            THE NEXT CHAPTER STARTS HERE
          </Badge>
          <h1 className="max-w-xl text-6xl font-normal leading-[1.02] tracking-tighter sm:text-7xl">
            Good gear.
            <br />
            Great games.
            <br />
            <span className="text-primary italic">Your haus.</span>
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground">
            Your future home for pickleball paddles and court essentials. Built
            around the game we love.
          </p>
          <Link
            href="/shop"
            className={cn(buttonVariants({ size: "lg" }), "mt-8")}
          >
            Explore the shop <ArrowRight aria-hidden="true" />
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            Storefront preview · Our collection is coming soon.
          </p>
        </div>
        <div
          aria-hidden="true"
          className="relative flex min-h-96 items-center justify-center overflow-hidden rounded-3xl bg-primary text-primary-foreground sm:min-h-[470px]"
        >
          <div className="absolute inset-8 rounded-t-full border border-primary-foreground/25" />
          <div className="absolute inset-x-0 top-1/2 border-t border-primary-foreground/25" />
          <div className="absolute inset-y-0 left-1/2 border-l border-primary-foreground/25" />
          <div className="relative -rotate-12 rounded-[45%] border-8 border-accent bg-accent text-primary p-10 shadow-2xl">
            <CircleDot className="size-28" strokeWidth={1} />
          </div>
          <span className="absolute bottom-7 left-7 text-xs tracking-[0.2em] text-accent">
            MEET YOU AT THE KITCHEN.
          </span>
          <span className="absolute right-7 top-7 text-sm">HOD / 001</span>
        </div>
      </section>
      <section
        className="mx-auto max-w-7xl px-6 pb-20 lg:px-10"
        aria-labelledby="collections-heading"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <h2
            id="collections-heading"
            className="text-3xl font-normal tracking-tight"
          >
            Court essentials
          </h2>
          <span className="text-sm text-muted-foreground">
            A first look at what’s ahead
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map(({ number, name, description, icon: Icon }) => (
            <Link
              key={name}
              href="/shop"
              className="group flex items-center gap-5 rounded-xl border bg-card p-7 transition-colors hover:bg-muted"
            >
              <Icon
                aria-hidden="true"
                className="size-12 shrink-0 rounded-full bg-accent p-2.5 text-primary"
                strokeWidth={1.5}
              />
              <div className="flex-1">
                <p className="mb-2 text-xs text-muted-foreground">
                  {number} / COMING SOON
                </p>
                <h3 className="text-xl font-normal">{name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              </div>
              <MoveUpRight aria-hidden="true" className="size-5" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

