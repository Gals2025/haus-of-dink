import "server-only";
import { sql } from "drizzle-orm";
import type { AuthSession } from "../auth/authorize";
import { catalogActor } from "./queries";
import type { ProductImageInput } from "./image-contracts";

export function imageTargetQuery(identity: AuthSession, productId: string, variantId: string | null) {
  return sql`with actor as materialized (${catalogActor(identity,"inventory:write")})
    select p.id from products p where p.id=${productId}::uuid and p.status<>'archived' and exists(select 1 from actor)
    and (${variantId}::uuid is null or exists(select 1 from product_variants where id=${variantId}::uuid and product_id=p.id))`;
}
export function saveProductImageQuery(identity: AuthSession, input: ProductImageInput) {
  return sql`with actor as materialized (${catalogActor(identity,"inventory:write",true)}),
    target as materialized (select p.id from products p where p.id=${input.productId}::uuid and p.status<>'archived' and exists(select 1 from actor)
      and (${input.variantId}::uuid is null or exists(select 1 from product_variants where id=${input.variantId}::uuid and product_id=p.id)) for update of p),
    demoted as (update product_images set is_primary=false,updated_at=clock_timestamp() where product_id in (select id from target)
      and variant_id is not distinct from ${input.variantId}::uuid and is_primary returning id),
    saved as (insert into product_images(product_id,variant_id,blob_url,alt_text,is_primary,sort_order)
      select target.id,${input.variantId}::uuid,${input.imageUrl},${input.altText},true,0 from target where (select count(*) from demoted)>=0 returning id,product_id),
    logged as (insert into catalog_audit(actor_id,product_id,action,changes)
      select actor.id,saved.product_id,'update',jsonb_build_object('fields',jsonb_build_array('images'),'imageId',saved.id,'variantId',${input.variantId}::uuid,'primary',true)
      from actor cross join saved returning id)
    select exists(select 1 from logged) as saved`;
}
