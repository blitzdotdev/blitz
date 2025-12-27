#!/usr/bin/env node

/**
 * MCP Bridge Server for Kite 3D Game Engine - HTTP Transport
 *
 * This uses HTTP+SSE transport instead of stdio, which is more reliable
 * for some MCP clients.
 *
 * Usage: node mcp-bridge-http.mjs [--port 3849]
 */

import http from 'node:http';
import {
    setLogFunctions,
    setupWebSocketServer,
    startHttpServer,
    shutdown,
    mcpTools,
    mcpResources,
    executeTool,
    readResource,
    editorState
} from './mcp-bridge-common.mjs';

// Parse command line args
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const MCP_HTTP_PORT = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1]) : 3849;

// Setup logging
const log = console.log.bind(console);
const logError = console.error.bind(console);
setLogFunctions(log, logError);

// ============================================
// MCP HTTP Server with SSE
// ============================================

// Store SSE connections for notifications
const sseClients = new Set();

function createJsonRpcResponse(id, result) {
    return {
        jsonrpc: '2.0',
        id,
        result
    };
}

function createJsonRpcError(id, code, message) {
    return {
        jsonrpc: '2.0',
        id,
        error: { code, message }
    };
}

// Handle MCP JSON-RPC requests
async function handleMcpRequest(request) {
    const { method, params, id } = request;

    switch (method) {
        case 'initialize':
            return createJsonRpcResponse(id, {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {},
                    resources: {}
                },
                serverInfo: {
                    name: 'kite3d-dev-mcp',
                    version: '1.0.0'
                }
            });

        case 'initialized':
            return createJsonRpcResponse(id, {});

        case 'tools/list':
            return createJsonRpcResponse(id, { tools: mcpTools });

        case 'tools/call':
            const toolResult = await executeTool(params.name, params.arguments || {});
            return createJsonRpcResponse(id, {
                content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
            });

        case 'resources/list':
            return createJsonRpcResponse(id, { resources: mcpResources });

        case 'resources/read':
            const resourceData = await readResource(params.uri);
            return createJsonRpcResponse(id, {
                contents: [{
                    uri: params.uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(resourceData, null, 2)
                }]
            });

        case 'ping':
            return createJsonRpcResponse(id, {});

        default:
            return createJsonRpcError(id, -32601, `Method not found: ${method}`);
    }
}

// Create MCP HTTP server
const mcpHttpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${MCP_HTTP_PORT}`);

    // SSE endpoint for server-to-client messages
    if (url.pathname === '/sse' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Send initial endpoint info
        const endpointUrl = `http://localhost:${MCP_HTTP_PORT}/message`;
        res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

        sseClients.add(res);

        req.on('close', () => {
            sseClients.delete(res);
        });

        return;
    }

    // JSON-RPC message endpoint
    if (url.pathname === '/message' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const request = JSON.parse(body);
                log('[MCP] Request:', request.method, request.id);

                const response = await handleMcpRequest(request);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));

                log('[MCP] Response:', response.id, response.error ? 'ERROR' : 'OK');
            } catch (error) {
                logError('[MCP] Error:', error.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(createJsonRpcError(null, -32700, 'Parse error')));
            }
        });
        return;
    }

    // Health check
    if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            transport: 'http+sse',
            editorConnected: editorState.isConnected
        }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// ============================================
// Start Servers
// ============================================

async function main() {
    try {
        // Setup WebSocket server for editor communication
        setupWebSocketServer();

        // Start HTTP server for health checks
        await startHttpServer();

        // Start MCP HTTP server
        mcpHttpServer.listen(MCP_HTTP_PORT, () => {
            log(`[MCP] HTTP server listening on http://localhost:${MCP_HTTP_PORT}`);
            log(`[MCP] SSE endpoint: http://localhost:${MCP_HTTP_PORT}/sse`);
            log(`[MCP] Message endpoint: http://localhost:${MCP_HTTP_PORT}/message`);
            log('');
            log('Add to mcp.json:');
            log(JSON.stringify({
                servers: {
                    'kite3d-dev-mcp': {
                        type: 'sse',
                        url: `http://localhost:${MCP_HTTP_PORT}/sse`
                    }
                }
            }, null, 2));
        });

    } catch (error) {
        logError('Startup error:', error.message);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    log('\n[Bridge] Shutting down...');
    mcpHttpServer.close();
    shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('\n[Bridge] Shutting down...');
    mcpHttpServer.close();
    shutdown();
    process.exit(0);
});

main().catch((error) => {
    console.error('Fatal error:', error.message, error.stack);
    process.exit(1);
});
