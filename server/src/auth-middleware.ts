import type { NextFunction, Request, Response } from 'express'
import type { TokenAuthenticator } from './contracts.js'
import { ApiError } from './errors.js'

export function requireUser(authenticator: TokenAuthenticator) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const authorization = request.header('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/i)
    if (!match) {
      next(new ApiError(401, 'A valid Supabase access token is required.', 'unauthorized'))
      return
    }

    try {
      const context = await authenticator.authenticate(match[1])
      if (!context) {
        next(new ApiError(401, 'The access token is invalid or expired.', 'unauthorized'))
        return
      }
      request.authContext = context
      next()
    } catch (error) {
      next(error)
    }
  }
}
