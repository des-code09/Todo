const ANIMALS = [
  'Alligator',
  'Badger',
  'Bear',
  'Fox',
  'Koala',
  'Otter',
  'Panda',
  'Rabbit',
  'Tiger',
  'Wolf',
]

const EMOJI = {
  Alligator: '🐊',
  Badger: '🦡',
  Bear: '🐻',
  Fox: '🦊',
  Koala: '🐨',
  Otter: '🦦',
  Panda: '🐼',
  Rabbit: '🐰',
  Tiger: '🐯',
  Wolf: '🐺',
}

function hashUserId(userId) {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash << 5) - hash + userId.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function buildPersona(animal) {
  const label = `Anonymous ${animal}`
  return {
    animal,
    label,
    emoji: EMOJI[animal],
    initials: `A${animal.charAt(0)}`,
  }
}

export function getAnonymousPersona(userId) {
  if (!userId) {
    return buildPersona(ANIMALS[0])
  }

  const storageKey = `anonPersona:${userId}`
  const cached = localStorage.getItem(storageKey)

  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      if (parsed?.animal && EMOJI[parsed.animal]) {
        return buildPersona(parsed.animal)
      }
    } catch {
      localStorage.removeItem(storageKey)
    }
  }

  const animal = ANIMALS[hashUserId(userId) % ANIMALS.length]
  localStorage.setItem(storageKey, JSON.stringify({ animal }))
  return buildPersona(animal)
}
