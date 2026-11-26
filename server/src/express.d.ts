import type { AuthenticatedContext } from './contracts.js'

declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer
  }
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthenticatedContext
      rawBody?: Buffer
      requestId?: string
    }
  }
}

export {}
