# Asset System

## Types

- Object - `glb`, `gltf`
- Material - `mat`, `mat.json`

## Object

✅❌ ⚠️❗🔧🛠️🗂️📁📂📝 

Instance types - 
- `assetRoot` - Actual asset root object loaded from a file, there should only be one of these loaded in memory per asset file.
  - props - `userData.rootPath`, `_tpRootPath`, `userData.tpAssetId`
  - It is never referenced in scene or any other asset. To use it, it is cloned to create `assetRootClone`(`assetComponent`)
- `assetChild` - object, material, geometry, texture objects inside `assetRoot`
  - props - `_tpRootPath` = `assetRoot.userData.rootPath`
  - If Object - It is never referenced in scene or any other asset. To use it, it is cloned to create `assetChildClone`(`assetComponentChild`)
  - Otherwise - It is directly referenced in scene or other assets.
- `assetRootClone` (`assetComponent`) -
  - props - `_sChildren`, `userData.rootPath`, `userData.sProperties`, `userData.tpAssetId`
- `assetChildClone` (`assetComponentChild`) - 
  - props - `_tpRootPath`, `_tpRootUid`
- `embeddedAssetClone` = (`assetComponent & assetChild`) - when an asset is referenced inside another asset

### Properties

- `_sChildren`
    - root ❌
    - rootClone ✅ - set to `root.children`, and should be synced with that.
    - child ❌
    - childClone ❌
- `userData.rootPath`
    - root ✅ - path from which this asset was loaded
    - rootClone ✅ - path of the asset that will be synced to this object
    - child ❌
    - childClone ❌
- `userData.sProperties`
    - root ❌
    - rootClone ✅ - set to `defSPropsObj` when `rootClone` is created(by cloning `root`), then it can be changed by the user.
    - child ⚠️ - later
    - childClone ⚠️ - later
- `_tpRootPath`
    - root ✅ - same as `userData.rootPath`
    - rootClone ❌
    - child ✅ - path of the root of the asset
    - childClone ✅ - path of the root of the asset, it also has `tpRootUid`
- `_tpRootUid`
    - root ❌
    - rootClone ❌
    - child ❌
    - childClone ✅ - `uuid` of the `child` of the `root` that this is cloned from
- `userData.tpAssetId`
    - root ✅ - asset id, used for asset file tracking
    - rootClone ✅ - same as root, tracker tries to find file in manifest if path is not found
    - child ❌
    - childClone ❌

## Material

### Properties

- `userData.rootPath`
    - root ✅ - path from which this asset was loaded
    - rootClone ✅ - path of the asset that will be synced to this object
- `userData.sProperties`
    - root ❌
    - rootClone ✅ - set to `defSPropsMat` when `rootClone` is created(by cloning `root`), then it can be changed by the user.
- `_tpRootPath`
    - root ✅ - same as `userData.rootPath`
    - rootClone ❌
- `userData.tpAssetId`
    - root ✅ - asset id, used for asset file tracking
    - rootClone ✅ - same as root, tracker tries to find file in manifest if path is not found


## Actions

### Converting a standard object to a saved asset

- generate asset id
- export object as name.asset.glb File blob
  - preserve uuid should be true
- call process raw refresh refs in asset tracker to set the _tpRootPath inside the asset resources
