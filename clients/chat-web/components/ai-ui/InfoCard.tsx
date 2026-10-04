import type { ComponentProps } from './types'
import { panelClass } from './styles'

export function InfoCard({ component }: ComponentProps<'card'>) {
  return (
    <section aria-label={component.title} className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{component.title}</h3>
        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{component.sourceStatus === 'verified' ? '已核实' : '未核实'}</span>
      </div>
      <p className="my-3 whitespace-pre-wrap break-words text-sm text-gray-600">{component.description}</p>
      <dl className="space-y-2 text-sm">
        {component.details.map((detail, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3"><dt className="break-words text-gray-500">{detail.label}</dt><dd className="whitespace-pre-wrap break-words">{detail.value}</dd></div>)}
      </dl>
    </section>
  )
}
