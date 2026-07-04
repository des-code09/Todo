export const VALIDATION_MESSAGES = {
  emptyTodo: 'Enter a todo before adding.',
  whitespaceTodo: "Todo text can't be only spaces.",
  missingDueDate: 'Pick a due date.',
  emptyEdit: "Todo text can't be empty.",
}

const OFFLINE_MESSAGE = "You're offline. Check your connection and try again."
const NETWORK_MESSAGE = "Can't reach the server right now. Try again in a moment."
const TIMEOUT_MESSAGE = 'That took too long. Check your connection and try again.'

const CONTEXT_FALLBACKS = {
  load: "Couldn't load your todos. Try again.",
  add: "Couldn't add that todo. Try again.",
  update: "Couldn't update that todo. Try again.",
  edit: "Couldn't save your changes. Try again.",
  delete: "Couldn't delete that todo. Try again.",
  session: "Couldn't start your session. Refresh the page.",
  auth: 'Something went wrong with your account. Please try again.',
}

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'

function isNetworkError(error) {
  const message = (error?.message ?? '').toLowerCase()
  const name = (error?.name ?? '').toLowerCase()

  return (
    name === 'aborterror'
    || name === 'typeerror'
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
    || message.includes('network request failed')
  )
}

function isServerError(error) {
  const status = Number(error?.status ?? error?.code)
  if (status >= 502 && status <= 504) return true

  const message = (error?.message ?? '').toLowerCase()
  return message.includes('502') || message.includes('503') || message.includes('504')
}

function getAuthMessage(error) {
  const message = error?.message ?? ''

  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.'
  }
  if (/email not confirmed/i.test(message)) {
    return 'Confirm your email before signing in.'
  }
  if (/already registered|already been registered/i.test(message)) {
    return 'An account with this email already exists. Try signing in.'
  }
  if (/password should be at least/i.test(message)) {
    return 'Password is too short. Use at least 6 characters.'
  }
  if (/unable to validate email/i.test(message)) {
    return 'Enter a valid email address.'
  }
  if (/anonymous/i.test(message)) {
    return "Guest mode isn't available right now. Try again later."
  }
  if (/jwt expired|invalid jwt/i.test(message)) {
    return 'Your session expired. Refresh the page to continue.'
  }

  return null
}

function getDatabaseMessage(error) {
  const code = String(error?.code ?? '')
  const message = (error?.message ?? '').toLowerCase()

  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security')) {
    return "You don't have permission to do that. Try signing in again."
  }
  if (code === 'PGRST116' || message.includes('0 rows')) {
    return 'That todo no longer exists. It may have been deleted.'
  }
  if (code === '23502') {
    return 'Todo text and due date are required.'
  }
  if (code === '22P02') {
    return 'Something was wrong with that input. Please try again.'
  }
  if (code === 'PGRST301') {
    return 'Your session expired. Refresh the page to continue.'
  }

  return null
}

export function isRetryableError(error, context = 'load') {
  if (!navigator.onLine) return true
  return context === 'load' && (isNetworkError(error) || isServerError(error))
}

export function getFriendlyError(error, context = 'load') {
  if (!navigator.onLine) return OFFLINE_MESSAGE

  if (error?.name === 'AbortError') return TIMEOUT_MESSAGE
  if (isNetworkError(error)) return NETWORK_MESSAGE
  if (isServerError(error)) return 'The database is temporarily unavailable. Try again in a moment.'

  if (context === 'auth') {
    const authMessage = getAuthMessage(error)
    if (authMessage) return authMessage
    return CONTEXT_FALLBACKS.auth
  }

  const authMessage = getAuthMessage(error)
  if (authMessage) return authMessage

  const databaseMessage = getDatabaseMessage(error)
  if (databaseMessage) return databaseMessage

  return CONTEXT_FALLBACKS[context] ?? FALLBACK_MESSAGE
}

export function logError(scope, error) {
  console.error(`[${scope}]`, error)
}
