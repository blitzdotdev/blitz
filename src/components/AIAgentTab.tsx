import React, {useEffect, useState, useRef, useMemo} from "react";
import {Button, Card, TextArea, Tag, Menu, MenuItem, InputGroup, Dialog, Classes} from "@blueprintjs/core";
import {InsSectionHeader, InsSectionItem} from "./InspectorPanelComponent.tsx";
import {ChatHistoryManager, ChatHistory, ChatMessage} from "../utils/ChatHistoryManager.ts";

export function AIAgentTab({
    className,
}: {
    className?: string
}) {
    const historyManager = useMemo(() => new ChatHistoryManager(), [])
    const [currentHistory, setCurrentHistory] = useState<ChatHistory | null>(null)
    const [allHistories, setAllHistories] = useState<ChatHistory[]>([])
    const [inputValue, setInputValue] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isHistoryListOpen, setIsHistoryListOpen] = useState(false)
    const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
    const [renameValue, setRenameValue] = useState('')
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Load all histories on mount
    useEffect(() => {
        loadHistories()
        return () => {
            historyManager.dispose()
        }
    }, [])

    const loadHistories = async () => {
        const histories = await historyManager.getAllHistories()
        setAllHistories(histories)

        // Load the most recent history if available
        if (histories.length > 0 && !currentHistory) {
            setCurrentHistory(histories[0])
        }
    }

    const createNewChat = async () => {
        const newHistory = await historyManager.createHistory()
        setCurrentHistory(newHistory)
        await loadHistories()
    }

    const switchToChat = (history: ChatHistory) => {
        setCurrentHistory(history)
        setIsHistoryListOpen(false)
    }

    const deleteChat = async (id: string) => {
        await historyManager.deleteHistory(id)
        await loadHistories()
        if (currentHistory?.id === id) {
            const histories = await historyManager.getAllHistories()
            setCurrentHistory(histories.length > 0 ? histories[0] : null)
        }
    }

    const renameChat = async () => {
        if (currentHistory && renameValue.trim()) {
            await historyManager.updateHistoryTitle(currentHistory.id, renameValue.trim())
            await loadHistories()
            setCurrentHistory({...currentHistory, title: renameValue.trim()})
        }
        setIsRenameDialogOpen(false)
        setRenameValue('')
    }

    const openRenameDialog = () => {
        if (currentHistory) {
            setRenameValue(currentHistory.title)
            setIsRenameDialogOpen(true)
        }
    }

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    useEffect(() => {
        scrollToBottom()
    }, [currentHistory?.messages])

    const handleSend = async () => {
        if (!inputValue.trim() || isLoading) return

        // Create new history if none exists
        let history = currentHistory
        if (!history) {
            history = await historyManager.createHistory()
            setCurrentHistory(history)
            await loadHistories()
        }

        const userMessage: ChatMessage = {
            role: 'user',
            content: inputValue,
            timestamp: new Date()
        }

        history.messages.push(userMessage)
        await historyManager.saveHistory(history)
        setCurrentHistory({...history, messages: [...history.messages]})
        setInputValue('')
        setIsLoading(true)

        try {
            // TODO: Implement actual AI agent integration
            // This is a placeholder for the AI agent response
            await new Promise(resolve => setTimeout(resolve, 1000))

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: 'AI Agent response will be integrated here. This is a placeholder.',
                timestamp: new Date()
            }

            history.messages.push(assistantMessage)
            await historyManager.saveHistory(history)
            setCurrentHistory({...history, messages: [...history.messages]})
        } catch (error) {
            console.error('Error sending message:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const clearCurrentChat = async () => {
        if (currentHistory) {
            currentHistory.messages = []
            await historyManager.saveHistory(currentHistory)
            setCurrentHistory({...currentHistory})
        }
    }

    return <Card className={"bpInspectorCard " + className || ''} style={{borderRadius: 0, display: 'flex', flexDirection: 'column', height: '100%'}}>
        <InsSectionHeader title={currentHistory?.title || "AI Agent"} icon={"chat"}>
            <Button
                icon="list"
                variant={"minimal"}
                onClick={() => setIsHistoryListOpen(!isHistoryListOpen)}
                title="Chat History"
            />
            <Button
                icon="edit"
                variant={"minimal"}
                onClick={openRenameDialog}
                disabled={!currentHistory}
                title="Rename Chat"
            />
            <Button
                icon="plus"
                variant={"minimal"}
                onClick={createNewChat}
                title="New Chat"
            />
            <Button
                icon="delete"
                variant={"minimal"}
                onClick={clearCurrentChat}
                disabled={!currentHistory || currentHistory.messages.length === 0}
                title="Clear Messages"
            />
        </InsSectionHeader>

        {isHistoryListOpen && (
            <div style={{
                borderBottom: '1px solid #394b59',
                maxHeight: '200px',
                overflowY: 'auto'
            }}>
                <Menu>
                    {allHistories.map(history => (
                        <MenuItem
                            key={history.id}
                            text={history.title}
                            label={new Date(history.updated).toLocaleDateString()}
                            active={currentHistory?.id === history.id}
                            onClick={() => switchToChat(history)}
                            labelElement={
                                <Button
                                    icon="trash"
                                    minimal
                                    small
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        deleteChat(history.id)
                                    }}
                                />
                            }
                        />
                    ))}
                    {allHistories.length === 0 && (
                        <MenuItem text="No chat history" disabled />
                    )}
                </Menu>
            </div>
        )}

        <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
        }}>
            {!currentHistory || currentHistory.messages.length === 0 ? (
                <InsSectionItem
                    text={'No messages yet. Start a conversation with the AI agent.'}
                    icon={'info-sign'}
                />
            ) : (
                currentHistory.messages.map((message, index) => (
                    <div
                        key={index}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
                            gap: '5px'
                        }}
                    >
                        <Tag
                            minimal
                            intent={message.role === 'user' ? 'primary' : 'success'}
                        >
                            {message.role === 'user' ? 'You' : 'AI Agent'}
                        </Tag>
                        <div
                            style={{
                                backgroundColor: message.role === 'user' ? '#394b59' : '#2d3748',
                                padding: '10px',
                                borderRadius: '8px',
                                maxWidth: '80%',
                                wordWrap: 'break-word'
                            }}
                        >
                            {message.content}
                        </div>
                        <span style={{ fontSize: '10px', opacity: 0.6 }}>
                            {message.timestamp.toLocaleTimeString()}
                        </span>
                    </div>
                ))
            )}
            {isLoading && (
                <div style={{ alignSelf: 'flex-start' }}>
                    <Tag minimal intent="none">AI Agent is typing...</Tag>
                </div>
            )}
            <div ref={messagesEndRef} style={{ height: '1px', visibility:'hidden' }}></div>
        </div>

        <div style={{
            padding: '10px',
            borderTop: '1px solid #394b59',
            display: 'flex',
            gap: '10px'
        }}>
            <TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                fill
                autoResize={false}
                disabled={isLoading}
                style={{ resize: 'vertical', minHeight: '60px' }}
            />
            <Button
                icon="send-message"
                intent="primary"
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
                loading={isLoading}
            />
        </div>

        <Dialog
            isOpen={isRenameDialogOpen}
            onClose={() => setIsRenameDialogOpen(false)}
            title="Rename Chat"
        >
            <div className={Classes.DIALOG_BODY}>
                <InputGroup
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Enter chat name"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            renameChat()
                        }
                    }}
                />
            </div>
            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <Button onClick={() => setIsRenameDialogOpen(false)}>Cancel</Button>
                    <Button intent="primary" onClick={renameChat}>Rename</Button>
                </div>
            </div>
        </Dialog>
    </Card>
}
