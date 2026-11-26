import { createApp } from './app.js'
import { loadConfig } from './config.js'

try {
  const config = loadConfig()
  const app = createApp(config)
  const onListening = () => {
    console.info(`DataPlus API listening on port ${config.port}.`)
  }
  const server = config.wireGuardLabEnabled || config.wireGuardDevicesEnabled
    ? app.listen(config.port, '127.0.0.1', onListening)
    : app.listen(config.port, onListening)

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        console.error('API shutdown failed.')
        process.exitCode = 1
      }
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown configuration error.'
  console.error(`DataPlus API startup failed: ${message}`)
  process.exitCode = 1
}
