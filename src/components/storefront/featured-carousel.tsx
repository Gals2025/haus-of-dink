"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { FeaturedItem } from "@/server/featured/contracts";

export function FeaturedCarousel({ items }: { items: FeaturedItem[] }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const slides = items.filter((item) => item.active).slice(0, 3);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = window.setInterval(() => setCurrent((index) => (index + 1) % slides.length), 6500);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  useEffect(() => {
    if (current >= slides.length) setCurrent(0);
  }, [current, slides.length]);

  if (!slides.length) return null;
  const slide = slides[current] ?? slides[0]!;
  const imageUrl = slide.imageUrl?.replaceAll("\\", "%5C").replaceAll('"', "%22").replaceAll("(", "%28").replaceAll(")", "%29");
  const move = (direction: number) => setCurrent((index) => (index + direction + slides.length) % slides.length);

  return (
    <section className="featured-section" aria-labelledby="featured-heading">
      <div className="featured-heading">
        <div>
          <p className="featured-kicker">A LITTLE SOMETHING FROM THE HAUS</p>
          <h2 id="featured-heading">Featured</h2>
        </div>
        <p>Good finds for your next game.</p>
      </div>
      <div
        className="featured-carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}
        aria-roledescription="carousel"
        aria-label="Featured items"
      >
        <article className="featured-slide" key={slide.slot} aria-roledescription="slide" aria-label={`${current + 1} of ${slides.length}`}>
          <div className="featured-copy" aria-live="polite">
            <span className="featured-eyebrow">{slide.eyebrow || "FEATURED"}</span>
            <h3>{slide.title}</h3>
            <p>{slide.description}</p>
            <Link href={slide.href} className="featured-cta">{slide.ctaLabel}<ArrowRight aria-hidden="true" className="size-4" /></Link>
          </div>
          <div
            className={`featured-art${slide.imageUrl ? " has-image" : ""}`}
            role={slide.imageUrl ? "img" : undefined}
            aria-label={slide.imageUrl ? (slide.imageAlt || slide.title) : undefined}
            style={imageUrl ? { backgroundImage: `linear-gradient(90deg, rgb(17 62 26 / 10%), rgb(17 62 26 / 6%)), url("${imageUrl}")` } : undefined}
            aria-hidden={slide.imageUrl ? undefined : true}
          >
            {!slide.imageUrl && <><span className="featured-art-ball" /><span className="featured-art-paddle" /><span className="featured-art-swoosh" /></>}
            <span className="featured-art-number">0{slide.slot} <span>/ 03</span></span>
          </div>
        </article>
        <div className="featured-controls">
          <div className="featured-dots" aria-label="Choose featured slide">
            {slides.map((item, index) => (
              <button key={item.slot} type="button" onClick={() => setCurrent(index)} aria-label={`Show slide ${index + 1}: ${item.title}`} aria-current={current === index ? "true" : undefined} className={current === index ? "is-current" : ""} />
            ))}
          </div>
          <span className="featured-count">{String(current + 1).padStart(2, "0")} <i>/</i> {String(slides.length).padStart(2, "0")}</span>
          <div className="featured-arrows">
            <button type="button" onClick={() => move(-1)} aria-label="Previous featured item" disabled={slides.length < 2}><ArrowLeft aria-hidden="true" /></button>
            <button type="button" onClick={() => move(1)} aria-label="Next featured item" disabled={slides.length < 2}><ArrowRight aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
