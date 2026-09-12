export type SourceLanguage = 'css' | 'html' | 'javascript' | 'json' | 'markdown' | 'plain' | 'xml'

export function sourceLanguageForPath(path: string): SourceLanguage {
    const name = path.split('/').pop()?.toLowerCase() || path.toLowerCase()
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
    if (['js', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension)) return 'javascript'
    if (name === 'assets.json' || ['json', 'gltf'].includes(extension)) return 'json'
    if (extension === 'html') return 'html'
    if (extension === 'css') return 'css'
    if (['xml', 'mjcf'].includes(extension)) return 'xml'
    if (extension === 'md') return 'markdown'
    return 'plain'
}
