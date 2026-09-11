# Small integration helpers suggested by a MuJoCo delivery experiment

A MicroDuck delivery project used the existing Blitz 0.12.0 viewer, a project-local MuJoCo WASM plugin, and native MuJoCo 3.8.1 CPU training. Reusing those pieces worked, but three integration contracts required repeated custom code. These are proposals for small helpers and validation examples, grounded in that experiment; the failures below were in the integration, not established Kite3D engine defects.

## 1. Keep collider, visual, and cached geometry in agreement

Use one descriptor for a collider's stable ID, shape, pose, and dimensions. The simulator adapter and renderer should consume it, and validation should compare the resulting geometry rather than just the descriptor.

The workshop boxes were emitted four ways: native MJCF (`training/layout.py:scene_xml`), authored glTF (`tools/build_scene.py`), episode replay (`Delivery.layout`), and the WASM collision overlay (`moveCollision`). Two failures survived a position-only check:

- Moving a static crate changed `geom_xpos` but left MuJoCo's compiled world BVH stale. At the relocated crate, the robot produced zero contacts; disabling midphase produced 12 parcel/torso/foot contacts. `mj_setConst` did not repair that case.
- Changing a crate's `geom_size` also required refreshing its `geom_rbound`. A perimeter sweep found 38 contact-count differences over 128 probe states before refreshing the radius. For these boxes, the radius is the Euclidean norm of the half-sizes. Rendering also needed to scale the mesh and overlay, rather than update only their positions.

These observations are specific to direct native model mutation in MuJoCo 3.8.1. **Do not make disabling midphase a general engine default.** Prefer a supported update path or model reconstruction, and keep cache maintenance inside the simulator adapter. The small experiment used disabled midphase plus refreshed box radii, then verified perimeter contacts against a freshly compiled model.

A useful first deliverable is a collider descriptor/validation example with:

- explicit half-size versus full-size conventions and a single coordinate transform;
- checks of actual visual bounds and physical contact near centers **and edges** after reset;
- reference comparison against a freshly compiled layout, avoiding two copies of the same mutation bug;
- a clear boundary: editing scene art does not silently change the simulator model.

## 2. Share timestamped pose playback, not task-specific navigation

The original pond viewer and the delivery viewer both cloned robot CAD body groups, converted Z-up to Y-up, reordered quaternions, interpolated recorded poses, and drew ghosts. The original `floor(t / 0.2)` lookup assumed uniform samples; collision termination can produce a shorter final interval. The delivery viewer instead binary-searches recorded timestamps, linearly interpolates position, and uses quaternion slerp.

A small body-pose timeline helper could accept copied snapshots with stable body IDs and timestamps. It should specify the coordinate/quaternion convention, clamp at the first/last frame, and handle one-frame and shortened-terminal recordings. It should not own observations, rewards, motor control, or policy inference.

Ghost comparisons also need immutable identity. Names such as `untrained-700` were reused across training runs. Fetches and caches now include run ID, evaluation revision, and attempt ID; ghosts compare the same layout at the same simulation time. A late response from an older run must not replace the current attempt.

## 3. Extend runtime ownership to pending asynchronous work

`RuntimeObjectOwner` already handled roots, clones, and resource cleanup. Remaining glue in `Delivery.start/stop/collision` covered pending model loads, fetch cancellation, polling, DOM, camera restoration, and ghost materials.

The component had to retain the session returned by `createSession()` immediately, close it on Stop, and check ownership again after awaited calls. Checking only `active` is insufficient: Stop followed by Play can make an old operation appear active again. Replacing a cloned material also required disposing the displaced clone, which the final root traversal could no longer find.

An opt-in cancellable resource scope around existing runtime ownership would be useful if it can demonstrate these behaviors:

- Stop during load, then immediately Play: the old session closes and cannot attach a view;
- aborted/late requests cannot update a new component instance;
- repeated Play/Stop restores authored transforms and camera state, removes UI/timers, and leaves zero sessions;
- replaced owned materials are disposed without disposing source resources.

## What stays outside the engine

SB3 checkpoint filename handling and a Torch 2.14 nested-ZIP loading workaround were real experiment failures, but belong in trainer-specific code. Likewise, the native trainer's atomic JSON publication should remain task glue until another integration demonstrates a common API. Start with the collider example, timeline primitive, and cancellation tests rather than a training framework.

## Evidence and limits

The experiment's integration notes identify the functions above; the final local source commit is `8afddd4` in `microduck-test-delivery` (experiment provenance, not a commit in this repository). All 92 scheduled frozen-policy evaluations were repeated after the bounding-radius fix with no changes to outcomes, durations, or returns. The final policy achieved 10/12 held-out deliveries; that score is not evidence that a proposed helper generalizes.

Eight native checks, a matched-version native/WASM contact fixture, and Blitz Playable/Editable/Persisted checks passed. The stronger reusable evidence is the collider perimeter comparison, nonuniform timestamp case, and Play/Stop ownership checks. Short native/WASM parity does not establish identical long-horizon robot trajectories.
