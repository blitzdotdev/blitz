#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
    mcpResources,
    executeTool,
    readResource,
    editorState,
    editorClients,
    requestFromEditor
} from './mcp-bridge-common.mjs';

import {mcpTools} from "./mcp-tools.mjs";

/**
 * MCP Bridge Server for Kite 3D Game Engine - Stdio Transport
 *
 * This uses stdio transport for MCP communication.
 * For HTTP transport, use mcp-bridge-http.mjs instead.
 *
 * Usage:
 *   MCP mode: node mcp-bridge-server.mjs
 *   Test mode: node mcp-bridge-server.mjs --test
 */

// Check if running in test mode BEFORE any imports that might log
const isTestMode = process.argv.includes('--test');

const transport = process.argv.includes('--http') ? 'http' : 'stdio';

// In MCP mode, we must ensure NOTHING goes to stdout except JSON-RPC
if (transport === 'stdio' && !isTestMode) {
    process.removeAllListeners('warning');
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.debug = noop;
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
const log = isTestMode ? ((...args) => process.stderr.write(args.join(' ') + '\n')) : () => {};
const logError = isTestMode ? ((...args) => process.stderr.write('ERROR: ' + args.join(' ') + '\n')) : () => {};
setLogFunctions(log, logError);

// ============================================
// MCP Server for AI Agent Communication
// ============================================

const mcpServer = new Server(
    { name: 'kite3d-dev-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await executeTool(name, args || {});
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
});

mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: mcpResources }));

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
            setupWebSocketServer();
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
            const transport = new StdioServerTransport();
            await mcpServer.connect(transport);
            // Keep the process alive
            process.stdin.resume();
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
