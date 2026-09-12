import {describe, expect, it, vi} from 'vitest'
import {
    inferGeneratorParam,
    parseGeneratorParamsSchema,
    validateGeneratorParam,
    type GeneratorParamSchemaEntry,
} from '../../src/generatorParams.ts'

describe('generator params', () => {
    it('parses entries in order and infers omitted types', () => {
        const schema = parseGeneratorParamsSchema({
            choice: {options: ['light', {value: 'full', label: 'Full shaders'}], default: 'light'},
            enabled: {default: true},
            count: {default: 3, min: 1, max: 5, step: 1},
            offset: {default: [1, 2, 3]},
            title: {default: 'Map'},
            config: {default: {seed: 4}},
        }, 'generators/map.js')

        expect(Object.keys(schema)).toEqual(['choice', 'enabled', 'count', 'offset', 'title', 'config'])
        expect(Object.values(schema).map(({type}) => type))
            .toEqual(['select', 'boolean', 'number', 'vector', 'string', 'json'])
        expect(schema.choice.options).toEqual(['light', {value: 'full', label: 'Full shaders'}])
    })

    it('drops invalid entries with one warning per module and key', () => {
        const warn = vi.fn()
        const schema = parseGeneratorParamsSchema({
            good: {type: 'integer', default: 2},
            badType: {type: 'slider'},
            badOptions: {options: [{value: true, label: 'Yes'}]},
            badRange: {type: 'number', min: 5, max: 1},
        }, 'generators/map.js', warn)

        expect(schema).toEqual({good: {type: 'integer', default: 2}})
        expect(warn).toHaveBeenCalledTimes(3)
        for (const key of ['badType', 'badOptions', 'badRange']) {
            expect(warn.mock.calls.find(([message]) => String(message).includes(`"${key}"`))?.[0])
                .toContain('generators/map.js')
        }
    })

    it('returns an empty schema for absent and non-object exports', () => {
        const warn = vi.fn()
        expect(parseGeneratorParamsSchema(undefined, 'plain.js', warn)).toEqual({})
        expect(warn).not.toHaveBeenCalled()
        expect(parseGeneratorParamsSchema(['bad'], 'array.js', warn)).toEqual({})
        expect(parseGeneratorParamsSchema('bad', 'string.js', warn)).toEqual({})
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn.mock.calls[0][0]).toContain('array.js')
        expect(warn.mock.calls[1][0]).toContain('string.js')
    })

    it('infers controls for undeclared saved values', () => {
        expect(inferGeneratorParam(true).type).toBe('boolean')
        expect(inferGeneratorParam(3).type).toBe('number')
        expect(inferGeneratorParam([1, 2, 3]).type).toBe('vector')
        expect(inferGeneratorParam('hello').type).toBe('string')
        expect(inferGeneratorParam({nested: true}).type).toBe('json')
        expect(inferGeneratorParam([1, 2, 3, 4, 5]).type).toBe('json')
    })

    it('validates types, numeric bounds, select options, vectors, colors, and json', () => {
        const valid = (value: unknown, entry: GeneratorParamSchemaEntry) =>
            expect(validateGeneratorParam(value, entry)).toBeUndefined()
        const invalid = (value: unknown, entry: GeneratorParamSchemaEntry, message: string) =>
            expect(validateGeneratorParam(value, entry)).toContain(message)

        valid(false, {type: 'boolean'})
        invalid('false', {type: 'boolean'}, 'true or false')
        valid(2, {type: 'number', min: 1, max: 3})
        invalid(4, {type: 'number', max: 3}, 'at most 3')
        invalid(1.5, {type: 'integer'}, 'integer')
        valid('full', {type: 'select', options: ['light', 'full']})
        invalid('other', {type: 'select', options: ['light', 'full']}, 'available options')
        valid([1, 2, 3], {type: 'vector'})
        invalid([1, '2'], {type: 'vector'}, '2 to 4 numbers')
        valid('#12abEF', {type: 'color'})
        invalid('red', {type: 'color'}, 'hex color')
        valid({nested: [null, true]}, {type: 'json'})
        invalid({value: undefined}, {type: 'json'}, 'JSON value')
    })
})
