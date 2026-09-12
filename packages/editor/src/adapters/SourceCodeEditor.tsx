import {indentWithTab} from '@codemirror/commands'
import {css} from '@codemirror/lang-css'
import {html} from '@codemirror/lang-html'
import {javascript} from '@codemirror/lang-javascript'
import {json} from '@codemirror/lang-json'
import {markdown} from '@codemirror/lang-markdown'
import {xml} from '@codemirror/lang-xml'
import {bracketMatching, indentOnInput, indentUnit, syntaxHighlighting} from '@codemirror/language'
import {EditorState, Transaction, type Extension} from '@codemirror/state'
import {
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from '@codemirror/view'
import {classHighlighter} from '@lezer/highlight'
import {minimalSetup} from 'codemirror'
import {useLayoutEffect, useRef} from 'react'
import {sourceLanguageForPath} from './sourceLanguage.ts'

function languageExtension(path: string): Extension | undefined {
    const name = path.split('/').pop()?.toLowerCase() || path.toLowerCase()
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
    switch (sourceLanguageForPath(path)) {
        case 'javascript':
            return javascript({
                typescript: extension === 'ts' || extension === 'tsx',
                jsx: extension === 'tsx',
            })
        case 'json': return json()
        case 'html': return html()
        case 'css': return css()
        case 'xml': return xml()
        case 'markdown': return markdown()
        case 'plain': return undefined
    }
}

export function SourceCodeEditor({path, value, onChange}: {
    path: string
    value: string
    onChange(value: string): void
}) {
    const mountRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView>()
    const onChangeRef = useRef(onChange)
    const valueRef = useRef(value)
    const applyingExternalValueRef = useRef(false)
    valueRef.current = value

    useLayoutEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    useLayoutEffect(() => {
        const parent = mountRef.current
        if (!parent) return
        const language = sourceLanguageForPath(path)
        const support = languageExtension(path)
        const extensions: Extension[] = [
            minimalSetup,
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            bracketMatching(),
            indentOnInput(),
            EditorState.tabSize.of(2),
            indentUnit.of('  '),
            keymap.of([indentWithTab]),
            syntaxHighlighting(classHighlighter),
            EditorView.theme({}, {dark: true}),
            EditorView.editorAttributes.of({'data-language': language}),
            EditorView.contentAttributes.of({
                'aria-label': `Source editor: ${path}`,
                'aria-multiline': 'true',
                autocapitalize: 'off',
                autocomplete: 'off',
                autocorrect: 'off',
                spellcheck: 'false',
            }),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && !applyingExternalValueRef.current) {
                    onChangeRef.current(update.state.doc.toString())
                }
            }),
        ]
        if (support) extensions.push(support)
        const view = new EditorView({
            parent,
            state: EditorState.create({doc: valueRef.current, extensions}),
        })
        viewRef.current = view
        return () => {
            viewRef.current = undefined
            view.destroy()
        }
    }, [path])

    useLayoutEffect(() => {
        const view = viewRef.current
        if (!view || view.state.doc.toString() === value) return
        const topBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
        const topLine = view.state.doc.lineAt(topBlock.from).number
        const nextDocument = view.state.toText(value)
        const nextTop = nextDocument.line(Math.min(topLine, nextDocument.lines)).from
        const changes = view.state.changes({from: 0, to: view.state.doc.length, insert: value})
        applyingExternalValueRef.current = true
        try {
            view.dispatch({
                changes,
                effects: EditorView.scrollIntoView(nextTop, {y: 'start', yMargin: 0}),
                annotations: Transaction.addToHistory.of(false),
            })
        } finally {
            applyingExternalValueRef.current = false
        }
    }, [value])

    return <div className="source-code-editor" ref={mountRef}/>
}
