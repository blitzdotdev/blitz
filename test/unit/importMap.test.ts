import {describe, expect, it} from 'vitest'
import {
    dependencyImportMap,
    projectDependencies,
    projectPluginNames,
    RUNTIME_SPECIFIERS,
} from '../../src/importMap.ts'

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

    it('maps installed plugins by bare name and package subpath for every dependency spec', () => {
        const packageJson = {
            dependencies: {
                '@blitzdev/plugin-packed': 'file:../plugin.tgz',
                'local-plugin': 'file:../plugin',
                'versioned-plugin': '^1.2.3',
            },
            kite3d: {
                plugins: [
                    '@blitzdev/plugin-packed',
                    'local-plugin:NamedPlugin',
                    {import: 'versioned-plugin', className: 'VersionedPlugin'},
                ],
            },
        }
        expect(projectPluginNames(packageJson)).toEqual([
            '@blitzdev/plugin-packed',
            'local-plugin',
            'versioned-plugin',
        ])

        const map = dependencyImportMap(projectDependencies(packageJson), '/editor-runtime.js', [
            {
                specifier: '@blitzdev/plugin-packed',
                entry: 'dist/plugin.js',
                rootUrl: '/kite3d/plugins/@blitzdev/plugin-packed/',
            },
            {
                specifier: 'local-plugin',
                entry: './index.js',
                rootUrl: '/kite3d/plugins/local-plugin',
            },
        ])

        expect(map.imports['@blitzdev/plugin-packed'])
            .toBe('/kite3d/plugins/@blitzdev/plugin-packed/dist/plugin.js')
        expect(map.imports['@blitzdev/plugin-packed/'])
            .toBe('/kite3d/plugins/@blitzdev/plugin-packed/')
        expect(map.imports['local-plugin']).toBe('/kite3d/plugins/local-plugin/index.js')
        expect(map.imports['local-plugin/']).toBe('/kite3d/plugins/local-plugin/')
        expect(map.imports['@blitzdev/engine']).toBe('/editor-runtime.js')
    })
})
