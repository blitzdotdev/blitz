import {describe, expect, it} from 'vitest'
import {
    dependencyImportMap,
    projectDependencies,
    projectPluginNames,
    RUNTIME_SPECIFIERS,
} from '../../src/importMap.ts'

describe('dependencyImportMap', () => {
    it('maps runtime modules and semver dependencies while skipping local and @kite3d package specs', () => {
        const formerScopeDependency = ['@blitzdev', 'example'].join('/')
        const dependencies = projectDependencies({
            dependencies: {
                '@kite3d/engine': 'file:../../packs/engine.tgz',
                '@kite3d/editor': '0.12.0',
                [formerScopeDependency]: '1.2.3',
                gsap: '^3.12.5',
                local: 'file:../local',
                tagged: 'latest',
            },
        })

        const map = dependencyImportMap(dependencies, '/editor-runtime.js')

        for (const specifier of RUNTIME_SPECIFIERS) {
            expect(map.imports[specifier]).toBe('/editor-runtime.js')
        }
        expect(map.imports[formerScopeDependency]).toContain(`https://esm.sh/${formerScopeDependency}@1.2.3?external=`)
        expect(map.imports.gsap).toContain('https://esm.sh/gsap@^3.12.5?external=')
        expect(map.imports).not.toHaveProperty('@kite3d/editor')
        expect(map.imports).not.toHaveProperty('local')
        expect(map.imports).not.toHaveProperty('tagged')
        expect(JSON.stringify(map)).not.toContain('../../packs')
    })

    it('maps installed plugins by bare name and package subpath for every dependency spec', () => {
        const packageJson = {
            dependencies: {
                '@kite3d/plugin-packed': 'file:../plugin.tgz',
                'local-plugin': 'file:../plugin',
                'versioned-plugin': '^1.2.3',
            },
            kite3d: {
                plugins: [
                    '@kite3d/plugin-packed',
                    'local-plugin:NamedPlugin',
                    {import: 'versioned-plugin', className: 'VersionedPlugin'},
                ],
            },
        }
        expect(projectPluginNames(packageJson)).toEqual([
            '@kite3d/plugin-packed',
            'local-plugin',
            'versioned-plugin',
        ])

        const map = dependencyImportMap(projectDependencies(packageJson), '/editor-runtime.js', [
            {
                specifier: '@kite3d/plugin-packed',
                entry: 'dist/plugin.js',
                rootUrl: '/kite3d/plugins/@kite3d/plugin-packed/',
            },
            {
                specifier: 'local-plugin',
                entry: './index.js',
                rootUrl: '/kite3d/plugins/local-plugin',
            },
        ])

        expect(map.imports['@kite3d/plugin-packed'])
            .toBe('/kite3d/plugins/@kite3d/plugin-packed/dist/plugin.js')
        expect(map.imports['@kite3d/plugin-packed/'])
            .toBe('/kite3d/plugins/@kite3d/plugin-packed/')
        expect(map.imports['local-plugin']).toBe('/kite3d/plugins/local-plugin/index.js')
        expect(map.imports['local-plugin/']).toBe('/kite3d/plugins/local-plugin/')
        expect(map.imports['@kite3d/engine']).toBe('/editor-runtime.js')
    })
})
