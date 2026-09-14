/**
 * MCP Bridge - AI Agent Integration for Kite 3D Editor
 *
 * This module exports utilities for connecting the editor to AI agents
 * through the Model Context Protocol (MCP).
 */

export { MCPBridgeClient, createMCPBridgeClient } from './MCPBridgeClient.ts';
export type { BridgeMessage, RequestHandler, MCPBridgeClientOptions } from './MCPBridgeClient.ts';

export { createMCPBridgeHandler, initMCPBridge } from './MCPBridgeHandler.ts';
export type { MCPBridgeHandlerOptions } from './MCPBridgeHandler.ts';

export { mcpTools, mcpResources } from './MCPToolsResources.ts';

export { ChatHistoryManager } from './ChatHistoryManager.ts';
export type { ChatMessage, ChatHistory } from './ChatHistoryManager.ts';
