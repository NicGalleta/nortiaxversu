import { useMemo, useRef, useState } from 'react'
import { createSortedRowModel, rowSortingFeature, tableFeatures, useTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { compareAmounts, formatAmount, formatDate } from '../../../shared/format.js'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const typeLabels = {
  proveedor: 'Proveedor',
  sueldos: 'Sueldos',
  arriendo: 'Arriendo',
  impuestos: 'Impuestos',
  servicios: 'Servicios',
  credito_bancario: 'Crédito bancario',
}
const columns = [
  { accessorKey: 'id_obligacion', header: 'Referencia', enableSorting: false },
  { accessorKey: 'acreedor', header: 'Acreedor', enableSorting: false },
  { accessorKey: 'descripcion', header: 'Descripción', enableSorting: false },
  { accessorKey: 'tipo', header: 'Tipo', enableSorting: false, cell: ({ getValue }) => typeLabels[getValue()] ?? getValue() },
  {
    accessorKey: 'fecha_vencimiento', header: 'Vencimiento', sortDescFirst: false,
    sortFn: (a, b, id) => a.getValue(id).localeCompare(b.getValue(id)),
    cell: ({ getValue }) => <time dateTime={getValue()}>{formatDate(getValue())}</time>,
  },
  {
    accessorKey: 'monto', header: 'Monto', sortDescFirst: true,
    sortFn: (a, b, id) => compareAmounts(a.getValue(id), b.getValue(id)),
    cell: ({ getValue }) => formatAmount(getValue()),
  },
]
const inputClass = 'h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-stone-700 focus:ring-2 focus:ring-stone-200'
const rowHeight = 52
const headerHeight = 44

function searchable(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-CL')
}

export default function ObligationsTable({ obligations, fechaCorte }) {
  // TanStack Virtual v3 requires live reads from its mutable virtualizer instance.
  'use no memo'

  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const scrollRef = useRef(null)
  const filtered = useMemo(() => {
    const query = searchable(search.trim())
    return obligations.filter((obligation) => (
      (!type || obligation.tipo === type)
      && (!query || [obligation.id_obligacion, obligation.acreedor, obligation.descripcion]
        .some((value) => searchable(value).includes(query)))
    ))
  }, [obligations, search, type])
  const table = useTable({
    features, columns, data: filtered,
    getRowId: (row) => row.id_obligacion,
    initialState: { sorting: [{ id: 'fecha_vencimiento', desc: false }] },
    enableMultiSort: false,
    enableSortingRemoval: false,
  })
  const rows = table.getRowModel().rows
  // This component intentionally reads Virtual's mutable instance on each render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index].id,
    overscan: 6,
    scrollMargin: headerHeight,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = virtualRows.length ? virtualRows[0].start - headerHeight : 0
  const paddingBottom = virtualRows.length
    ? Math.max(0, virtualizer.getTotalSize() - (virtualRows.at(-1).end - headerHeight))
    : 0

  function resetScroll() {
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function clearFilters() {
    setSearch('')
    setType('')
    resetScroll()
  }

  return (
    <section aria-labelledby="obligations-title" className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex items-center justify-between gap-6 border-b border-stone-200 p-6">
        <div>
          <h2 id="obligations-title" className="font-semibold">Obligaciones pendientes</h2>
          <p className="mt-1 text-xs text-stone-500">Todas las obligaciones pendientes de la importación activa.</p>
        </div>
        <p role="status" className="text-sm text-stone-500">{rows.length.toLocaleString('es-CL')} de {obligations.length.toLocaleString('es-CL')}</p>
      </div>

      {obligations.length === 0 ? (
        <p className="px-6 py-12 text-sm text-stone-600">No hay obligaciones pendientes en esta importación.</p>
      ) : (
        <>
          <div className="flex gap-4 border-b border-stone-200 px-6 py-4">
            <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-stone-600">
              Buscar obligaciones
              <input
                type="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); resetScroll() }}
                placeholder="Acreedor, descripción o referencia"
                className={inputClass}
              />
            </label>
            <label className="flex w-56 flex-col gap-1.5 text-xs font-medium text-stone-600">
              Tipo de obligación
              <select value={type} onChange={(event) => { setType(event.target.value); resetScroll() }} className={inputClass}>
                <option value="">Todos los tipos</option>
                {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-medium">No encontramos obligaciones con estos filtros</p>
              <p className="mt-2 text-sm text-stone-600">Prueba otro acreedor, referencia o tipo.</p>
              <button onClick={clearFilters} className="mt-4 rounded-md px-3 py-2 text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-stone-900">
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div ref={scrollRef} tabIndex={0} role="region" aria-label="Lista de obligaciones pendientes" className="h-96 overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-stone-600">
              <table aria-rowcount={rows.length + 1} className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
                <caption className="sr-only">Obligaciones pendientes. Fechas anteriores al corte aparecen como vencidas. Ordena por vencimiento o monto.</caption>
                <colgroup>
                  <col className="w-[13%]" /><col className="w-[20%]" /><col className="w-[25%]" />
                  <col className="w-[14%]" /><col className="w-[13%]" /><col className="w-[15%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-stone-50">
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id} aria-rowindex={1} className="h-11">
                      {group.headers.map((header) => {
                        const sorted = header.column.getIsSorted()
                        return (
                          <th
                            key={header.id}
                            scope="col"
                            aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                            className={`border-b border-stone-200 px-4 text-xs font-semibold text-stone-600 ${header.id === 'monto' ? 'text-right' : ''}`}
                          >
                            {header.column.getCanSort() ? (
                              <button
                                className="inline-flex items-center gap-1 rounded py-2 focus-visible:outline-2 focus-visible:outline-stone-900"
                                onClick={() => { header.column.toggleSorting(); resetScroll() }}
                              >
                                <table.FlexRender header={header} />
                                <span aria-hidden="true">{sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}</span>
                              </button>
                            ) : <table.FlexRender header={header} />}
                          </th>
                        )
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {paddingTop > 0 && <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: paddingTop }} /></tr>}
                  {virtualRows.map((virtualRow) => {
                    const row = rows[virtualRow.index]
                    const overdue = row.original.fecha_vencimiento < fechaCorte
                    return (
                      <tr key={row.id} aria-rowindex={virtualRow.index + 2} className="h-[52px] hover:bg-stone-50">
                        {row.getAllCells().map((cell) => (
                          <td
                            key={cell.id}
                            title={cell.column.id === 'descripcion' || cell.column.id === 'acreedor' ? cell.getValue() : undefined}
                            className={`truncate border-b border-stone-100 px-4 py-3 ${cell.column.id === 'monto' ? 'text-right font-medium tabular-nums' : cell.column.id === 'fecha_vencimiento' && overdue ? 'font-medium text-amber-800' : 'text-stone-600'}`}
                          >
                            <table.FlexRender cell={cell} />
                            {cell.column.id === 'fecha_vencimiento' && overdue && <span className="sr-only"> (vencida al corte)</span>}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  {paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: paddingBottom }} /></tr>}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-stone-200 px-6 py-3 text-xs text-stone-500">Fechas en ámbar: vencidas al corte del {formatDate(fechaCorte)}. Montos en moneda local.</p>
        </>
      )}
    </section>
  )
}
