import type {Server} from 'node:http'

export async function closeTestServer(server: Server): Promise<void> {
    const closed = new Promise<void>((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose())
    })
    server.closeIdleConnections()
    server.closeAllConnections()
    await closed
}
