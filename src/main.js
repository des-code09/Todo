import './style.css'
import { supabase } from './supabase.js'

let todos = []

const form = document.querySelector('.todo-form')
const input = document.querySelector('.todo-input')
const todoList = document.querySelector('.todo-list')

function escapeHtml(text) {
  const element = document.createElement('span')
  element.textContent = text
  return element.innerHTML
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

async function fetchTodos() {
  const { data, error } = await supabase
    .from('todos')
    .select('id, text, is_complete, created_at')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch todos:', error.message)
    return
  }

  todos = data
  render()
}

async function addTodo(text) {
  const { error } = await supabase.from('todos').insert({ text })

  if (error) {
    console.error('Failed to add todo:', error.message)
    return false
  }

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
    return false
  }

  return true
}

async function deleteTodo(id) {
  const { error } = await supabase.from('todos').delete().eq('id', id)

  if (error) {
    console.error('Failed to delete todo:', error.message)
    return false
  }

  return true
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const text = input.value.trim()
  if (!text) return

  const added = await addTodo(text)
  if (!added) return

  input.value = ''
  input.focus()
  await fetchTodos()
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

fetchTodos()
