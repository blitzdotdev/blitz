import type {ProjectDependency} from './types.ts'
import {dependencyImportMap} from '@blitzdev/engine/importMap'

export interface GenerateIndexHtmlOptions {
    name: string
    version: string
    runtimeHash: string
    dependencies?: ProjectDependency[]
}

export function generateIndexHtml({name, version, runtimeHash, dependencies = []}: GenerateIndexHtmlOptions): string {
    const importMap = JSON.stringify(dependencyImportMap(dependencies, './_blitz/runtime.js')).replace(/</g, '\\u003c')
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="kite3d-runtime" content="${escapeHtml(`${version} ${runtimeHash}`)}">
<link rel="icon" href="./icon.svg">
<title>${escapeHtml(name)}</title>
<script type="importmap">${importMap}</script>
<style>html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style>
</head>
<body>
<canvas id="kite3d-canvas"></canvas>
<script type="module">
import {createGame} from './_blitz/runtime.js'
createGame({base:new URL('./',location.href).href,canvas:document.getElementById('kite3d-canvas')})
  .catch(error=>{document.body.textContent='Failed to start: '+error.message})
</script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}
