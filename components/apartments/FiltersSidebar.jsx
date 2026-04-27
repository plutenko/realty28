import { useState, useEffect, useRef } from 'react'
import PriceFilterSection from './PriceFilterSection'

function MultiCheckboxList({ items, selected, onToggle, emptyText }) {
  if (!items.length) {
    return <p className="text-xs text-gray-400">{emptyText}</p>
  }

  return (
    <div className="space-y-2">
      {items.map((name) => (
        <label
          key={name}
          className="flex items-center gap-2 text-sm text-gray-900"
        >
          <input
            type="checkbox"
            checked={selected.includes(name)}
            onChange={() => onToggle(name)}
            className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          />
          <span className="truncate">{name}</span>
        </label>
      ))}
    </div>
  )
}

/**
 * Карточка фильтра: плавное раскрытие (grid-template-rows) + стрелка.
 */
function FilterBlock({ title, open, onToggle, children }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
      >
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span
          className={`inline-block text-gray-600 transition-transform duration-300 ease-out ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        >
          ▼
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default function FiltersSidebar({
  onResetFilters,
  hasActiveFilters,
  uniqueDevelopers,
  complexBuildingsTree,
  selectedDevelopers,
  selectedComplexes,
  selectedBuildingIds,
  onToggleDeveloper,
  onToggleComplexWhole,
  onToggleBuilding,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  absMin,
  absMax,
  priceRanges,
  selectedPriceRanges,
  onTogglePriceRange,
  priceCounts,
  selectedRooms,
  onToggleRoom,
  roomCountsByValue,
  twoLevelOnly,
  onToggleTwoLevel,
  twoLevelCount,
  floorFrom,
  floorTo,
  onFloorFromChange,
  onFloorToChange,
  areaFrom,
  areaTo,
  onAreaFromChange,
  onAreaToChange,
  areaRanges,
  areaCounts,
  selectedAreaRanges,
  onToggleAreaRange,
  complexCountsByName,
  buildingCountsById,
  handoverOptions,
  selectedHandoverKeys,
  handoverCountsByKey,
  onToggleHandover,
  ppmRanges,
  selectedPpmRanges,
  ppmCounts,
  onTogglePpmRange,
}) {
  const [openSections, setOpenSections] = useState({
    price: true,
    handover: true,
    ppm: true,
    rooms: true,
    floor: true,
    area: true,
    developers: true,
    complexes: true,
  })

  const toggleSection = (key) => {
    setOpenSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  /** Свёрнут список литеров для этого ЖК (по умолчанию все свёрнуты). */
  const [collapsedZhks, setCollapsedZhks] = useState(() => new Set())

  // По умолчанию сворачиваем все ЖК при первой загрузке списка
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    if (!complexBuildingsTree?.length) return
    initializedRef.current = true
    setCollapsedZhks(new Set(complexBuildingsTree.map((c) => c.complexName)))
  }, [complexBuildingsTree])

  const toggleZhkLiters = (complexName) => {
    setCollapsedZhks((prev) => {
      const next = new Set(prev)
      if (next.has(complexName)) next.delete(complexName)
      else next.add(complexName)
      return next
    })
  }

  const roomsList = [
    { label: 'Студии', value: 0 },
    { label: '1', value: 1 },
    { label: '2', value: 2 },
    { label: '3', value: 3 },
    { label: '4+', value: 4 },
  ]

  return (
    <div className="w-[300px] space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Фильтр</h2>

      {hasActiveFilters && onResetFilters ? (
        <button
          type="button"
          onClick={onResetFilters}
          className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
        >
          Сбросить все фильтры
        </button>
      ) : null}

      <FilterBlock
        title="Цена"
        open={openSections.price}
        onToggle={() => toggleSection('price')}
      >
        <div className="w-full text-left">
          <PriceFilterSection
            priceMin={priceMin}
            priceMax={priceMax}
            onPriceMinChange={onPriceMinChange}
            onPriceMaxChange={onPriceMaxChange}
            absMin={absMin}
            absMax={absMax}
          />
        </div>

        <p className="mb-2 mt-2 text-left text-sm font-medium text-gray-800">
          Диапазоны цены
        </p>
        <div className="space-y-1 text-left">
          {priceRanges.map((r, idx) => {
            const count = priceCounts?.[idx] ?? 0
            const checked = selectedPriceRanges.includes(idx)
            const disabled = count === 0 && !checked
            return (
              <label
                key={r.label}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 transition hover:bg-gray-50 ${
                  disabled ? 'opacity-40' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onTogglePriceRange(idx)}
                    className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  />
                  <span className="truncate text-sm text-gray-900">{r.label}</span>
                </div>
                <span className="shrink-0 text-sm text-gray-400">({count})</span>
              </label>
            )
          })}
        </div>
      </FilterBlock>

      <FilterBlock
        title="Срок сдачи"
        open={openSections.handover}
        onToggle={() => toggleSection('handover')}
      >
        <div className="space-y-1 text-left">
          {(handoverOptions ?? []).length ? (
            handoverOptions.map((opt) => {
              const count = handoverCountsByKey?.[opt.key] ?? 0
              const checked = selectedHandoverKeys.includes(opt.key)
              const disabled = count === 0 && !checked
              return (
                <label
                  key={opt.key}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 transition hover:bg-gray-50 ${
                    disabled ? 'opacity-40' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleHandover(opt.key)}
                      className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                    />
                    <span className="truncate text-sm text-gray-900">{opt.label}</span>
                  </div>
                  <span className="shrink-0 text-sm text-gray-400">({count})</span>
                </label>
              )
            })
          ) : (
            <p className="text-xs text-gray-400">Нет данных</p>
          )}
        </div>
      </FilterBlock>

      <FilterBlock
        title="Цена за м²"
        open={openSections.ppm}
        onToggle={() => toggleSection('ppm')}
      >
        <div className="space-y-1 text-left">
          {(ppmRanges ?? []).map((r, idx) => {
            const count = ppmCounts?.[idx] ?? 0
            const checked = selectedPpmRanges?.includes(idx)
            const disabled = count === 0 && !checked
            return (
              <label
                key={r.label}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 transition hover:bg-gray-50 ${
                  disabled ? 'opacity-40' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onTogglePpmRange(idx)}
                    className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  />
                  <span className="truncate text-sm text-gray-900">{r.label}</span>
                </div>
                <span className="shrink-0 text-sm text-gray-400">({count})</span>
              </label>
            )
          })}
        </div>
      </FilterBlock>

      <FilterBlock
        title="Комнаты"
        open={openSections.rooms}
        onToggle={() => toggleSection('rooms')}
      >
        <div className="grid grid-cols-2 gap-2">
          {roomsList.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 text-sm text-gray-900 transition hover:bg-gray-50 ${
                (roomCountsByValue?.[r.value] ?? 0) === 0 &&
                !selectedRooms.includes(r.value)
                  ? 'opacity-40'
                  : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedRooms.includes(r.value)}
                  disabled={
                    (roomCountsByValue?.[r.value] ?? 0) === 0 &&
                    !selectedRooms.includes(r.value)
                  }
                  onChange={() => onToggleRoom(r.value)}
                  className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                />
                <span className="truncate">{r.label}</span>
              </div>
              <span className="shrink-0 text-xs text-gray-400">
                ({roomCountsByValue?.[r.value] ?? 0})
              </span>
            </label>
          ))}
        </div>
        <label
          className={`mt-2 flex cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 text-sm text-gray-900 transition hover:bg-gray-50 ${
            (twoLevelCount ?? 0) === 0 && !twoLevelOnly ? 'opacity-40' : ''
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(twoLevelOnly)}
              disabled={(twoLevelCount ?? 0) === 0 && !twoLevelOnly}
              onChange={() => onToggleTwoLevel?.()}
              className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            />
            <span className="truncate">Двухуровневые</span>
          </div>
          <span className="shrink-0 text-xs text-gray-400">
            ({twoLevelCount ?? 0})
          </span>
        </label>
      </FilterBlock>

      <FilterBlock
        title="Этаж"
        open={openSections.floor}
        onToggle={() => toggleSection('floor')}
      >
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            placeholder="От"
            value={floorFrom ?? ''}
            onChange={(e) =>
              onFloorFromChange(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="number"
            placeholder="До"
            value={floorTo ?? ''}
            onChange={(e) =>
              onFloorToChange(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </FilterBlock>

      <FilterBlock
        title="Площадь"
        open={openSections.area}
        onToggle={() => toggleSection('area')}
      >
        <div className="flex gap-3">
          <input
            type="number"
            placeholder="От"
            value={areaFrom}
            onChange={(e) => onAreaFromChange(e.target.value)}
            className="w-full rounded-xl bg-gray-100 p-3 text-left text-sm text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="number"
            placeholder="До"
            value={areaTo}
            onChange={(e) => onAreaToChange(e.target.value)}
            className="w-full rounded-xl bg-gray-100 p-3 text-left text-sm text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <p className="mb-2 mt-4 text-left text-sm font-medium text-gray-800">
          Диапазоны площади
        </p>
        <div className="space-y-2 text-left">
          {(areaRanges ?? []).map((r, idx) => {
            const count = areaCounts?.[idx] ?? 0
            const checked = selectedAreaRanges.some((x) => x.label === r.label)
            const disabled = count === 0 && !checked
            return (
              <label
                key={r.label}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 transition hover:bg-gray-50 ${
                  disabled ? 'opacity-40' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggleAreaRange(r)}
                    className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  />
                  <span className="truncate text-sm text-gray-900">{r.label}</span>
                </div>
                <span className="shrink-0 text-sm text-gray-400">({count})</span>
              </label>
            )
          })}
        </div>
      </FilterBlock>

      <FilterBlock
        title="Застройщики"
        open={openSections.developers}
        onToggle={() => toggleSection('developers')}
      >
        <MultiCheckboxList
          items={uniqueDevelopers}
          selected={selectedDevelopers}
          onToggle={onToggleDeveloper}
          emptyText="Нет данных"
        />
      </FilterBlock>

      <FilterBlock
        title="ЖК"
        open={openSections.complexes}
        onToggle={() => toggleSection('complexes')}
      >
        <div className="space-y-3">
          {complexBuildingsTree?.length ? (
            complexBuildingsTree.map(({ complexName, buildings }) => {
              const allIds = buildings.map((b) => b.id)
              const totalCount = complexCountsByName?.[complexName] ?? 0
              const wholeSelected = selectedComplexes.includes(complexName)
              const allIndividually =
                allIds.length > 0 &&
                allIds.every((id) => selectedBuildingIds.includes(id))
              const someIndividually = allIds.some((id) =>
                selectedBuildingIds.includes(id)
              )
              const indeterminate =
                !wholeSelected && someIndividually && !allIndividually
              const parentChecked = wholeSelected || allIndividually
              const parentDisabled = totalCount === 0 && !parentChecked
              const litersExpanded = !collapsedZhks.has(complexName)

              return (
                <div key={complexName} className="rounded-lg border border-gray-100 bg-gray-50/80 p-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-expanded={litersExpanded}
                      title={litersExpanded ? 'Свернуть литеры' : 'Развернуть литеры'}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-600 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-1"
                      onClick={() => toggleZhkLiters(complexName)}
                    >
                      <span
                        className={`inline-block text-[10px] leading-none transition-transform duration-200 ease-out motion-reduce:transition-none ${
                          litersExpanded ? 'rotate-0' : '-rotate-90'
                        }`}
                        aria-hidden
                      >
                        ▼
                      </span>
                    </button>
                    <label
                      className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 text-sm font-medium text-gray-900 transition hover:bg-white/80 ${
                        parentDisabled ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          ref={(el) => {
                            if (el) el.indeterminate = indeterminate
                          }}
                          checked={parentChecked}
                          disabled={parentDisabled}
                          onChange={() => {
                            if (parentChecked && !indeterminate) {
                              onToggleComplexWhole(complexName, allIds, false)
                            } else {
                              onToggleComplexWhole(complexName, allIds, true)
                            }
                          }}
                          className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                        />
                        <span className="truncate">{complexName}</span>
                      </div>
                      <span className="shrink-0 text-sm text-gray-400">
                        ({totalCount})
                      </span>
                    </label>
                  </div>

                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
                      litersExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="mt-2 space-y-1 border-l-2 border-orange-200 pl-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          Литеры
                        </p>
                        {buildings.map((b) => {
                          const bCount = buildingCountsById?.[b.id] ?? 0
                          const childChecked =
                            wholeSelected || selectedBuildingIds.includes(b.id)
                          const childDisabled = bCount === 0 && !childChecked
                          return (
                            <label
                              key={b.id}
                              className={`flex cursor-pointer items-center justify-between gap-2 rounded-md py-0.5 pl-1 text-sm text-gray-800 transition hover:bg-white/90 ${
                                childDisabled ? 'opacity-40' : ''
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={childChecked}
                                  disabled={childDisabled}
                                  onChange={() =>
                                    onToggleBuilding(complexName, b.id, allIds)
                                  }
                                  className="accent-orange-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                />
                                <span className="truncate">
                                  {b.name}
                                  {b.address ? ` (${b.address})` : ''}
                                </span>
                              </div>
                              <span className="shrink-0 text-xs text-gray-400">
                                ({bCount})
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="text-xs text-gray-400">Нет данных</p>
          )}
        </div>
      </FilterBlock>
    </div>
  )
}
