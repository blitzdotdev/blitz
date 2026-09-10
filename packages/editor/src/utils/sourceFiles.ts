import type {ProjectFileEntry} from '../ProjectSource.ts'

export const editableSourceExtensions = new Set(['.css', '.gltf', '.html', '.js', '.json', '.md', '.mjs', '.txt'])
export const maxSourceBytes = 1024 * 1024

export function isEditableSourceFile(entry?: ProjectFileEntry | null): entry is ProjectFileEntry {
    if (!entry || entry.size > maxSourceBytes) return false
    const name = entry.path.split('/').pop() || entry.path
    const dot = name.lastIndexOf('.')
    return dot >= 0 && editableSourceExtensions.has(name.slice(dot).toLowerCase())
}
