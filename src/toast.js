let dismissTimer = null

function getToastRegion() {
  return document.querySelector('.toast-region')
}

export function dismissToast() {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }

  const region = getToastRegion()
  if (!region) return

  region.replaceChildren()
  region.hidden = true
}

export function showToast({ message, actionLabel, onAction, durationMs = 5000 }) {
  const region = getToastRegion()
  if (!region) return

  dismissToast()

  const toast = document.createElement('div')
  toast.className = 'toast'

  const messageElement = document.createElement('span')
  messageElement.className = 'toast__message'
  messageElement.textContent = message

  const actionButton = document.createElement('button')
  actionButton.type = 'button'
  actionButton.className = 'toast__action'
  actionButton.textContent = actionLabel

  actionButton.addEventListener('click', () => {
    onAction?.()
    dismissToast()
  })

  toast.append(messageElement, actionButton)
  region.append(toast)
  region.hidden = false

  dismissTimer = window.setTimeout(() => {
    dismissToast()
  }, durationMs)
}
