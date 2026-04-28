import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

function RangeChips({ ranges, counts, isSelected, onToggle, getKey }) {
  if (!ranges?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {ranges.map((r, idx) => {
        const count = counts?.[idx] ?? 0
        const active = isSelected(idx, r)
        const disabled = count === 0 && !active
        const key = getKey ? getKey(idx, r) : idx
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(idx, r)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {r.label} <span className="opacity-60">({count})</span>
          </button>
        )
      })}
    </div>
  )
}

function CustomRangeBlock({ label = 'Свой диапазон', children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-gray-600 transition hover:bg-gray-50"
      >
        <span>{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}

function NameChips({ items, counts, selected, onToggle, emptyText }) {
  if (!items?.length) {
    return <p className="text-xs text-gray-400">{emptyText}</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((name) => {
        const count = counts?.[name] ?? 0
        const active = selected.includes(name)
        const disabled = count === 0 && !active
        return (
          <button
            key={name}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(name)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {name} <span className="opacity-60">({count})</span>
          </button>
        )
      })}
    </div>
  )
}

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

export default function FiltersSidebarLab({
  onResetFilters,
  hasActiveFilters,
  resetVariant = 'neutral',
  activeFilterCount = null,
  uniqueDevelopers,
  developerCountsByName,
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
  renovationOnly,
  onToggleRenovation,
  renovationCount,
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
    rooms: true,
    price: true,
    handover: true,
    area: true,
    features: true,
    floor: true,
    ppm: true,
    developers: true,
    complexes: true,
  })

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const [collapsedZhks, setCollapsedZhks] = useState(() => new Set())

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

  const complexTreeByDeveloper = useMemo(() => {
    const groups = new Map()
    for (const item of (complexBuildingsTree ?? [])) {
      const dev = item.developerName || 'Без застройщика'
      if (!groups.has(dev)) groups.set(dev, [])
      groups.get(dev).push(item)
    }
    return [...groups.entries()]
      .map(([dev, items]) => ({ dev, items }))
      .sort((a, b) => String(a.dev).localeCompare(String(b.dev), 'ru'))
  }, [complexBuildingsTree])

  return (
    <div className="w-[300px] space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Фильтр</h2>

      {hasActiveFilters && onResetFilters ? (
        <button
          type="button"
          onClick={onResetFilters}
          className={
            resetVariant === 'neutral'
              ? 'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50'
              : 'w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100'
          }
        >
          Сбросить все фильтры
          {activeFilterCount != null && activeFilterCount > 0
            ? ` (${activeFilterCount})`
            : ''}
        </button>
      ) : null}

      {/* 1. Комнаты */}
      <FilterBlock
        title="Комнаты"
        open={openSections.rooms}
        onToggle={() => toggleSection('rooms')}
      >
        <div className="flex flex-wrap gap-1.5">
          {roomsList.map((r) => {
            const count = roomCountsByValue?.[r.value] ?? 0
            const active = selectedRooms.includes(r.value)
            const disabled = count === 0 && !active
            return (
              <button
                key={r.value}
                type="button"
                disabled={disabled}
                onClick={() => onToggleRoom(r.value)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  active
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {r.label} <span className="opacity-60">({count})</span>
              </button>
            )
          })}
        </div>
      </FilterBlock>

      {/* 2. Цена */}
      <FilterBlock
        title="Цена"
        open={openSections.price}
        onToggle={() => toggleSection('price')}
      >
        <RangeChips
          ranges={priceRanges}
          counts={priceCounts}
          isSelected={(idx) => selectedPriceRanges.includes(idx)}
          onToggle={(idx) => onTogglePriceRange(idx)}
        />
        <CustomRangeBlock>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="От, ₽"
              value={priceMin === absMin ? '' : Number(priceMin).toLocaleString('ru-RU')}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '')
                onPriceMinChange(raw === '' ? absMin : Number(raw))
              }}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="До, ₽"
              value={priceMax === absMax ? '' : Number(priceMax).toLocaleString('ru-RU')}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '')
                onPriceMaxChange(raw === '' ? absMax : Number(raw))
              }}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </CustomRangeBlock>
      </FilterBlock>

      {/* 3. Срок сдачи */}
      <FilterBlock
        title="Срок сдачи"
        open={openSections.handover}
        onToggle={() => toggleSection('handover')}
      >
        {(handoverOptions ?? []).length ? (
          <div className="flex flex-wrap gap-1.5">
            {handoverOptions.map((opt) => {
              const count = handoverCountsByKey?.[opt.key] ?? 0
              const active = selectedHandoverKeys.includes(opt.key)
              const disabled = count === 0 && !active
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleHandover(opt.key)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  {opt.label} <span className="opacity-60">({count})</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Нет данных</p>
        )}
      </FilterBlock>

      {/* 4. Площадь */}
      <FilterBlock
        title="Площадь"
        open={openSections.area}
        onToggle={() => toggleSection('area')}
      >
        <RangeChips
          ranges={areaRanges}
          counts={areaCounts}
          isSelected={(idx, r) => selectedAreaRanges.some((x) => x.label === r.label)}
          onToggle={(idx, r) => onToggleAreaRange(r)}
          getKey={(idx, r) => r.label}
        />
        <CustomRangeBlock>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="От, м²"
              value={areaFrom}
              onChange={(e) => onAreaFromChange(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="До, м²"
              value={areaTo}
              onChange={(e) => onAreaToChange(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </CustomRangeBlock>
      </FilterBlock>

      {/* 5. Особенности */}
      <FilterBlock
        title="Особенности"
        open={openSections.features}
        onToggle={() => toggleSection('features')}
      >
        <div className="flex flex-wrap gap-1.5">
          {[
            {
              key: 'twolevel',
              label: 'Двухуровневые',
              count: twoLevelCount ?? 0,
              active: Boolean(twoLevelOnly),
              onToggle: onToggleTwoLevel,
            },
            {
              key: 'renovation',
              label: 'С ремонтом',
              count: renovationCount ?? 0,
              active: Boolean(renovationOnly),
              onToggle: onToggleRenovation,
            },
          ].map((f) => {
            const disabled = f.count === 0 && !f.active
            return (
              <button
                key={f.key}
                type="button"
                disabled={disabled}
                onClick={() => f.onToggle?.()}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  f.active
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {f.label} <span className="opacity-60">({f.count})</span>
              </button>
            )
          })}
        </div>
      </FilterBlock>

      {/* 6. Этаж */}
      <FilterBlock
        title="Этаж"
        open={openSections.floor}
        onToggle={() => toggleSection('floor')}
      >
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="От"
            value={floorFrom ?? ''}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '')
              onFloorFromChange(raw === '' ? null : Number(raw))
            }}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="До"
            value={floorTo ?? ''}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '')
              onFloorToChange(raw === '' ? null : Number(raw))
            }}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </FilterBlock>

      {/* 7. Цена за м² */}
      <FilterBlock
        title="Цена за м²"
        open={openSections.ppm}
        onToggle={() => toggleSection('ppm')}
      >
        <RangeChips
          ranges={ppmRanges}
          counts={ppmCounts}
          isSelected={(idx) => (selectedPpmRanges ?? []).includes(idx)}
          onToggle={(idx) => onTogglePpmRange(idx)}
        />
      </FilterBlock>

      {/* 8. Застройщики */}
      <FilterBlock
        title="Застройщики"
        open={openSections.developers}
        onToggle={() => toggleSection('developers')}
      >
        <NameChips
          items={uniqueDevelopers}
          counts={developerCountsByName}
          selected={selectedDevelopers}
          onToggle={onToggleDeveloper}
          emptyText="Нет данных"
        />
      </FilterBlock>

      {/* 9. ЖК */}
      <FilterBlock
        title="ЖК"
        open={openSections.complexes}
        onToggle={() => toggleSection('complexes')}
      >
        <div className="space-y-2">
          {complexTreeByDeveloper.length ? (
            complexTreeByDeveloper.map(({ dev, items }, devIdx) => (
              <div key={dev}>
                {complexTreeByDeveloper.length > 1 ? (
                  <p className={`text-[10px] font-medium uppercase tracking-wide text-gray-400 ${devIdx === 0 ? '' : 'mt-2'}`}>
                    {dev}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {items.map(({ complexName, buildings }) => {
                    const allIds = buildings.map((b) => b.id)
                    const totalCount = complexCountsByName?.[complexName] ?? 0
                    const wholeSelected = selectedComplexes.includes(complexName)
                    const allIndividually =
                      allIds.length > 0 &&
                      allIds.every((id) => selectedBuildingIds.includes(id))
                    const someIndividually = allIds.some((id) =>
                      selectedBuildingIds.includes(id)
                    )
                    const parentChecked = wholeSelected || allIndividually
                    const someActive = parentChecked || someIndividually
                    const disabled = totalCount === 0 && !someActive
                    const litersExpanded = !collapsedZhks.has(complexName)
                    const hasMultipleLiters = buildings.length > 1

                    return (
                      <div key={complexName} className="w-full">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (parentChecked) {
                                onToggleComplexWhole(complexName, allIds, false)
                              } else {
                                onToggleComplexWhole(complexName, allIds, true)
                              }
                            }}
                            className={`flex min-w-0 flex-1 items-center gap-1 rounded-full border px-3 py-1.5 text-sm text-left transition ${
                              someActive
                                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                          >
                            <span className="min-w-0 truncate">{complexName}</span>
                            <span className="shrink-0 opacity-60">({totalCount})</span>
                          </button>
                          {hasMultipleLiters ? (
                            <button
                              type="button"
                              aria-expanded={litersExpanded}
                              title={litersExpanded ? 'Свернуть литеры' : 'Литеры'}
                              onClick={() => toggleZhkLiters(complexName)}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100"
                            >
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${litersExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          ) : (
                            <div className="h-6 w-6 shrink-0" aria-hidden />
                          )}
                        </div>

                        {hasMultipleLiters && litersExpanded ? (
                          <div className="mt-1.5 ml-3 flex flex-wrap gap-1">
                            {buildings.map((b) => {
                              const bCount = buildingCountsById?.[b.id] ?? 0
                              const childChecked =
                                wholeSelected || selectedBuildingIds.includes(b.id)
                              const childDisabled = bCount === 0 && !childChecked
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  disabled={childDisabled}
                                  onClick={() =>
                                    onToggleBuilding(complexName, b.id, allIds)
                                  }
                                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                                    childChecked
                                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                                  } ${childDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
                                >
                                  {b.name}
                                  <span className="opacity-60"> ({bCount})</span>
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-400">
              Нет данных
            </p>
          )}
        </div>
      </FilterBlock>
    </div>
  )
}
