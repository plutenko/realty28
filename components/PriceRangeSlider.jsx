/**
 * rc-slider v11+: отдельного `Range` нет — используйте Slider с range.
 * Эквивалент старого:
 *   import Slider, { Range } from 'rc-slider'
 *   <Range ... />  →  <Slider range ... />
 */
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'

const MIN = 0
const MAX = 15000000
const STEP = 100000

export default function PriceRangeSlider({ value, onChange }) {
  return (
    <div className="px-0.5 py-2">
      <Slider
        range
        min={MIN}
        max={MAX}
        step={STEP}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
