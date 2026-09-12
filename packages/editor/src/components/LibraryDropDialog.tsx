import {Button, Checkbox, Dialog, DialogBody, DialogFooter, HTMLSelect, Radio, RadioGroup} from '@blueprintjs/core'
import {useEffect, useState} from 'react'
import type {LibraryDropAssetType, LibraryDropChoice} from '../utils/libraryDropChoices.ts'

export interface LibraryDropActionOption {
    id: string
    label: string
}

export interface LibraryDropMaterialOption {
    index: number
    name: string
}

export interface LibraryDropDialogRequest {
    assetName: string
    assetType: LibraryDropAssetType
    targetName: string
    targetDescription: string
    reason?: string
    actions: LibraryDropActionOption[]
    defaultAction: string
    slots?: LibraryDropActionOption[]
    materials?: LibraryDropMaterialOption[]
    onApply: (choice: LibraryDropChoice & {materialIndex?: number}, remember: boolean) => void
    onCancel?: () => void
}

let showLibraryDropDialog: ((request: LibraryDropDialogRequest) => void) | undefined

export function requestLibraryDropDialog(request: LibraryDropDialogRequest): boolean {
    if (!showLibraryDropDialog) return false
    showLibraryDropDialog(request)
    return true
}

export function LibraryDropDialog() {
    const [request, setRequest] = useState<LibraryDropDialogRequest | null>(null)
    const [action, setAction] = useState('')
    const [slot, setSlot] = useState('map')
    const [materialIndex, setMaterialIndex] = useState(0)
    const [remember, setRemember] = useState(false)

    useEffect(() => {
        showLibraryDropDialog = (next) => {
            setRequest(next)
            setAction(next.defaultAction)
            setSlot(next.slots?.[0]?.id || 'map')
            setMaterialIndex(next.materials?.[0]?.index || 0)
            setRemember(false)
        }
        return () => {
            showLibraryDropDialog = undefined
        }
    }, [])

    const close = () => {
        request?.onCancel?.()
        setRequest(null)
    }
    const apply = () => {
        if (!request) return
        request.onApply({action, slot, materialIndex}, remember)
        setRequest(null)
    }

    return <Dialog
        className="bp5-dark library-drop-dialog"
        data-testid="library-drop-dialog"
        isOpen={Boolean(request)}
        onClose={close}
        title="Add library asset"
    >
        {request && <form
            data-testid="library-drop-dialog"
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    close()
                } else if (event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    apply()
                }
            }}
            onSubmit={(event) => {
                event.preventDefault()
                apply()
            }}
        >
            <DialogBody>
                <p className="library-drop-dialog-summary">
                    Choose what to do with <strong>{request.assetName}</strong>.
                </p>
                <div className="library-drop-target" data-testid="library-drop-target">
                    <span>Target</span>
                    <strong>{request.targetName}</strong>
                    <small>{request.targetDescription}</small>
                </div>
                {request.reason && <p className="library-drop-dialog-reason" data-testid="library-drop-reason">
                    {request.reason}
                </p>}
                <RadioGroup
                    data-testid="library-drop-actions"
                    label="Action"
                    onChange={(event) => setAction(event.currentTarget.value)}
                    selectedValue={action}
                >
                    {request.actions.map((option) => <Radio
                        key={option.id}
                        label={option.label}
                        value={option.id}
                    />)}
                </RadioGroup>
                {action === 'texture-apply' && request.slots && <label className="library-drop-field">
                    <span>Texture slot</span>
                    <HTMLSelect
                        data-testid="library-drop-slot"
                        fill
                        onChange={(event) => setSlot(event.currentTarget.value)}
                        value={slot}
                    >
                        {request.slots.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </HTMLSelect>
                </label>}
                {action === 'texture-apply' && request.materials && request.materials.length > 1 && <label className="library-drop-field">
                    <span>Material</span>
                    <HTMLSelect
                        data-testid="library-drop-material"
                        fill
                        onChange={(event) => setMaterialIndex(Number(event.currentTarget.value))}
                        value={materialIndex}
                    >
                        {request.materials.map((option) => <option key={option.index} value={option.index}>{option.name}</option>)}
                    </HTMLSelect>
                </label>}
                <Checkbox
                    checked={remember}
                    data-testid="library-drop-remember"
                    label={`Remember my choice for ${request.assetType}`}
                    onChange={(event) => setRemember(event.currentTarget.checked)}
                />
            </DialogBody>
            <DialogFooter actions={<>
                <Button onClick={close}>Cancel</Button>
                <Button data-testid="library-drop-apply" intent="primary" type="submit">Apply</Button>
            </>}/>
        </form>}
    </Dialog>
}
