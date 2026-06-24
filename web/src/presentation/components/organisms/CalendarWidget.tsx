import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, AlignLeft, Info } from 'lucide-react';
import type { CalendarEvent } from '../../../domain/entities';

interface CalendarWidgetProps {
  events: CalendarEvent[];
  onSelectEvent?: (event: CalendarEvent) => void;
  onDoubleClickDateTime?: (dateTimeIso: string) => void;
  readOnly?: boolean;
}

type ViewMode = 'month' | 'week' | 'day';

export const CalendarWidget: React.FC<CalendarWidgetProps> = ({
  events,
  onSelectEvent,
  onDoubleClickDateTime,
  readOnly = false,
}) => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date()); // Start at current date
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  const daysOfWeek = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  // Helper: Parse event start/end date safely
  const parseEventDate = (dateStr: string): Date => {
    // If it's in YYYY-MM-DDTHH:mm:ss format or similar
    if (dateStr.includes('T')) {
      return new Date(dateStr);
    }
    // If it's YYYY-MM-DD HH:mm
    const cleaned = dateStr.replace(' ', 'T');
    return new Date(cleaned);
  };

  // Helper: check if two dates are the same calendar day
  const isSameDay = (d1: Date, d2: Date): boolean => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Get start of the current week (Monday)
  const getStartOfWeek = (d: Date): Date => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(date.setDate(diff));
  };

  // Get week dates starting from Monday
  const getWeekDates = (d: Date): Date[] => {
    const start = getStartOfWeek(d);
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const nextDate = new Date(start);
      nextDate.setDate(start.getDate() + i);
      dates.push(nextDate);
    }
    return dates;
  };

  // Get month grid days (including padding from previous/next months)
  const getMonthGridDays = (d: Date): Date[] => {
    const year = d.getFullYear();
    const month = d.getMonth();
    
    // First day of current month
    const firstDayOfMonth = new Date(year, month, 1);
    // Find index of first day (Monday = 0, Sunday = 6)
    let startDayIndex = firstDayOfMonth.getDay() - 1;
    if (startDayIndex < 0) startDayIndex = 6; // Sunday

    // Days in current month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const grid: Date[] = [];

    // Add days from previous month
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayIndex - 1; i >= 0; i--) {
      grid.push(new Date(year, month - 1, prevMonthDays - i));
    }

    // Add current month days
    for (let i = 1; i <= daysInMonth; i++) {
      grid.push(new Date(year, month, i));
    }

    // Add days from next month to make it complete grid of rows of 7
    const remaining = 42 - grid.length; // 6 rows of 7
    for (let i = 1; i <= remaining; i++) {
      grid.push(new Date(year, month + 1, i));
    }

    return grid;
  };

  // Navigation handlers
  const handlePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date()); // Go back to current date
  };

  // Read calendar colors from CSS custom properties (theme-aware)
  // Light themes define darker WCAG-accessible variants via --color-cal-*
  const getThemeCalendarColors = (): Record<string, string> => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const get = (prop: string, fallback: string) => {
      const val = style.getPropertyValue(prop).trim();
      return val || fallback;
    };
    return {
      class: get('--color-cal-class', '#0ea5e9'),
      evidence: get('--color-cal-evidence', '#10b981'),
      abp: get('--color-cal-abp', '#6366f1'),
      final: get('--color-cal-final', '#f43f5e'),
      colloquium: get('--color-cal-colloquium', '#f59e0b'),
      'notice-general': get('--color-cal-notice-general', '#d946ef'),
      'notice-professor': get('--color-cal-notice-professor', '#a855f7'),
    };
  };

  const defaultColors: Record<string, string> = getThemeCalendarColors();

  const [customColors, setCustomColors] = useState<Record<string, string>>(defaultColors);

  React.useEffect(() => {
    const loadColors = () => {
      const saved = localStorage.getItem('exam_colors');
      if (saved) {
        try {
          setCustomColors({ ...defaultColors, ...JSON.parse(saved) });
        } catch {}
      }
    };
    loadColors();
    window.addEventListener('exam-colors-changed', loadColors);
    return () => window.removeEventListener('exam-colors-changed', loadColors);
  }, []);

  // Helper: check if a day falls within the start-end range of an event
  const isDayInEventRange = (day: Date, e: CalendarEvent): boolean => {
    try {
      const startD = parseEventDate(e.start);
      const start = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate()).getTime();
      const endD = e.end ? parseEventDate(e.end) : startD;
      const end = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate()).getTime();
      
      const target = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      return target >= start && target <= end;
    } catch {
      return false;
    }
  };

  // Filter events for a given day (including multi-day duration)
  const getEventsForDay = (day: Date): CalendarEvent[] => {
    return events.filter(e => isDayInEventRange(day, e));
  };

  // Styling helper for event cards based on type and range position
  const getEventStyles = (day: Date, e: CalendarEvent) => {
    return 'cursor-pointer transition-all duration-150 hover:brightness-110 select-none shadow-sm rounded-lg p-2 ';
  };

  const getEventStyleProperties = (day: Date, e: CalendarEvent) => {
    const type = e._type === 'class'
      ? 'class'
      : e._type === 'notice'
        ? (e._noticeType === 'general' ? 'notice-general' : 'notice-professor')
        : (e._examType || 'evidence');
    const color = customColors[type] || defaultColors[type] || '#10b981';

    return {
      backgroundColor: `${color}15`, // Light semi-transparent backdrop
      color: color,
      border: 'none',
      borderRadius: '6px',
    };
  };

  const formatTimeRange = (e: CalendarEvent): string => {
    try {
      const startD = parseEventDate(e.start);
      let endD = e.end ? parseEventDate(e.end) : null;
      
      const formatTime = (d: Date) => {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      };

      if (endD && endD.getTime() !== startD.getTime()) {
        return `${formatTime(startD)} - ${formatTime(endD)}`;
      }
      return formatTime(startD);
    } catch {
      return '';
    }
  };

  const handleCellDoubleClick = (day: Date) => {
    if (!readOnly && onDoubleClickDateTime) {
      // Set to 09:00 AM local time
      const dateCopy = new Date(day);
      dateCopy.setHours(9, 0, 0, 0);
      onDoubleClickDateTime(dateCopy.toISOString());
    }
  };

  return (
    <div className="flex flex-col bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-xl p-4 text-[var(--color-text-primary)]">
      
      {/* Calendar Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-[var(--color-border)]">
        
        {/* Navigation & Title */}
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-[var(--color-bg-input)] rounded-lg p-1 border border-[var(--color-border)]">
            <button
              onClick={handlePrev}
              className="p-1.5 hover:bg-[var(--color-bg-card-hover)] rounded-md text-[var(--color-text-secondary)] hover:text-white transition-all"
              title="Anterior"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1 text-xs font-semibold hover:bg-[var(--color-bg-card-hover)] rounded-md text-[var(--color-text-secondary)] hover:text-white transition-all border-x border-[var(--color-border)]"
            >
              Hoy
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 hover:bg-[var(--color-bg-card-hover)] rounded-md text-[var(--color-text-secondary)] hover:text-white transition-all"
              title="Siguiente"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-lg font-bold flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-[var(--color-accent)]" />
            <span className="capitalize">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </span>
          </h2>
        </div>

        {/* View Mode Selectors */}
        <div className="flex bg-[var(--color-bg-input)] rounded-lg p-1 border border-[var(--color-border)] self-start sm:self-auto">
          <button
            onClick={() => setViewMode('month')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
              viewMode === 'month'
                ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Mes
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
              viewMode === 'week'
                ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Semana
          </button>
          <button
            onClick={() => setViewMode('day')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
              viewMode === 'day'
                ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Día
          </button>
        </div>

      </div>

      {/* View Contents */}

      {/* ── MONTH VIEW ── */}
      {viewMode === 'month' && (() => {
        const gridDays = getMonthGridDays(currentDate);
        const weeks: Date[][] = [];
        for (let i = 0; i < gridDays.length; i += 7) {
          weeks.push(gridDays.slice(i, i + 7));
        }

        const getWeekEventPosition = (weekDays: Date[], e: CalendarEvent) => {
          try {
            const startD = parseEventDate(e.start);
            const endD = e.end ? parseEventDate(e.end) : startD;

            const startDay = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate());
            const endDay = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate());

            const monday = new Date(weekDays[0].getFullYear(), weekDays[0].getMonth(), weekDays[0].getDate());
            const sunday = new Date(weekDays[6].getFullYear(), weekDays[6].getMonth(), weekDays[6].getDate());

            // Check if overlaps this week
            if (endDay.getTime() < monday.getTime() || startDay.getTime() > sunday.getTime()) {
              return null;
            }

            // Find indexes
            let startIdx = 0;
            if (startDay.getTime() > monday.getTime()) {
              startIdx = Math.round((startDay.getTime() - monday.getTime()) / (1000 * 60 * 60 * 24));
            }

            let endIdx = 6;
            if (endDay.getTime() < sunday.getTime()) {
              endIdx = Math.round((endDay.getTime() - monday.getTime()) / (1000 * 60 * 60 * 24));
            }

            return { startIdx, endIdx };
          } catch {
            return null;
          }
        };

        return (
          <div className="flex-1 flex flex-col min-h-[500px]">
            {/* Weekday labels */}
            <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-bold text-[var(--color-text-secondary)]">
              {daysOfWeek.map((day) => (
                <div key={day} className="py-2 border-b border-[var(--color-border)]">
                  {day}
                </div>
              ))}
            </div>

            {/* Grid of weeks */}
            <div className="flex flex-col gap-1 flex-1">
              {weeks.map((weekDays, weekIdx) => {
                // 1. Get all events that overlap this week
                const weekEvents = events.filter(e => getWeekEventPosition(weekDays, e) !== null);

                // 2. Sort events: longer duration first, then by ID
                const sortedWeekEvents = [...weekEvents].sort((a, b) => {
                  const posA = getWeekEventPosition(weekDays, a)!;
                  const posB = getWeekEventPosition(weekDays, b)!;
                  const durA = posA.endIdx - posA.startIdx;
                  const durB = posB.endIdx - posB.startIdx;
                  if (durA !== durB) return durB - durA; // descending
                  return a.id.localeCompare(b.id);
                });

                // 3. Assign tracks
                const tracks: boolean[][] = []; // occupied[track][day]
                const placedEvents: Array<{ event: CalendarEvent; startCol: number; endCol: number; track: number }> = [];

                sortedWeekEvents.forEach(e => {
                  const pos = getWeekEventPosition(weekDays, e)!;
                  let assignedTrack = 0;
                  
                  // Find first track that is free for all days between startIdx and endIdx
                  while (true) {
                    if (!tracks[assignedTrack]) {
                      tracks[assignedTrack] = Array(7).fill(false);
                    }
                    
                    let overlap = false;
                    for (let d = pos.startIdx; d <= pos.endIdx; d++) {
                      if (tracks[assignedTrack][d]) {
                        overlap = true;
                        break;
                      }
                    }
                    
                    if (!overlap) {
                      break;
                    }
                    assignedTrack++;
                  }

                  // Mark days as occupied
                  for (let d = pos.startIdx; d <= pos.endIdx; d++) {
                    tracks[assignedTrack][d] = true;
                  }

                  placedEvents.push({
                    event: e,
                    startCol: pos.startIdx + 1,
                    endCol: pos.endIdx + 2,
                    track: assignedTrack,
                  });
                });

                const maxVisibleTracks = 2;
                const hasMore = tracks.length > maxVisibleTracks;
                const visiblePlacedEvents = placedEvents.filter(pe => pe.track < maxVisibleTracks);

                return (
                  <div key={weekIdx} className="border border-[var(--color-border)] rounded-xl relative min-h-[100px] flex flex-col justify-between overflow-hidden bg-[var(--color-bg-card)]">
                    
                    {/* Background Grid Cells */}
                    <div className="grid grid-cols-7 gap-1 absolute inset-0 pointer-events-none">
                      {weekDays.map((day, idx) => {
                        const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                        const isToday = isSameDay(day, new Date());
                        return (
                          <div
                            key={idx}
                            className={`h-full border-r border-[var(--color-border)] last:border-r-0 ${
                              isCurrentMonth 
                                ? 'bg-[var(--color-bg-input)]/10' 
                                : 'bg-black/10 opacity-30'
                            } ${isToday ? 'bg-[var(--color-accent-muted)]/10 ring-1 ring-[var(--color-accent)] ring-inset' : ''}`}
                          />
                        );
                      })}
                    </div>

                    {/* Foreground Interactive Overlay (Days + Events) */}
                    <div className="relative z-10 p-2 flex-1 flex flex-col justify-between min-h-[90px]">
                      
                      {/* Day Numbers Row */}
                      <div className="grid grid-cols-7 gap-1 mb-1 pointer-events-none">
                        {weekDays.map((day, idx) => {
                          const isToday = isSameDay(day, new Date());
                          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                          return (
                            <div
                              key={idx}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCellDoubleClick(day);
                              }}
                              className="pointer-events-auto cursor-pointer"
                            >
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-block ${
                                  isToday 
                                    ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm' 
                                    : isCurrentMonth
                                      ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                                      : 'text-[var(--color-text-tertiary)] opacity-50'
                                }`}
                              >
                                {day.getDate()}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Events Grid Layer */}
                      <div className="grid grid-cols-7 gap-x-1 gap-y-1 mt-1 flex-1 relative min-h-[50px]">
                        {visiblePlacedEvents.map(({ event, startCol, endCol, track }) => {
                          const startD = parseEventDate(event.start);
                          const endD = event.end ? parseEventDate(event.end) : startD;
                          const isMultiDay = endD.getTime() - startD.getTime() > 0;
                          
                          const type = event._type === 'class'
                            ? 'class'
                            : event._type === 'notice'
                              ? (event._noticeType === 'general' ? 'notice-general' : 'notice-professor')
                              : (event._examType || 'evidence');
                          const color = customColors[type] || defaultColors[type] || '#10b981';
                          
                          const monday = new Date(weekDays[0].getFullYear(), weekDays[0].getMonth(), weekDays[0].getDate());
                          const sunday = new Date(weekDays[6].getFullYear(), weekDays[6].getMonth(), weekDays[6].getDate());
                          
                          const continuesBefore = startD.getTime() < monday.getTime();
                          const continuesAfter = endD.getTime() > sunday.getTime() + (24 * 60 * 60 * 1000 - 1000);

                          return (
                            <div
                              key={event.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onSelectEvent?.(event);
                              }}
                              style={{
                                gridColumn: `${startCol} / ${endCol}`,
                                gridRow: `${track + 1}`,
                                backgroundColor: `${color}15`,
                                color: color,
                                border: 'none',
                                borderTopLeftRadius: continuesBefore ? '0' : '4px',
                                borderBottomLeftRadius: continuesBefore ? '0' : '4px',
                                borderTopRightRadius: continuesAfter ? '0' : '4px',
                                borderBottomRightRadius: continuesAfter ? '0' : '4px',
                              }}
                              className="px-2 py-0.5 text-[9px] font-bold truncate cursor-pointer transition-all hover:brightness-110 flex items-center gap-1 shadow-sm leading-none h-5 select-none"
                              title={event.title}
                            >
                              {isMultiDay && !continuesBefore && <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                              <span className="truncate">{event.title}</span>
                            </div>
                          );
                        })}

                        {hasMore && (
                          <div
                            style={{
                              gridColumn: '1 / -1',
                              gridRow: `${maxVisibleTracks + 1}`,
                            }}
                            className="text-[8px] font-extrabold text-center text-[var(--color-text-tertiary)] py-0.5 bg-[var(--color-bg-sidebar)]/50 border border-[var(--color-border)]/50 rounded cursor-pointer hover:bg-[var(--color-bg-card-hover)] flex items-center justify-center h-4.5"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setViewMode('week');
                            }}
                          >
                            Ver más eventos...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── WEEK VIEW ── */}
      {viewMode === 'week' && (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-7 gap-3 min-h-[500px]">
          {getWeekDates(currentDate).map((day, idx) => {
            const dayEvents = getEventsForDay(day);
            const isToday = isSameDay(day, new Date()); // Dynamically resolve today

            return (
              <div
                key={idx}
                onDoubleClick={() => handleCellDoubleClick(day)}
                className={`flex flex-col border border-[var(--color-border)] rounded-xl p-3 min-h-[250px] relative transition-all ${
                  isToday 
                    ? 'bg-[var(--color-bg-input)]/70 ring-1 ring-[var(--color-accent)]' 
                    : 'bg-[var(--color-bg-input)]/30 hover:bg-[var(--color-bg-input)]/50'
                }`}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between mb-3 border-b border-[var(--color-border)] pb-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {daysOfWeek[idx]}
                    </span>
                    <span className="text-sm font-extrabold text-[var(--color-text-primary)]">
                      {day.getDate()}
                    </span>
                  </div>
                  {isToday && (
                    <span className="text-[9px] bg-[var(--color-accent-muted)] border border-[var(--color-accent)] text-[var(--color-accent)] px-1.5 py-0.5 rounded-full font-bold">
                      Hoy
                    </span>
                  )}
                </div>

                {/* Day's Event List */}
                <div className="flex-1 space-y-2 overflow-y-auto max-h-[380px] pr-1">
                  {dayEvents.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[10px] text-[var(--color-text-tertiary)] italic py-8">
                      Sin eventos
                    </div>
                  ) : (
                    dayEvents.map((e) => (
                      <div
                        key={e.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelectEvent?.(e);
                        }}
                        className={`p-2.5 rounded-lg border border-transparent cursor-pointer transition-all flex flex-col gap-1 shadow-sm ${getEventStyles(day, e)}`}
                        style={getEventStyleProperties(day, e)}
                      >
                        <span className="text-xs font-bold leading-snug line-clamp-2">
                          {e.title}
                        </span>
                        
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[9px] opacity-90">
                          {formatTimeRange(e) && (
                            <span className="bg-black/25 px-1.5 py-0.5 rounded font-mono">
                              {formatTimeRange(e)}
                            </span>
                          )}
                          {e.location && (
                            <span className="flex items-center gap-0.5 max-w-[120px] truncate" title={e.location}>
                              <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                              <span className="truncate">{e.location}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Quick Add indicator */}
                {!readOnly && (
                  <div className="mt-2 text-[9px] text-center text-[var(--color-text-tertiary)] opacity-0 hover:opacity-100 transition-opacity">
                    Doble click para agregar
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── DAY VIEW ── */}
      {viewMode === 'day' && (
        <div className="flex-1 flex flex-col md:flex-row gap-5 min-h-[400px]">
          
          {/* Day details card */}
          <div className="w-full md:w-64 bg-[var(--color-bg-input)] rounded-xl border border-[var(--color-border)] p-4 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
              {daysOfWeek[currentDate.getDay() === 0 ? 6 : currentDate.getDay() - 1]}
            </span>
            <span className="text-6xl font-black text-[var(--color-accent)] my-2">
              {currentDate.getDate()}
            </span>
            <span className="text-lg font-bold text-[var(--color-text-primary)]">
              {monthNames[currentDate.getMonth()]}
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)] mt-1">
              Año {currentDate.getFullYear()}
            </span>
            
            {!readOnly && (
              <button
                onClick={() => handleCellDoubleClick(currentDate)}
                className="mt-6 w-full py-2 bg-[var(--color-accent-muted)] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] rounded-lg text-xs font-bold transition-all"
              >
                Agregar Evento para Hoy
              </button>
            )}
          </div>

          {/* Day events timeline/list */}
          <div className="flex-1 flex flex-col">
            <h3 className="text-sm font-bold text-[var(--color-text-secondary)] mb-3 flex items-center gap-1.5">
              <AlignLeft className="w-4 h-4" />
              Eventos Programados
            </h3>

            <div className="flex-1 space-y-3 overflow-y-auto max-h-[380px] pr-2">
              {getEventsForDay(currentDate).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[var(--color-border)] rounded-xl">
                  <Info className="w-8 h-8 text-[var(--color-text-tertiary)] mb-2" />
                  <p className="text-sm text-[var(--color-text-secondary)] font-medium">
                    No hay eventos registrados para este día.
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    Haga doble click o use el panel lateral para crear uno.
                  </p>
                </div>
              ) : (
                getEventsForDay(currentDate).map((e) => (
                  <div
                    key={e.id}
                    onClick={() => onSelectEvent?.(e)}
                    className={`p-4 rounded-xl border border-transparent cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md ${getEventStyles(currentDate, e)}`}
                    style={getEventStyleProperties(currentDate, e)}
                  >
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-white leading-snug">
                        {e.title}
                      </h4>
                      {e.description && (
                        <p className="text-xs opacity-80 leading-relaxed max-w-xl">
                          {e.description}
                        </p>
                      )}
                    </div>

                    <div className="flex sm:flex-col items-end gap-2 text-xs flex-shrink-0">
                      {formatTimeRange(e) && (
                        <span className="bg-black/30 px-2 py-0.5 rounded font-mono font-semibold">
                          {formatTimeRange(e)}
                        </span>
                      )}
                      {e.location && (
                        <span className="flex items-center gap-1 opacity-90 max-w-[200px] truncate">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="truncate">{e.location}</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
