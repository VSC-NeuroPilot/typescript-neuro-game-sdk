import { WebSocketServer, WebSocket } from 'ws'
import type { JSONSchema7 } from 'json-schema'
import type { IncomingMessage as HttpIncomingMessage } from 'http'

// Type definitions
export interface Action {
    name: string
    description: string
    schema?: Omit<JSONSchema7, 'type'> & { type: 'object' }
}

export interface ForcedAction {
    state?: string
    query: string
    ephemeral_context?: boolean
    action_names: string[]
}

export interface ExtraConfigOptions {
    /** Whether this is a test mode. Useful for automated testing purposes. */
    test?: boolean
    /** Whether or not the server should support multi-connects. Defaults to `false` since for most purposes you shouldn't be needing this. */
    multiConnect?: boolean
}

// Message types
export interface WsMessage {
    command: string
    game?: string
    data?: { [key: string]: any }
}

export interface OutgoingMessage {
    command: string
    data?: { [key: string]: any }
}

export interface IncomingMessage extends WsMessage {
    game: string
}

// Connection interface
export interface ClientConnection {
    id: number
    socket: WebSocket
    gameName?: string
    isAlive: boolean
}

// Execution result for actions
export interface ExecutionResult {
    successful: boolean
    message?: string | undefined
}

export class ExecutionResultHelper {
    static success(message?: string | undefined): ExecutionResult {
        return { successful: true, message: message || undefined }
    }

    static failure(message: string): ExecutionResult {
        return { successful: false, message }
    }
}

// Action handler interface
export interface ActionHandler {
    name: string
    validate(data: any): ExecutionResult
    execute(data: any): Promise<void> | void
}

// Message queue for outgoing messages
export class MessageQueue {
    private messages: OutgoingMessage[] = []

    enqueue(message: OutgoingMessage): void {
        // Check if we can merge with existing messages
        for (const existingMessage of this.messages) {
            if (this.tryMergeMessages(existingMessage, message)) {
                return
            }
        }
        this.messages.push(message)
    }

    dequeue(): OutgoingMessage | null {
        return this.messages.shift() || null
    }

    size(): number {
        return this.messages.length
    }

    private tryMergeMessages(existing: OutgoingMessage, incoming: OutgoingMessage): boolean {
        // Handle merging for actions/register
        if (existing.command === 'actions/register' && incoming.command === 'actions/register') {
            const existingActions = existing.data?.actions || []
            const incomingActions = incoming.data?.actions || []

            // Remove duplicate actions (by name) and add new ones
            const filtered = existingActions.filter((existingAction: Action) =>
                !incomingActions.some((incomingAction: Action) => incomingAction.name === existingAction.name)
            )

            existing.data = { actions: [...filtered, ...incomingActions] }
            return true
        }

        // Handle merging for actions/unregister
        if (existing.command === 'actions/unregister' && incoming.command === 'actions/unregister') {
            const existingNames = existing.data?.action_names || []
            const incomingNames = incoming.data?.action_names || []

            // Remove duplicates and combine
            const filtered = existingNames.filter((name: string) => !incomingNames.includes(name))
            existing.data = { action_names: [...filtered, ...incomingNames] }
            return true
        }

        return false
    }
}

// Command handler for incoming messages
export class CommandHandler {
    private handlers: Map<string, (data: any, connection: ClientConnection) => Promise<void>> = new Map()

    registerHandler(command: string, handler: (data: any, connection: ClientConnection) => Promise<void>): void {
        this.handlers.set(command, handler)
    }

    async handle(command: string, data: any, connection: ClientConnection): Promise<void> {
        const handler = this.handlers.get(command)
        if (handler) {
            try {
                await handler(data, connection)
            } catch (error) {
                console.error(`Error handling command ${command}:`, error)
            }
        } else {
            console.warn(`Unknown command: ${command}`)
        }
    }
}

/** The NeuroServer is a class that holds the current server */
export class NeuroServer {
    /** The WebSocket server */
    public readonly wss: WebSocketServer
    /** Actions currently registered per game */
    private readonly gameActions: Map<string, Map<string, Action>> = new Map()
    /** Action handlers per game */
    private readonly gameActionHandlers: Map<string, Map<string, ActionHandler>> = new Map()
    /** Whether or not there is a forced action currently in place. */
    public readonly forcedAction?: ForcedAction
    /** Currently connected clients */
    private readonly connections: Map<number, ClientConnection> = new Map()
    /** Message queues per connection */
    private readonly messageQueues: Map<number, MessageQueue> = new Map()
    /** Command handler */
    private readonly commandHandler: CommandHandler = new CommandHandler()
    /** Connection ID counter */
    private connectionIdCounter = 0
    /**
     * Extra configuration options for this server.
     * See {@link ExtraConfigOptions} for these config types.
     */
    private readonly extraConfigs?: ExtraConfigOptions | undefined

    /** 
     * Constructs a Neuro API server.
     * @param host The host to spawn the socket server on.
     * @param port The port to spawn the socket server on.
     * @param extraConfigs Extra configuration options.
     */
    constructor(host = "127.0.0.1", port = 8000, extraConfigs?: ExtraConfigOptions | undefined) {
        this.extraConfigs = extraConfigs || undefined
        this.wss = new WebSocketServer({ host, port })

        this.setupEventHandlers()
        this.setupCommandHandlers()
        this.startHeartbeat()
    }

    /** Get all actions for a specific game */
    public getGameActions(gameName: string): Action[] {
        const gameActions = this.gameActions.get(gameName)
        return gameActions ? Array.from(gameActions.values()) : []
    }

    /** Get currently connected clients for a game */
    public getConnectedClients(gameName?: string): ClientConnection[] {
        const clients = Array.from(this.connections.values())
        return gameName ? clients.filter(c => c.gameName === gameName) : clients
    }

    /** Register an action handler for a specific game */
    public registerActionHandler(gameName: string, handler: ActionHandler): void {
        if (!this.gameActionHandlers.has(gameName)) {
            this.gameActionHandlers.set(gameName, new Map())
        }
        this.gameActionHandlers.get(gameName)!.set(handler.name, handler)
    }

    /** Send a message to a specific connection */
    public sendToConnection(connectionId: number, message: OutgoingMessage): void {
        const connection = this.connections.get(connectionId)
        if (connection && connection.socket.readyState === WebSocket.OPEN) {
            connection.socket.send(JSON.stringify(message))
        }
    }

    /** Send a message to all connections of a specific game */
    public sendToGame(gameName: string, message: OutgoingMessage): void {
        this.getConnectedClients(gameName).forEach(connection => {
            if (connection.socket.readyState === WebSocket.OPEN) {
                connection.socket.send(JSON.stringify(message))
            }
        })
    }

    /** Send a message to all connections */
    public broadcast(message: OutgoingMessage): void {
        Array.from(this.connections.values()).forEach(connection => {
            if (connection.socket.readyState === WebSocket.OPEN) {
                connection.socket.send(JSON.stringify(message))
            }
        })
    }

    /** Force an action on a specific game */
    public forceAction(gameName: string, query: string, actionNames: string[], state?: string, ephemeralContext?: boolean): void {
        const message: OutgoingMessage = {
            command: 'action',
            data: {
                id: this.generateActionId(),
                name: actionNames[Math.floor(Math.random() * actionNames.length)],
                data: JSON.stringify({ query, state, ephemeral_context: ephemeralContext })
            }
        }
        this.sendToGame(gameName, message)
    }

    private setupEventHandlers(): void {
        this.wss.on('connection', (socket: WebSocket, request: HttpIncomingMessage) => {
            const connectionId = ++this.connectionIdCounter
            const connection: ClientConnection = {
                id: connectionId,
                socket,
                isAlive: true
            }

            this.connections.set(connectionId, connection)
            this.messageQueues.set(connectionId, new MessageQueue())

            console.log(`+ Connection ${connectionId} opened`)

            socket.on('message', async (data: Buffer) => {
                try {
                    const message: WsMessage = JSON.parse(data.toString())
                    await this.handleIncomingMessage(message, connection)
                } catch (error) {
                    console.error(`Error parsing message from connection ${connectionId}:`, error)
                }
            })

            socket.on('close', () => {
                console.log(`- Connection ${connectionId} closed`)
                this.connections.delete(connectionId)
                this.messageQueues.delete(connectionId)
            })

            socket.on('error', (error) => {
                console.error(`Connection ${connectionId} error:`, error)
            })

            socket.on('pong', () => {
                connection.isAlive = true
            })

            // Send reregister_all command to new connections
            this.sendToConnection(connectionId, { command: 'actions/reregister_all' })
        })

        this.wss.on('listening', () => {
            const address = this.wss.address()
            console.log(`Neuro API server listening on ${typeof address === 'string' ? address : `${address?.address}:${address?.port}`}`)
        })
    }

    private setupCommandHandlers(): void {
        // Handle startup messages
        this.commandHandler.registerHandler('startup', async (data: any, connection: ClientConnection) => {
            if (!connection.gameName) {
                const gameName = data?.game || 'unknown'
                console.log(`Connection ${connection.id} registered as game: ${gameName}`)
                connection.gameName = gameName

                // Clear any existing actions for this game
                this.gameActions.set(gameName, new Map())
                this.gameActionHandlers.set(gameName, new Map())
            }
        })

        // Handle context messages
        this.commandHandler.registerHandler('context', async (data: any, connection: ClientConnection) => {
            console.log(`Context from ${connection.gameName}: ${data?.message} (silent: ${data?.silent})`)
        })

        // Handle action registration
        this.commandHandler.registerHandler('actions/register', async (data: any, connection: ClientConnection) => {
            if (!connection.gameName) return

            const actions: Action[] = data?.actions || []
            const gameActions = this.gameActions.get(connection.gameName) || new Map()

            actions.forEach(action => {
                gameActions.set(action.name, action)
                console.log(`Registered action '${action.name}' for game '${connection.gameName}'`)
            })

            this.gameActions.set(connection.gameName, gameActions)
        })

        // Handle action unregistration
        this.commandHandler.registerHandler('actions/unregister', async (data: any, connection: ClientConnection) => {
            if (!connection.gameName) return

            const actionNames: string[] = data?.action_names || []
            const gameActions = this.gameActions.get(connection.gameName)

            if (gameActions) {
                actionNames.forEach(name => {
                    gameActions.delete(name)
                    console.log(`Unregistered action '${name}' for game '${connection.gameName}'`)
                })
            }
        })

        // Handle action forcing
        this.commandHandler.registerHandler('actions/force', async (data: any, connection: ClientConnection) => {
            if (!connection.gameName) return

            const actionNames: string[] = data?.action_names || []
            const query: string = data?.query || ''
            const state: string | undefined = data?.state
            const ephemeralContext: boolean = data?.ephemeral_context || false

            console.log(`Action force from ${connection.gameName}: ${query} (actions: ${actionNames.join(', ')})`)

            // In a real implementation, you would randomly select an action and execute it
            // For now, we just log it
        })

        // Handle action results
        this.commandHandler.registerHandler('action/result', async (data: any, connection: ClientConnection) => {
            const id: string = data?.id || ''
            const success: boolean = data?.success || false
            const message: string = data?.message || ''

            console.log(`Action result from ${connection.gameName}: ${id} - ${success ? 'SUCCESS' : 'FAILURE'}: ${message}`)
        })
    }

    private async handleIncomingMessage(message: WsMessage, connection: ClientConnection): Promise<void> {
        console.log(`<-- [${connection.id}] ${message.command}`, message.data || {})

        // Set game name if provided
        if (message.game && !connection.gameName) {
            connection.gameName = message.game
        }

        await this.commandHandler.handle(message.command, message.data, connection)
    }

    private startHeartbeat(): void {
        setInterval(() => {
            this.connections.forEach((connection, id) => {
                if (!connection.isAlive) {
                    console.log(`Connection ${id} failed heartbeat, terminating`)
                    connection.socket.terminate()
                    this.connections.delete(id)
                    this.messageQueues.delete(id)
                    return
                }

                connection.isAlive = false
                connection.socket.ping()
            })
        }, 30000) // 30 seconds
    }

    private generateActionId(): string {
        return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    /** Close the server */
    public close(): Promise<void> {
        return new Promise((resolve) => {
            this.wss.close(() => {
                console.log('Neuro API server closed')
                resolve()
            })
        })
    }
}
