import * as idb from 'idb'

export class BrowserFileStoreIdb {

    static readonly IDB_NAME = 'THREEPIPE_EDITOR_DB'
    static readonly IDB_VERSION = 1
    static readonly IDB_FILE_STORE = 'files_system'

    db?: idb.IDBPDatabase

    async initDb() {
        if (this.db) return this.db
        this.db = await idb.openDB<any>(BrowserFileStoreIdb.IDB_NAME, BrowserFileStoreIdb.IDB_VERSION, {
            upgrade(db) {
                db.createObjectStore(BrowserFileStoreIdb.IDB_FILE_STORE)
            }
        })
        return this.db
    }

    dispose() {
        this.db?.close()
        this.db = undefined
    }

    async put(value: any, key: string) {
        const db = await this.initDb()
        await db.put(BrowserFileStoreIdb.IDB_FILE_STORE, value, key)
    }

    async get(key: string) {
        const db = await this.initDb()
        return await db.get(BrowserFileStoreIdb.IDB_FILE_STORE, key)
    }

    async getKeys() {
        return (await this.initDb().then(db => db.getAllKeys(BrowserFileStoreIdb.IDB_FILE_STORE))) as string[]
    }

    async clearDb() {
        await (await this.initDb()).clear(BrowserFileStoreIdb.IDB_FILE_STORE)
    }

}

// todo we need to subscribe to changes from other tabs
export class BrowserFileStoreIdbWithMem extends BrowserFileStoreIdb{
    cache: {[key: string]: any} = {}

    async put(value: any & {lastModified: number}, key: string) {
        this.cache[key] = value
        await super.put(value, key)
    }

    async get(key: string) {
        const val = await super.get(key)
        const cache = this.cache[key]
        // we need to return from memory if possible because permissions in file system handles are not persisted
        return (val && cache && val.lastModified === cache.lastModified) ? cache : val
    }
}

export const browserFileStore = new BrowserFileStoreIdbWithMem()
