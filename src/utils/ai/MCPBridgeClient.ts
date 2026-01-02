/**
 * MCP Bridge Client for Kite 3D Editor
 *
 * This client connects the editor webpage to the MCP bridge server,
 * allowing AI agents to interact with the editor through the bridge.
 */

export interface BridgeMessage {
    type: 'request' | 'response' | 'error' | 'stateUpdate' | 'event';
    requestId?: number;
    action?: string;
    params?: Record<string, unknown>;
    data?: unknown;
    error?: string;
    state?: Record<string, unknown>;
    event?: string;
}

export type RequestHandler = (action: string, params: Record<string, unknown>) => Promise<unknown>;

export interface MCPBridgeClientOptions {
    wsUrl?: string;
    autoReconnect?: boolean;
    reconnectInterval?: number;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
    requestHandler?: RequestHandler;
}

const DEFAULT_WS_PORT = 3848;

export class MCPBridgeClient {
    private ws: WebSocket | null = null;
    public wsUrl: string;
    private autoReconnect: boolean;
    private reconnectInterval: number;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isConnecting = false;
    private isManualClose = false;

    private onConnect?: () => void;
    private onDisconnect?: () => void;
    private onError?: (error: Error) => void;
    private requestHandler?: RequestHandler;

    constructor(options: MCPBridgeClientOptions = {}) {
        this.wsUrl = options.wsUrl || `ws://localhost:${DEFAULT_WS_PORT}`;
        this.autoReconnect = options.autoReconnect ?? true;
        this.reconnectInterval = options.reconnectInterval ?? 3000;
        this.onConnect = options.onConnect;
        this.onDisconnect = options.onDisconnect;
        this.onError = options.onError;
        this.requestHandler = options.requestHandler;
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            if (this.isConnecting) {
                reject(new Error('Already connecting'));
                return;
            }

            this.isConnecting = true;
            this.isManualClose = false;

            try {
                this.ws = new WebSocket(this.wsUrl);

                this.ws.onopen = () => {
                    this.isConnecting = false;
                    console.log('[MCPBridgeClient] Connected to bridge server');
                    this.onConnect?.();
                    resolve();
                };

                this.ws.onclose = () => {
                    this.isConnecting = false;
                    console.log('[MCPBridgeClient] Disconnected from bridge server');
                    this.onDisconnect?.();

                    if (this.autoReconnect && !this.isManualClose) {
                        this.scheduleReconnect();
                    }
                };

                this.ws.onerror = (event) => {
                    this.isConnecting = false;
                    const error = new Error('WebSocket connection error');
                    console.error('[MCPBridgeClient] Connection error:', event);
                    this.onError?.(error);
                    reject(error);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
            } catch (error) {
                this.isConnecting = false;
                reject(error);
            }
        });
    }

    disconnect(): void {
        this.isManualClose = true;
        this.clearReconnectTimer();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    private scheduleReconnect(): void {
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            console.log('[MCPBridgeClient] Attempting to reconnect...');
            this.connect().catch(() => {
                // Reconnection failed, will try again
            });
        }, this.reconnectInterval);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private send(message: BridgeMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('[MCPBridgeClient] Cannot send message - not connected');
        }
    }

    private async handleMessage(data: string): Promise<void> {
        try {
            const message: BridgeMessage = JSON.parse(data);

            if (message.type === 'request' && message.action && message.requestId !== undefined) {
                // Handle request from MCP bridge
                try {
                    const result = await this.handleRequest(message.action, message.params || {});
                    this.send({
                        type: 'response',
                        requestId: message.requestId,
                        data: result
                    });
                } catch (error) {
                    this.send({
                        type: 'error',
                        requestId: message.requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        } catch (error) {
            console.error('[MCPBridgeClient] Failed to parse message:', error);
        }
    }

    private async handleRequest(action: string, params: Record<string, unknown>): Promise<unknown> {
        if (this.requestHandler) {
            return this.requestHandler(action, params);
        }
        throw new Error(`No handler registered for action: ${action}`);
    }

    /**
     * Set the request handler for processing MCP requests
     */
    setRequestHandler(handler: RequestHandler): void {
        this.requestHandler = handler;
    }

    /**
     * Send a state update to the bridge server
     */
    sendStateUpdate(state: Record<string, unknown>): void {
        this.send({
            type: 'stateUpdate',
            state
        });
    }

    /**
     * Send an event to the bridge server (for logging/debugging)
     */
    sendEvent(event: string, data?: unknown): void {
        this.send({
            type: 'event',
            event,
            data
        });
    }
}

/**
 * Create a default MCP Bridge Client instance
 */
export function createMCPBridgeClient(options?: MCPBridgeClientOptions): MCPBridgeClient {
    return new MCPBridgeClient(options);
}

