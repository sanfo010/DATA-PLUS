export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'request_failed',
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class DatabaseOperationError extends Error {
  constructor(public readonly databaseCode: string | undefined, message: string) {
    super(message)
    this.name = 'DatabaseOperationError'
  }
}

export const notFound = (message = 'Resource not found.') =>
  new ApiError(404, message, 'not_found')

export const unavailable = (message = 'Service temporarily unavailable.') =>
  new ApiError(503, message, 'service_unavailable')

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      return new ApiError(400, 'Request body must contain valid JSON.', 'invalid_json')
    }
    if (error.type === 'entity.too.large') {
      return new ApiError(413, 'Request body is too large.', 'payload_too_large')
    }
  }

  if (error instanceof DatabaseOperationError) {
    switch (error.databaseCode) {
      case 'P0002':
        return notFound()
      case '42501':
        return new ApiError(403, 'Operation not permitted.', 'forbidden')
      case '22023':
        return new ApiError(400, 'Invalid request.', 'invalid_request')
      case '55000':
        return new ApiError(409, 'Operation conflicts with the current state.', 'conflict')
      default:
        return unavailable('Data service request failed.')
    }
  }

  return unavailable()
}
