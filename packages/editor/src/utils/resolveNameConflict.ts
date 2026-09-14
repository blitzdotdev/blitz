import {getMeta} from "./project.ts";

export async function resolveNameConflict(newName: string) {
    let conflict = true
    while (conflict) {
        const parts = newName.split('-')
        const last = parts[parts.length - 1]
        if (!isNaN(Number(last))) {
            parts[parts.length - 1] = (Number(last) + 1).toString()
        } else {
            parts.push('1')
        }
        newName = parts.join('-')
        const meta2 = await getMeta(newName)
        conflict = !!meta2
    }
    return newName
}
