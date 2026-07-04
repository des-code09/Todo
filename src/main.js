import './style.css'
import { getAnonymousPersona } from './anonymousPersona.js'
import { supabase } from './supabase.js'
import {
  getFriendlyError,
  logError,
  isRetryableError,
  VALIDATION_MESSAGES,
} from './errors.js'
import { showToast, dismissToast } from './toast.js'

const UNDO_DELETE_MS = 5000

const ICON_DELETE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'

let todos = []
let user = null
let authReady = false
let signOutLock = false
let editingField = null
let saveEditingPromise = null
let syncSessionPromise = null
let fetchTodosPromise = null
let pendingDelete = null
let pendingDeleteTimer = null
let isLoadingTodos = false
let isFetchingTodos = false
let hasLoadedTodosOnce = false

const form = document.querySelector('.todo-form')
const input = document.querySelector('.todo-input')
const dueDateInput = document.querySelector('.todo-due-input')
const todoList = document.querySelector('.todo-list')
const todoStatus = document.querySelector('.todo-status')
const addButton = document.querySelector('.todo-add-button')
const navAccount = document.querySelector('.nav-account')
const navAccountTrigger = document.querySelector('.nav-account__trigger')
const navAccountAvatar = document.querySelector('.nav-account__avatar')
const navAccountLabel = document.querySelector('.nav-account__label')
const navAccountMenu = document.querySelector('.nav-account__menu')
const navAccountAuth = document.querySelector('.nav-account__auth')
const navAccountSignedIn = document.querySelector('.nav-account__signed-in')
const authSignOutButton = document.querySelector('.auth-sign-out')
const authSwitchLinks = document.querySelectorAll('.auth-switch__link')
const signInForm = document.querySelector('.auth-form--sign-in')
const signUpForm = document.querySelector('.auth-form--sign-up')

let todoStatusMessage = todoStatus?.querySelector('.todo-status__message') ?? null
let todoStatusRetry = todoStatus?.querySelector('.todo-status__retry') ?? null

function ensureTodoStatusStructure() {
  if (!todoStatus || todoStatusMessage) return

  todoStatus.replaceChildren()

  todoStatusMessage = document.createElement('span')
  todoStatusMessage.className = 'todo-status__message'

  todoStatusRetry = document.createElement('button')
  todoStatusRetry.type = 'button'
  todoStatusRetry.className = 'todo-status__retry'
  todoStatusRetry.textContent = 'Try again'
  todoStatusRetry.hidden = true
  todoStatusRetry.addEventListener('click', () => {
    showTodoError('')
    void fetchTodos({ silent: true })
  })

  todoStatus.append(todoStatusMessage, todoStatusRetry)
}

ensureTodoStatusStructure()

function escapeHtml(text) {
  const element = document.createElement('span')
  element.textContent = text
  return element.innerHTML
}

function todayLocalDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

dueDateInput.value = todayLocalDateString()

function formatDueDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function getDueDateClass(todo) {
  if (todo.is_complete) return ''

  const today = todayLocalDateString()
  if (todo.due_date === today) return ' todo-item__due--today'
  if (todo.due_date < today) return ' todo-item__due--overdue'

  return ''
}

function getTodoItemClass(todo) {
  const classes = []
  if (todo.is_complete) classes.push('todo-item--completed')
  if (!todo.is_complete && todo.due_date < todayLocalDateString()) {
    classes.push('todo-item--overdue')
  }
  return classes.length ? ` ${classes.join(' ')}` : ''
}

function sortTodos(list) {
  return [...list].sort((left, right) => {
    const dueCompare = String(left.due_date ?? '').localeCompare(String(right.due_date ?? ''))
    if (dueCompare !== 0) return dueCompare
    return String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''))
  })
}

function patchTodo(id, updates) {
  todos = sortTodos(
    todos.map((todo) => (todo.id === id ? { ...todo, ...updates } : todo)),
  )
}

function normalizeTodos(data) {
  let nextTodos = sortTodos(data ?? [])

  if (pendingDelete) {
    nextTodos = nextTodos.filter((item) => item.id !== pendingDelete.id)
  }

  return nextTodos
}

function todosEqual(left, right) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftTodo = left[index]
    const rightTodo = right[index]

    if (
      leftTodo.id !== rightTodo.id
      || leftTodo.text !== rightTodo.text
      || leftTodo.is_complete !== rightTodo.is_complete
      || leftTodo.due_date !== rightTodo.due_date
    ) {
      return false
    }
  }

  return true
}

function isAnonymousUser(currentUser) {
  return Boolean(currentUser?.is_anonymous)
}

function isEmailUser(currentUser) {
  return Boolean(currentUser?.email)
}

function isNavMenuOpen() {
  return navAccount.classList.contains('nav-account--open')
}

function openNavMenu() {
  navAccount.classList.add('nav-account--open')
  navAccountMenu.hidden = false
  navAccountTrigger.setAttribute('aria-expanded', 'true')
}

function closeNavMenu() {
  navAccount.classList.remove('nav-account--open')
  navAccountMenu.hidden = true
  navAccountTrigger.setAttribute('aria-expanded', 'false')
}

function toggleNavMenu() {
  if (isNavMenuOpen()) {
    closeNavMenu()
    return
  }

  openNavMenu()
}

function showTodoError(message, { retry = false } = {}) {
  if (!todoStatus) return

  ensureTodoStatusStructure()

  const hasMessage = Boolean(message)
  todoStatus.hidden = !hasMessage && !retry

  if (todoStatusMessage) {
    todoStatusMessage.textContent = message
  }

  if (todoStatusRetry) {
    todoStatusRetry.hidden = !retry
  }
}

function setLoadingState(loading) {
  isLoadingTodos = loading
  form.classList.toggle('todo-form--loading', loading)
  input.disabled = loading
  dueDateInput.disabled = loading

  if (loading) {
    addButton.disabled = true
    addButton.classList.add('todo-add-button--loading')
    render()
    return
  }

  addButton.classList.remove('todo-add-button--loading')
  updateAddButtonState()
}

function setFetchingState(fetching) {
  isFetchingTodos = fetching
  document.documentElement.classList.toggle('app-fetching', fetching)
  todoList.classList.toggle('todo-list--fetching', fetching)
  todoList.setAttribute('aria-busy', fetching ? 'true' : 'false')
}

function updateAddButtonState() {
  if (isLoadingTodos) return
  addButton.disabled = !input.value.trim()
}

function setInputValidation(isInvalid) {
  input.setAttribute('aria-invalid', isInvalid ? 'true' : 'false')
}

function clearFormValidation() {
  setInputValidation(false)
  showTodoError('')
}

function validateAddForm() {
  const rawText = input.value
  const text = rawText.trim()
  const dueDate = dueDateInput.value

  if (!text && !rawText) {
    setInputValidation(true)
    showTodoError(VALIDATION_MESSAGES.emptyTodo)
    return null
  }

  if (!text) {
    setInputValidation(true)
    showTodoError(VALIDATION_MESSAGES.whitespaceTodo)
    return null
  }

  if (!dueDate) {
    setInputValidation(true)
    showTodoError(VALIDATION_MESSAGES.missingDueDate)
    return null
  }

  clearFormValidation()
  return { text, dueDate }
}

function showAuthError(message) {
  if (isEmailUser(user)) {
    openNavMenu()
    navAccountLabel.textContent = message
    navAccountLabel.classList.add('nav-account__label--error')

    window.setTimeout(() => {
      navAccountLabel.classList.remove('nav-account__label--error')
      renderNavAccount()
    }, 4000)
    return
  }

  openNavMenu()
  setAuthMessage(signInForm, message)
}

function setAuthMessage(authForm, message, type = 'error') {
  const messageElement = authForm.querySelector('.auth-message')
  messageElement.textContent = message
  messageElement.hidden = !message
  messageElement.classList.toggle('auth-message--error', type === 'error')
  messageElement.classList.toggle('auth-message--success', type === 'success')
}

function clearAuthMessages() {
  for (const authForm of [signInForm, signUpForm]) {
    setAuthMessage(authForm, '')
  }
}

function setAvatarContent({ text, mode }) {
  navAccountAvatar.textContent = text
  navAccountAvatar.classList.toggle('nav-account__avatar--emoji', mode === 'emoji')
  navAccountAvatar.classList.toggle('nav-account__avatar--initial', mode === 'initial')
  navAccountAvatar.classList.toggle('nav-account__avatar--guest', mode === 'guest')
}

function renderNavAccount() {
  navAccountLabel.classList.remove('nav-account__label--error')
  navAccount.classList.remove('nav-account--email', 'nav-account--anonymous', 'nav-account--guest')

  if (isEmailUser(user)) {
    const initial = user.email.charAt(0).toUpperCase()
    navAccount.classList.add('nav-account--email')
    setAvatarContent({ text: initial, mode: 'initial' })
    navAccountLabel.textContent = user.email
    navAccountAuth.hidden = true
    navAccountSignedIn.hidden = false
    return
  }

  navAccountSignedIn.hidden = true
  navAccountAuth.hidden = false
  setAuthMode('sign-in')

  if (isAnonymousUser(user)) {
    const persona = getAnonymousPersona(user.id)
    navAccount.classList.add('nav-account--anonymous')
    setAvatarContent({ text: persona.emoji, mode: 'emoji' })
    navAccountLabel.textContent = persona.label
    return
  }

  navAccount.classList.add('nav-account--guest')
  setAvatarContent({ text: '?', mode: 'guest' })
  navAccountLabel.textContent = 'Sign in'
}

function setAuthMode(mode) {
  const isSignIn = mode === 'sign-in'

  signInForm.hidden = !isSignIn
  signUpForm.hidden = isSignIn
  clearAuthMessages()
}

function renderSkeleton() {
  return Array.from({ length: 3 }, () => `
      <li class="todo-skeleton" aria-hidden="true">
        <div class="todo-skeleton__main">
          <span class="todo-skeleton__checkbox"></span>
          <span class="todo-skeleton__text"></span>
        </div>
        <span class="todo-skeleton__due"></span>
        <span class="todo-skeleton__actions"></span>
      </li>
    `).join('')
}

function renderTodoItem(todo) {
  const dueDateClass = getDueDateClass(todo)
  const itemClass = getTodoItemClass(todo)
  const isEditingText = editingField?.id === todo.id && editingField.field === 'text'
  const isEditingDue = editingField?.id === todo.id && editingField.field === 'due'

  const textContent = isEditingText
    ? `
            <input
              type="text"
              class="todo-item__edit-text"
              data-id="${todo.id}"
              value="${escapeHtml(todo.text)}"
              aria-label="Edit todo text"
            />`
    : `
            <span
              class="todo-item__text"
              data-id="${todo.id}"
              tabindex="0"
              role="button"
              aria-label="Edit todo: ${escapeHtml(todo.text)}"
            >${escapeHtml(todo.text)}</span>`

  const dueContent = isEditingDue
    ? `
          <input
            type="date"
            class="todo-item__edit-due"
            data-id="${todo.id}"
            value="${todo.due_date}"
            required
            aria-label="Edit due date"
          />`
    : `
          <time
            class="todo-item__due${dueDateClass}"
            data-id="${todo.id}"
            datetime="${todo.due_date}"
            tabindex="0"
            role="button"
            aria-label="Edit due date: ${formatDueDate(todo.due_date)}"
          >
            ${formatDueDate(todo.due_date)}
          </time>`

  return `
        <li class="todo-item${itemClass}" data-id="${todo.id}">
          <div class="todo-item__main">
            <input
              type="checkbox"
              class="todo-item__checkbox"
              data-id="${todo.id}"
              ${todo.is_complete ? 'checked' : ''}
              aria-label="${todo.is_complete ? 'Mark as incomplete' : 'Mark as complete'}: ${escapeHtml(todo.text)}"
            />
            ${textContent}
          </div>
          ${dueContent}
          <div class="todo-item__actions">
            <button
              type="button"
              class="todo-item__delete"
              data-id="${todo.id}"
              aria-label="Delete todo: ${escapeHtml(todo.text)}"
            >
              ${ICON_DELETE}
            </button>
          </div>
        </li>
      `
}

function render() {
  todoList.classList.toggle('todo-list--loading', isLoadingTodos)

  if (isLoadingTodos) {
    todoList.innerHTML = renderSkeleton()
    return
  }

  todoList.innerHTML = sortTodos(todos).map((todo) => renderTodoItem(todo)).join('')

  if (editingField != null) {
    const selector = editingField.field === 'text'
      ? '.todo-item__edit-text'
      : '.todo-item__edit-due'
    const activeInput = todoList.querySelector(
      `.todo-item[data-id="${editingField.id}"] ${selector}`,
    )
    activeInput?.focus()
    if (editingField.field === 'text' && activeInput) {
      activeInput.select()
    }
  }
}

async function startEditing(id, field) {
  if (editingField && (editingField.id !== id || editingField.field !== field)) {
    const saved = await saveEditing({ renderAfter: false })
    if (!saved) return
  }

  if (editingField?.id === id && editingField.field === field) return

  editingField = { id, field }
  showTodoError('')
  render()
}

function cancelEditing() {
  editingField = null
  render()
}

async function saveEditing({ renderAfter = true } = {}) {
  if (editingField == null) return true
  if (saveEditingPromise) return saveEditingPromise

  saveEditingPromise = saveEditingInternal({ renderAfter }).finally(() => {
    saveEditingPromise = null
  })

  return saveEditingPromise
}

async function saveEditingInternal({ renderAfter = true } = {}) {
  if (editingField == null) return true

  const { id, field } = editingField
  const todo = todos.find((item) => item.id === id)
  const row = todoList.querySelector(`.todo-item[data-id="${id}"]`)
  if (!row || !todo) {
    editingField = null
    if (renderAfter) render()
    return true
  }

  let updates = null

  if (field === 'text') {
    const textInput = row.querySelector('.todo-item__edit-text')
    if (!textInput) {
      editingField = null
      if (renderAfter) render()
      return true
    }

    const trimmedText = textInput.value.trim()
    if (!trimmedText) {
      showTodoError(VALIDATION_MESSAGES.emptyEdit)
      textInput.focus()
      return false
    }

    if (trimmedText === todo.text) {
      editingField = null
      if (renderAfter) render()
      return true
    }

    const saved = await updateTodo(id, { text: trimmedText })
    if (!saved) {
      textInput.focus()
      return false
    }

    updates = { text: trimmedText }
  } else {
    const dueInput = row.querySelector('.todo-item__edit-due')
    if (!dueInput) {
      editingField = null
      if (renderAfter) render()
      return true
    }

    const due_date = dueInput.value
    if (!due_date) {
      showTodoError(VALIDATION_MESSAGES.missingDueDate)
      dueInput.focus()
      return false
    }

    if (due_date === todo.due_date) {
      editingField = null
      if (renderAfter) render()
      return true
    }

    const saved = await updateTodo(id, { due_date })
    if (!saved) {
      dueInput.focus()
      return false
    }

    updates = { due_date }
  }

  editingField = null
  patchTodo(id, updates)
  if (renderAfter) render()
  return true
}

async function updateTodo(id, updates) {
  const payload = {}

  if ('text' in updates) {
    const trimmedText = updates.text.trim()
    if (!trimmedText) {
      showTodoError(VALIDATION_MESSAGES.emptyEdit)
      return false
    }
    payload.text = trimmedText
  }

  if ('due_date' in updates) {
    if (!updates.due_date) {
      showTodoError(VALIDATION_MESSAGES.missingDueDate)
      return false
    }
    payload.due_date = updates.due_date
  }

  if (Object.keys(payload).length === 0) return false

  const { error } = await supabase
    .from('todos')
    .update(payload)
    .eq('id', id)

  if (error) {
    logError('updateTodo', error)
    showTodoError(getFriendlyError(error, 'edit'))
    return false
  }

  showTodoError('')
  return true
}

function flushPendingDelete() {
  if (!pendingDelete) return
  if (pendingDeleteTimer) {
    clearTimeout(pendingDeleteTimer)
    pendingDeleteTimer = null
  }
  const snapshot = pendingDelete
  pendingDelete = null
  return snapshot
}

async function commitPendingDelete() {
  const snapshot = flushPendingDelete()
  if (!snapshot) return

  const { id, todo } = snapshot
  const { error } = await supabase.from('todos').delete().eq('id', id)

  if (error) {
    logError('deleteTodo', error)
    todos = sortTodos([...todos, todo])
    render()
    showTodoError(getFriendlyError(error, 'delete'))
    return
  }

  dismissToast()
}

function cancelPendingDelete() {
  const snapshot = flushPendingDelete()
  if (!snapshot) return

  todos = sortTodos([...todos, snapshot.todo])
  render()
  dismissToast()
}

async function scheduleDeleteTodo(id) {
  if (pendingDelete && pendingDelete.id !== id) {
    await commitPendingDelete()
  }

  if (editingField?.id === id) {
    cancelEditing()
  }

  const todo = todos.find((item) => item.id === id)
  if (!todo) return

  flushPendingDelete()
  dismissToast()

  pendingDelete = { id, todo }
  todos = todos.filter((item) => item.id !== id)
  render()
  showTodoError('')

  showToast({
    message: 'Todo deleted.',
    actionLabel: 'Undo',
    onAction: cancelPendingDelete,
    durationMs: UNDO_DELETE_MS,
  })

  pendingDeleteTimer = window.setTimeout(() => {
    pendingDeleteTimer = null
    void commitPendingDelete()
  }, UNDO_DELETE_MS)
}

async function syncSession(session) {
  if (!session?.user) return false
  if (syncSessionPromise) return syncSessionPromise

  syncSessionPromise = (async () => {
    user = session.user
    renderNavAccount()
    await fetchTodos({ silent: true })
    return true
  })().finally(() => {
    syncSessionPromise = null
  })

  return syncSessionPromise
}

async function fetchTodos({ silent = false } = {}) {
  if (!user?.id) return
  if (fetchTodosPromise) return fetchTodosPromise

  fetchTodosPromise = fetchTodosInternal({ silent }).finally(() => {
    fetchTodosPromise = null
  })

  return fetchTodosPromise
}

async function fetchTodosInternal({ silent = false } = {}) {
  if (!user?.id) return

  if (silent) {
    setFetchingState(true)
  } else {
    setLoadingState(true)
  }

  const { data, error } = await supabase
    .from('todos')
    .select('id, text, is_complete, created_at, due_date')
    .eq('user_id', user.id)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) {
    logError('fetchTodos', error)
    const friendlyMessage = getFriendlyError(error, 'load')
    showTodoError(friendlyMessage, { retry: isRetryableError(error, 'load') })
    if (silent) {
      setFetchingState(false)
    } else {
      setLoadingState(false)
    }
    render()
    return
  }

  showTodoError('')
  const previousTodos = todos
  const nextTodos = normalizeTodos(data)
  const todosChanged = !todosEqual(previousTodos, nextTodos)
  todos = nextTodos

  if (silent) {
    setFetchingState(false)
  } else {
    setLoadingState(false)
  }

  if (todosChanged || !hasLoadedTodosOnce) {
    hasLoadedTodosOnce = true
    todoList.classList.add('todo-list--revealed')
    render()
  }
}

async function ensureActiveSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) {
    logError('getSession', error)
    showTodoError(getFriendlyError(error, 'session'))
    return null
  }

  if (session) {
    user = session.user
    return session
  }

  const { data, error: anonError } = await supabase.auth.signInAnonymously()
  if (anonError) {
    logError('signInAnonymously', anonError)
    showTodoError(getFriendlyError(anonError, 'session'))
    return null
  }

  user = data.session.user
  return data.session
}

async function addTodo(text, dueDate) {
  const session = await ensureActiveSession()
  if (!session) return false

  const { error } = await supabase
    .from('todos')
    .insert({ text, user_id: session.user.id, due_date: dueDate })

  if (error) {
    logError('addTodo', error)
    showTodoError(getFriendlyError(error, 'add'))
    return false
  }

  showTodoError('')
  return true
}

async function toggleTodo(id, is_complete) {
  const todo = todos.find((item) => item.id === id)
  if (!todo) return false

  const { error } = await supabase
    .from('todos')
    .update({ is_complete })
    .eq('id', id)

  if (error) {
    logError('toggleTodo', error)
    showTodoError(getFriendlyError(error, 'update'))
    return false
  }

  return true
}

async function handleSignIn(event) {
  event.preventDefault()
  clearAuthMessages()

  const email = signInForm.querySelector('.auth-email').value.trim()
  const password = signInForm.querySelector('.auth-password').value

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    setAuthMessage(signInForm, getFriendlyError(error, 'auth'))
    return
  }

  signInForm.reset()
  closeNavMenu()
  await syncSession(data.session)
}

async function handleSignUp(event) {
  event.preventDefault()
  clearAuthMessages()

  const email = signUpForm.querySelector('.auth-email').value.trim()
  const password = signUpForm.querySelector('.auth-password').value

  if (isAnonymousUser(user)) {
    const { data, error } = await supabase.auth.updateUser({ email, password })
    if (error) {
      setAuthMessage(signUpForm, getFriendlyError(error, 'auth'))
      return
    }

    signUpForm.reset()
    user = data.user
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    await syncSession(currentSession)

    if (isAnonymousUser(user)) {
      setAuthMessage(
        signInForm,
        'Check your email to confirm your account. Your todos are saved to this account.',
        'success',
      )
    }

    return
  }

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) {
    setAuthMessage(signUpForm, getFriendlyError(error, 'auth'))
    return
  }

  signUpForm.reset()

  if (data.session) {
    closeNavMenu()
    await syncSession(data.session)
    return
  }

  setAuthMessage(
    signUpForm,
    'Account created. Check your email to confirm your account, then sign in.',
    'success',
  )
}

async function handleSignOut() {
  if (signOutLock) return

  signOutLock = true
  authSignOutButton.disabled = true

  try {
    cancelPendingDelete()
    editingField = null

    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      logError('signOut', error)
      showAuthError(getFriendlyError(error, 'auth'))
      return
    }

    user = null
    todos = []
    hasLoadedTodosOnce = false
    todoList.classList.remove('todo-list--revealed')
    render()
    renderNavAccount()
    closeNavMenu()
    showTodoError('')

    const { data, error: anonError } = await supabase.auth.signInAnonymously()
    if (anonError) {
      logError('signInAnonymously', anonError)
      showAuthError(getFriendlyError(anonError, 'auth'))
      return
    }

    await syncSession(data.session)
  } finally {
    authSignOutButton.disabled = false
    signOutLock = false
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const validated = validateAddForm()
  if (!validated) return

  const { text, dueDate } = validated
  addButton.disabled = true

  try {
    const added = await addTodo(text, dueDate)
    if (!added) return

    input.value = ''
    dueDateInput.value = todayLocalDateString()
    clearFormValidation()
    input.focus()
    await fetchTodos({ silent: true })
  } finally {
    updateAddButtonState()
  }
})

input.addEventListener('input', () => {
  if (input.getAttribute('aria-invalid') === 'true' && input.value.trim()) {
    setInputValidation(false)
    if (!todoStatusRetry || todoStatusRetry.hidden) {
      showTodoError('')
    }
  }
  updateAddButtonState()
})

todoList.addEventListener('change', async (event) => {
  if (event.target.matches('.todo-item__edit-due')) {
    void saveEditing()
    return
  }

  if (!event.target.matches('.todo-item__checkbox')) return
  if (event.target.disabled) return

  const id = Number(event.target.dataset.id)
  const todo = todos.find((item) => item.id === id)
  if (!todo) return

  const nextComplete = !todo.is_complete
  const updated = await toggleTodo(id, nextComplete)
  if (!updated) return

  patchTodo(id, { is_complete: nextComplete })
  render()
})

todoList.addEventListener('click', (event) => {
  const textEl = event.target.closest('.todo-item__text')
  if (textEl) {
    void startEditing(Number(textEl.dataset.id), 'text')
    return
  }

  const dueEl = event.target.closest('.todo-item__due')
  if (dueEl) {
    void startEditing(Number(dueEl.dataset.id), 'due')
    return
  }

  const deleteButton = event.target.closest('.todo-item__delete')
  if (deleteButton) {
    void scheduleDeleteTodo(Number(deleteButton.dataset.id))
  }
})

todoList.addEventListener('focusout', (event) => {
  if (!event.target.matches('.todo-item__edit-text, .todo-item__edit-due')) return
  if (editingField == null) return

  const nextTarget = event.relatedTarget
  if (nextTarget?.matches('.todo-item__edit-text, .todo-item__edit-due')) return
  if (nextTarget?.closest('.todo-item__text, .todo-item__due')) return

  void saveEditing()
})

todoList.addEventListener('keydown', (event) => {
  if (event.target.matches('.todo-item__text, .todo-item__due')) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const field = event.target.matches('.todo-item__text') ? 'text' : 'due'
      void startEditing(Number(event.target.dataset.id), field)
    }
    return
  }

  if (!event.target.matches('.todo-item__edit-text, .todo-item__edit-due')) return

  if (event.key === 'Enter') {
    event.preventDefault()
    void saveEditing()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    cancelEditing()
  }
})

navAccountTrigger.addEventListener('click', (event) => {
  event.stopPropagation()
  toggleNavMenu()
})

document.addEventListener('click', (event) => {
  if (!isNavMenuOpen()) return
  if (navAccount.contains(event.target)) return
  closeNavMenu()
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !isNavMenuOpen()) return
  closeNavMenu()
  navAccountTrigger.focus()
})

for (const link of authSwitchLinks) {
  link.addEventListener('click', () => setAuthMode(link.dataset.mode))
}

signInForm.addEventListener('submit', handleSignIn)
signUpForm.addEventListener('submit', handleSignUp)
authSignOutButton.addEventListener('click', handleSignOut)

supabase.auth.onAuthStateChange(async (event, session) => {
  if (signOutLock) return

  if (event === 'INITIAL_SESSION') {
    authReady = true

    if (session) {
      await syncSession(session)
      return
    }

    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) {
      logError('signInAnonymously', error)
      showTodoError(getFriendlyError(error, 'session'))
      return
    }

    await syncSession(data.session)
    return
  }

  if (!authReady || event === 'SIGNED_OUT') return

  if (session) {
    await syncSession(session)
  }
})

async function bootstrap() {
  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  if (!user) {
    renderNavAccount()
  }

  document.documentElement.classList.add('fonts-ready')
}

void bootstrap()
