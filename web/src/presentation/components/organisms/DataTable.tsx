import React, { useState } from 'react';
import { SearchBar } from '../molecules/SearchBar';
import { TableRow } from '../molecules/TableRow';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { Button } from '../atoms/Button';

interface DataTableAction<T> {
  icon: 'edit' | 'delete' | 'view' | 'chat';
  label: string;
  onClick: (item: T) => void;
  variant?: 'danger' | 'ghost' | 'outline';
  disabled?: (item: T) => boolean;
  className?: (item: T) => string;
  badgeCount?: (item: T) => number;
}

interface DataTableProps<T> {
  headers: string[];
  data: T[];
  searchPlaceholder?: string;
  searchFields?: (keyof T)[];
  renderRowCells: (item: T) => React.ReactNode[];
  actions?: DataTableAction<T>[];
  onRowClick?: (item: T) => void;
  itemsPerPage?: number;
  className?: string;
  rowClassName?: (item: T) => string;
}

export function DataTable<T>({
  headers,
  data,
  searchPlaceholder = 'Buscar...',
  searchFields = [],
  renderRowCells,
  actions = [],
  onRowClick,
  itemsPerPage = 10,
  className = '',
  rowClassName,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Filter items
  const filteredData = data.filter((item) => {
    if (!searchQuery || searchFields.length === 0) return true;
    return searchFields.some((field) => {
      const val = item[field];
      if (val === null || val === undefined) return false;
      return String(val).toLowerCase().includes(searchQuery.toLowerCase());
    });
  });

  // Calculate pagination
  const totalItems = filteredData.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1); // Reset page to 1 when searching
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top search actions bar */}
      {searchFields.length > 0 && (
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="max-w-md w-full">
            <SearchBar
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
            />
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] font-medium">
            Mostrando {Math.min(startIndex + 1, totalItems)}-{Math.min(startIndex + itemsPerPage, totalItems)} de {totalItems} registros
          </div>
        </div>
      )}

      {/* Table grid wrapper */}
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-xl shadow-sm bg-[var(--color-bg-card)]">
        <table className="min-w-full divide-y divide-[var(--color-border)] text-left table-auto">
          <thead className="bg-[var(--color-bg-sidebar)]">
            <tr>
              {headers.map((header, idx) => (
                <th
                  key={idx}
                  className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
              {actions.length > 0 && (
                <th className="px-6 py-3.5 text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider text-right whitespace-nowrap">
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {paginatedData.length > 0 ? (
              paginatedData.map((item, rowIdx) => {
                const cells = renderRowCells(item);
                const mappedActions = actions.map((act) => ({
                  icon: act.icon,
                  label: act.label,
                  variant: act.variant,
                  disabled: act.disabled ? act.disabled(item) : false,
                  onClick: () => act.onClick(item),
                  className: act.className ? act.className(item) : undefined,
                  badgeCount: act.badgeCount ? act.badgeCount(item) : undefined,
                }));

                return (
                  <TableRow
                    key={rowIdx}
                    cells={cells}
                    actions={mappedActions}
                    onClick={onRowClick ? () => onRowClick(item) : undefined}
                    className={rowClassName ? rowClassName(item) : ''}
                  />
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={headers.length + (actions.length > 0 ? 1 : 0)}
                  className="px-6 py-12 text-center text-[var(--color-text-tertiary)]"
                >
                  <div className="flex flex-col items-center justify-center">
                    <Inbox className="w-10 h-10 text-[var(--color-border)] mb-2" />
                    <span className="text-sm font-semibold">No se encontraron registros</span>
                    <span className="text-xs mt-1">Intentá cambiar la búsqueda o verificar los filtros.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-[var(--color-text-tertiary)]">
            Página {currentPage} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="!p-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: totalPages }).map((_, idx) => {
              const pageNum = idx + 1;
              const isCurrent = pageNum === currentPage;
              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`
                    w-8 h-8 rounded-lg text-xs font-semibold cursor-pointer transition-colors
                    ${isCurrent
                      ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)]'
                      : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                    }
                  `}
                >
                  {pageNum}
                </button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="!p-2"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
export default DataTable;
