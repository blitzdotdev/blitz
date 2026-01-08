/**
 * Common functionality for MCP Bridge Server
 * Shared between stdio and HTTP transport implementations
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket, WebSocketServer} from 'ws';

// Configuration
// export const HTTP_PORT = process.env.MCP_BRIDGE_HTTP_PORT || 3847;
const DEFAULT_WS_PORT = 3848;

// Store for connected editor clients
export const editorClients = new Set();

// Pending requests waiting for editor response
const pendingRequests = new Map();
let requestIdCounter = 0;

// Store for editor state (cached from connected editors)
export let editorState = {
    scene: null,
    selectedObjects: [],
    projectInfo: null,
    isConnected: false
};

// Dynamic tools and resources from editor
export let mcpTools = {value: []};
export let mcpResources = {value: []};

// WebSocket server reference
let wsServer = null;
let httpServer = null;

// Logging functions - can be overridden
let logFn = () => {};
let logErrorFn = () => {};

export function setLogFunctions(log, logError) {
    logFn = log;
    logErrorFn = logError;
}

function log(...args) {
    logFn(...args);
}

function logError(...args) {
    logErrorFn(...args);
}
/*
// ============================================
// HTTP Server for Editor Health Check & REST API
// ============================================

export function createHttpServer() {
    httpServer = http.createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);

        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                connectedEditors: editorClients.size,
                isEditorConnected: editorState.isConnected
            }));
            return;
        }

        if (url.pathname === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                editorConnected: editorState.isConnected,
                clientCount: editorClients.size,
                editorState: {
                    hasScene: !!editorState.scene,
                    selectedObjectsCount: editorState.selectedObjects.length,
                    projectInfo: editorState.projectInfo
                }
            }));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    return httpServer;
}

export function startHttpServer() {
    if (!httpServer) {
        createHttpServer();
    }

    return new Promise((resolve, reject) => {
        const handleError = (err) => {
            if (err.code === 'EADDRINUSE') {
                // Port is in use - try to use it anyway (previous instance may have died)
                // Or just continue without HTTP server since MCP stdio doesn't need it
                logFn(`[Bridge] Port ${HTTP_PORT} in use, continuing without HTTP server`);
                resolve(null);
            } else {
                reject(err);
            }
        };

        httpServer.on('error', handleError);
        httpServer.listen(HTTP_PORT, () => {
            log(`[Bridge] HTTP server listening on http://localhost:${HTTP_PORT}`);
            resolve(httpServer);
        });
    });
}
*/

// ============================================
// WebSocket Server for Editor Communication
// ============================================

export function sendToEditor(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

export function broadcastToEditors(message) {
    const messageStr = JSON.stringify(message);
    editorClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

function handleEditorMessage(ws, message) {
    switch (message.type) {
        case 'stateUpdate':
            Object.assign(editorState, message.state);
            break;

        case 'response':
            if (message.requestId && pendingRequests.has(message.requestId)) {
                const { resolve } = pendingRequests.get(message.requestId);
                pendingRequests.delete(message.requestId);
                resolve(message.data);
            }
            break;

        case 'error':
            if (message.requestId && pendingRequests.has(message.requestId)) {
                const { reject } = pendingRequests.get(message.requestId);
                pendingRequests.delete(message.requestId);
                reject(new Error(message.error));
            }
            break;

        case 'event':
            log('[Editor Event]', message.event, message.data);
            break;

        default:
            log('[Bridge] Unknown message type:', message.type);
    }
}

export function setupWebSocketServer({port, onToolsChanged, onResourcesChanged} = {}) {
    try {
        const parsedPort = parseInt(port || DEFAULT_WS_PORT);
        if( isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
            throw new Error(`[Bridge] Invalid WebSocket port: ${port}`);
        }
        wsServer = new WebSocketServer({ port: parsedPort });

        wsServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`[Bridge] WebSocket port ${parsedPort} in use, stop the other instance or choose a different port`);
            } else {
                console.error(`WebSocket server error: ${error.message}`);
            }
        });

        wsServer.on('connection', (ws) => {
            console.error('[Bridge] Editor client connected');
            editorClients.add(ws);
            editorState.isConnected = true;

            // Request initial state
            sendToEditor(ws, {
                type: 'request',
                requestId: ++requestIdCounter,
                action: 'getState'
            });

            // Request tools and resources
            const toolsRequestId = ++requestIdCounter;
            pendingRequests.set(toolsRequestId, {
                resolve: (data) => {
                    // toolsRes.resolve(data)
                    if (data && typeof data === 'object') {
                        if (data.tools) {
                            mcpTools.value = data.tools;
                            console.error('[Bridge] Received', data.tools.length, 'tools from editor');
                            if (onToolsChanged) onToolsChanged(data.tools);
                        }
                        if (data.resources) {
                            mcpResources.value = data.resources;
                            console.error('[Bridge] Received', data.resources.length, 'resources from editor');
                            if (onResourcesChanged) onResourcesChanged(data.resources);
                        }
                    }
                },
                reject: (error) => {
                    logError('[Bridge] Failed to get tools and resources:', error);
                    // toolsRes.reject(error)
                }
            });

            sendToEditor(ws, {
                type: 'request',
                requestId: toolsRequestId,
                action: 'getToolsAndResources'
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    handleEditorMessage(ws, message);
                } catch (error) {
                    logError('[Bridge] Failed to parse editor message:', error);
                }
            });

            ws.on('close', () => {
                log('[Bridge] Editor client disconnected');
                editorClients.delete(ws);
                editorState.isConnected = editorClients.size > 0;
            });

            ws.on('error', (error) => {
                logError('[Bridge] WebSocket error:', error);
                editorClients.delete(ws);
            });
        });

        log(`[Bridge] WebSocket server listening on ws://localhost:${parsedPort}`);
        return wsServer;
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            logFn(`[Bridge] WebSocket port ${port} in use, continuing without WS server`);
            return null;
        }
        throw error;
    }
}

// Send request to editor and wait for response
export function requestFromEditor(action, params = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
        if (editorClients.size === 0) {
            reject(new Error('No editor connected'));
            return;
        }

        const requestId = ++requestIdCounter;
        const timeoutId = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error('Request timeout'));
            }
        }, timeout);

        pendingRequests.set(requestId, {
            resolve: (data) => {
                clearTimeout(timeoutId);
                resolve(data);
            },
            reject: (error) => {
                clearTimeout(timeoutId);
                reject(error);
            }
        });

        const editor = editorClients.values().next().value;
        sendToEditor(editor, {
            type: 'request',
            requestId,
            action,
            params
        });
    });
}

// ============================================
// Tool Execution Handler
// ============================================

export async function executeTool(name, args = {}) {
    if (!editorState.isConnected) {
        return { error: 'No editor connected. Please ensure the Kite 3D editor is running and connected to the bridge.' };
    }

    try {
        return await requestFromEditor(name, args);
    } catch (error) {
        return { error: error.message };
    }
}

// ============================================
// Resource Reading Handler
// ============================================

export async function readResource(uri) {
    if (!editorState.isConnected) {
        return { error: 'No editor connected' };
    }

    try {
        switch (uri) {
            case 'kite3d://scene/hierarchy':
                return await requestFromEditor('getSceneHierarchy');
            case 'kite3d://editor/state':
                return await requestFromEditor('getEditorState');
            default:
                return { error: `Unknown resource: ${uri}` };
        }
    } catch (error) {
        return { error: error.message };
    }
}

// ============================================
// Shutdown
// ============================================

export function shutdown() {
    if (httpServer) httpServer.close();
    if (wsServer) wsServer.close();
}

// Set working directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.join(__dirname, '..'));
