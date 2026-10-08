export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class UnprocessableEntityError extends AppError {
  public constructor(message: string) {
    super(422, 'INSUFFICIENT_DATA', message)
  }
}

export class NotFoundError extends AppError {
  public constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} não encontrado.`)
  }
}

export class ConflictError extends AppError {
  public constructor(message: string) {
    super(409, 'INVALID_STATE', message)
  }
}

export class SessionConflictError extends AppError {
  public constructor() {
    super(409, 'SESSION_CONFLICT', 'A sessão foi atualizada por outra solicitação. Recarregue e tente novamente.')
  }
}
