import { NeuroServer, type ActionHandler, ExecutionResultHelper } from 'neuro-game-api'

// Create a simple action handler
class SayHelloHandler implements ActionHandler {
    name = 'say_hello'

    validate(data: any) {
        if (!data?.name || typeof data.name !== 'string') {
            return ExecutionResultHelper.failure('Name is required and must be a string')
        }
        return ExecutionResultHelper.success()
    }

    execute(data: any) {
        console.log(`Hello, ${data.name}!`)
    }
}

// Create and start the server
const server = new NeuroServer("127.0.0.1", 8000)

// Register action handlers
server.registerActionHandler('ExampleGame', new SayHelloHandler())

console.log('Barebones Neuro API server started!')
console.log('Connect your game client to ws://localhost:8000')

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down server...')
    await server.close()
    process.exit(0)
})

// Keep the process alive
process.stdin.resume()
