import {posix} from 'node:path'
import {parse} from 'es-module-lexer'

interface ModuleImport {
    start: number
    end: number
    specifier: string
    dynamic: boolean
}

export type ResolveModuleRevision = (path: string) => Promise<string | undefined>

/** Rewrites literal relative ESM imports while caching lexer work by source identity. */
export class ProjectModuleRewriter {
    private readonly analyses = new Map<string, Promise<readonly ModuleImport[]>>()

    async rewrite(
        path: string,
        sha256: string,
        source: string,
        resolveRevision: ResolveModuleRevision,
        reloadRevision?: string,
    ): Promise<string> {
        const imports = await this.analyze(path, sha256, source)
        const edits = (await Promise.all(imports.map(async (entry) => {
            const target = resolveRelativeImport(path, entry.specifier)
            if (!target) return undefined
            const targetRevision = await resolveRevision(target)
            if (!targetRevision) return undefined
            const specifier = versionedSpecifier(entry.specifier, targetRevision, reloadRevision)
            return {
                start: entry.start,
                end: entry.end,
                value: entry.dynamic ? JSON.stringify(specifier) : specifier,
            }
        }))).filter((edit) => edit !== undefined).sort((a, b) => b.start - a.start)

        let rewritten = source
        for (const edit of edits) {
            rewritten = rewritten.slice(0, edit.start) + edit.value + rewritten.slice(edit.end)
        }
        return rewritten
    }

    private analyze(path: string, sha256: string, source: string): Promise<readonly ModuleImport[]> {
        const key = `${path}\0${sha256}`
        const cached = this.analyses.get(key)
        if (cached) return cached

        const analysis = Promise.resolve(parse(source, path)).then(([imports]) => imports.flatMap((entry) => {
            if (!entry.specifier || !isRelativeSpecifier(entry.specifier)) return []
            if (entry.type === 'dynamic' && entry.glob) return []
            return [{
                start: entry.start,
                end: entry.end,
                specifier: entry.specifier,
                dynamic: entry.type === 'dynamic',
            }]
        }))
        this.analyses.set(key, analysis)
        void analysis.catch(() => this.analyses.delete(key))
        return analysis
    }
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../')
}

function resolveRelativeImport(importer: string, specifier: string): string | undefined {
    const encodedPath = specifier.split(/[?#]/, 1)[0]
    let decodedPath: string
    try {
        decodedPath = decodeURIComponent(encodedPath)
    } catch {
        return undefined
    }
    const target = posix.normalize(posix.join(posix.dirname(importer), decodedPath))
    if (!target || target === '.' || target === '..' || target.startsWith('../') || posix.isAbsolute(target)) {
        return undefined
    }
    return target
}

function versionedSpecifier(specifier: string, sha256: string, reloadRevision?: string): string {
    const hashIndex = specifier.indexOf('#')
    const fragment = hashIndex < 0 ? '' : specifier.slice(hashIndex)
    const withoutFragment = hashIndex < 0 ? specifier : specifier.slice(0, hashIndex)
    const queryIndex = withoutFragment.indexOf('?')
    const path = queryIndex < 0 ? withoutFragment : withoutFragment.slice(0, queryIndex)
    const parameters = new URLSearchParams(queryIndex < 0 ? '' : withoutFragment.slice(queryIndex + 1))
    parameters.set('v', sha256)
    if (reloadRevision) parameters.set('r', reloadRevision)
    return `${path}?${parameters}${fragment}`
}
