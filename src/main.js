import './style.css'

const todos = []
let nextId = 1

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
      const completedClass = todo.completed ? ' todo-item--completed' : ''

      return `
        <li class="todo-item${completedClass}">
          <input
            type="checkbox"
            class="todo-item__checkbox"
            data-id="${todo.id}"
            ${todo.completed ? 'checked' : ''}
            aria-label="${todo.completed ? 'Mark as incomplete' : 'Mark as complete'}: ${escapeHtml(todo.text)}"
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

function addTodo(text) {
  todos.push({
    id: nextId++,
    text,
    completed: false,
  })
  render()
}

function toggleTodo(id) {
  const todo = todos.find((item) => item.id === id)
  if (!todo) return

  todo.completed = !todo.completed
  render()
}

function deleteTodo(id) {
  const index = todos.findIndex((item) => item.id === id)
  if (index === -1) return

  todos.splice(index, 1)
  render()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()

  const text = input.value.trim()
  if (!text) return

  addTodo(text)
  input.value = ''
  input.focus()
})

todoList.addEventListener('change', (event) => {
  if (!event.target.matches('.todo-item__checkbox')) return

  toggleTodo(Number(event.target.dataset.id))
})

todoList.addEventListener('click', (event) => {
  if (!event.target.matches('.todo-item__delete')) return

  deleteTodo(Number(event.target.dataset.id))
})

render()
