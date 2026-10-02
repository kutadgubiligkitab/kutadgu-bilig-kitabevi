# Legacy Supabase book-cover cleanup

This directory records the verified deletion of migrated book covers from the Supabase Storage bucket `book-covers`. Private R2 objects are the copies that stay. The bucket itself stays.

## What may be deleted

Only an object that is listed in `deletion-manifest.json` and `restore-manifest.json`.

- Class A: a book cover or gallery object whose current `books` row points at the canonical `/__r2/book-covers/` URL, whose Supabase and R2 bytes have the same size and SHA-256, and whose old Supabase URL is not referenced.
- Class B: the two old Hero slide sources that are no longer referenced by `store_hero_store_slides`.

## What must stay

`protected-snapshot.json` is the pre-delete snapshot of:

- Class C: Book Staff objects under `staff/`
- Class E: objects that were not proved to be migrated book covers

No deletion batch may contain those paths. Do not delete the bucket. Do not delete any R2 object.

## How deletion is performed

Use the Storage HTTP API for one exact object at a time:

```text
DELETE /storage/v1/object/book-covers/<exact-path>
```

`scripts/legacy-cover-storage/delete-exact.js` does that. It is a dry run until `--apply` is passed. It refuses wildcards, folder paths, prefix collisions, Class C, and Class E. It does not run `DELETE FROM storage.objects`.

```bash
node scripts/legacy-cover-storage/delete-exact.js --class A --limit 10
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/legacy-cover-storage/delete-exact.js --apply --class A --limit 10
```

The service-role key is an environment variable. Do not write it into this directory.

## How to restore

`restore-from-r2.js` downloads the matching private object through its canonical Cloudflare URL, checks the size and SHA-256 against `restore-manifest.json`, then uploads that exact path back to Supabase Storage with the recorded content type. It does not delete.

```bash
node scripts/legacy-cover-storage/restore-from-r2.js --path 'book/example.webp'
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/legacy-cover-storage/restore-from-r2.js --apply --path 'book/example.webp'
```

Do not run a restore unless a deleted object actually needs to come back.
