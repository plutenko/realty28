export async function fetchUnitsFromApi() {
  try {
    const res = await fetch('/api/units')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { data, error: null }
  } catch (e) {
    return { data: [], error: e }
  }
}

export async function fetchComplexesFromApi() {
  try {
    const res = await fetch('/api/complexes')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { data, error: null }
  } catch (e) {
    return { data: [], error: e }
  }
}
