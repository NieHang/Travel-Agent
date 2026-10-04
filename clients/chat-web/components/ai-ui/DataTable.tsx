import type { ComponentProps } from './types'
import { panelClass } from './styles'

export function DataTable({ component }: ComponentProps<'table'>) {
  return (
    <div className={`${panelClass} overflow-x-auto`}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="mb-3 text-left font-semibold">{component.title}</caption>
        <thead><tr>{component.columns.map(column => <th key={column.key} scope="col" className="border-b border-gray-200 bg-gray-50 px-3 py-2 font-medium">{column.label}</th>)}</tr></thead>
        <tbody>
          {component.rows.map(row => <tr key={row.id} className="hover:bg-gray-50">{component.columns.map(column => <td key={column.key} className="whitespace-pre-wrap border-b border-gray-100 px-3 py-2">{row.cells.find(cell => cell.key === column.key)?.value ?? '—'}</td>)}</tr>)}
          {component.rows.length === 0 && <tr><td colSpan={component.columns.length} className="p-4 text-center text-gray-500">暂无数据</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
