import Link from "next/link";
import { ArrowRight, CircleDot, Layers3, MoveUpRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const collections = [
  { number: "01", name: "Paddles", description: "Find your feel. Make every shot count.", icon: CircleDot },
  { number: "02", name: "Accessories", description: "The little things that elevate your game.", icon: Layers3 },
];

export default function HomePage() {
  return (
    <>
      <section className="home-hero">
        <div className="home-copy">
          <Badge variant="outline" className="hero-eyebrow">THE NEXT CHAPTER STARTS HERE</Badge>
          <h1>Good gear.<br />Great games.<br /><em>Your haus.</em></h1>
          <p>At Haus of Dink, we create the must-have essentials that keep your gear fresh, your style sharp, and your game ready for every rally.</p>
          <Link href="/shop" className={cn(buttonVariants({ size: "lg" }), "hero-cta")}>
            Explore the shop <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <div className="hero-mark" aria-label="Haus of Dink, pickleball essentials">
          <div className="hero-swoosh hero-swoosh-one" />
          <div className="hero-swoosh hero-swoosh-two" />
          <div className="hero-wordmark">
            <div className="wordmark-top">HAUS<span className="wordmark-of">of</span></div>
            <div className="wordmark-bottom">DINK<span className="wordmark-paddle" /></div>
            <div className="wordmark-tagline">PICKLEBALL ESSENTIALS</div>
          </div>
          <div className="pickleball" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
        </div>
      </section>
      <section className="collections-section" aria-labelledby="collections-heading">
        <div className="collections-heading">
          <h2 id="collections-heading">Court essentials</h2>
          <span>A first look at what’s ahead</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map(({ number, name, description, icon: Icon }) => (
            <Link key={name} href="/shop" className="group flex items-center gap-5 rounded-xl border bg-card p-7 transition-colors hover:bg-muted">
              <Icon aria-hidden="true" className="size-12 shrink-0 rounded-full bg-accent p-2.5 text-primary" strokeWidth={1.5} />
              <div className="flex-1">
                <p className="mb-2 text-xs text-muted-foreground">{number} / COMING SOON</p>
                <h3 className="text-xl font-normal">{name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
              <MoveUpRight aria-hidden="true" className="size-5" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
