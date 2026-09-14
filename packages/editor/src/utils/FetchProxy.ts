declare global{
    interface Window {
        _tpFetchAsset?: (url: string)=>Promise<string>
        _tpOriginalFetch?: typeof fetch
        _tpFetchAssetPrefix?: string
    }
}

export class FetchProxy {

    static Setup(prefix: string) {
        if (window._tpFetchAssetPrefix) {
            if (window._tpFetchAssetPrefix !== prefix) this.Reset()
            else return
        }

        window._tpOriginalFetch = window.fetch
        window._tpFetchAssetPrefix = prefix
        window.fetch = async (input: RequestInfo | URL, ...rest) => {
            let url = typeof input === 'string' ? input : (input as Request).url
            if (url.startsWith(window.location.origin)) {
                url = url.slice(window.location.origin.length)
            }
            if (url && (url.startsWith(prefix))) {
                if (!window._tpFetchAsset) {
                    console.warn('FetchProxy not setup, might not be able to fetch asset', url)
                    window._tpFetchAsset = async (f) => f
                }
                url = await window._tpFetchAsset(url)
                // console.log(url)
                if (typeof url === 'string') {
                    input = url
                }
            }
            if (!window._tpOriginalFetch) {
                throw new Error('FetchProxy not setup correctly, reference to fetch missing')
            }
            return window._tpOriginalFetch(input, ...rest)
        }
    }

    static Reset() {
        if (window._tpFetchAssetPrefix) {
            if (window._tpOriginalFetch) window.fetch = window._tpOriginalFetch
            delete window._tpFetchAssetPrefix
        }
    }

    static Set(fetcher: (url: string) => Promise<string>) {
        window._tpFetchAsset = fetcher
    }
}
