export class AppError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly category?: 'INVALID_INPUT',
  ) {
    super(message)
  }
}

export class UnprocessableEntityError extends AppError {
  public constructor(message: string) {
    super('INSUFFICIENT_DATA', message)
  }
}

export class NotFoundError extends AppError {
  public constructor(resource: string) {
    super('NOT_FOUND', `${resource} não encontrado.`)
  }
}

export class ConflictError extends AppError {
  public constructor(message: string) {
    super('INVALID_STATE', message)
  }
}

export class SessionConflictError extends AppError {
  public constructor() {
    super('SESSION_CONFLICT', 'A sessão foi atualizada por outra solicitação. Recarregue e tente novamente.')
  }
}
