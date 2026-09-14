# The Kite3D editor rewrite

Revision 3, 2026-09-14. This is a plan you mark: every section ends with a `[ ]` line, and each open decision has its own. Edit any sentence you disagree with; the passes get briefed from this file. The code blocks are the shape the passes must produce, written against the real upstream files and our real server, so a pass can start from them. Your two notes on revision 2 are folded in and quoted where they land (sections 4.2 and 10).

Paths: `packages/editor` is the upstream editor (repalash/threepipe-blueprint-editor at 7fac408) as it sits in `~/kite3d`; `packages/kite3d` and `packages/engine` are ours after the cleanup (#30 on the old repository). Line numbers refer to those trees. Lines of the deleted project hub refer to the old repository at `f87b8c6^`, the commit before the cleanup.

## 0. The rule

Every line in the new editor is upstream's unless one of five reasons forces a change: the local dev server owns the file system; the simplifications that fall out of watching the file system and treating the editor as a pure client; agent-editable glTF text instead of GLB; one `createGame` so embedding a game is easy; a bug fix or a better abstraction. That is the whole rule. Anything else needs a line here and your mark.

- [ ] Accept the rule.

## 1. Why a restart and not a cleanup

Let me start with the number that decided this. Three audits compared our tree against upstream and against the five reasons. About 80 percent of the editor diff, 80 percent of the CLI package and 20 percent of the engine fell outside the reasons. Deleting in place would have converged to the same core, but with residue, and with every upstream helper that had been rewritten staying rewritten. Worse, our editor history started on 2026-09-09 with a file copy, so upstream could never be merged again.

A restart keeps upstream's code as upstream wrote it and swaps only the layer that touched the browser file system. The helpers we had thrown away come back for free: `ScriptUtil`, `PlayModeHelper` with pause, `ProjectSettingsManager` with add and remove of scripts and plugins, `EditPreviewHelper`, `AssetTracker`. And the fork has history, so `git merge upstream/master` keeps working.

The kite3d and engine packages are different. They are new code with no upstream, their justified cores are small and known, and the cleanup already stripped the rest. They carry over as they are, plus the project hub that section 10 brings back from history.

- [ ] Accept the restart.

## 2. The repository

This part is done. `~/kite3d` is the new monorepo and will become master of the kite3d repository when 0.20.0 ships from it. No GitHub remote exists yet; say the name when you want it pushed.

```
~/kite3d  (branch main)
├── packages/
│   ├── editor/               upstream editor at 7fac408, git mv, history follows every file
│   ├── engine/               createGame, the glTF serializer, the format parsers, the plugins
│   ├── kite3d/               init, dev, screenshot, skills, publish (prints a skill path); open returns in section 10
│   ├── threepipe/            0.5.1 plus shouldExportObject in the exporter
│   └── uiconfig-blueprint/   vendored, 0.1.0-dev.14
├── scripts/                  release.mjs, set-version.mjs, build-uiconfig-blueprint.mjs
├── .github/workflows/        ci.yml, release.yml
├── docs/agents.md            the agent guide, equal to packages/kite3d/template/AGENTS.md
├── AGENTS.md                 repository rules for agents
└── package.json              workspaces, the three override, build, lint, test, release scripts

upstream/master ──► upstream-master   (mirror of repalash, never edited)
                          │
                          └──► main    (the rewrite; `git merge upstream/master` when he fixes something)
```

Nothing builds yet. The editor's `package.json` still points at upstream's `file:../threepipe` link, and the deletions of section 3 have not run. That is step 1 of section 14.

- [ ] Accept the layout: one monorepo, five packages, upstream's branch kept as a mirror.
- [ ] Fork point: head 7fac408. (Alternative: c3d8c6a, the exact point we forked; head adds upstream's camera selection improvement, seven files.)

## 3. What goes from upstream

Upstream carried a whole second product inside the editor: an MCP bridge with a WebSocket server and two chat tabs, a browser file system layer with IndexedDB, a service worker that served project modules, a directory picker welcome flow, a single-file mode for opening one GLB without a project, and templates that bootstrapped a project on first open. None of it survives contact with a dev server that owns the folder.

The list, all of it with no importer left once the adapter of section 4 and the picker of section 10 exist:

```
src/utils/ai/, AIAgentTab.tsx, AIMCPTab.tsx      MCP bridge and the chat tabs                    2,054 lines
src/utils/BrowserFileStore.ts, FetchProxy.ts, FileTracker.ts, fsImporter.ts, public/fs-sw.js,
    resolveNameConflict.ts, the IndexedDB half of project.ts, the idb dependency
                                                  the browser file system and the service worker
src/utils/fsApi.ts: queryHandlePerm (55 to 69) and the BroadcastChannel in AnotherFSHelper (80)
                                                  the rest of the file stays; it is the seam of section 4
src/components/Welcome*.tsx, WelcomeScreen.scss, utils/projectActions.tsx, refreshProjectQueryState.ts
                                                  the directory picker, 953 lines; section 10 replaces it
src/components/SaveFileButton.tsx, UseSaveFile.tsx, data/EmptyProjectSettings.ts,
    saveFileAdHoc (ViewerInstanceManager.ts:466) and saveSceneAdHoc (1003)
                                                  single-file mode; UseSaveFile.tsx:76 is the only caller
src/data/projectTemplates.ts, AgentsMdTemplate.md, GitignoreTemplate.txt
                                                  bootstrap on open; kite3d init owns it          ~850
project.ts buildProjectBundleCode, player.ts, public/player.html
                                                  the published bundle; createGame is the runtime
src/utils/importMaps.ts, importmap-vite-plugin, es-module-shims in index.html
                                                  the server injects the import map
src/utils/SandboxPlugin.ts, reportWebVitals.ts, EditorStructure.ts, GridMaterial.ts,
    UseRenderingTrace.tsx, HtmlUiComponent.example.ts and .md
                                                  dead upstream too
src/components/MemoryTab.tsx                      shows the FileTracker stash
backend/, scripts/upload-r2.mjs, packages/mcp-bridge/, tests/, .github/
                                                  not the editor package
```

What stays even though it looks browser-shaped: `fsApi.ts` minus the two items above (its `getDirHandle`, `getFileHandle`, `writeFileHandle` and `AnotherFSHelper` are the helpers every save goes through), `AssetTracker` (the in-memory asset registry; it imports by URL through the importer and never touches a handle), `ScriptUtil` and `modules.ts` (section 7 changes one function), `PlayModeHelper` (section 6), `ProjectSettingsManager`, `EditPreviewHelper`, `EditorFeatures`, the tsdb Library client (section 9), and upstream's thumbnails and save backups, which now land under `.kite3d/`.

- [ ] Accept the deletions.

## 4. Feature: the dev server as the file system

Here is the one idea this whole section rests on. Upstream never calls the browser file system directly; it calls a handle. Every read and write goes through `FileSystemDirectoryHandle` and `FileSystemFileHandle`, and I counted exactly which members, in the tree that remains after section 3:

```
getFileHandle / getDirectoryHandle   34 call sites     project.ts, ScriptUtil.ts, ViewerInstanceManager.ts,
                                                       ProjectSettingsManager.ts, FilesPanel.tsx
getFile()                            11 call sites     six files
entries()                             1 call site      AssetsProvider.ts:40, directoryToManifest
createWritable().write().close()      1 call site      fsApi.ts:72, writeFileHandle (the two in saveFileAdHoc go with it)
isSameEntry()                         1 call site      ScriptUtil.ts:635, the FileSystemObserver branch, which goes (section 7)
queryPermission / requestPermission   3 call sites     fsApi.ts:56, project.ts:151, ViewerInstanceManager.ts:612
kind, name                            reads only
never                                 removeEntry, values, keys, resolve, seek, truncate, showSaveFilePicker
```

If two small classes implement the first four rows over HTTP, every upstream helper runs unchanged. That is the seam, and it is why the rewrite is small.

### 4.1 The transport

`DevServerSource` is carried over from the old editor and trimmed to what the handles and the screenshot need. It is the only file that knows the routes.

```ts
// packages/editor/src/devserver/DevServerSource.ts
export interface ProjectFileEntry { path: string; size: number; sha256: string; mtime: number }
export interface ProjectReadResult { bytes: Uint8Array; sha256: string }
export type ProjectEvent =
    | { type: 'change' | 'add' | 'unlink'; path: string; sha256?: string; client?: string }
    | { type: 'command'; id: string; command: 'screenshot'; options: { name?: string; width?: number; height?: number } }

export class ProjectConflictError extends Error {
    constructor(readonly path: string, readonly sha256?: string) { super(`${path} changed on disk`) }
}

export class DevServerSource {
    readonly clientId = crypto.randomUUID()
    private readonly token: string
    constructor(readonly base = new URL('/', location.href)) {
        const token = new URL(location.href).searchParams.get('t')
        if (!token) throw new Error('Open the tokenized URL printed by kite3d dev.')
        this.token = token
    }
    private headers(extra: Record<string, string> = {}) {
        return { 'X-Kite3D-Token': this.token, 'X-Kite3D-Client': this.clientId, ...extra }
    }
    async list(): Promise<ProjectFileEntry[]> { return this.json('/api/files') }
    async listDirectories(): Promise<string[]> { return (await this.json<{ directories: string[] }>('/api/directories')).directories }
    async createDirectory(path: string) { await this.json('/api/directories', { method: 'POST', body: JSON.stringify({ path }), headers: { 'Content-Type': 'application/json' } }) }
    async state(): Promise<{ hub?: true; name?: string; versions?: Record<string, string> }> { return this.json('/api/state') }
    async read(path: string): Promise<ProjectReadResult> {
        const res = await fetch(this.fileUrl(path), { headers: this.headers() })
        if (!res.ok) throw new Error(`Cannot read ${path}: ${res.status}`)
        return { bytes: new Uint8Array(await res.arrayBuffer()), sha256: (res.headers.get('etag') || '').replace(/"/g, '') }
    }
    async write(path: string, bytes: Blob | Uint8Array | string, ifMatch: string | '*'): Promise<{ sha256: string }> {
        const res = await fetch(this.fileUrl(path), {
            method: 'PUT', body: bytes,
            headers: this.headers({ 'Content-Type': 'application/octet-stream', 'If-Match': ifMatch === '*' ? '*' : `"${ifMatch}"` }),
        })
        if (res.status === 412) throw new ProjectConflictError(path, (await res.json()).sha256)
        if (!res.ok) throw new Error(`Cannot write ${path}: ${res.status}`)
        return res.json()
    }
    async delete(path: string) {
        const res = await fetch(this.fileUrl(path), { method: 'DELETE', headers: this.headers() })
        if (!res.ok && res.status !== 404) throw new Error(`Cannot delete ${path}: ${res.status}`)
    }
    events(listener: (event: ProjectEvent) => void): () => void {
        const source = new EventSource(`/api/events?client=${encodeURIComponent(this.clientId)}`)
        for (const type of ['change', 'add', 'unlink', 'command'] as const) {
            source.addEventListener(type, (e) => listener({ type, ...JSON.parse((e as MessageEvent).data) }))
        }
        return () => source.close()
    }
    fileUrl(path: string, sha256?: string, revision?: number): string {
        const url = new URL('/files/' + path.split('/').map(encodeURIComponent).join('/'), this.base)
        if (sha256) url.searchParams.set('v', sha256)
        if (revision) url.searchParams.set('r', String(revision))
        return url.href
    }
    async screenshotResult(id: string, png: Blob) {
        await fetch(`/api/screenshot/${id}`, { method: 'POST', body: png, headers: this.headers({ 'Content-Type': 'image/png' }) })
    }
    private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
        const res = await fetch(new URL(path, this.base), { ...init, headers: this.headers(init.headers as Record<string, string>) })
        if (!res.ok) throw new Error(`${path}: ${res.status}`)
        return res.json()
    }
}
```

The server side is unchanged from the cleanup branch: `GET /api/files` returns `{path, size, sha256, mtime}` entries, `GET /files/<path>` answers with an `ETag` and rewrites relative imports in `.m?js` files when `?v=` is present, `PUT /files/<path>` requires `If-Match` and writes through a temp file and a rename, `GET /api/events` is Server-Sent Events with a 150 ms coalescing window per path. The token is accepted from the header, from the per-port cookie the first page load sets, or from `?t=` on GET, which is what keeps `<script type=module>` and `viewer.load` working without a header.

### 4.2 The handles

> Your note on revision 2: "remove never used and simplify the File System Access API"

Agreed, and it changes the shape of the adapter. Revision 2 mimicked the browser interfaces, which meant pretending to implement members nobody calls, and a cast at the boundary so TypeScript would accept the pretence. That is a type that lies. The adapter now has its own two interfaces with exactly the members of the table above, and upstream's type annotations move to them. That is a mechanical rename of 22 mentions in six files (`fsApi.ts` 5, `FilesPanel.tsx` 5, `project.ts` 4, `ScriptUtil.ts` 3, `AssetsProvider.ts` 3, `ViewerInstanceManager.ts` 2) and no logic change.

Three ceremonies go with the browser: permissions, because a dev server has nothing to grant (`queryHandlePerm` and its two remaining callers, `project.ts:151 to 157` inside `resolveFile` and `ViewerInstanceManager.ts:612`); the writable stream, because a write is one PUT (`writeFileHandle` at `fsApi.ts:71 to 75` becomes one line); and `isSameEntry`, because the only comparison lives in the observer branch that section 7 deletes.

```ts
// packages/editor/src/devserver/handles.ts
import { DevServerSource, ProjectFileEntry, ProjectEvent } from './DevServerSource'

// The whole contract. Upstream calls nothing else on a handle.
export interface ProjectDirectoryHandle {
    readonly kind: 'directory'
    readonly name: string
    readonly path: string
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectoryHandle>
    getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectFileHandle>
    entries(): AsyncIterableIterator<[string, ProjectDirectoryHandle | ProjectFileHandle]>
}
export interface ProjectFileHandle {
    readonly kind: 'file'
    readonly name: string
    readonly path: string
    getFile(): Promise<File>
    write(data: Blob | Uint8Array | string): Promise<void>
}

export class ProjectManifest {
    files = new Map<string, ProjectFileEntry>()      // the listing; events keep it current
    directories = new Set<string>()
    based = new Map<string, string>()                // the sha this tab last read or wrote, per path; events never touch it
    constructor(private readonly source: DevServerSource) {}
    async refresh() {
        const [files, directories] = await Promise.all([this.source.list(), this.source.listDirectories()])
        this.files = new Map(files.map((f) => [f.path, f]))
        this.directories = new Set(directories)
    }
    apply(event: ProjectEvent) {
        if (event.type === 'unlink') this.files.delete(event.path)
        else if (event.type !== 'command') this.files.set(event.path, { path: event.path, size: 0, sha256: event.sha256 || '', mtime: Date.now() })
    }
    childrenOf(dir: string): Array<[string, 'file' | 'directory']> {
        const prefix = dir ? dir + '/' : ''
        const names = new Map<string, 'file' | 'directory'>()
        for (const path of this.files.keys()) {
            if (!path.startsWith(prefix)) continue
            const rest = path.slice(prefix.length)
            const slash = rest.indexOf('/')
            names.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'directory')
        }
        for (const d of this.directories) if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) names.set(d.slice(prefix.length), 'directory')
        return [...names]
    }
}

const notFound = (name: string) => new DOMException(`${name} not found`, 'NotFoundError')

export class DevServerDirectoryHandle implements ProjectDirectoryHandle {
    readonly kind = 'directory' as const
    constructor(readonly path: string, private readonly source: DevServerSource, private readonly manifest: ProjectManifest) {}
    get name() { return this.path.split('/').pop() || '' }
    private child(name: string) { return this.path ? `${this.path}/${name}` : name }
    async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
        const path = this.child(name)
        if (!this.manifest.directories.has(path) && !this.manifest.childrenOf(path).length) {
            if (!options.create) throw notFound(name)
            await this.source.createDirectory(path)
            this.manifest.directories.add(path)
        }
        return new DevServerDirectoryHandle(path, this.source, this.manifest)
    }
    async getFileHandle(name: string, options: { create?: boolean } = {}) {
        const path = this.child(name)
        if (!this.manifest.files.has(path)) {
            if (!options.create) throw notFound(name)
            const { sha256 } = await this.source.write(path, new Uint8Array(), '*')   // '*' is unconditional; callers check existence first (FilesPanel.tsx:222)
            this.manifest.files.set(path, { path, size: 0, sha256, mtime: Date.now() })
            this.manifest.based.set(path, sha256)
        }
        return new DevServerFileHandle(path, this.source, this.manifest)
    }
    async *entries(): AsyncIterableIterator<[string, DevServerDirectoryHandle | DevServerFileHandle]> {
        for (const [name, kind] of this.manifest.childrenOf(this.path)) {
            const path = this.child(name)
            yield [name, kind === 'directory' ? new DevServerDirectoryHandle(path, this.source, this.manifest) : new DevServerFileHandle(path, this.source, this.manifest)]
        }
    }
}

export class DevServerFileHandle implements ProjectFileHandle {
    readonly kind = 'file' as const
    constructor(readonly path: string, private readonly source: DevServerSource, private readonly manifest: ProjectManifest) {}
    get name() { return this.path.split('/').pop() || '' }
    async getFile(): Promise<File> {
        const { bytes, sha256 } = await this.source.read(this.path)
        this.manifest.based.set(this.path, sha256)
        return new File([bytes], this.name, { lastModified: this.manifest.files.get(this.path)?.mtime })
    }
    async write(data: Blob | Uint8Array | string) {
        // The base is what this tab read or wrote, never what it heard from an event. A file this tab
        // never read (a new sidecar) writes unconditionally, which the server spells '*'.
        const { sha256 } = await this.source.write(this.path, data, this.manifest.based.get(this.path) || '*')
        this.manifest.based.set(this.path, sha256)
        this.manifest.files.set(this.path, { ...(this.manifest.files.get(this.path) || { path: this.path, size: 0, mtime: 0 }), sha256, mtime: Date.now() })
    }
}
```

```ts
// packages/editor/src/utils/fsApi.ts, lines 71 to 75 after the change
export async function writeFileHandle(fileHandle: ProjectFileHandle, file: Blob | Uint8Array | string) {
    await fileHandle.write(file)
}
```

Two things to notice. `getFileHandle` without `create` throws a `NotFoundError` DOMException, which is what upstream's `fsApi.ts:29` and `:42` already catch. And a write carries, as `If-Match`, the sha256 this tab last read or wrote for that path, so two editors on one project cannot overwrite each other silently.

Here is the whole conflict story, because the base matters. Editors A and B both loaded the scene at sha S0. A saves: the server compares `If-Match: "S0"` with the file, they agree, it writes, the sha is now S1, and A remembers S1. The server sends `change {path, sha256: S1, client: A}` to every tab; B's listing learns S1, and if B has unsaved edits B is asked whether to reload the disk copy. Say B says no and saves later. B's PUT still carries S0, because the base is what B read, never what B heard. The server answers 412 with the current sha (`server.ts:298 to 300`), and nothing is written. That surfaces as `ProjectConflictError`; the save handler then reads the disk copy and asks `The scene changed on disk. Reload the disk version?`, the port of the old manager at 637 to 647. Yes replaces B's copy with A's version, and B's edits are gone. No writes nothing and keeps B's copy, and the next save asks again. There is no overwrite button. Two saves at the same instant behave the same way: the server takes them one at a time, the first wins, the second gets the 412.

### 4.3 How the editor opens

Upstream's `loadProject(meta)` wants a `LoadedProject` with a `handle`. We give it one for the served folder and keep everything after that as upstream wrote it. The first call decides between the picker and a project (section 10).

```ts
// packages/editor/src/main.tsx, the new bootstrap
const source = new DevServerSource()
const state = await source.state()
if (state.hub) {
    renderHub(source)                                   // section 10: the picker, no viewer
} else {
    const manifest = new ProjectManifest(source)
    await manifest.refresh()
    const root = new DevServerDirectoryHandle('', source, manifest)
    await manager.loadProject({ name: state.name!, path: '', file: 'package.json', handle: root })
}
```

```
browser (packages/editor)                              kite3d dev (packages/kite3d)
──────────────────────────                              ──────────────────────────
main.tsx reads ?t=  ───────────── GET /api/state ─────────►  {name, versions}
manifest.refresh() ──────── GET /api/files, /api/directories ─►  [{path, sha256, ...}], {directories}
root = DirectoryHandle('')
manager.loadProject({handle: root, file: 'package.json'})
  initProjectHandles()            (project.ts:197, unchanged)
    handle.getFileHandle('package.json').getFile() ── GET /files/package.json ──►  bytes, ETag
    parse settings                (the engine's parser, section 5)
  settingsManager.onProjectSettingsChange()   (unchanged)
    scriptUtil loads plugins and scripts      (section 7)
  loadImport(main scene, isMain)
    viewer.load('/files/assets/main.scene.gltf?v=<sha>')   (section 5)
manager.initialize()  ───────── GET /api/events (SSE) ─────►  ': connected'
```

### 4.4 How a write travels, and how a change comes back

```
Save Scene (or New Script, or Make Asset, or a package.json edit)
  upstream code calls fsHelper.writeFile(handle, path, file)     (fsApi.ts:84, unchanged)
    handle.getFileHandle(path, {create: true}).write(file)
        └──► PUT /files/<path>   If-Match: "<sha of last read>"   X-Kite3D-Client: <id>
               200 or 201 {path, sha256}   this tab's base for <path> becomes the new sha
               412 {sha256: <current>}     ProjectConflictError ─► read the disk copy ─► "Reload the disk version?"
                                              yes: base = disk sha, reload, editor copy gone
                                              no:  nothing written, editor copy kept, ask again on the next save

server: writes .<name>.kite3d-<hex>, renames, hashes, schedules the event (150 ms window)
        └──► SSE  change {path, sha256, client: <id>}     to every subscriber

each editor tab:
  event.client == my clientId    ─►  ignore (I wrote it)
  otherwise                      ─►  manifest.apply(event)
                                 ─►  scriptUtil.changedFilesQ.push(event.path)      (section 7)
                                 ─►  path == main scene  ─►  confirm if dirty, then loadImport
```

The last line is the one new behaviour in this section, and it is a port of what our editor already did: a scene changed on disk by an agent or by Blender reloads, with a confirm when the editor copy is dirty. Upstream's `refreshChangedFilesQ` takes it from there for scripts, `package.json` and `assets.json`, because its queue already accepts a plain path string (`ScriptUtil.ts:610`, the string branch at 629). `FileSystemObserver`, the two-second poll, the `BroadcastChannel` and `FetchProxy` are gone; asset URLs under `/kite3d/` resolve through the engine's `createProjectAssetURLModifier` on the viewer's importer, the same call `createGame` makes.

Lifecycle of the pieces: one `DevServerSource` and one `ProjectManifest` per page, made in `main.tsx`. The SSE subscription opens in `ViewerInstanceManager.initialize()` and closes in `dispose()`. Handles are values, created on demand, and hold no state; the per-path base sha lives in the manifest. Nothing caches `File` objects.

Evidence for the pass: open a scratch project headless; Files lists every file and empty folder; New Folder, New Script and New Scene create files on disk; a script edited from a shell shows in the editor within a second and its component reloads; an external edit of the open scene prompts and reloads; two editors on the same project, a save in one appears in the other and a stale save gets the conflict message; no request without the token succeeds. Screenshots per case, viewed.

- [ ] Accept section 4, with the two interfaces of 4.2 as the contract.

## 5. Feature: glTF text scenes

Upstream saves `assets/main.scene.glb`, a binary. Our rule is a text file an agent can edit with a script: pretty JSON, stable ids, a sibling `.bin`, images under `assets/textures/`. The engine already has the serializer and the parsers; the editor just has to call them where upstream calls the binary exporter.

```ts
// packages/editor/src/utils/ViewerInstanceManager.ts, exportScene (upstream 868 to 941), the changed middle
import { serializeSceneGltf } from '@kite3d/engine'

const serialized = await serializeSceneGltf(viewer, { scenePath: project.mainScene })
// serialized.gltf   Uint8Array, the pretty JSON with stable key order
// serialized.files  [{path: 'assets/main.scene.bin', bytes}, {path: 'assets/textures/<sha>.png', bytes}, ...]
for (const f of serialized.files) await this.fsHelper.writeFile(project.handle, f.path, new File([f.bytes], f.path.split('/').pop()!))
const staleBin = project.mainScene.replace(/\.gltf$/i, '.bin')
if (!serialized.files.some((f) => f.path === staleBin) && manifest.files.has(staleBin)) await this.source.delete(staleBin)
return { file: new File([serialized.gltf], project.mainScene.split('/').pop()!, { type: 'model/gltf+json' }), preview }
```

```ts
// loadImport (upstream 1383 to 1450), the main-scene branch
const url = this.source.fileUrl(project.mainScene, manifest.files.get(project.mainScene)?.sha256)
const root = await v.load(url, { importAsModelRoot: true })
await this.nestedAssets.loadObjectDependencies(root)     // placed asset instances by rootPath, from the engine
await this.nestedAssets.waitForPending()
this.restoreEditCamera(root)                              // the scene's defaultCamera into the edit camera, port of the old editor
this.savedSceneHash = await sha256(await serializeSceneGltf(v, { scenePath: project.mainScene }).then((s) => s.gltf))
```

Eight small bridges in upstream code make the format ours: `settingsKey` becomes `kite3d` and `assetUrlPrefix` becomes `/kite3d/` (`project.ts:6,7`, and the dot directory becomes `.kite3d/` by itself); the six `.scene.glb` checks become `.scene.gltf` (`project.ts:12,244`; `ViewerInstanceManager.ts:621,1403,1414,1768`; `projectUtils.ts:32`; `FilesPanel.tsx:285,507`); `parsePackageJsonSettings` (`project.ts:240`) delegates to the engine's `parsePackageJsonSettingsConfig`, so `kite3d.viewer` keeps all thirteen fields and plugin strings parse the same way at Play and in a published game; `assets.json` entries keep the engine shape `{path, files?}`; asset ids use the readable rule instead of a UUID in `addIdToAssetsManifest` (`ViewerInstanceManager.ts:792`); bare module specifiers follow the engine rule, a key in `package.json.dependencies`.

```
Save
  exportScene ─► serializeSceneGltf(viewer) ─► gltf + sidecars
       │                                        │
       │  PUT assets/main.scene.bin             │  PUT assets/textures/<sha>.png
       │  DELETE assets/main.scene.bin  (only when no buffer references it any more)
       └► PUT assets/main.scene.gltf   If-Match: "<sha of the last load or save>"
  savedSceneHash = sha256(gltf)          a clean scene stays clean after reload

Load
  GET /files/assets/main.scene.gltf?v=<sha>  ─► viewer.load(importAsModelRoot)
  nestedAssets.loadObjectDependencies         ─► each node with userData.rootPath imports its asset once and clones
  restoreEditCamera                           ─► edit camera = scene defaultCamera
  savedSceneHash                              ─► dirty flag false
```

Evidence: save a scene with three boxes and one image texture; the `.gltf` is pretty JSON with a sibling `.bin` and the image under `assets/textures/`; a second save writes byte-identical files; an agent script edit to a node's translation shows after the external-change reload; a hidden object survives the round trip.

- [ ] Accept section 5.

## 6. Feature: Play on the edit viewer, with pause and inspection

Upstream's play mode is the one we lost and want back: it snapshots the scene, starts the clock and the components on the same scene graph, pauses by stopping the clock, lets you click any object in the frozen world, and reloads the snapshot on stop. Our runtime, `createGame`, boots a separate viewer from files on disk, which is right for an embedded game and wrong for the editor. The fix is to split `createGame` so the editor can run the second half on its own viewer.

```ts
// packages/engine/src/runtime/createGame.ts, after the split
export interface StartGameOptions { base: string; onError?: (error: unknown) => void }
export interface RunningGame { stop(): Promise<void> }

export async function startGame(viewer: ThreeViewer, project: RuntimeProject, options: StartGameOptions): Promise<RunningGame> {
    await registerProjectScripts(viewer, project, options)     // skips modules already registered on this viewer
    await registerProjectPlugins(viewer, project, options)
    viewer.timeline.reset(); viewer.timeline.start()
    viewer.getPlugin(EntityComponentPlugin)!.start()
    const physics = viewer.getPlugin(CannonPhysicsPlugin); if (physics) physics.running = true
    const main = await import(/* @vite-ignore */ new URL(project.packageJson.main || './main.js', options.base).href)
    const cleanup = await main.main?.({ viewer })
    return {
        async stop() {
            await cleanup?.()
            if (physics) physics.running = false
            viewer.getPlugin(EntityComponentPlugin)!.stop()
            viewer.timeline.stop(); viewer.timeline.reset()
        },
    }
}

export async function createGame(options: CreateGameOptions): Promise<CreatedGame> {
    const project = await loadRuntimeProject(options.base)
    const viewer = createViewer(options, project)                       // the plugin list as today
    viewer.assetManager.importer.addURLModifier(createProjectAssetURLModifier(options.base, project.assetsManifest))
    const nested = new RuntimeNestedAssetLoader(viewer, options.onError)
    const root = await viewer.load(new URL(project.mainScene, options.base).href, { importAsModelRoot: true })
    await nested.loadObjectDependencies(root); await nested.waitForPending()
    const running = await startGame(viewer, project, options)
    return { viewer, project, dispose: async () => { await running.stop(); nested.dispose(); viewer.dispose() } }
}
```

The editor keeps upstream's `PlayModeHelper` and changes three lines. The temp file becomes memory, which upstream's code already half does: `exportScene('running', false, 'gltf')` at line 57 produces text glTF and keeps it at line 70; the `resolveFile` fallback at 164 goes. Where upstream called `EntityComponentPlugin.start()` after `timeline.start()` (lines 103 to 108), it calls `startGame`, and `stopRunMode` calls `stop()`.

```ts
// packages/editor/src/utils/PlayModeHelper.ts, the changed lines
manager.features.enable('physics', 'PlayingMode')
this.running = await startGame(manager.get(), manager.runtimeProject(), { base: '/files/', onError: manager.reportError })
// ...
await this.running?.stop()
manager.features.disable('physics', 'PlayingMode')
```

```
                Run                              Pause
   ┌────────┐ ───────► ┌──────────────┐ ───────► ┌──────────────┐
   │  Edit  │          │   Running    │          │    Paused    │
   │        │ ◄─────── │              │ ◄─────── │              │
   └────────┘   Stop   └──────────────┘  Resume  └──────────────┘
                             │  Stop                    ▲
                             └──────────────────────────┘

 Edit     editPreview off: widgets and gizmo visible, picker on, clock stopped
 Running  snapshot held in memory, editPreview on, physics on, clock running, picker off
 Paused   clock stopped: no component update(), no physics step, picker on, gizmo works
 Stop     unload, reload the snapshot, reselect by uuid, editPreview off, dirty flag as before
```

The pause rule is the one thing to add to the engine, from issue #23: a paused frame runs no component `update()` and steps no physics. If the entity plugin or the physics plugin keep stepping with the timeline stopped, they get gated on `timeline.running`. Everything else is upstream's helper doing what it did in 2024. Disk is never touched by Play or Stop; edits made while paused are discarded at Stop, which is the upstream behaviour too.

Evidence: a scene with a physics box high above a ground plane and a script component that moves another box; Play shows both moving; Pause freezes them (two screenshots a second apart, near-zero diff); click the falling box while paused, the Inspector shows it, drag it with the gizmo, resume, it continues from there; Stop restores the pre-Play frame (diff against the pre-Play screenshot) and the file on disk is byte-identical; a published game still boots through `createGame` in a headless page.

- [ ] Accept section 6.

## 7. Feature: project modules loaded by URL

Upstream reads a script's text through a handle, rewrites its relative imports with regular expressions (`modules.ts:28 to 76`), hands the text to a service worker, and imports it through `new Function('return import(path)')`. It also keeps a dependency graph so a change to one file reloads only its dependants. All of that existed because a browser cannot import from a directory handle. A dev server can serve modules, and ours already rewrites relative imports inside served `.m?js` files when `?v=` is present. So the loader collapses to one native import.

```ts
// packages/editor/src/utils/modules.ts, loadModules1 replaced
export async function loadModules1(paths: string[], project: LoadedProject) {
    const results: Record<string, unknown> = {}
    for (const path of paths) {
        const url = isDependencyModuleSpecifier(path, project.packageJson)      // the engine rule: a key in dependencies
            ? path
            : project.source.fileUrl(path, project.manifest.files.get(path)?.sha256, project.revision)
        try { results[path] = await import(/* @vite-ignore */ url) }
        catch (error) { results[path] = { __tpModuleError: error } }             // the shape ScriptUtil already handles
    }
    return results
}
```

`ScriptUtil` keeps everything after the import: `refLoadModule` scans exports for `PluginType` and `ComponentType`, matches them to settings, registers with `addPlugin` and `addComponent`, and `scriptFilesChanged` removes and re-registers on a change. The dependency graph goes, and so does the `FileSystemObserver` branch of `refreshChangedFilesQ` (the handle comparison at `ScriptUtil.ts:633 to 641`); the queue only ever holds paths now. Instead of the graph, one page-wide `revision` counter bumps on every module change, so every project module re-imports fresh. Simpler than the graph, and cheap, because a project has a handful of scripts.

```
 file saved (editor, agent, shell) ─► chokidar ─► SSE change{path, sha256}
   ─► manifest.apply
   ─► scriptUtil.changedFilesQ.push(path)
        refreshChangedFilesQ (every 2 s, unchanged)
          ├─ package.json or assets.json ─► onObserveFileChange ─► settings reload
          └─ *.js, *.mjs ─► scriptFilesChanged
                             remove the module's plugins and components
                             revision++
                             import('/files/<path>?v=<sha>&r=<revision>')
                             refLoadModule ─► addPlugin, addComponent
                             Play running? ─► stop, start again (PlayModeHelper.loadRunningScene)
```

Adding a dependency is the one thing that needs a page reload, because the server injects the import map into the page at load. Upstream appended a second import map at runtime, which only works with es-module-shims.

- [ ] Accept section 7.
- [ ] Decision: page reload on a dependency change (my pick), or keep `ImportMapsManager` and es-module-shims to append maps at runtime.

## 8. Feature: the screenshot command

`kite3d screenshot` asks the connected editor for its viewport. The CLI posts to the server, the server broadcasts a `command` event and waits ten seconds, the editor answers with a PNG. The editor side is one listener and one capture, ported from the old manager (`captureScreenshot`, 717 to 754), which forces a render even when the tab is idle and composites the background.

```ts
// packages/editor/src/utils/ViewerInstanceManager.ts, inside initialize()
this.unsubscribe = this.source.events(async (event) => {
    if (event.type === 'command' && event.command === 'screenshot') {
        try { await this.source.screenshotResult(event.id, await this.captureScreenshot(event.options)) }
        catch (error) { this.reportError(error) }
        return
    }
    if (event.client === this.source.clientId) return
    this.manifest.apply(event)
    if (event.path === this.loadedProject?.mainScene) await this.reloadSceneFromDisk()
    else this.scriptUtil.changedFilesQ.push(event.path)
})
```

The headless path of the CLI waits for `window.kite3dProjectLoaded`, which `loadProject` sets when the scene is in. During Play the capture shows the running game, because it is the same viewer.

- [ ] Accept section 8.

## 9. Feature: the Library

Upstream's bottom-bar Library lists `asset-cdn.threepipe.org` through its tsdb client and drops models, materials, textures and environments into the scene through `CanvasFileDropHandler` and `AssetTracker`. It stays exactly as it is, dependencies included. Two of our fixes port onto it as diffs (section 11): a drop that lands before its import finishes waits for it instead of dropping nothing, a failed import shows a toast, and a material drop marks the scene dirty.

The dialog we added on top, "apply as object, material or texture, remember my choice", is not ported; upstream applies the drop directly.

- [ ] Accept section 9.
- [ ] Decision: leave the drop dialog out (my pick, and your earlier call), or port it (500 lines).

## 10. Feature: the project picker behind `kite3d open`

> Your note on revision 2: "TODO keep project picker, it should be what opens when user runs `npx kite3d open` in a blank terminal (not in project dir). when they run `npx kite3d dev` in a project folder then it should open the project wihthout the picker being shown. Also the picker should use the old monorepo's picker, which allowed user to list all kite3d projects, see which ones are active / not and open them in a new tab."

Some history first, because it explains where the code comes from. The old repository had exactly this picker. PR #13 built the CLI half (`bc5f390`: the project index, background servers, the launcher) and PR #12 the editor half (`b35ce75`: the hub page, the welcome dialog, the navbar picker, the worktrees section). The cleanup in #30 deleted the CLI half and its tests but left the editor half in place with nothing to talk to. So the picker is not new work. It is a restore from `f87b8c6^`, with the editor half moved onto upstream's welcome dialog, which is what it was derived from in the first place.

The behaviour, in your words and in the old code's terms:

- `npx kite3d open`, from any folder, starts the launcher once or reuses it (`~/.kite3d/hub.json` holds its pid, port, url and token), and opens its tokenized URL. The launcher is a detached `kite3d open --no-open` process on `127.0.0.1:4320` (through 4339), serving the editor bundle with `/api/state` answering `{hub: true}` and the seven hub routes below. The page shows the welcome dialog forced open and no viewer: every indexed project grouped by git repository, worktrees under their repository, loose projects below, active ones marked with an Open and a Stop button, plus New Project and Open Project.
- `npx kite3d dev` in a project folder starts that project's server (`4321` through 4340), registers it in the index, and opens the editor directly. No dialog. The first navbar button shows the same picker on demand, with "this tab" marked, so a closed tab is one `kite3d open` away and a sibling worktree is one click away.
- Clicking a running project opens its URL in a new tab, nothing else. Clicking a stopped one spawns `node <project>/node_modules/kite3d/dist/cli.js dev --no-open` detached, waits for `<project>/.kite3d/dev.json`, and opens the URL it finds there in a new tab. The token travels inside that URL; the new server sets its own per-port cookie on the first load.

```ts
// packages/kite3d/src/projectIndex.ts          ~/.kite3d/projects.json
export interface ProjectIndex { version: 1; projects: IndexedProject[] }
export interface IndexedProject {
    path: string            // absolute, symlinks resolved; the key
    name: string            // package.json name, or the folder name
    repoRoot: string | null // git worktree root, or null for a loose project
    lastOpened: string      // ISO time of the last init, dev, or open through the picker
}
// packages/kite3d/src/hub.ts                    ~/.kite3d/hub.json, the launcher
export interface HubState { pid: number; port: number; url: string; token: string }
// packages/kite3d/src/server.ts                 <project>/.kite3d/dev.json, every dev server (already written today)
export interface DevState { origin: string; url: string; port: number; token: string; pid: number; started_at: string }
// GET /api/hub/projects
export interface HubProjects {
    active: Array<{ path: string; name: string; branch: string | null; url: string }>
    repos: Array<{ name: string; root: string; worktrees: HubProject[] }>
    loose: HubProject[]
}
export interface HubProject { path: string; name: string; branch: string | null; head: string | null; running: boolean; url?: string }
```

```
GET   /api/state                    {hub: true}                     the editor picks hub mode on this
GET   /api/hub/projects             HubProjects                      index + git grouping + dev.json liveness
GET   /api/hub/folders?path=        {path, parent, folders: [{name, path, isProject, isRepo}]}   Open Project browser, under $HOME
POST  /api/hub/projects/start       {path} → {url}                   reuse a live dev.json, else spawn and wait 60 s
POST  /api/hub/projects/stop        {path} → {stopped: true}         SIGTERM, 5 s, SIGKILL
POST  /api/hub/projects/create      {parent, name} → {path}          kite3d init, then register
POST  /api/hub/projects/add         {path} → {path}                  register an existing project
errors                              {error: {code, message}}         invalid_request, invalid_path, not_found, conflict, start_failed
```

A project is "active" when its `dev.json` parses, its `pid` answers `kill(pid, 0)`, and the `t` in its url equals its token. No heartbeat, no port probe. A dead pid with a stale file reads as stopped, and the next start overwrites the file.

```
shell                       kite3d open (CLI)            launcher, 127.0.0.1:4320           project dev server
  │ npx kite3d open              │                              │                                 │
  ├─────────────────────────────►│ read ~/.kite3d/hub.json      │                                 │
  │                              │ pid dead or absent:          │                                 │
  │                              │ spawn detached open --no-open├─► listen, write hub.json        │
  │                              │ wait for hub.json (60 s)     │                                 │
  │  browser: /?t=<hub token> ◄──┘                              │                                 │
  │──────────────────────────────────────────────────────────────►  GET /api/state  {hub: true}  │
  │                                                              │  GET /api/hub/projects         │
  │  click a stopped project                                     │                                 │
  │──────────────────────────────────────────────────────────────►  POST /api/hub/projects/start  │
  │                                                              │  spawn detached dev --no-open ──►  listen 4321+, write .kite3d/dev.json
  │                                                              │  wait for dev.json, {url} ◄─────┘
  │  new tab: window.open(url, '_blank') ─────────────────────────────────────────────────────────►  serve the editor, set the per-port cookie
```

```
 a project row in the picker

                kite3d dev, or Open in the picker            Stop in the picker, or Ctrl-C in its terminal
   stopped ──────────────────────────────────────► running ───────────────────────────────────────► stopped
   dev.json absent, or its pid dead                dev.json valid, pid alive
   Open: POST start, wait, window.open(url)        Open: window.open(url) only, no new process
```

On the editor side the restore is four files from `b35ce75`, re-based onto upstream's welcome dialog: `hubClient.tsx` (the seven routes and the token header, 262 lines), `HubProjectPicker.tsx` (the navbar popover, 104), `WelcomeDialogProjectsTab.tsx` (the hub version, 220, replacing upstream's 48-line IndexedDB recents tab), and the `hubMode` prop of `WelcomeScreenDialog.tsx` (forced open, no escape, no outside click). The mode switch is the `if (state.hub)` in section 4.3. Upstream's directory-picker files of section 3 are what this replaces.

Two things change from the old code, both because the old code was heavier than its job. First, the three lock files go: `projects.lock`, `hub-start.lock` and `dev-detach.lock`, each with a 60-second staleness rule and a polling loop. The index is written through a temp file and a rename, so a lost race costs one registration that the next `dev` repeats; two `kite3d open` at the same instant can start two launchers on two ports, and both work. Second, a start on an already-running project also refreshes `lastOpened`, so the field name stops lying.

Evidence: from a blank folder, headless, `kite3d open` prints a URL and `hub.json` appears; the page lists two scratch projects, one running, grouped under their repository with the worktree branch names; Open on the stopped one writes its `dev.json`, returns its URL, and a new page loads the editor; Open on the running one spawns nothing; Stop turns the row grey; `kite3d dev` in a project opens the editor with no dialog, and the navbar button shows the picker with that tab marked. Screenshots viewed.

- [ ] Accept section 10: the picker comes back from `f87b8c6^`, launcher on 4320, index in `~/.kite3d/projects.json`, active means a live `dev.json`.
- [ ] Decision: restore it lean, without the three lock files (my pick), or byte for byte as it was.

## 11. The fixes to port, one commit each

Each of these lands on a file that exists upstream, so it ports as a diff with its original evidence.

```
#16  hidden objects survive the scene save     VisibilityIcon.tsx reads object.visible; the serializer
                                               passes onlyVisible: false and shouldExportObject (engine);
                                               the exporter change is in packages/threepipe.
                                               Guard: hidden-objects.spec.ts, ported.
#17  library drops wait, report, dirty          handleDragStart keeps a promise and a dropLanded flag,
                                               handleDrop awaits it, showLibraryImportError toast,
                                               materialCommand calls setDirty({change: 'material'}).
                                               Guards: library-drop-flow.spec.ts, three tests, ported.
#28  multi-root project asset drops            a loader AuxScene group with more than one child is named
                                               after the asset file, in upstream's toAssetIdPath path.
#14  / isolates, [ ] halve and double speed    the EditModePlugin.ts diff (setWASDMovementSpeed, toggleIsolate,
                                               exitIsolate, withIsolateVisibilityRestored, the bindings),
                                               the hierarchy Isolate item, the SPEED and ISOLATED chips,
                                               exportScene wrapped in withIsolateVisibilityRestored.
                                               Upstream 12a8cdb touched this file after our fork; port against head.
#26  Set as main scene                         a Files context item on .scene.gltf that writes mainScene
                                               through ProjectSettingsManager.setSettings, then opens it.
#13  cookie per port, versioned imports         kite3d package, untouched. Guard: cookie-isolation.test.ts, kept.
```

```ts
// Set as main scene, the whole feature
{ text: 'Set as main scene', icon: 'home', onClick: async () => {
    if (!await confirmDialog(`Change the main scene from ${project.mainScene} to ${file.path} and load it?`)) return
    await manager.settingsManager.setSettings({ mainScene: file.path })     // writes package.json through the handle
    await manager.loadProjectFile(file)
} }
```

- [ ] Accept section 11.

## 12. Carry-over from kite3d and the engine

After #30 the CLI is `init`, `dev` with `--no-open` and `--port`, `screenshot`, `skills`, and `publish`, which prints the path of `packages/kite3d/skills/publish/SKILL.md`, a thirteen-step procedure an agent follows with curl. Section 10 adds `open` back, with `--no-open` and `--stop`. The server has the file, directory, state, events, screenshot and plugin-package routes, plus the hub routes when it runs as the launcher. The engine has `createGame` (split as in section 6), `nestedAssets`, the format parsers, `registerScripts`, the import map with the plugin mapping, `serializeSceneGltf` with the canonical helpers, `fileTypes`, and the plugins. The public API game projects rely on stays: `createGame` and its options, `main({viewer})`, `registerScripts`, `serializeSceneGltf`, the parsers and types, `createProjectAssetURLModifier`, `HtmlUiComponent`, `CannonPhysicsPlugin` and its components.

One export is gone that a real game uses. The terminator project imports `RuntimeObjectOwner` from `authoring.ts` in seven files, and `registerGameValidation` plus `publishGameTelemetry` in its `main.js`. The last two were the check feature and stay gone. `RuntimeObjectOwner` is the runtime-object ownership API the guide documents (lines 79 to 97): runtime-created objects are tracked so they never reach the saved scene and get cleaned up on stop. Nothing in the repository imports it, but a game does.

- [ ] Accept section 12.
- [ ] Decision: restore `authoring.ts` for `RuntimeObjectOwner` (my pick; one commit from history), or delete it and have terminator's agent migrate.
- [ ] Terminator upgrade note for its agent: remove `registerGameValidation` and `publishGameTelemetry` from `main.js`; drop `kite3d.publish.exclude` from `package.json`; keep `kite3d.imports`, `scripts`, `plugins`, `viewer`.

## 13. The guide

`docs/agents.md` is 1,000 lines. 908 of them describe the project format and the engine, mostly upstream's own text, and they stay. The 92 lines of editor and CLI text become one short section: `npx kite3d init`, `npx kite3d dev`, `npx kite3d open`, `npx kite3d screenshot`, `npx kite3d skills`, `npx kite3d publish` prints the skill; the token rule; the `.kite3d/` folder and `~/.kite3d/`. The `data-testid` list and the route list go.

- [ ] Accept section 13.

## 14. Order of work

```
 old repository (blitzdotdev/kite3d)          new repository (~/kite3d)
 ──────────────────────────────────           ──────────────────────────
 #30 cleanup merged on main  ✓                step 0  repository shape            ✓
 0.19.0-alpha.3 on next  (your mark)          step 1  section 3 deletions, editor package.json
                                                      wired to the workspace, green build
                                              step 2  section 4  adapter and SSE: the editor opens
                                                      the served project, lists, saves
                                              step 3  section 5  glTF text, section 7 modules by URL
                                              step 4  section 6  Play on the edit viewer, engine split
                                              step 5  section 10 the picker: CLI half, then editor half
                                              step 6  sections 8, 9, 11: screenshot, Library fixes,
                                                      keys, Set as main scene, three guards
                                              step 7  section 13 guide; 0.20.0-alpha.1 on next
                                                      terminator upgrade; then 0.20.0 on latest
```

Each step is one codex pass at medium with the pr-skill section, manual headless evidence with screenshots I view myself, no proactive tests, one squash commit on `main`.

- [ ] Accept the order.
- [ ] 0.19.0-alpha.3 from the old repository now, so terminator can test the CLI shape early (my pick), or skip it.

## 15. What is not happening

No mesh editing in the browser; Blender stays the editor, and the round trip through the watcher is what section 4 already gives you. No tabs and no stage yet; the document-and-stage design note stands and lands after this rewrite, on the upstream manager shape, which is the shape it was written for. No new tests; the three ported guards are tests of reported bugs. No new features beyond the six fixes and the restored picker. No GitHub remote until you name it.

## 16. Numbers to expect

Upstream `src` is 27,201 lines; after section 3 about 23,000. New editor code: about 250 lines for the transport and the handles, about 100 for the bootstrap and the event listener, about 60 for the loader, about 90 for the screenshot capture, the ported fixes at about 400, and the picker's four files at about 680 restored. kite3d after the cleanup: 1,504 lines of source, plus about 800 restored for the index, the launcher and the hub routes without their locks. Engine: 4,613, of which about 4,100 are upstream's plugins. Against the tree we are leaving: an editor of 24,000 lines with 80 percent suspect, a CLI package of 10,247 with 80 percent suspect, an engine of 6,667 with 20 percent suspect.
