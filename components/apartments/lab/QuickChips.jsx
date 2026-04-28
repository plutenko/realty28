const ROOMS_CHIPS = [
  { label: 'Студии', values: [0] },
  { label: '1к', values: [1] },
  { label: '2к', values: [2] },
  { label: '3к+', values: [3, 4] },
]

const HANDOVER_CHIPS = [
  { id: 'all', label: 'Все' },
  { id: 'delivered', label: 'Готовое' },
  { id: 'in_progress', label: 'В стройке' },
]

export default function QuickChips({
  selectedRooms = [],
  onSetRooms,
  handoverOptions = [],
  selectedHandoverKeys = [],
  onSetHandoverKeys,
}) {
  const plannedKeys = handoverOptions
    .map((o) => o.key)
    .filter((k) => k !== 'delivered')

  const onlyDelivered =
    selectedHandoverKeys.length === 1 && selectedHandoverKeys[0] === 'delivered'
  const allPlanned =
    plannedKeys.length > 0 &&
    selectedHandoverKeys.length === plannedKeys.length &&
    plannedKeys.every((k) => selectedHandoverKeys.includes(k))

  let handoverMode = 'all'
  if (onlyDelivered) handoverMode = 'delivered'
  else if (allPlanned) handoverMode = 'in_progress'

  function isRoomChipActive(values) {
    if (!values.length) return false
    return values.every((v) => selectedRooms.includes(v))
  }

  function toggleRoomChip(values) {
    const active = isRoomChipActive(values)
    if (active) {
      onSetRooms?.(selectedRooms.filter((r) => !values.includes(r)))
    } else {
      onSetRooms?.([...new Set([...selectedRooms, ...values])])
    }
  }

  function setHandoverMode(mode) {
    if (mode === 'all') return onSetHandoverKeys?.([])
    if (mode === 'delivered') return onSetHandoverKeys?.(['delivered'])
    if (mode === 'in_progress') return onSetHandoverKeys?.(plannedKeys)
  }

  const baseChip =
    'shrink-0 rounded-full border px-3 py-1.5 text-sm transition'
  const activeChip =
    'border-blue-500 bg-blue-50 text-blue-700 font-medium'
  const inactiveChip =
    'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'

  return (
    <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible">
      {ROOMS_CHIPS.map((c) => {
        const active = isRoomChipActive(c.values)
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => toggleRoomChip(c.values)}
            className={`${baseChip} ${active ? activeChip : inactiveChip}`}
          >
            {c.label}
          </button>
        )
      })}
      <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />
      {HANDOVER_CHIPS.map((c) => {
        const active = handoverMode === c.id
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => setHandoverMode(c.id)}
            className={`${baseChip} ${active ? activeChip : inactiveChip}`}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
