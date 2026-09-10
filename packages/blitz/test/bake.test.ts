import {describe, expect, it} from 'vitest'
import {checkBakeSafety} from '../src/bake.ts'

describe('bake safety', () => {
    it('refuses a node with persisted children', () => {
        const result = checkBakeSafety({
            nodes: [{name: 'Forest', children: [1]}, {name: 'Hand placed tree'}],
        }, 'Forest')
        expect(result).toMatchObject({ok: false, code: 'non_generated_children'})
    })

    it('refuses human edits under the node since the last bake', () => {
        const result = checkBakeSafety({
            nodes: [{
                name: 'Forest',
                children: [1],
                extras: {blitzBakedFrom: {ts: '2026-09-09T10:00:00.000Z'}},
            }, {
                name: 'Baked tree',
                extras: {blitzGenerated: true},
            }],
        }, 'Forest', [{
            ts: '2026-09-09T11:00:00.000Z',
            client: 'editor-human',
            summary: {transforms: [{node: {name: 'Baked tree'}, property: 'position'}]},
        }])
        expect(result).toMatchObject({ok: false, code: 'human_edits'})
    })

    it('allows forced replacement', () => {
        const result = checkBakeSafety({
            nodes: [{name: 'Forest', children: [1]}, {name: 'Hand placed tree'}],
        }, 'Forest', [], true)
        expect(result).toEqual({ok: true})
    })
})
