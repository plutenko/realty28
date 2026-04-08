/**
 * Загрузка данных новостроек (только FK, без строковых complexName/developerName).
 */

/** @param {import('@supabase/supabase-js').SupabaseClient | null} supabase */
export async function getDevelopers(supabase) {
  if (!supabase) return { data: [], error: new Error('Supabase не настроен') }
  return supabase
    .from('developers')
    .select(
      `
      *,
      developer_managers (
        id,
        name,
        phone,
        short_description,
        messenger,
        created_at
      )
    `
    )
    .order('name')
}

export async function getComplexes(supabase) {
  if (!supabase) return { data: [], error: new Error('Supabase не настроен') }
  const withUnitsPerFloor = await supabase
    .from('complexes')
    .select(
      `
      id,
      name,
      city,
      realtor_commission_type,
      realtor_commission_value,
      developer_id,
      developers (
        id,
        name
      ),
      buildings (
        id,
        name,
        floors,
        units_per_floor,
        units_per_entrance
      )
    `
    )
    .order('name')
  if (!withUnitsPerFloor.error) return withUnitsPerFloor

  const msg = String(withUnitsPerFloor.error.message || '')

  // Backward compatibility:
  // 1) old DB without buildings.units_per_floor OR buildings.units_per_entrance.
  if (/units_per_floor/i.test(msg) || /units_per_entrance/i.test(msg)) {
    // Try a partial fallback: we need at least units_per_floor.
    // If that also doesn't exist, it will still fallback to floors-only below.
    const hasUnitsPerFloor = !/units_per_floor/i.test(msg)
    if (hasUnitsPerFloor) {
      return supabase
        .from('complexes')
        .select(
          `
        id,
        name,
        city,
        realtor_commission_type,
        realtor_commission_value,
        developer_id,
        developers (
          id,
          name
        ),
        buildings (
          id,
          name,
          floors,
          units_per_floor
        )
      `
        )
        .order('name')
    }

    // Oldest fallback: floors only.
    return supabase
      .from('complexes')
      .select(
        `
        id,
        name,
        city,
        realtor_commission_type,
        realtor_commission_value,
        developer_id,
        developers (
          id,
          name
        ),
        buildings (
          id,
          name,
          floors
        )
      `
      )
      .order('name')
  }

  return withUnitsPerFloor
}

/** Здания с ЖК и застройщиком (вложенность по FK) */
export async function getBuildings(supabase) {
  if (!supabase) return { data: [], error: new Error('Supabase не настроен') }
  return supabase
    .from('buildings')
    .select(
      `
      *,
      complexes (
        id,
        name,
        city,
        developer_id,
        developers (
          id,
          name
        )
      )
    `
    )
    .order('name')
}

/** Fetch all rows with pagination (Supabase caps at 1000 per request).
 *  queryFn: () => supabase.from('units').select(`...`) — must return a fresh query each call */
async function fetchAllPages(queryFn) {
  const PAGE = 1000
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn().order('id').range(from, from + PAGE - 1)
    if (error) return { data: all, error }
    all = all.concat(data ?? [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return { data: all, error: null }
}

export async function getUnits(supabase) {
  if (!supabase) return { data: [], error: new Error('Supabase не настроен') }
  try {
    let res = await fetchAllPages(() => supabase.from('units').select(`
      *,
      building:building_id (
        id,
        name,
        units_per_floor,
        units_per_entrance,
        handover_status,
        handover_quarter,
        handover_year,
        complex:complex_id (
          id,
          name,
          realtor_commission_type,
          realtor_commission_value,
          developer:developer_id (
            id,
            name,
            developer_managers (
              id,
              name,
              phone,
              short_description,
              messenger,
              created_at
            )
          )
        )
      )
    `))

    if (res.error && /handover_status|handover_quarter|handover_year/i.test(String(res.error.message || ''))) {
      // Backward compatibility: DB without handover columns on buildings.
      res = await fetchAllPages(() => supabase.from('units').select(`
        *,
        building:building_id (
          id,
          name,
          units_per_floor,
          units_per_entrance,
          complex:complex_id (
            id,
            name,
            realtor_commission_type,
            realtor_commission_value,
            developer:developer_id (
              id,
              name,
              developer_managers (
                id,
                name,
                phone,
                short_description,
                messenger,
                created_at
              )
            )
          )
        )
      `))
    }

    if (res.error && /units_per_entrance/i.test(String(res.error.message || ''))) {
      // Backward compatibility: DB without buildings.units_per_entrance (migration 014 not applied).
      // Handover-поля стараемся сохранить, если они есть.
      res = await fetchAllPages(() => supabase.from('units').select(`
        *,
        building:building_id (
          id,
          name,
          units_per_floor,
          handover_status,
          handover_quarter,
          handover_year,
          complex:complex_id (
            id,
            name,
            realtor_commission_type,
            realtor_commission_value,
            developer:developer_id (
              id,
              name,
              developer_managers (
                id,
                name,
                phone,
                short_description,
                messenger,
                created_at
              )
            )
          )
        )
      `))
      if (res.error && /handover_status|handover_quarter|handover_year/i.test(String(res.error.message || ''))) {
        // Самый старый fallback: без units_per_entrance и без handover-полей.
        res = await fetchAllPages(() => supabase.from('units').select(`
          *,
          building:building_id (
            id,
            name,
            units_per_floor,
            complex:complex_id (
              id,
              name,
              realtor_commission_type,
              realtor_commission_value,
              developer:developer_id (
                id,
                name,
                developer_managers (
                  id,
                  name,
                  phone,
                  short_description,
                  messenger,
                  created_at
                )
              )
            )
          )
        `))
      }
    }

    if (res.error) {
      console.error('getUnits error:', res.error)
      return { data: [], error: res.error }
    }

    console.log('[DEBUG getUnits]:', res.data)
    return { data: res.data ?? [], error: null }
  } catch (e) {
    console.error('getUnits exception:', e)
    return { data: [], error: e }
  }
}

/** Каталог /buildings: ЖК → дома → квартиры (+ обложка из images) */
export async function getComplexesWithNestedUnits(supabase) {
  if (!supabase) return { data: [], error: new Error('Supabase не настроен') }
  let res = await supabase
    .from('complexes')
    .select(
      `
      id,
      name,
      city,
      realtor_commission_type,
      realtor_commission_value,
      developer_id,
      developers (
        id,
        name
      ),
      buildings (
        id,
        name,
        floors,
        units_per_floor,
        units_per_entrance,
        units (
          id,
          floor,
          number,
          position,
          entrance,
          rooms,
          area,
          layout_title,
          layout_image_url,
          finish_image_url,
          price,
          price_per_meter,
          status,
          span_columns,
          span_floors,
          is_commercial
        )
      )
    `
    )
    .order('name')

  // Backward compatibility: в таблице units нет entrance / span (PostgREST: units_2.*).
  if (
    res.error &&
    /column units_\d+\.(entrance|span_columns|span_floors)\b/i.test(
      String(res.error.message || '')
    )
  ) {
    res = await supabase
      .from('complexes')
      .select(
        `
      id,
      name,
      city,
      realtor_commission_type,
      realtor_commission_value,
      developer_id,
      developers (
        id,
        name
      ),
      buildings (
        id,
        name,
        floors,
        units_per_floor,
        units_per_entrance,
        units (
          id,
          floor,
          number,
          position,
          rooms,
          area,
          layout_title,
          layout_image_url,
          finish_image_url,
          price,
          price_per_meter,
          status
        )
      )
    `
      )
      .order('name')
  }

  // Backward compatibility: DB without buildings.units_per_entrance (migration 014 not applied).
  if (res.error && /units_per_entrance/i.test(String(res.error.message || ''))) {
    res = await supabase
      .from('complexes')
      .select(
        `
      id,
      name,
      city,
      realtor_commission_type,
      realtor_commission_value,
      developer_id,
      developers (
        id,
        name
      ),
      buildings (
        id,
        name,
        floors,
        units_per_floor,
        units (
          id,
          floor,
          number,
          position,
          rooms,
          area,
          layout_title,
          layout_image_url,
          finish_image_url,
          price,
          price_per_meter,
          status
        )
      )
    `
      )
      .order('name')
  }

  if (res.error && /units_per_floor/i.test(String(res.error.message || ''))) {
    res = await supabase
      .from('complexes')
      .select(
        `
        id,
        name,
        city,
        realtor_commission_type,
        realtor_commission_value,
        developer_id,
        developers (
          id,
          name
        ),
        buildings (
          id,
          name,
          floors,
          units (
            id,
            floor,
            number,
            position,
            rooms,
            area,
            layout_title,
            layout_image_url,
            finish_image_url,
            price,
            price_per_meter,
            status
          )
        )
      `
      )
      .order('name')
  }

  if (res.error) return res
  const rows = res.data ?? []
  const ids = rows.map((c) => c.id)
  if (ids.length === 0) return { data: [], error: null }

  const { data: imgRows } = await supabase
    .from('images')
    .select('entity_id, url')
    .eq('entity_type', 'complex')
    .in('entity_id', ids)

  const urlByComplex = new Map()
  for (const row of imgRows ?? []) {
    if (row?.entity_id && !urlByComplex.has(row.entity_id)) {
      urlByComplex.set(row.entity_id, row.url)
    }
  }

  const data = rows.map((c) => ({
    ...c,
    image: urlByComplex.get(c.id) ?? null,
  }))

  // Поэтажный план корпуса хранится в images (entity_type = building_floor_plan)
  const buildingIds = []
  for (const c of rows ?? []) {
    for (const b of c.buildings ?? []) {
      if (b?.id) buildingIds.push(b.id)
    }
  }

  const uniqueBuildingIds = [...new Set(buildingIds)]
  if (uniqueBuildingIds.length === 0) return { data, error: null }

  const { data: floorPlanRows } = await supabase
    .from('images')
    .select('entity_id, url')
    .eq('entity_type', 'building_floor_plan')
    .in('entity_id', uniqueBuildingIds)

  const floorPlanByBuilding = new Map()
  for (const row of floorPlanRows ?? []) {
    if (row?.entity_id && !floorPlanByBuilding.has(row.entity_id)) {
      floorPlanByBuilding.set(row.entity_id, row.url)
    }
  }

  /** Поэтажные планы (admin/units → entity_type building_floor_level_plan). */
  let perLevelRows = []
  const perLevelRes = await supabase
    .from('images')
    .select('entity_id, floor_level, url, id')
    .eq('entity_type', 'building_floor_level_plan')
    .in('entity_id', uniqueBuildingIds)
    .order('id', { ascending: false })

  if (!perLevelRes.error && Array.isArray(perLevelRes.data)) {
    perLevelRows = perLevelRes.data
  }

  const floorPlanByBuildingAndLevel = new Map()
  for (const row of perLevelRows) {
    if (!row?.entity_id || row.floor_level == null) continue
    const key = `${row.entity_id}/${String(row.floor_level)}`
    if (!floorPlanByBuildingAndLevel.has(key)) {
      floorPlanByBuildingAndLevel.set(key, row.url)
    }
  }

  // Внедряем floorPlanUrl и floorPlanByFloor внутрь зданий
  const dataWithFloorPlans = data.map((c) => ({
    ...c,
    buildings: (c.buildings ?? []).map((b) => {
      const byFloor = {}
      for (const [key, url] of floorPlanByBuildingAndLevel) {
        const idx = key.lastIndexOf('/')
        if (idx === -1) continue
        const bid = key.slice(0, idx)
        const fl = key.slice(idx + 1)
        if (bid !== b.id) continue
        const n = Number(fl)
        if (!Number.isFinite(n)) continue
        if (!byFloor[n]) byFloor[n] = url
      }
      return {
        ...b,
        floorPlanUrl: floorPlanByBuilding.get(b.id) ?? null,
        floorPlanByFloor: byFloor,
      }
    }),
  }))

  return { data: dataWithFloorPlans, error: null }
}
