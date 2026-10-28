import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FeaturedCarousel } from "@/components/storefront/featured-carousel";
import { defaultFeaturedItems } from "@/server/featured/contracts";
import { listFeaturedItems } from "@/server/featured/service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const featuredItems = await listFeaturedItems().catch(() => defaultFeaturedItems);
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
      <FeaturedCarousel items={featuredItems} />
    </>
  );
}
