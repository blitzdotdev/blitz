import {describe, expect, it} from 'vitest'
import {dependencyImportMap, projectDependencies, RUNTIME_SPECIFIERS} from '../../src/importMap.ts'

describe('dependencyImportMap', () => {
    it('maps runtime modules, maps semver dependencies, and skips local and Kite3D package specs', () => {
        const dependencies = projectDependencies({
            dependencies: {
                '@blitzdev/engine': 'file:../../packs/engine.tgz',
                '@blitzdev/editor': '0.12.0',
                gsap: '^3.12.5',
                local: 'file:../local',
                tagged: 'latest',
            },
        })

        const map = dependencyImportMap(dependencies, '/editor-runtime.js')

        for (const specifier of RUNTIME_SPECIFIERS) {
            expect(map.imports[specifier]).toBe('/editor-runtime.js')
        }
        expect(map.imports.gsap).toContain('https://esm.sh/gsap@^3.12.5?external=')
        expect(map.imports).not.toHaveProperty('@blitzdev/editor')
        expect(map.imports).not.toHaveProperty('local')
        expect(map.imports).not.toHaveProperty('tagged')
        expect(JSON.stringify(map)).not.toContain('../../packs')
    })
})
