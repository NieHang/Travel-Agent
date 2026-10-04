import type { ComponentProps } from './types'
import { panelClass } from './styles'

const statusLabel = { pending: '待完成', current: '进行中', completed: '已完成' }
const statusClass = { pending: 'border-gray-200 bg-gray-50 text-gray-500', current: 'border-blue-500 bg-blue-50 text-blue-700', completed: 'border-green-500 bg-green-50 text-green-700' }

export function StepsProgress({ component }: ComponentProps<'steps'>) {
  return (
    <section aria-label={component.title} className={panelClass}>
      <h3 className="mb-3 font-semibold">{component.title}</h3>
      <ol className="flex flex-col gap-2 sm:flex-row">
        {component.items.map((item, index) => <li key={item.id} aria-current={item.status === 'current' ? 'step' : undefined} className={`flex flex-1 items-center gap-2 rounded-lg border p-3 ${statusClass[item.status]}`}>
          <span aria-hidden="true" className="font-semibold">{item.status === 'completed' ? '✓' : index + 1}</span>
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{item.label}</span><span className="block text-xs">{statusLabel[item.status]}</span></span>
        </li>)}
      </ol>
    </section>
  )
}
