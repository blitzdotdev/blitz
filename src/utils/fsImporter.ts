
export interface FileParsed {
    str: string,
    ct: string,
}
export class FsImporter {
    prefix: string;
    ready: Promise<ServiceWorkerRegistration>;
    resolveFile: (path: string) => Promise<File | FileParsed | undefined>;

    constructor(resolveFile: (path: string) => Promise<File | FileParsed | undefined>/*, prefix = "/fs/"*/) {
        const prefix = "/fs/";
        this.prefix = prefix.endsWith("/") ? prefix : prefix + "/";
        this.ready = this._registerSW();
        this._setupMessageHandler();
        this.resolveFile = resolveFile;
    }

    async _registerSW() {
        if (!("serviceWorker" in navigator)) {
            throw new Error("Service Workers are not supported in this browser.");
        }
        const reg = await navigator.serviceWorker.register(
            // new URL("./fs-sw.js", import.meta.url),
            '/fs-sw.js',
            {type: "module"}
        );
        await navigator.serviceWorker.ready;
        return reg;
    }

    _setupMessageHandler() {
        navigator.serviceWorker.addEventListener("message", async (event) => {
            const {type, path, port} = event.data || {};
            if (type === "RESOLVE_FILE" && path && port) {
                try {
                    const file = await this.resolveFile(path);
                    // const ff = files.get(path)
                    // console.log('fs sw resolve file', path, file)
                    if (!file)
                        port.postMessage({ok: false, error: 'Not Found'});
                    else {
                        if ((file as FileParsed).str) {
                            port.postMessage({
                                ok: true, body: (file as FileParsed).str, init: {
                                    headers: {"Content-Type": (file as FileParsed).ct ?? "text/plain;charset=UTF-8"}
                                }
                            }, []);
                        } else {
                            port.postMessage({
                                ok: true, body: file as File, init: {
                                    headers: {"Content-Type": (file as File).type || "application/octet-stream"}
                                }
                            }, []); // transfer File/Blob
                        }
                    }
                } catch (err: any) {
                    port.postMessage({ok: false, error: err?.message || 'Unknown Error'});
                }
            }
        });
    }

    async import(path: string, prefix = true) {
        await this.ready;
        if(prefix) path = this.prefix + path.replace(/^\/+/, "");
        return import(/* @vite-ignore */ path);
    }

}
