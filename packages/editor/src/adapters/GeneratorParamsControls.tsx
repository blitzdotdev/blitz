import {useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode} from 'react'
import {Button, HTMLSelect, InputGroup, NumericInput, Switch} from '@blueprintjs/core'
import {
    inferGeneratorParam,
    validateGeneratorParam,
    type GeneratorParamOption,
    type GeneratorParamSchema,
    type GeneratorParamSchemaEntry,
} from '@kite3d/engine'

export function GeneratorParamsControls({
    nodeIndex,
    params,
    schema,
    onApply,
}: {
    nodeIndex: number
    params: Record<string, unknown>
    schema: GeneratorParamSchema
    onApply: (params: Record<string, unknown>) => Promise<void>
}) {
    const declared = Object.entries(schema)
    const undeclared = Object.entries(params)
        .filter(([key]) => !Object.prototype.hasOwnProperty.call(schema, key))
        .map(([key, value]) => [key, inferGeneratorParam(value)] as const)

    return <>
        <div className="generator-param-list">
            {[...declared, ...undeclared].map(([key, entry]) => <GeneratorParamRow
                key={key}
                paramKey={key}
                entry={entry}
                hasSavedValue={Object.prototype.hasOwnProperty.call(params, key)}
                savedValue={params[key]}
                onApply={async (value) => onApply({...params, [key]: value})}/>) }
        </div>
        <GeneratorParamsJson
            key={nodeIndex}
            nodeIndex={nodeIndex}
            params={params}
            onApply={onApply}/>
    </>
}

function GeneratorParamRow({paramKey, entry, hasSavedValue, savedValue, onApply}: {
    paramKey: string
    entry: GeneratorParamSchemaEntry
    hasSavedValue: boolean
    savedValue: unknown
    onApply: (value: unknown) => Promise<void>
}) {
    const hasDefault = Object.prototype.hasOwnProperty.call(entry, 'default')
    const value = hasSavedValue ? savedValue : hasDefault ? entry.default : emptyValue(entry)
    const label = entry.label || humanizeParamKey(paramKey)
    const savedError = hasSavedValue || hasDefault ? validateGeneratorParam(value, entry) : undefined
    const testId = `generator-param-${paramKey}`

    if (entry.type === 'boolean') {
        return <ParamRow label={label} help={entry.help} isDefault={!hasSavedValue && hasDefault} error={savedError}>
            <Switch
                aria-label={label}
                checked={value === true}
                data-testid={testId}
                onChange={(event) => void onApply(event.currentTarget.checked)}/>
        </ParamRow>
    }

    if (entry.type === 'select') {
        const options = entry.options || []
        const selected = options.findIndex((option) => Object.is(optionValue(option), value))
        return <ParamRow label={label} help={entry.help} isDefault={!hasSavedValue && hasDefault} error={savedError}>
            <HTMLSelect
                aria-label={label}
                data-testid={testId}
                fill={true}
                value={selected < 0 ? '' : String(selected)}
                onChange={(event) => {
                    const option = options[Number(event.currentTarget.value)]
                    if (option !== undefined) void onApply(optionValue(option))
                }}>
                {selected < 0 && <option value="">Choose…</option>}
                {options.map((option, index) => <option key={index} value={String(index)}>
                    {optionLabel(option)}
                </option>)}
            </HTMLSelect>
        </ParamRow>
    }

    return <DeferredParamRow
        entry={entry}
        isDefault={!hasSavedValue && hasDefault}
        label={label}
        onApply={onApply}
        savedError={savedError}
        testId={testId}
        value={value}/>
}

function DeferredParamRow({entry, isDefault, label, onApply, savedError, testId, value}: {
    entry: GeneratorParamSchemaEntry
    isDefault: boolean
    label: string
    onApply: (value: unknown) => Promise<void>
    savedError?: string
    testId: string
    value: unknown
}) {
    const focused = useRef(false)
    const dirty = useRef(false)
    const latest = useRef({draft: draftValue(value, entry), error: savedError})
    latest.current = {draft: draftValue(value, entry), error: savedError}
    const [draft, setDraft] = useState<string | string[]>(latest.current.draft)
    const [error, setError] = useState(savedError)

    useEffect(() => {
        if (focused.current) return
        dirty.current = false
        setDraft(latest.current.draft)
        setError(latest.current.error)
    }, [entry, savedError, value])

    const changeDraft = (next: string | string[]) => {
        dirty.current = true
        setDraft(next)
        setError(undefined)
    }
    const commit = async () => {
        if (!dirty.current) {
            setDraft(latest.current.draft)
            setError(latest.current.error)
            return
        }
        const parsed = parseDraft(draft, entry, label)
        if (typeof parsed === 'string') {
            setError(parsed)
            return
        }
        const validationError = validateGeneratorParam(parsed.value, entry)
        if (validationError) {
            setError(validationError)
            return
        }
        dirty.current = false
        setError(undefined)
        await onApply(parsed.value)
    }
    const onFocus = () => { focused.current = true }
    const onBlur = (event: FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        focused.current = false
        void commit()
    }
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' || (entry.type === 'json' && event.shiftKey)) return
        event.preventDefault()
        void commit()
    }

    return <ParamRow label={label} help={entry.help} isDefault={isDefault} error={error}>
        <div className="generator-param-control" onFocus={onFocus} onBlur={onBlur}>
            {(entry.type === 'number' || entry.type === 'integer') && <NumericInput
                allowNumericCharactersOnly={false}
                aria-label={label}
                asyncControl={true}
                buttonPosition="none"
                data-testid={testId}
                fill={true}
                max={entry.max}
                min={entry.min}
                onKeyDown={onKeyDown}
                onValueChange={(_number, text) => changeDraft(text)}
                stepSize={entry.step ?? (entry.type === 'integer' ? 1 : 0.1)}
                value={stringDraft(draft)}/>}
            {entry.type === 'string' && <InputGroup
                aria-label={label}
                data-testid={testId}
                onChange={(event) => changeDraft(event.currentTarget.value)}
                onKeyDown={onKeyDown}
                value={stringDraft(draft)}/>}
            {entry.type === 'vector' && <div className="generator-vector-inputs" data-testid={testId}>
                {arrayDraft(draft).map((component, index) => <NumericInput
                    allowNumericCharactersOnly={false}
                    aria-label={`${label} ${index + 1}`}
                    asyncControl={true}
                    buttonPosition="none"
                    fill={true}
                    key={index}
                    onKeyDown={onKeyDown}
                    onValueChange={(_number, text) => {
                        const next = [...arrayDraft(draft)]
                        next[index] = text
                        changeDraft(next)
                    }}
                    stepSize={0.1}
                    value={component}/>) }
            </div>}
            {entry.type === 'color' && <input
                aria-label={label}
                className="generator-color-input"
                data-testid={testId}
                onChange={(event) => changeDraft(event.currentTarget.value)}
                onKeyDown={onKeyDown}
                type="color"
                value={/^#[\da-f]{6}$/i.test(stringDraft(draft)) ? stringDraft(draft) : '#000000'}/>}
            {entry.type === 'json' && <textarea
                aria-label={label}
                className="bp5-input generator-param-json-input"
                data-testid={testId}
                onChange={(event) => changeDraft(event.currentTarget.value)}
                onKeyDown={onKeyDown}
                value={stringDraft(draft)}/>}
        </div>
    </ParamRow>
}

function ParamRow({children, error, help, isDefault, label}: {
    children: ReactNode
    error?: string
    help?: string
    isDefault: boolean
    label: string
}) {
    return <div className="generator-param-row">
        <div className="kite3d-control-row">
            <span>{label}</span>
            <div className="generator-param-value">
                {children}
                {isDefault && <span className="generator-default-hint">default</span>}
            </div>
        </div>
        {help && <small className="generator-param-help">{help}</small>}
        {error && <small className="generator-param-error" role="alert">{error}</small>}
    </div>
}

function GeneratorParamsJson({nodeIndex, params, onApply}: {
    nodeIndex: number
    params: Record<string, unknown>
    onApply: (params: Record<string, unknown>) => Promise<void>
}) {
    const serialized = JSON.stringify(params, null, 2)
    const focused = useRef(false)
    const dirty = useRef(false)
    const latest = useRef(serialized)
    latest.current = serialized
    const [draft, setDraft] = useState(serialized)
    const [error, setError] = useState<string>()

    useEffect(() => {
        if (focused.current) return
        dirty.current = false
        setDraft(serialized)
        setError(undefined)
    }, [serialized])

    const apply = async () => {
        let parsed: unknown
        try {
            parsed = JSON.parse(draft) as unknown
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Params must be valid JSON.')
            return
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setError('Params must be a JSON object.')
            return
        }
        dirty.current = false
        setError(undefined)
        await onApply(parsed as Record<string, unknown>)
    }

    return <details className="generator-json-fallback">
        <summary>Edit as JSON</summary>
        <label className="kite3d-control-row is-textarea">
            <span>Params</span>
            <textarea
                aria-label="Generator params JSON"
                className="bp5-input generator-params-input"
                data-testid={`generator-params-${nodeIndex}`}
                value={draft}
                onFocus={() => { focused.current = true }}
                onBlur={() => {
                    focused.current = false
                    if (!dirty.current) setDraft(latest.current)
                }}
                onChange={(event) => {
                    dirty.current = true
                    setDraft(event.currentTarget.value)
                    setError(undefined)
                }}/>
        </label>
        {error && <small className="generator-param-error generator-json-error" role="alert">{error}</small>}
        <Button small={true} onClick={() => void apply()} text="Apply"/>
    </details>
}

function draftValue(value: unknown, entry: GeneratorParamSchemaEntry): string | string[] {
    if (entry.type === 'vector') {
        const parts = Array.isArray(value) ? value.slice(0, 4).map(String) : [value === undefined ? '' : String(value)]
        while (parts.length < 2) parts.push('')
        return parts
    }
    if (entry.type === 'json') return JSON.stringify(value, null, 2) ?? ''
    return value === undefined || value === null ? '' : String(value)
}

function parseDraft(
    draft: string | string[],
    entry: GeneratorParamSchemaEntry,
    label: string,
): {value: unknown} | string {
    if (entry.type === 'number' || entry.type === 'integer') {
        const text = stringDraft(draft).trim()
        const value = text ? Number(text) : Number.NaN
        return {value}
    }
    if (entry.type === 'vector') {
        const values = arrayDraft(draft).map((part) => part.trim() ? Number(part) : Number.NaN)
        return {value: values}
    }
    if (entry.type === 'json') {
        try {
            return {value: JSON.parse(stringDraft(draft)) as unknown}
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : 'invalid JSON'
            return `${label} contains invalid JSON: ${message}`
        }
    }
    return {value: stringDraft(draft)}
}

function emptyValue(entry: GeneratorParamSchemaEntry): unknown {
    if (entry.type === 'boolean') return false
    if (entry.type === 'vector') return [0, 0, 0]
    if (entry.type === 'color') return '#000000'
    return undefined
}

function stringDraft(value: string | string[]): string {
    return Array.isArray(value) ? value.join(', ') : value
}

function arrayDraft(value: string | string[]): string[] {
    return Array.isArray(value) ? value : [value, '']
}

function optionValue(option: GeneratorParamOption): string | number {
    return typeof option === 'object' ? option.value : option
}

function optionLabel(option: GeneratorParamOption): string {
    return typeof option === 'object' ? option.label : String(option)
}

function humanizeParamKey(key: string): string {
    const words = key
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .toLowerCase()
    return words ? words[0].toUpperCase() + words.slice(1) : key
}
