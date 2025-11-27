import {BrowserFileStoreIdb} from './BrowserFileStore.ts'

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}

export interface ChatHistory {
    id: string;
    title: string;
    created: Date;
    updated: Date;
    messages: ChatMessage[];
}

export class ChatHistoryManager {
    private static readonly STORAGE_KEY_PREFIX = 'chat_history_'
    private static readonly CHAT_LIST_KEY = 'chat_history_list'
    private store: BrowserFileStoreIdb

    constructor() {
        this.store = new BrowserFileStoreIdb()
    }

    private async getHistoryList(): Promise<string[]> {
        try {
            const list = await this.store.get(ChatHistoryManager.CHAT_LIST_KEY)
            return list || []
        } catch (error) {
            console.error('Error getting chat history list:', error)
            return []
        }
    }

    private async saveHistoryList(list: string[]): Promise<void> {
        try {
            await this.store.put(list, ChatHistoryManager.CHAT_LIST_KEY)
        } catch (error) {
            console.error('Error saving chat history list:', error)
        }
    }

    async createHistory(title?: string): Promise<ChatHistory> {
        const id = this.generateId()
        const now = new Date()
        const history: ChatHistory = {
            id,
            title: title || `Chat ${new Date().toLocaleDateString()}`,
            created: now,
            updated: now,
            messages: []
        }

        await this.saveHistory(history)

        const list = await this.getHistoryList()
        list.unshift(id)
        await this.saveHistoryList(list)

        return history
    }

    async saveHistory(history: ChatHistory): Promise<void> {
        try {
            history.updated = new Date()
            const key = ChatHistoryManager.STORAGE_KEY_PREFIX + history.id
            await this.store.put(this.serializeHistory(history), key)
        } catch (error) {
            console.error('Error saving chat history:', error)
            throw error
        }
    }

    async getHistory(id: string): Promise<ChatHistory | null> {
        try {
            const key = ChatHistoryManager.STORAGE_KEY_PREFIX + id
            const data = await this.store.get(key)
            if (!data) return null
            return this.deserializeHistory(data)
        } catch (error) {
            console.error('Error getting chat history:', error)
            return null
        }
    }

    async getAllHistories(): Promise<ChatHistory[]> {
        try {
            const list = await this.getHistoryList()
            const histories: ChatHistory[] = []

            for (const id of list) {
                const history = await this.getHistory(id)
                if (history) {
                    histories.push(history)
                }
            }

            return histories
        } catch (error) {
            console.error('Error getting all chat histories:', error)
            return []
        }
    }

    async deleteHistory(id: string): Promise<void> {
        try {
            const key = ChatHistoryManager.STORAGE_KEY_PREFIX + id
            const db = await this.store.initDb()
            await db.delete(BrowserFileStoreIdb.IDB_FILE_STORE, key)

            const list = await this.getHistoryList()
            const newList = list.filter(historyId => historyId !== id)
            await this.saveHistoryList(newList)
        } catch (error) {
            console.error('Error deleting chat history:', error)
            throw error
        }
    }

    async updateHistoryTitle(id: string, title: string): Promise<void> {
        const history = await this.getHistory(id)
        if (history) {
            history.title = title
            await this.saveHistory(history)
        }
    }

    private generateId(): string {
        return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    }

    private serializeHistory(history: ChatHistory): any {
        return {
            id: history.id,
            title: history.title,
            created: history.created.toISOString(),
            updated: history.updated.toISOString(),
            messages: history.messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp.toISOString()
            }))
        }
    }

    private deserializeHistory(data: any): ChatHistory {
        return {
            id: data.id,
            title: data.title,
            created: new Date(data.created),
            updated: new Date(data.updated),
            messages: data.messages.map((msg: any) => ({
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.timestamp)
            }))
        }
    }

    dispose() {
        this.store.dispose()
    }
}

