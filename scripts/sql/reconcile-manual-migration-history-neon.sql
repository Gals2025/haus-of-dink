-- Haus of Dink: reconcile manually installed migrations 0000 through 0006.
-- Target: production branch, neondb, as selected in Neon SQL Editor.
-- This is NOT a schema upgrade. No application table data is written.
-- Tested against the committed migration chain at 298de70.
-- PostgreSQL version/format differences or extra constraints may cause a safe
-- mismatch. Report it; do not remove checks to force completion.
-- Use the plain Run button for the complete file. On any error, ROLLBACK.
-- Plain SQL only: no dollar quoting or escaped newline string literals.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(729142006);
-- Plain SQL guards avoid dollar-quoted blocks in the SQL Editor.
CREATE TEMP TABLE hod_baseline_guard (
 check_name text NOT NULL,
 passed boolean NOT NULL,
 CONSTRAINT hod_baseline_verification CHECK (passed IS TRUE)
) ON COMMIT DROP;
INSERT INTO hod_baseline_guard VALUES
 ('expected database neondb', current_database() = 'neondb'),
 ('migration tracking must be absent', to_regclass('drizzle.__drizzle_migrations') IS NULL);
-- Share locks prevent application data/schema writes during verification.
LOCK TABLE public."attribute_values",
 public."attributes",
 public."brands",
 public."categories",
 public."product_attribute_values",
 public."product_images",
 public."product_variants",
 public."products",
 public."account",
 public."rate_limit",
 public."session",
 public."user",
 public."verification",
 public."admin_audit",
 public."inventory_balances",
 public."inventory_locations",
 public."inventory_movements",
 public."inventory_reservations" IN SHARE MODE;
CREATE TEMP TABLE hod_expected_baseline(kind text,object_count integer,fingerprint text) ON COMMIT DROP;
INSERT INTO hod_expected_baseline VALUES
 ('columns',152,'f2c957d040a565d5a3e366c1303629a1'),
 ('constraints',90,'28b63f165db632dc7be6c6a34d467ce2'),
 ('enums',3,'7651f2db703a18e8ddc1bbc152d0f888'),
 ('functions',8,'0edfd906bca993df508a1a4f927eb0fb'),
 ('indexes',67,'4a306c353db53ef02ce2c86e264d4c94'),
 ('tables',18,'7a176c66167669511edce51011b1b58a'),
 ('triggers',14,'f78f305b72349d52c34020a4ebaad0d4');
CREATE TEMP TABLE hod_actual_baseline ON COMMIT DROP AS
WITH app_tables AS (
 SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
 AND c.relname IN ('attribute_values','attributes','brands','categories','product_attribute_values','product_images','product_variants','products','account','rate_limit','session','user','verification','admin_audit','inventory_balances','inventory_locations','inventory_movements','inventory_reservations')
), objects AS (
 SELECT 'tables' AS kind, t.relname AS name,
 jsonb_build_array(t.relrowsecurity,t.relforcerowsecurity)::text AS definition
 FROM app_tables t
 UNION ALL
 SELECT 'columns',t.relname||'.'||a.attname,
 jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,
 a.attgenerated,a.attidentity,pg_get_expr(d.adbin,d.adrelid))::text
 FROM app_tables t JOIN pg_attribute a ON a.attrelid=t.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraints',t.relname,
 jsonb_build_array(c.contype,c.convalidated,c.condeferrable,c.condeferred,
 regexp_replace(pg_get_constraintdef(c.oid),'[[:space:]]+','','g'))::text
 FROM app_tables t JOIN pg_constraint c ON c.conrelid=t.oid
 WHERE c.contype IN ('p','u','f','c','x')
 UNION ALL
 SELECT 'indexes',t.relname,
 jsonb_build_array(i.indisunique,i.indisprimary,i.indisvalid,i.indisready,
 regexp_replace(substring(pg_get_indexdef(i.indexrelid) FROM ' USING .*'),
 '[[:space:]]+','','g'))::text
 FROM app_tables t JOIN pg_index i ON i.indrelid=t.oid
 UNION ALL
 SELECT 'triggers',t.relname||'.'||g.tgname,
 jsonb_build_array(g.tgenabled,
 regexp_replace(pg_get_triggerdef(g.oid),'[[:space:]]+','','g'))::text
 FROM app_tables t JOIN pg_trigger g ON g.tgrelid=t.oid
 WHERE NOT g.tgisinternal
 UNION ALL
 SELECT 'functions',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_array(l.lanname,format_type(p.prorettype,NULL),p.provolatile,
 p.prosecdef,p.proisstrict,p.proconfig,
 regexp_replace(p.prosrc,'[[:space:]]+','','g'))::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.proname IN ('catalog_set_updated_at','catalog_check_category_cycle','reject_admin_audit_change','require_active_session_user','inventory_immutable','inventory_apply','inventory_validate_reversal')
 UNION ALL
 SELECT 'enums',t.typname,
 jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)::text
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 JOIN pg_enum e ON e.enumtypid=t.oid
 WHERE n.nspname='public' AND t.typname IN
 ('catalog_status','product_status','inventory_movement_type') GROUP BY t.typname
)
SELECT kind,count(*)::integer AS object_count,
 md5(string_agg(jsonb_build_array(name,definition)::text,chr(10)
 ORDER BY name COLLATE "C",definition COLLATE "C")) AS fingerprint
FROM objects GROUP BY kind;
-- Each failed comparison identifies its category in the failing row.
INSERT INTO hod_baseline_guard(check_name,passed)
SELECT 'baseline: ' || coalesce(e.kind,a.kind),
 (e.object_count IS NOT DISTINCT FROM a.object_count)
 AND (e.fingerprint IS NOT DISTINCT FROM a.fingerprint)
FROM hod_expected_baseline e FULL JOIN hod_actual_baseline a USING(kind);
INSERT INTO hod_baseline_guard VALUES
 ('original stockroom location ID', EXISTS(
   SELECT 1 FROM inventory_locations
   WHERE id='00000000-0000-4000-8000-000000000001'));
-- Only the bookkeeping namespace may already exist. No application object
-- creation/repair is skipped, and the ledger must have passed the absent guard.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE drizzle.__drizzle_migrations (
 id SERIAL PRIMARY KEY,
 hash text NOT NULL,
 created_at bigint
);
-- SHA-256 values use Drizzle readMigrationFiles against the committed SQL,
-- with the exact journal timestamps. These are baseline records, not DDL replays.
INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES
 ('52718781106c13e1d96636392fc02b90138838b16e7142aa7c6e3841e1f1bbda',1792603231979),
 ('7ea7be5755f254542cc534cc07db74c7b12c6741905943ad307ed9f6f9021618',1792603241084),
 ('e18136836859c6713c61b6225eaadf58fb1ff9a6edf90a49ab674db3c195d852',1792660000000),
 ('4b0c1dbc08313ee24d6d823f2695b32363122f33d862b3b08809bff48a05c9ed',1792840000000),
 ('9333472757b432dcfd4e6252c255bc270eb0394cb192d852169df16eb1c0df64',1792850000000),
 ('44b1a9fe9a575178f7b620e5b96936e035645215012cc246952012459377e19f',1793000000000),
 ('c8e537efcc249455b2fdce445876cdfcd19955bd05210764ff484c3f34cebbb4',1793008596586);
COMMIT;
SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id;
