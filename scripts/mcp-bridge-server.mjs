#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'http';
import { randomUUID } from 'crypto';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
    setLogFunctions,
    setupWebSocketServer,
    // startHttpServer,
    shutdown,
    executeTool,
    readResource,
    editorState,
    editorClients,
    requestFromEditor,
    mcpTools,
    mcpResources
} from './mcp-bridge-common.mjs';

/**
 * MCP Bridge Server for Kite 3D Game Engine - Stdio/HTTP Transport
 *
 * This uses stdio or HTTP transport for MCP communication.
 *
 * Usage:
 *   Stdio mode: node mcp-bridge-server.mjs [--port=3848]
 *   HTTP mode: node mcp-bridge-server.mjs --http [--port=3848] [--mcp-port=3849]
 *   Test mode: node mcp-bridge-server.mjs --test [--port=3848]
 */

// Parse command line arguments
const args = process.argv.slice(2);
const isTestMode = args.includes('--test');
const transportType = args.includes('--http') ? 'http' : 'stdio';

// Parse --port argument (for WebSocket)
const portArg = args.find(arg => arg.startsWith('--port='));
const wsPort = portArg ? portArg.split('=')[1] : (process.env.MCP_BRIDGE_WS_PORT || undefined);

// Parse --mcp-port argument (for HTTP transport)
const mcpPortArg = args.find(arg => arg.startsWith('--mcp-port='));
const mcpHttpPort = mcpPortArg ? parseInt(mcpPortArg.split('=')[1]) : (process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : 3849);

// In MCP mode, we must ensure NOTHING goes to stdout except JSON-RPC
if (transportType === 'stdio' && !isTestMode) {
    // process.removeAllListeners('warning');
    // const noop = () => {};
    // console.log = noop;
    // console.info = noop;
    // console.warn = noop;
    // console.debug = noop;
}

// Catch any uncaught errors before they can corrupt stdout
process.on('uncaughtException', (error) => {
    process.stderr.write(`Uncaught exception: ${error.message}\n${error.stack}\n`);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    process.stderr.write(`Unhandled rejection: ${reason}\n`);
    process.exit(1);
});

// Setup logging
const log = (...args)=>process.stderr.write(args.join(' ') + '\n');
const logError = (...args)=>process.stderr.write('ERROR: ' + args.join(' ') + '\n');
setLogFunctions(log, logError);

// ============================================
// MCP Server for AI Agent Communication
// ============================================

const mcpServer = new Server(
    { name: 'kite3d-dev-mcp', version: '1.0.0' },
    { capabilities: { tools: {
                listChanged: true,
            }, resources: {
                listChanged: true,
            } } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools.value }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await executeTool(name, args || {});
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
});

mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: mcpResources.value }));

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const data = await readResource(uri);
    return {
        contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2)
        }]
    };
});

// ============================================
// Start Servers
// ============================================

async function main() {
    try {
        // Wrap WebSocket setup in try-catch
        try {
            setupWebSocketServer({
                port: wsPort,
                onToolsChanged: ()=>mcpServer && mcpServer.sendToolListChanged(),
                onResourcesChanged: ()=>mcpServer && mcpServer.sendResourceListChanged(),
            });
        } catch (wsError) {
            process.stderr.write(`WebSocket setup error: ${wsError.message}\n`);
            process.exit(1);
        }

        // try {
        //     await startHttpServer();
        // } catch (httpError) {
        //     process.stderr.write(`HTTP server error: ${httpError.message}\n`);
        //     // Continue even if HTTP fails - MCP should still work
        // }

        if (isTestMode) {
            log('\n[Bridge] Running in TEST MODE');
            log('[Bridge] Type <action> [json args] - e.g: createObject {"type":"box"}');
            log('[Bridge] Special: status, exit\n');

            const readline = await import('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const prompt = () => {
                rl.question('[test]> ', async (input) => {
                    const trimmed = input.trim();
                    if (!trimmed) { prompt(); return; }

                    if (trimmed === 'status') {
                        log('Connected editors:', editorClients.size);
                        log('Editor connected:', editorState.isConnected);
                        prompt(); return;
                    }
                    if (trimmed === 'exit' || trimmed === 'quit') {
                        rl.close();
                        process.exit(0);
                    }

                    const spaceIdx = trimmed.indexOf(' ');
                    const action = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
                    const argsStr = spaceIdx === -1 ? '{}' : trimmed.slice(spaceIdx + 1).trim() || '{}';

                    let params = {};
                    try {
                        params = JSON.parse(argsStr);
                    } catch (e) {
                        logError('Invalid JSON args:', e.message);
                        prompt(); return;
                    }

                    try {
                        const result = await requestFromEditor(action, params);
                        log(JSON.stringify(result, null, 2));
                    } catch (error) {
                        logError('Error:', error.message);
                    }

                    prompt();
                });
            };

            prompt();
        } else {
            if (transportType === 'http') {
                // HTTP Transport mode - NOT TESTED
                const httpTransport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                });

                await mcpServer.connect(httpTransport);

                // Create HTTP server
                const httpServer = http.createServer(async (req, res) => {
                    try {
                        await httpTransport.handleRequest(req, res);
                    } catch (error) {
                        process.stderr.write(`HTTP request error: ${error.message}\n`);
                        if (!res.headersSent) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Internal server error' }));
                        }
                    }
                });

                httpServer.listen(mcpHttpPort, () => {
                    process.stderr.write(`[Bridge] MCP HTTP server listening on port ${mcpHttpPort}\n`);
                });

                // Handle graceful shutdown for HTTP
                const shutdownHttp = async () => {
                    process.stderr.write('\n[Bridge] Shutting down HTTP server...\n');
                    httpServer.close();
                    await httpTransport.close();
                };

                process.on('SIGINT', shutdownHttp);
                process.on('SIGTERM', shutdownHttp);

            } else {
                // Stdio Transport mode
                const transport = new StdioServerTransport();
                await mcpServer.connect(transport);
                // Keep the process alive
                process.stdin.resume();
            }
        }
    } catch (error) {
        process.stderr.write(`ERROR: ${error.message}\n${error.stack}\n`);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    log('\n[Bridge] Shutting down...');
    shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('\n[Bridge] Shutting down...');
    shutdown();
    process.exit(0);
});

main().catch((error) => {
    process.stderr.write(`Fatal error: ${error.message}\n${error.stack}\n`);
    process.exit(1);
});
