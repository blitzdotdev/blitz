import React, {useEffect, useState} from "react";
import {Button, Card, InputGroup, Tag, Callout} from "@blueprintjs/core";
import {InsSectionHeader} from "./InsSectionHeader.tsx";
import {InsSectionItem} from "./InsSectionItem.tsx";
import {MCPBridgeClient} from "../utils/ai";

export function AIMCPTab({
    className,
    mcpBridge,
}: {
    className?: string;
    mcpBridge?: MCPBridgeClient;
}) {
    const [isConnected, setIsConnected] = useState(false);
    const [wsPort, setWsPort] = useState('3848');
    const [isConnecting, setIsConnecting] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    // Initialize port from mcpBridge wsUrl
    useEffect(() => {
        if (!mcpBridge) return;

        // Extract port from wsUrl
        const match = mcpBridge.wsUrl.match(/:(\d+)$/);
        if (match) {
            setWsPort(match[1]);
        }
    }, [mcpBridge]);

    // Poll connection status
    useEffect(() => {
        if (!mcpBridge) return;

        const checkConnection = () => {
            setIsConnected(mcpBridge.isConnected);
        };

        checkConnection();
        const interval = setInterval(checkConnection, 500);

        return () => clearInterval(interval);
    }, [mcpBridge]);

    const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newPort = e.target.value;
        setWsPort(newPort);

        // Update the wsUrl in the client when port changes
        if (mcpBridge && newPort) {
            mcpBridge.wsUrl = `ws://localhost:${newPort}`;
        }
    };

    const handleConnect = async () => {
        if (!mcpBridge) return;

        setIsConnecting(true);
        setLastError(null);

        try {
            await mcpBridge.connect();
            setIsConnected(true);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : 'Connection failed');
            console.error('Failed to connect to MCP bridge:', error);
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = () => {
        if (!mcpBridge) return;

        mcpBridge.disconnect();
        setIsConnected(false);
        setLastError(null);
    };

    if (!mcpBridge) {
        return (
            <Card className={"bpInspectorCard " + (className || '')} style={{borderRadius: 0, display: 'flex', flexDirection: 'column', height: '100%'}}>
                <InsSectionHeader title="MCP Bridge" icon="data-connection" />
                <div style={{padding: '15px'}}>
                    <Callout intent="warning" icon="info-sign">
                        MCP Bridge is not initialized. Please load a project first.
                    </Callout>
                </div>
            </Card>
        );
    }

    return (
        <Card className={"bpInspectorCard " + (className || '')} style={{borderRadius: 0, display: 'flex', flexDirection: 'column', height: '100%'}}>
            <InsSectionHeader title="MCP Bridge" icon="data-connection">
                {/*{isConnected ? (*/}
                {/*    <Button*/}
                {/*        icon="offline"*/}
                {/*        variant="minimal"*/}
                {/*        onClick={handleDisconnect}*/}
                {/*        title="Disconnect from MCP Bridge"*/}
                {/*        intent="danger"*/}
                {/*    />*/}
                {/*) : (*/}
                {/*    <Button*/}
                {/*        icon="link"*/}
                {/*        variant="minimal"*/}
                {/*        onClick={handleConnect}*/}
                {/*        loading={isConnecting}*/}
                {/*        title="Connect to MCP Bridge"*/}
                {/*        intent="success"*/}
                {/*    />*/}
                {/*)}*/}
            </InsSectionHeader>

            <div style={{
                padding: '15px',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px'
            }}>
                {/* Connection Status */}
                <div>
                    <div style={{marginBottom: '8px', fontSize: '12px', opacity: 0.8}}>
                        Connection Status
                    </div>
                    <Tag
                        intent={isConnected ? 'success' : 'warning'}
                        icon={isConnected ? 'tick-circle' : 'offline'}
                        fill
                    >
                        {isConnected ? 'Connected' : 'Disconnected'}
                    </Tag>
                </div>

                {/* WebSocket Port */}
                <div>
                    <div style={{marginBottom: '8px', fontSize: '12px', opacity: 0.8}}>
                        WebSocket Port
                    </div>
                    <InputGroup
                        value={wsPort}
                        onChange={handlePortChange}
                        placeholder="3848"
                        disabled={isConnected}
                        type="number"
                        leftIcon="numerical"
                    />
                    <div style={{marginTop: '5px', fontSize: '11px', opacity: 0.6}}>
                        Default: 3848
                    </div>
                </div>

                {/* Connection URL */}
                <div>
                    <div style={{marginBottom: '8px', fontSize: '12px', opacity: 0.8}}>
                        WebSocket URL
                    </div>
                    <InputGroup
                        value={`ws://localhost:${wsPort}`}
                        readOnly
                        leftIcon="link"
                        rightElement={
                            <Button
                                icon="clipboard"
                                variant="minimal"
                                onClick={() => {
                                    navigator.clipboard.writeText(`ws://localhost:${wsPort}`);
                                }}
                                title="Copy to clipboard"
                            />
                        }
                    />
                </div>

                {/* Manual Connect Button */}
                {!isConnected && (
                    <Button
                        icon="link"
                        intent="primary"
                        onClick={handleConnect}
                        loading={isConnecting}
                        fill
                        text={isConnecting ? "Connecting..." : "Connect to MCP Bridge"}
                    />
                )}

                {/* Disconnect Button */}
                {isConnected && (
                    <Button
                        icon="offline"
                        intent="danger"
                        onClick={handleDisconnect}
                        fill
                        text="Disconnect"
                    />
                )}

                {/* Error Display */}
                {lastError && (
                    <Callout intent="danger" icon="error">
                        {lastError}
                    </Callout>
                )}

                {/* Info Section */}
                <div style={{marginTop: '10px'}}>
                    <InsSectionItem
                        text="About MCP Bridge"
                        icon="info-sign"
                    />
                    <div style={{
                        marginTop: '10px',
                        fontSize: '12px',
                        opacity: 0.7,
                        lineHeight: '1.5'
                    }}>
                        The MCP Bridge connects the editor to AI agents through the Model Context Protocol.
                        Ensure the bridge server is running before connecting.
                    </div>
                </div>

                {/* Connection Instructions */}
                <div>
                    <InsSectionItem
                        text="How to Start the MCP Server"
                        icon="learning"
                    />
                    <div style={{
                        marginTop: '10px',
                        fontSize: '12px',
                        opacity: 0.7,
                        lineHeight: '1.5'
                    }}>
                        <ol style={{paddingLeft: '20px', margin: '5px 0'}}>
                            <li>Run the MCP server by adding it to .mcp.json file or configuring in your IDE</li>
                            <li>Check the port is same in both mcp.json and above </li>
                            <li>Click the "Connect to MCP Bridge" button above</li>
                        </ol>
                    </div>
                </div>

                {/* Connection Info */}
                {isConnected && (
                    <Callout intent="success" icon="tick">
                        Connected successfully. The bridge server can now interact with the editor.
                    </Callout>
                )}
            </div>
        </Card>
    );
}
