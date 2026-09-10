import type {ProjectDependency} from './types.ts'

const RUNTIME_SPECIFIERS = ['threepipe', 'three', 'uiconfig.js', 'ts-browser-helpers'] as const

export interface GenerateIndexHtmlOptions {
    name: string
    version: string
    dependencies?: ProjectDependency[]
}

export function generateIndexHtml({name, version, dependencies = []}: GenerateIndexHtmlOptions): string {
    const extras = uniqueDependencies(dependencies)
        .filter((dependency) => !RUNTIME_SPECIFIERS.includes(dependency.key as typeof RUNTIME_SPECIFIERS[number]))
    const mappedKeys = [...RUNTIME_SPECIFIERS, ...extras.map(({key}) => key)]
    const imports: Record<string, string> = Object.fromEntries(
        RUNTIME_SPECIFIERS.map((specifier) => [specifier, './_blitz/runtime.js']),
    )
    for (const dependency of extras) {
        const baseUrl = dependency.url || `https://esm.sh/${dependency.key}@${dependency.version}`
        const separator = baseUrl.includes('?') ? '&' : '?'
        imports[dependency.key] = `${baseUrl}${separator}external=${mappedKeys.join(',')}`
    }

    const importMap = JSON.stringify({imports}).replace(/</g, '\\u003c')
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="blitz-runtime" content="${escapeHtml(version)}">
<title>${escapeHtml(name)}</title>
<script type="importmap">${importMap}</script>
<style>html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style>
</head>
<body>
<canvas id="blitz-canvas"></canvas>
<script type="module">
import {createGame} from './_blitz/runtime.js'
createGame({base:new URL('./',location.href).href,canvas:document.getElementById('blitz-canvas')})
  .catch(error=>{document.body.textContent='Failed to start: '+error.message})
</script>
</body>
</html>
`
}

function uniqueDependencies(dependencies: ProjectDependency[]): ProjectDependency[] {
    const byKey = new Map<string, ProjectDependency>()
    for (const dependency of dependencies) {
        if (!byKey.has(dependency.key)) byKey.set(dependency.key, dependency)
    }
    return [...byKey.values()]
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}
