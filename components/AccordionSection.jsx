/**
 * Универсальная секция-аккордеон для фильтров и форм.
 */
export default function AccordionSection({
  title,
  isOpen,
  onToggle,
  children,
  className = '',
}) {
  return (
    <div
      className={`mb-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow ${className}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 text-left transition-colors duration-200 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      >
        <h2 className="font-bold text-gray-900">{title}</h2>
        <span
          className={`inline-block shrink-0 text-gray-500 transition-transform duration-200 ease-out ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="mt-3 transition-all duration-200 ease-out">{children}</div>
      )}
    </div>
  )
}
