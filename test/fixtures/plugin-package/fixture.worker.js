const response = await fetch(new URL('./sidecar.bin', import.meta.url))
if (!response.ok) throw new Error(`Sidecar request failed: ${response.status}`)
const bytes = new Uint8Array(await response.arrayBuffer())
globalThis.postMessage(bytes[0])
