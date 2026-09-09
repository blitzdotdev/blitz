# Blob garbage collection note

Objects under `blobs/<sha256>` are content-addressed and shared by every game and release.
Expiry deletes game, token, and release rows through foreign-key cascades.
It never deletes blobs.

A future garbage collector should mark every SHA-256 referenced by `releases.manifest_json`, then sweep unmarked objects after a safety window.
It must account for releases that are not currently active because rollback depends on them.
