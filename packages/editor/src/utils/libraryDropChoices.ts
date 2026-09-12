export const libraryDropChoicesStorageKey = 'kite3d.editor.dropChoices'

export type LibraryDropAssetType = 'model' | 'material' | 'texture' | 'environment'

export interface LibraryDropChoice {
    action: string
    slot?: string
}

type LibraryDropChoices = Partial<Record<LibraryDropAssetType, LibraryDropChoice>>

export function getLibraryDropChoice(assetType: LibraryDropAssetType): LibraryDropChoice | null {
    try {
        const value = localStorage.getItem(libraryDropChoicesStorageKey)
        if (!value) return null
        const choices = JSON.parse(value) as LibraryDropChoices
        const choice = choices[assetType]
        return choice && typeof choice.action === 'string' ? choice : null
    } catch {
        return null
    }
}

export function setLibraryDropChoice(assetType: LibraryDropAssetType, choice: LibraryDropChoice): void {
    try {
        const current = localStorage.getItem(libraryDropChoicesStorageKey)
        const parsed = current ? JSON.parse(current) as unknown : null
        const choices: LibraryDropChoices = parsed && typeof parsed === 'object' ? parsed : {}
        choices[assetType] = choice
        localStorage.setItem(libraryDropChoicesStorageKey, JSON.stringify(choices))
    } catch {
        // Storage is optional. The drop still applies when it is unavailable.
    }
}

export function clearLibraryDropChoices(): void {
    try {
        localStorage.removeItem(libraryDropChoicesStorageKey)
    } catch {
        // The settings action remains safe when storage is unavailable.
    }
}
