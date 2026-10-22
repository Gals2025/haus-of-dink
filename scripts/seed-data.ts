import { createHash } from "node:crypto";
import type { InferInsertModel } from "drizzle-orm";
import * as schema from "../src/server/db/schema";

// Stable, namespaced UUIDs keep reruns safe without overwriting existing data.
function id(key: string): string {
  const hash = createHash("sha256").update(`haus-of-dink:development:${key}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const brandRows: InferInsertModel<typeof schema.brands>[] = [
  ["joola", "JOOLA"], ["selkirk", "Selkirk"], ["paddletek", "Paddletek"],
  ["crbn", "CRBN"], ["franklin", "Franklin"],
].map(([slug, name]) => ({ id: id(`brand:${slug}`), slug: slug!, name: name! }));
const categoryRows: InferInsertModel<typeof schema.categories>[] = [
  ["paddles", "Paddles"], ["balls", "Balls"], ["bags", "Bags"],
  ["shoes", "Shoes"], ["apparel", "Apparel"], ["accessories", "Accessories"],
].map(([slug, name]) => ({
  id: id(`category:${slug}`), slug: slug!, name: name!,
  description: `Pickleball ${name!.toLowerCase()} for practice and match play.`,
}));
const attributeDefinitions = [
  ["thickness", "Thickness", "mm"], ["weight", "Weight", "oz"],
  ["color", "Color", null], ["grip-size", "Grip Size", "in"],
  ["size", "Size", null], ["material", "Material", null],
  ["paddle-shape", "Paddle Shape", null], ["core-material", "Core Material", null],
  ["surface-material", "Surface Material", null],
] as const;
const attributeRows = attributeDefinitions.map(([slug, name, unit]) => ({ id: id(`attribute:${slug}`), slug, name, unit }));
const valueDefinitions = [
  ["thickness", "14-mm", "14"], ["thickness", "16-mm", "16"],
  ["weight", "8-oz", "8.0"], ["color", "black", "Black"],
  ["color", "green", "Green"], ["color", "yellow", "Yellow"],
  ["grip-size", "4-25-in", "4.25"], ["size", "medium", "M"],
  ["size", "large", "L"], ["material", "polyester", "Polyester"],
  ["paddle-shape", "elongated", "Elongated"], ["core-material", "polymer", "Polymer honeycomb"],
  ["surface-material", "carbon-fiber", "Carbon fiber"],
] as const;
const valueRows = valueDefinitions.map(([attribute, slug, value], sortOrder) => ({
  id: id(`value:${attribute}:${slug}`), attributeId: id(`attribute:${attribute}`), slug, value, sortOrder,
}));
const productDefinitions = [
  ["joola-control-paddle", "JOOLA Control Paddle", "joola", "paddles", "Control-focused paddle for consistent placement and comfortable resets."],
  ["selkirk-performance-paddle", "Selkirk Performance Paddle", "selkirk", "paddles", "Performance paddle for all-court practice and match play."],
  ["paddletek-club-paddle", "Paddletek Club Paddle", "paddletek", "paddles", "Versatile club paddle for developing players."],
  ["crbn-paddle-cover", "CRBN Paddle Cover", "crbn", "accessories", "Protective cover for carrying a paddle between sessions."],
  ["franklin-outdoor-balls", "Franklin Outdoor Balls — 3 Pack", "franklin", "balls", "Three outdoor pickleballs for regular court sessions."],
  ["joola-court-bag", "JOOLA Court Bag", "joola", "bags", "Court bag with room for paddles and daily essentials."],
  ["selkirk-training-shirt", "Selkirk Training Shirt", "selkirk", "apparel", "Lightweight training shirt for warm-weather play."],
] as const;
const productRows = productDefinitions.map(([slug, name, brand, category, description], index) => ({
  id: id(`product:${slug}`), name, slug, description, shortDescription: description,
  brandId: id(`brand:${brand}`), categoryId: id(`category:${category}`),
  status: "active" as const, featured: index < 2, newArrival: index < 3,
}));
// Fictional development SKUs; illustrative PHP prices, not a live brand catalog.
const variantDefinitions = [
  ["joola-control-paddle", "DEV-JOO-CTRL-14", 850000, 950000, 550000, "thickness", "14-mm"],
  ["joola-control-paddle", "DEV-JOO-CTRL-16", 900000, 1000000, 580000, "thickness", "16-mm"],
  ["selkirk-performance-paddle", "DEV-SEL-PERF-16", 1100000, null, 750000, "thickness", "16-mm"],
  ["paddletek-club-paddle", "DEV-PAD-CLUB-16", 650000, 700000, 420000, "thickness", "16-mm"],
  ["crbn-paddle-cover", "DEV-CRBN-COVER-BLK", 150000, null, 80000, "color", "black"],
  ["franklin-outdoor-balls", "DEV-FRA-BALL-3-YEL", 75000, null, 45000, "color", "yellow"],
  ["joola-court-bag", "DEV-JOO-BAG-BLK", 350000, 400000, 220000, "color", "black"],
  ["selkirk-training-shirt", "DEV-SEL-SHIRT-M", 180000, null, 95000, "size", "medium"],
  ["selkirk-training-shirt", "DEV-SEL-SHIRT-L", 180000, null, 95000, "size", "large"],
] as const;
const variantRows = variantDefinitions.map(([product, sku, price, compareAtPrice, cost]) => ({
  id: id(`variant:${sku}`), productId: id(`product:${product}`), sku, price, compareAtPrice, cost,
}));
const assignmentRows: InferInsertModel<typeof schema.productAttributeValues>[] = variantDefinitions.map(([product, sku, , , , attribute, value]) => ({
  id: id(`assignment:${sku}:${attribute}`), productId: id(`product:${product}`),
  variantId: id(`variant:${sku}`), attributeId: id(`attribute:${attribute}`),
  attributeValueId: id(`value:${attribute}:${value}`),
}));
const productSpecs = [
  ["joola-control-paddle", "surface-material", "carbon-fiber"],
  ["joola-control-paddle", "core-material", "polymer"],
  ["joola-control-paddle", "paddle-shape", "elongated"],
  ["joola-control-paddle", "grip-size", "4-25-in"],
  ["joola-control-paddle", "weight", "8-oz"],
  ["selkirk-training-shirt", "material", "polyester"],
] as const;
assignmentRows.push(...productSpecs.map(([product, attribute, value]) => ({
  id: id(`assignment:${product}:${attribute}`), productId: id(`product:${product}`),
  variantId: null,
  attributeId: id(`attribute:${attribute}`), attributeValueId: id(`value:${attribute}:${value}`),
})));

export const developmentCatalog = {
  brands: brandRows, categories: categoryRows, attributes: attributeRows,
  attributeValues: valueRows, products: productRows, variants: variantRows,
  assignments: assignmentRows,
};
