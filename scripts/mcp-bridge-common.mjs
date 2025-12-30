/**
 * Common functionality for MCP Bridge Server
 * Shared between stdio and HTTP transport implementations
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

// Configuration
export const HTTP_PORT = process.env.MCP_BRIDGE_HTTP_PORT || 3847;
export const WS_PORT = process.env.MCP_BRIDGE_WS_PORT || 3848;

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

export function setupWebSocketServer() {
    try {
        wsServer = new WebSocketServer({ port: WS_PORT });

        wsServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logFn(`[Bridge] WebSocket port ${WS_PORT} in use, continuing without WS server`);
            } else {
                logError(`WebSocket server error: ${error.message}`);
            }
        });

        wsServer.on('connection', (ws) => {
            log('[Bridge] Editor client connected');
            editorClients.add(ws);
            editorState.isConnected = true;

            sendToEditor(ws, {
                type: 'request',
                action: 'getState'
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

        log(`[Bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);
        return wsServer;
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            logFn(`[Bridge] WebSocket port ${WS_PORT} in use, continuing without WS server`);
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
// MCP Tools Definition
// ============================================

export const mcpTools = [
    {
        name: 'getSceneHierarchy',
        description: 'Get the current scene hierarchy with all objects and their properties',
        inputSchema: {
            type: 'object',
            properties: {
                maxDepth: { type: 'number', description: 'Maximum depth to traverse (default: unlimited). Use 1-3 for overview.' },
                skipBones: { type: 'boolean', description: 'Skip Bone objects in the hierarchy (default: true). Set to false to include skeletal bones.' },
                skipTypes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of object types to skip (e.g., ["Bone", "SkinnedMesh"])'
                }
            },
            required: []
        }
    },
    {
        name: 'getSelectedObjects',
        description: 'Get information about currently selected objects in the editor',
        inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'selectObject',
        description: 'Select an object in the scene by name or UUID',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string', description: 'The name or UUID of the object to select' }
            },
            required: ['identifier']
        }
    },
    {
        name: 'createObject',
        description: 'Create a new 3D object in the scene using the Object3DGeneratorPlugin',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'The type of object to create',
                    enum: [
                        // Primitives/Geometry
                        'geometry-plane',
                        'geometry-sphere',
                        'geometry-box',
                        'geometry-circle',
                        'geometry-torus',
                        'geometry-cylinder',
                        'geometry-text',
                        'geometry-line',
                        // Objects
                        'object-empty',
                        'object-group',
                        // Cameras
                        'camera-perspective',
                        'camera-orthographic',
                        // Lights
                        'light-point',
                        'light-ambient',
                        'light-directional',
                        'light-spot',
                        'light-hemisphere',
                        'light-rect-area',
                        // Text
                        'troika-text-plane'
                    ]
                },
                name: { type: 'string', description: 'Optional name for the object' },
                position: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
                    description: 'Initial position (default: {x: 0, y: 0, z: 0})'
                },
                parentUuid: { type: 'string', description: 'UUID of the parent object to attach to (optional)' },
                // Geometry parameters for primitives
                width: { type: 'number', description: 'Width for box/plane (default: 1)' },
                height: { type: 'number', description: 'Height for box/plane/cylinder (default: 1)' },
                depth: { type: 'number', description: 'Depth for box (default: 1)' },
                radius: { type: 'number', description: 'Radius for sphere/circle/torus (default: 1)' },
                radiusTop: { type: 'number', description: 'Top radius for cylinder (default: 1)' },
                radiusBottom: { type: 'number', description: 'Bottom radius for cylinder (default: 1)' },
                tube: { type: 'number', description: 'Tube radius for torus (default: 0.4)' },
                radialSegments: { type: 'number', description: 'Radial segments for cylinder/torus (default: 32)' },
                tubularSegments: { type: 'number', description: 'Tubular segments for torus (default: 48)' },
                widthSegments: { type: 'number', description: 'Width segments for box/plane/sphere (default: 1-32)' },
                heightSegments: { type: 'number', description: 'Height segments for box/plane/sphere/cylinder (default: 1-16)' },
                depthSegments: { type: 'number', description: 'Depth segments for box (default: 1)' },
                openEnded: { type: 'boolean', description: 'Open ended cylinder (default: false)' },
                // Light parameters
                color: { type: 'number', description: 'Color for lights as hex number (e.g., 0xffffff)' },
                intensity: { type: 'number', description: 'Intensity for lights (default: 1-3)' },
                // Camera parameters
                fov: { type: 'number', description: 'Field of view for perspective camera (default: 50)' },
                frustumSize: { type: 'number', description: 'Frustum size for orthographic camera' }
            },
            required: ['type']
        }
    },
    {
        name: 'deleteObject',
        description: 'Delete an object from the scene by UUID',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'The UUID of the object to delete (required, name not accepted to avoid duplicates)' }
            },
            required: ['uuid']
        }
    },
    {
        name: 'modifyObject',
        description: 'Modify properties of an object (position, rotation, scale, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string', description: 'The name or UUID of the object to modify' },
                properties: {
                    type: 'object',
                    description: 'Object containing properties to modify',
                    properties: {
                        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
                        rotation: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
                        scale: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
                        visible: { type: 'boolean' },
                        name: { type: 'string' }
                    }
                }
            },
            required: ['identifier', 'properties']
        }
    },
    {
        name: 'duplicateObject',
        description: 'Duplicate an object in the scene',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'The UUID of the object to duplicate (required, name not accepted to avoid duplicates)' }
            },
            required: ['uuid']
        }
    },
    {
        name: 'setObjectParent',
        description: 'Set the parent of an object (reparenting)',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string', description: 'The name or UUID of the object to reparent' },
                parentIdentifier: { type: 'string', description: 'The name or UUID of the new parent (use null or empty string for scene root)' },
                keepWorldTransform: { type: 'boolean', description: 'Keep the world position/rotation/scale (default: true)' }
            },
            required: ['identifier']
        }
    },
    {
        name: 'getObjectDetails',
        description: 'Get detailed information about a specific object including all component properties',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string', description: 'The name or UUID of the object' },
                includeChildren: { type: 'boolean', description: 'Include children hierarchy (default: false)' }
            },
            required: ['identifier']
        }
    },
    {
        name: 'findObjects',
        description: 'Search for objects in the scene by name pattern or type',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: 'Name pattern to search for (case-insensitive, supports * wildcard)' },
                type: { type: 'string', description: 'Object type to filter by (e.g., "Mesh", "Light", "Camera")' },
                hasComponent: { type: 'string', description: 'Filter objects that have a specific component' }
            },
            required: []
        }
    },
    {
        name: 'addComponent',
        description: 'Add a component/script to an object',
        inputSchema: {
            type: 'object',
            properties: {
                objectIdentifier: { type: 'string', description: 'The name or UUID of the object' },
                componentName: { type: 'string', description: 'The name of the component to add' },
                properties: { type: 'object', description: 'Initial properties for the component' }
            },
            required: ['objectIdentifier', 'componentName']
        }
    },
    {
        name: 'removeComponent',
        description: 'Remove a component from an object',
        inputSchema: {
            type: 'object',
            properties: {
                objectIdentifier: { type: 'string', description: 'The name or UUID of the object' },
                componentName: { type: 'string', description: 'The name of the component to remove' }
            },
            required: ['objectIdentifier', 'componentName']
        }
    },
    {
        name: 'getAvailableComponents',
        description: 'Get a list of available components/scripts that can be added to objects',
        inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'getProjectFiles',
        description: 'Get a list of files in the current project',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Optional subdirectory path to list' }
            },
            required: []
        }
    },
    {
        name: 'executeCommand',
        description: 'Execute an editor command (undo, redo, save, play, stop, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The command to execute', enum: ['undo', 'redo', 'save', 'play', 'stop', 'pause', 'refresh'] }
            },
            required: ['command']
        }
    },
    {
        name: 'getMaterials',
        description: 'Get a list of materials in the scene',
        inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'getTextures',
        description: 'Get a list of textures in the scene',
        inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'sendChatMessage',
        description: 'Send a message to be displayed in the editor chat/log',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'The message to display' },
                type: { type: 'string', description: 'Message type: info, warning, error, success', enum: ['info', 'warning', 'error', 'success'] }
            },
            required: ['message']
        }
    },
    {
        name: 'getEditorState',
        description: 'Get the current editor state including selection and mode',
        inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'getProjectInfo',
        description: 'Get information about the current project',
        inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'focusObject',
        description: 'Focus the camera on an object (fit to view)',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'The UUID of the object to focus on. If not provided, focuses on selected object or model root.' },
                padding: { type: 'number', description: 'Padding multiplier for the view fit (default: 1.5)' },
                duration: { type: 'number', description: 'Animation duration in milliseconds (default: 500)' }
            },
            required: []
        }
    }
];

// ============================================
// MCP Resources Definition
// ============================================

export const mcpResources = [
    {
        uri: 'kite3d://scene/hierarchy',
        name: 'Scene Hierarchy',
        description: 'Current scene object hierarchy',
        mimeType: 'application/json'
    },
    {
        uri: 'kite3d://editor/state',
        name: 'Editor State',
        description: 'Current editor state including selection and mode',
        mimeType: 'application/json'
    },
    {
        uri: 'kite3d://project/info',
        name: 'Project Info',
        description: 'Information about the current project',
        mimeType: 'application/json'
    }
];

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
            case 'kite3d://project/info':
                return await requestFromEditor('getProjectInfo');
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
