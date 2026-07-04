import {
  formatIsoDate,
  parseIsoDate,
  todayLocalDateString,
} from './dateUtils.js'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const ICON_PREV =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'

const ICON_NEXT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'

let popover = null
let anchor = null
let onSelectCallback = null
let onCloseCallback = null
let viewYear = 0
let viewMonth = 0
let selectedIso = null
let focusedDayIndex = -1
let dayButtons = []
let isOpen = false

let documentPointerDownListener = null
let documentKeyDownListener = null

function onDocumentPointerDown(event) {
  if (!isOpen) return
  if (popover.contains(event.target)) return
  if (anchor?.contains(event.target)) return
  closeDatePicker()
}

function onDocumentKeyDown(event) {
  if (!isOpen || event.key !== 'Escape') return
  if (popover.contains(document.activeElement)) return
  closeDatePicker()
}

function addDocumentListeners() {
  documentPointerDownListener = onDocumentPointerDown
  documentKeyDownListener = onDocumentKeyDown
  document.addEventListener('pointerdown', documentPointerDownListener, true)
  document.addEventListener('keydown', documentKeyDownListener)
}

function removeDocumentListeners() {
  if (documentPointerDownListener) {
    document.removeEventListener('pointerdown', documentPointerDownListener, true)
    documentPointerDownListener = null
  }

  if (documentKeyDownListener) {
    document.removeEventListener('keydown', documentKeyDownListener)
    documentKeyDownListener = null
  }
}

function ensurePopover() {
  if (popover) return popover

  popover = document.createElement('div')
  popover.className = 'date-picker'
  popover.hidden = true
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', 'Choose due date')
  popover.setAttribute('aria-modal', 'true')

  popover.innerHTML = `
    <div class="date-picker__header">
      <button type="button" class="date-picker__nav" data-action="prev-month" aria-label="Previous month">
        ${ICON_PREV}
      </button>
      <div class="date-picker__title" aria-live="polite"></div>
      <button type="button" class="date-picker__nav" data-action="next-month" aria-label="Next month">
        ${ICON_NEXT}
      </button>
    </div>
    <div class="date-picker__weekdays" aria-hidden="true"></div>
    <div class="date-picker__grid" role="grid" aria-label="Calendar days"></div>
    <div class="date-picker__footer">
      <button type="button" class="date-picker__today" data-action="today">Today</button>
    </div>
  `

  const weekdays = popover.querySelector('.date-picker__weekdays')
  weekdays.replaceChildren(
    ...WEEKDAYS.map((label) => {
      const cell = document.createElement('span')
      cell.className = 'date-picker__weekday'
      cell.textContent = label
      return cell
    }),
  )

  popover.addEventListener('click', handlePopoverClick)
  popover.addEventListener('keydown', handlePopoverKeyDown)

  document.body.append(popover)
  return popover
}

function getMonthTitle(year, month) {
  const date = new Date(year, month, 1)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function buildMonthDays(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = firstOfMonth.getDay()
  const gridStart = new Date(year, month, 1 - startOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return {
      date,
      iso: formatIsoDate(date),
      inMonth: date.getMonth() === month,
    }
  })
}

function renderGrid() {
  const title = popover.querySelector('.date-picker__title')
  const grid = popover.querySelector('.date-picker__grid')
  const todayIso = todayLocalDateString()

  title.textContent = getMonthTitle(viewYear, viewMonth)

  const days = buildMonthDays(viewYear, viewMonth)
  dayButtons = []

  grid.replaceChildren(
    ...days.map((day, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'date-picker__day'
      button.role = 'gridcell'
      button.dataset.iso = day.iso
      button.dataset.index = String(index)
      button.textContent = String(day.date.getDate())

      if (!day.inMonth) {
        button.classList.add('date-picker__day--outside')
      }

      if (day.iso === todayIso) {
        button.classList.add('date-picker__day--today')
      }

      if (day.iso === selectedIso) {
        button.classList.add('date-picker__day--selected')
        button.setAttribute('aria-selected', 'true')
      } else {
        button.setAttribute('aria-selected', 'false')
      }

      dayButtons.push(button)
      return button
    }),
  )

  if (focusedDayIndex < 0 || focusedDayIndex >= dayButtons.length) {
    const selectedIndex = dayButtons.findIndex((button) => button.dataset.iso === selectedIso)
    const todayIndex = dayButtons.findIndex((button) => button.dataset.iso === todayIso)
    focusedDayIndex = selectedIndex >= 0 ? selectedIndex : (todayIndex >= 0 ? todayIndex : 0)
  }

  dayButtons[focusedDayIndex]?.focus()
}

function positionPopover(anchorEl) {
  popover.hidden = false

  const anchorRect = anchorEl.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()
  const gap = 4
  const margin = 8

  let top = anchorRect.bottom + gap
  let left = anchorRect.left

  if (top + popoverRect.height > window.innerHeight - margin) {
    top = anchorRect.top - popoverRect.height - gap
  }

  if (top < margin) {
    top = margin
  }

  left = Math.min(left, window.innerWidth - popoverRect.width - margin)
  left = Math.max(margin, left)

  popover.style.top = `${top}px`
  popover.style.left = `${left}px`
}

function selectDate(iso) {
  selectedIso = iso
  onSelectCallback?.(iso)
  closeDatePicker({ notify: false })
}

function shiftMonth(delta) {
  const next = new Date(viewYear, viewMonth + delta, 1)
  viewYear = next.getFullYear()
  viewMonth = next.getMonth()
  renderGrid()
}

function moveFocus(delta) {
  if (!dayButtons.length) return

  focusedDayIndex = Math.min(dayButtons.length - 1, Math.max(0, focusedDayIndex + delta))
  dayButtons[focusedDayIndex]?.focus()
}

function moveFocusByRow(delta) {
  moveFocus(delta * 7)
}

function handlePopoverClick(event) {
  const actionTarget = event.target.closest('[data-action]')
  if (!actionTarget) {
    const dayButton = event.target.closest('.date-picker__day')
    if (dayButton?.dataset.iso) {
      selectDate(dayButton.dataset.iso)
    }
    return
  }

  const action = actionTarget.dataset.action
  if (action === 'prev-month') {
    shiftMonth(-1)
    return
  }

  if (action === 'next-month') {
    shiftMonth(1)
    return
  }

  if (action === 'today') {
    selectDate(todayLocalDateString())
  }
}

function handlePopoverKeyDown(event) {
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      moveFocus(-1)
      break
    case 'ArrowRight':
      event.preventDefault()
      moveFocus(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveFocusByRow(-1)
      break
    case 'ArrowDown':
      event.preventDefault()
      moveFocusByRow(1)
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (event.target.matches('.date-picker__day') && event.target.dataset.iso) {
        selectDate(event.target.dataset.iso)
      }
      break
    case 'Escape':
      event.preventDefault()
      closeDatePicker()
      break
    default:
      break
  }
}

export function openDatePicker({ anchor: anchorEl, value, onSelect, onClose }) {
  if (!anchorEl) return

  if (isOpen) {
    closeDatePicker({ notify: false })
  }

  ensurePopover()

  anchor = anchorEl
  onSelectCallback = onSelect ?? null
  onCloseCallback = onClose ?? null
  selectedIso = value || todayLocalDateString()

  const parsed = parseIsoDate(selectedIso)
  viewYear = parsed.getFullYear()
  viewMonth = parsed.getMonth()
  focusedDayIndex = -1

  renderGrid()
  positionPopover(anchorEl)

  isOpen = true
  addDocumentListeners()
}

export function closeDatePicker({ notify = true } = {}) {
  if (!popover || !isOpen) return

  popover.hidden = true
  isOpen = false
  removeDocumentListeners()

  const closeAnchor = anchor
  anchor = null
  onSelectCallback = null

  if (notify) {
    onCloseCallback?.()
  }

  onCloseCallback = null

  if (closeAnchor?.isConnected) {
    closeAnchor.focus({ preventScroll: true })
  }
}

export function isDatePickerOpen() {
  return isOpen
}

export function datePickerContains(node) {
  return Boolean(node && popover?.contains(node))
}
