export function refreshProjectQueryState(data: {
    project: string | null,
    file: string | null,
    model?: string
}, reload = false) {
    const params = new URLSearchParams(location.search)
    const current = {
        project: params.get('project') || params.get('p') || null,
        file: params.get('file') || params.get('f') || null,
        model: params.get('model') || params.get('m') || null,
    }
    if (reload || JSON.stringify(current) !== JSON.stringify(data)) {
        if (params.has('project')) params.delete('project')
        if (params.has('p')) params.delete('p')
        if (params.has('file')) params.delete('file')
        if (params.has('f')) params.delete('f')
        if (params.has('model')) params.delete('model')
        if (params.has('m')) params.delete('m')

        if (data.project) params.set('p', data.project)
        if (data.file) params.set('f', data.file)
        if (data.model) params.set('m', data.model)
        window.history.pushState({}, '', '?' + params.toString())
        if (reload || (!data.project && current.project)) {
            // force reload to reset state and import maps
            window.location.reload()
        }

    }
}
