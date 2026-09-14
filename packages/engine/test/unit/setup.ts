// The engine's runtime imports pull in three.js and threepipe, which read a handful of
// browser globals while their modules evaluate. These unit tests never render, so the
// smallest set that lets the modules load keeps jsdom out of the dependency tree.
class ImageDataStub {}

const documentStub = {
    createElementNS: () => ({style: {}, getContext: () => null, setAttribute: () => undefined}),
    createElement: () => ({style: {}, getContext: () => null, setAttribute: () => undefined}),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
}

if (!('ImageData' in globalThis)) Object.assign(globalThis, {ImageData: ImageDataStub})
if (!('window' in globalThis)) {
    Object.assign(globalThis, {
        window: {
            location: {href: 'http://localhost/', search: '', hash: ''},
            document: documentStub,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            devicePixelRatio: 1,
        },
    })
}
if (!('document' in globalThis)) Object.assign(globalThis, {document: documentStub})
