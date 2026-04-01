export default function ApartmentCard({ apartment, selected, onSelect }) {
  const { price, complex, district, rooms, area, floor } = apartment ?? {};

  const pills = [];

  if (apartment?.layout_image_url) {
    pills.push({ label: 'Планировка', className: 'bg-orange-500' });
  }

  if (apartment?.finish_image_url) {
    pills.push({ label: 'Отделка', className: 'bg-sky-500' });
  }

  if (!pills.length) {
    pills.push({ label: 'Без медиа', className: 'bg-gray-400' });
  }

  if (apartment?.orientation) {
    pills.push({
      label: `Сторона: ${apartment.orientation}`,
      className: 'bg-slate-700',
    });
  }

  return (
    <div
      onClick={onSelect}
      className={`bg-white border rounded-2xl p-4 cursor-pointer transition hover:shadow-md ${
        selected ? 'ring-2 ring-orange-500' : ''
      }`}
    >
      <div className="text-xl font-bold text-orange-500">
        {typeof price === 'number' ? price.toLocaleString() : price} ₽
      </div>

      <div className="font-medium text-gray-900">{complex}</div>

      <div className="text-sm text-gray-600">{district}</div>

      <div className="text-sm mt-1 text-gray-800">
        {rooms === 0
          ? 'Студия'
          : rooms >= 5
            ? '5+'
            : `${rooms}к`}{' '}
        • {area}м² • {floor} этаж
      </div>

      <div className="mt-3">
        <div className="flex gap-2 flex-wrap">
          {pills.slice(0, 3).map((p) => (
            <div
              key={p.label}
              className={`text-white px-2 py-1 rounded text-xs inline-block ${p.className}`}
            >
              {p.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

