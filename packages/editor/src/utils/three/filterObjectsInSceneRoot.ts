import {IGeometry, IMaterial, IObject3D} from "threepipe";

export function filterObjectsInSceneRoot<T extends (IGeometry|IMaterial) = (IGeometry|IMaterial)>(geoms: T[]): Set<T> {
    const inRoot = new Set<T>()
    const notInRoot = new Set<T>()
    let objMap = new Map<IObject3D, boolean>
    geoms.map(g => {
        let mInRoot = false
        for (const m of g.appliedMeshes) {
            if (objMap.has(m)) {
                mInRoot = objMap.get(m)!
                if (mInRoot) break
                else continue
            } else if (m.userData?.rootSceneModelRoot) {
                mInRoot = true
            }
            !mInRoot && m.traverseAncestors(a => {
                if (mInRoot) return
                if (a.userData?.rootSceneModelRoot) mInRoot = true
            })
            objMap.set(m, mInRoot)
            if (mInRoot) break
        }
        if (mInRoot) inRoot.add(g)
        else notInRoot.add(g)
    })
    return inRoot;
}
