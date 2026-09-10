import {IObject3D} from "threepipe";

export function addAtIndex(source: IObject3D, target: IObject3D | null, newIndex: number = -1) {
    // todo check if target is parent of source, in case only reordering (but that wont fire events like setDirty?)
    console.log('add ', source.name, 'to', target?.name, 'at', newIndex)
    if (source.parent !== target) {
        if (target)
            target.add(source)
        else {
            source.parent?.remove(source)
            // todo dispose?
        }
        // if(source.parent){
        //     const ind = source.parent.children.indexOf(source)
        //     if(ind >= 0) source.parent.children.splice(ind, 1) // remove from old parent
        // }
        // target.children.push(source)
        // source.parent = target
    }
    if (!target) return -1
    const newIndex2 = target.children.indexOf(source)
    if (newIndex >= 0 && newIndex2 >= 0 && newIndex !== newIndex2) {
        target.children.splice(newIndex2, 1)
        target.children.splice(newIndex, 0, source) // add at new index
        return newIndex
    }
    return newIndex2;
}
