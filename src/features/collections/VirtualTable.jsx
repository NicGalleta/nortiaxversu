import { useRef } from 'react'
import { tableFeatures, useTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
const features = tableFeatures({})

export default function VirtualTable({ rows: data, columns, label, getRowId, rowHeight = 72 }) {
  'use no memo'
  const scroll = useRef(null)
  const table = useTable({ features, columns, data, getRowId })
  const rows = table.getRowModel().rows
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight, getItemKey: index => rows[index].id, overscan: 5, scrollMargin: 44,
    initialRect: { width: 1100, height: 432 } })
  const items = virtual.getVirtualItems()
  const top = items.length ? Math.max(0, items[0].start - 44) : 0
  const bottom = items.length ? Math.max(0, virtual.getTotalSize() - (items.at(-1).end - 44)) : 0
  return <div ref={scroll} tabIndex={0} role="region" aria-label={label} className="h-[432px] overflow-auto rounded-lg border border-stone-200 bg-white focus-visible:outline-2 focus-visible:outline-stone-700">
    <table className="w-full min-w-[1000px] table-fixed border-separate border-spacing-0 text-left text-sm" aria-rowcount={rows.length + 1}>
      <caption className="sr-only">{label}</caption>
      <colgroup>{columns.map(column => <col key={column.id ?? column.accessorKey} style={{ width: column.size }} />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-stone-50">{table.getHeaderGroups().map(group => <tr key={group.id} className="h-11" aria-rowindex={1}>{group.headers.map(header => <th key={header.id} scope="col" className="border-b border-stone-200 px-3 text-xs font-semibold text-stone-600"><table.FlexRender header={header} /></th>)}</tr>)}</thead>
      <tbody>
        {top > 0 && <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: top }} /></tr>}
        {items.map(item => <tr key={rows[item.index].id} aria-rowindex={item.index + 2} style={{ height: rowHeight }} className="hover:bg-stone-50">{rows[item.index].getAllCells().map(cell => <td key={cell.id} className="overflow-hidden border-b border-stone-100 px-3 py-2 align-middle"><table.FlexRender cell={cell} /></td>)}</tr>)}
        {bottom > 0 && <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: bottom }} /></tr>}
      </tbody>
    </table>
    {!rows.length && <p role="status" className="p-10 text-center text-sm text-stone-600">No hay registros para esta selección.</p>}
  </div>
}
