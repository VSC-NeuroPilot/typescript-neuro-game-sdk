import { NeuroServer, type Action } from 'neuro-game-api'
import express from 'express'
import assert from 'assert'

// Create a Randy-like server that randomly selects and executes actions
class RandyServer {
    private neuroServer: NeuroServer
    private httpServer: any
    private registeredActions: Map<string, Action[]> = new Map()
    private pendingResult: { id: string; actionName: string } | null = null
    private actionForceQueue: string[] = []

    constructor() {
        this.neuroServer = new NeuroServer("127.0.0.1", 8000)
        this.setupHttpServer()
        this.setupNeuroServerHandlers()
    }

    private setupHttpServer() {
        const app = express()
        app.use(express.json())

        // HTTP endpoint to manually trigger actions (like Randy)
        app.post('/', (req, res) => {
            const message = req.body
            console.log('HTTP trigger:', message)

            if (message.command === 'action') {
                // Simulate action execution
                this.sendActionToGame(message.data)
            }

            res.sendStatus(200)
        })

        this.httpServer = app.listen(1337, () => {
            console.log('HTTP server listening on port 1337')
            console.log('Send POST requests to http://localhost:1337 to manually trigger actions')
        })
    }

    private setupNeuroServerHandlers() {
        // Override the default action handlers
        this.neuroServer['commandHandler'].registerHandler('actions/register', async (data: any, connection: any) => {
            const gameName = connection.gameName
            if (!gameName) return

            const actions: Action[] = data?.actions || []
            this.registeredActions.set(gameName, [
                ...(this.registeredActions.get(gameName) || []),
                ...actions
            ])

            console.log(`Registered ${actions.length} actions for ${gameName}:`, actions.map(a => a.name))
        })

        this.neuroServer['commandHandler'].registerHandler('actions/unregister', async (data: any, connection: any) => {
            const gameName = connection.gameName
            if (!gameName) return

            const actionNames: string[] = data?.action_names || []
            const existingActions = this.registeredActions.get(gameName) || []

            const filteredActions = existingActions.filter(action => !actionNames.includes(action.name))
            this.registeredActions.set(gameName, filteredActions)

            console.log(`Unregistered actions for ${gameName}:`, actionNames)
        })

        this.neuroServer['commandHandler'].registerHandler('actions/force', async (data: any, connection: any) => {
            const gameName = connection.gameName
            if (!gameName) return

            const actionNames: string[] = data?.action_names || []
            const query: string = data?.query || ''

            console.log(`Action force for ${gameName}: "${query}" with actions [${actionNames.join(', ')}]`)

            // Randomly select an action after a short delay (like Randy)
            if (this.pendingResult === null) {
                setTimeout(() => this.executeRandomAction(gameName, actionNames), 500)
            } else {
                console.warn('Received new actions/force while waiting for result; sent to queue')
                this.actionForceQueue.push(...actionNames)
            }
        })

        this.neuroServer['commandHandler'].registerHandler('action/result', async (data: any, connection: any) => {
            const id: string = data?.id || ''
            const success: boolean = data?.success || false
            const message: string = data?.message || ''

            console.log(`Action result: ${id} - ${success ? 'SUCCESS' : 'FAILURE'}: ${message}`)

            if (this.pendingResult && this.pendingResult.id === id) {
                console.log(`Completed action: ${this.pendingResult.actionName}`)
                this.pendingResult = null

                // Process queued actions
                if (this.actionForceQueue.length > 0) {
                    const nextAction = this.actionForceQueue.shift()!
                    const gameName = connection.gameName
                    setTimeout(() => this.executeRandomAction(gameName, [nextAction]), 500)
                }
            } else {
                console.warn(`Received unexpected action result: ${id}`)
            }
        })
    }

    private executeRandomAction(gameName: string, actionNames: string[]) {
        const actions = this.registeredActions.get(gameName) || []
        const availableActions = actions.filter(action => actionNames.includes(action.name))

        if (availableActions.length === 0) {
            console.warn(`No available actions for ${gameName} from: ${actionNames.join(', ')}`)
            return
        }

        const selectedAction = availableActions[Math.floor(Math.random() * availableActions.length)]
        assert(selectedAction, 'How was an action selected?')
        const actionId = this.generateActionId()

        // Generate fake data based on schema if available
        let fakeData = '{}'
        if (selectedAction.schema) {
            try {
                fakeData = this.generateFakeDataFromSchema(selectedAction.schema)
            } catch (error) {
                console.warn('Failed to generate fake data for action:', error)
            }
        }

        this.pendingResult = { id: actionId, actionName: selectedAction.name }

        const actionMessage = {
            command: 'action',
            data: {
                id: actionId,
                name: selectedAction.name,
                data: fakeData
            }
        }

        console.log(`--> Executing action: ${selectedAction.name} with data: ${fakeData}`)
        this.neuroServer.sendToGame(gameName, actionMessage)
    }

    private sendActionToGame(actionData: any) {
        // Find a game to send the action to
        const connections = this.neuroServer.getConnectedClients()
        if (connections.length === 0) {
            console.warn('No connected games to send action to')
            return
        }

        const connection = connections[0] // Use first connection
        if (connection?.gameName) {
            const actionMessage = {
                command: 'action',
                data: actionData
            }
            this.neuroServer.sendToGame(connection.gameName, actionMessage)
        }
    }

    private generateFakeDataFromSchema(schema: any): string {
        // Very basic fake data generation
        const fakeData: any = {}

        if (schema.properties) {
            for (const [key, prop] of Object.entries(schema.properties as any)) {
                const propSchema = prop as any
                switch (propSchema.type) {
                    case 'string':
                        fakeData[key] = propSchema.enum ? propSchema.enum[0] : 'test_string'
                        break
                    case 'number':
                    case 'integer':
                        fakeData[key] = propSchema.minimum || 1
                        break
                    case 'boolean':
                        fakeData[key] = true
                        break
                    default:
                        fakeData[key] = null
                }
            }
        }

        return JSON.stringify(fakeData)
    }

    private generateActionId(): string {
        return `randy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    async close() {
        if (this.httpServer) {
            await new Promise<void>((resolve) => {
                this.httpServer.close(() => resolve())
            })
        }
        await this.neuroServer.close()
    }
}

// Create and start the Randy server
const randy = new RandyServer()

console.log('Randy-like Neuro API server started!')
console.log('WebSocket: ws://localhost:8000')
console.log('HTTP API: http://localhost:1337')
console.log('')
console.log('Example HTTP request to trigger an action:')
console.log('curl -X POST http://localhost:1337 -H "Content-Type: application/json" -d \'{"command":"action","data":{"id":"test","name":"example_action","data":"{\\"param\\":\\"value\\"}"}}\' ')

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down Randy server...')
    await randy.close()
    process.exit(0)
})

// Keep the process alive
process.stdin.resume()
