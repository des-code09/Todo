import './style.css'
import { supabase } from './supabase.js'

let todos = []
let user = null
let authReady = false
let signOutLock = false

const form = document.querySelector('.todo-form')
const input = document.querySelector('.todo-input')
const todoList = document.querySelector('.todo-list')
const todoStatus = document.querySelector('.todo-status')
const authGuest = document.querySelector('.auth-guest')
const authUser = document.querySelector('.auth-user')
const authUserEmail = document.querySelector('.auth-user__email')
const authSignOutButton = document.querySelector('.auth-sign-out')
const authSwitchLinks = document.querySelectorAll('.auth-switch__link')
const signInForm = document.querySelector('.auth-form--sign-in')
const signUpForm = document.querySelector('.auth-form--sign-up')

function escapeHtml(text) {
  const element = document.createElement('span')
  element.textContent = text
  return element.innerHTML
}

function isAnonymousUser(currentUser) {
  return Boolean(currentUser?.is_anonymous)
}

function isEmailUser(currentUser) {
  return Boolean(currentUser?.email)
}

function showTodoError(message) {
  todoStatus.textContent = message
  todoStatus.hidden = !message
}

function showAuthError(message) {
  if (authUser.hidden) {
    setAuthMessage(signInForm, message)
    return
  }

  authUserEmail.textContent = message
  authUserEmail.classList.add('auth-user__email--error')

  window.setTimeout(() => {
    authUserEmail.classList.remove('auth-user__email--error')
    if (user?.email) {
      authUserEmail.textContent = user.email
    }
  }, 4000)
}

function setAuthMessage(form, message, type = 'error') {
  const messageElement = form.querySelector('.auth-message')
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

function renderAuth() {
  if (isEmailUser(user)) {
    authGuest.hidden = true
    authUser.hidden = false
    authUserEmail.textContent = user.email
    authUserEmail.classList.remove('auth-user__email--error')
    return
  }

  authGuest.hidden = false
  authUser.hidden = true
  setAuthMode('sign-in')
}

function setAuthMode(mode) {
  const isSignIn = mode === 'sign-in'

  signInForm.hidden = !isSignIn
  signUpForm.hidden = isSignIn
  clearAuthMessages()
}

function render() {
  todoList.innerHTML = todos
    .map((todo) => {
      const completedClass = todo.is_complete ? ' todo-item--completed' : ''

      return `
        <li class="todo-item${completedClass}">
          <input
            type="checkbox"
            class="todo-item__checkbox"
            data-id="${todo.id}"
            ${todo.is_complete ? 'checked' : ''}
            aria-label="${todo.is_complete ? 'Mark as incomplete' : 'Mark as complete'}: ${escapeHtml(todo.text)}"
          />
          <span class="todo-item__text">${escapeHtml(todo.text)}</span>
          <button type="button" class="todo-item__delete" data-id="${todo.id}">
            Delete
          </button>
        </li>
      `
    })
    .join('')
}

async function syncSession(session) {
  if (!session?.user) return false

  user = session.user
  renderAuth()
  await fetchTodos()
  return true
}

async function fetchTodos() {
  if (!user?.id) return

  const { data, error } = await supabase
    .from('todos')
    .select('id, text, is_complete, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch todos:', error.message)
    showTodoError(`Could not load todos: ${error.message}`)
    return
  }

  showTodoError('')
  todos = data
  render()
}

async function ensureActiveSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) {
    showTodoError(`Session error: ${error.message}`)
    return null
  }

  if (session) {
    user = session.user
    return session
  }

  const { data, error: anonError } = await supabase.auth.signInAnonymously()
  if (anonError) {
    showTodoError(`Could not start session: ${anonError.message}`)
    return null
  }

  user = data.session.user
  return data.session
}

async function addTodo(text) {
  const session = await ensureActiveSession()
  if (!session) return false

  const { error } = await supabase.from('todos').insert({ text, user_id: session.user.id })

  if (error) {
    console.error('Failed to add todo:', error.message)
    showTodoError(`Could not add todo: ${error.message}`)
    return false
  }

  showTodoError('')
  return true
}

async function toggleTodo(id) {
  const todo = todos.find((item) => item.id === id)
  if (!todo) return false

  const { error } = await supabase
    .from('todos')
    .update({ is_complete: !todo.is_complete })
    .eq('id', id)

  if (error) {
    console.error('Failed to toggle todo:', error.message)
    showTodoError(`Could not update todo: ${error.message}`)
    return false
  }

  return true
}

async function deleteTodo(id) {
  const { error } = await supabase.from('todos').delete().eq('id', id)

  if (error) {
    console.error('Failed to delete todo:', error.message)
    showTodoError(`Could not delete todo: ${error.message}`)
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
    setAuthMessage(signInForm, error.message)
    return
  }

  signInForm.reset()
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
      setAuthMessage(signUpForm, error.message)
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
    setAuthMessage(signUpForm, error.message)
    return
  }

  signUpForm.reset()

  if (data.session) {
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
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      showAuthError(`Sign out failed: ${error.message}`)
      return
    }

    user = null
    todos = []
    render()
    renderAuth()
    showTodoError('')

    const { data, error: anonError } = await supabase.auth.signInAnonymously()
    if (anonError) {
      showAuthError(`Sign out failed: ${anonError.message}`)
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

  const text = input.value.trim()
  if (!text) return

  const addButton = form.querySelector('.todo-add-button')
  addButton.disabled = true

  try {
    const added = await addTodo(text)
    if (!added) return

    input.value = ''
    input.focus()
    await fetchTodos()
  } finally {
    addButton.disabled = false
  }
})

todoList.addEventListener('change', async (event) => {
  if (!event.target.matches('.todo-item__checkbox')) return

  const updated = await toggleTodo(Number(event.target.dataset.id))
  if (!updated) return

  await fetchTodos()
})

todoList.addEventListener('click', async (event) => {
  if (!event.target.matches('.todo-item__delete')) return

  const deleted = await deleteTodo(Number(event.target.dataset.id))
  if (!deleted) return

  await fetchTodos()
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
      showTodoError(`Could not start session: ${error.message}`)
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

async function initApp() {
  if (authReady) return

  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    authReady = true
    await syncSession(session)
  }
}

initApp()
