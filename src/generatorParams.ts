export const generatorParamTypes = [
    'boolean',
    'number',
    'integer',
    'string',
    'select',
    'vector',
    'color',
    'json',
] as const

export type GeneratorParamType = typeof generatorParamTypes[number]

export type GeneratorParamOption = string | number | {
    value: string | number
    label: string
}

export interface GeneratorParamDefinition {
    type?: GeneratorParamType
    label?: string
    help?: string
    default?: unknown
    options?: GeneratorParamOption[]
    min?: number
    max?: number
    step?: number
}

export interface GeneratorParamSchemaEntry extends Omit<GeneratorParamDefinition, 'type'> {
    type: GeneratorParamType
}

export type GeneratorParamSchema = Record<string, GeneratorParamSchemaEntry>

export function parseGeneratorParamsSchema(
    exported: unknown,
    module: string,
    warn: (message: string) => void = console.warn,
): GeneratorParamSchema {
    if (exported === undefined) return {}
    if (!isRecord(exported)) {
        warn(`[kite3d] Ignoring invalid generator params export from ${module}: expected an object`)
        return {}
    }

    const schema: GeneratorParamSchema = {}
    for (const [key, value] of Object.entries(exported)) {
        const parsed = parseEntry(value)
        if (typeof parsed === 'string') {
            warn(`[kite3d] Ignoring invalid generator param "${key}" from ${module}: ${parsed}`)
            continue
        }
        schema[key] = parsed
    }
    return schema
}

export function inferGeneratorParam(value: unknown): GeneratorParamSchemaEntry {
    if (typeof value === 'boolean') return {type: 'boolean'}
    if (typeof value === 'number') return {type: 'number'}
    if (isNumberVector(value)) return {type: 'vector'}
    if (typeof value === 'string') return {type: 'string'}
    return {type: 'json'}
}

export function validateGeneratorParam(value: unknown, entry: GeneratorParamSchemaEntry): string | undefined {
    const name = entry.label || 'Value'
    switch (entry.type) {
        case 'boolean':
            return typeof value === 'boolean' ? undefined : `${name} must be true or false.`
        case 'number':
        case 'integer': {
            if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a number.`
            if (entry.type === 'integer' && !Number.isInteger(value)) return `${name} must be an integer.`
            if (entry.min !== undefined && value < entry.min) return `${name} must be at least ${entry.min}.`
            if (entry.max !== undefined && value > entry.max) return `${name} must be at most ${entry.max}.`
            return undefined
        }
        case 'string':
            return typeof value === 'string' ? undefined : `${name} must be text.`
        case 'select': {
            if (typeof value !== 'string' && typeof value !== 'number') {
                return `${name} must be one of the available options.`
            }
            if (entry.options?.length && !entry.options.some((option) => Object.is(optionValue(option), value))) {
                return `${name} must be one of the available options.`
            }
            return undefined
        }
        case 'vector':
            return isNumberVector(value) ? undefined : `${name} must be an array of 2 to 4 numbers.`
        case 'color':
            return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
                ? undefined
                : `${name} must be a six-digit hex color.`
        case 'json':
            return isJsonValue(value) ? undefined : `${name} must be a JSON value.`
    }
}

function parseEntry(value: unknown): GeneratorParamSchemaEntry | string {
    if (!isRecord(value)) return 'expected an object'
    if (value.type !== undefined && !generatorParamTypes.includes(value.type as GeneratorParamType)) {
        return `unknown type ${JSON.stringify(value.type)}`
    }
    if (value.label !== undefined && typeof value.label !== 'string') return 'label must be a string'
    if (value.help !== undefined && typeof value.help !== 'string') return 'help must be a string'
    if (value.options !== undefined && !isOptions(value.options)) return 'options must contain strings, numbers, or labeled values'
    for (const bound of ['min', 'max', 'step'] as const) {
        if (value[bound] !== undefined && !isFiniteNumber(value[bound])) return `${bound} must be a finite number`
    }
    if (isFiniteNumber(value.step) && value.step <= 0) return 'step must be greater than zero'
    if (isFiniteNumber(value.min) && isFiniteNumber(value.max) && value.min > value.max) {
        return 'min must not be greater than max'
    }

    const type = value.type as GeneratorParamType | undefined
        ?? (value.options !== undefined ? 'select' : inferGeneratorParam(value.default).type)
    if ((value.min !== undefined || value.max !== undefined || value.step !== undefined)
        && type !== 'number' && type !== 'integer') {
        return 'min, max, and step require a number or integer type'
    }
    if (value.options !== undefined && type !== 'select') return 'options require the select type'

    const entry: GeneratorParamSchemaEntry = {
        type,
        ...(value.label !== undefined ? {label: value.label} : {}),
        ...(value.help !== undefined ? {help: value.help} : {}),
        ...(Object.prototype.hasOwnProperty.call(value, 'default') ? {default: value.default} : {}),
        ...(value.options !== undefined ? {options: value.options} : {}),
        ...(isFiniteNumber(value.min) ? {min: value.min} : {}),
        ...(isFiniteNumber(value.max) ? {max: value.max} : {}),
        ...(isFiniteNumber(value.step) ? {step: value.step} : {}),
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'default')) {
        const error = validateGeneratorParam(entry.default, entry)
        if (error) return `invalid default: ${error}`
    }
    return entry
}

function isOptions(value: unknown): value is GeneratorParamOption[] {
    return Array.isArray(value) && value.every((option) => {
        if (typeof option === 'string' || typeof option === 'number') return true
        return isRecord(option)
            && (typeof option.value === 'string' || typeof option.value === 'number')
            && typeof option.label === 'string'
    })
}

function optionValue(option: GeneratorParamOption): string | number {
    return typeof option === 'object' ? option.value : option
}

function isNumberVector(value: unknown): value is number[] {
    return Array.isArray(value)
        && value.length >= 2
        && value.length <= 4
        && value.every(isFiniteNumber)
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const valid = Array.isArray(value)
        ? value.every((item) => isJsonValue(item, seen))
        : Object.getPrototypeOf(value) === Object.prototype
            && Object.values(value).every((item) => isJsonValue(item, seen))
    seen.delete(value)
    return valid
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
