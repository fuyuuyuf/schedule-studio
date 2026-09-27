const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateKey(value) {
  if (!DATE_PATTERN.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return formatDateKey(date) === value ? date : null;
}

export function formatDateKey(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addCalendarDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function normalizeRecurrence(input) {
  if (!input || input.enabled === false) return null;
  const frequency = ['daily', 'weekly', 'monthly', 'yearly'].includes(input.frequency) ? input.frequency : null;
  if (!frequency) throw new Error('重复频率必须是 daily、weekly、monthly 或 yearly');
  const interval = Math.max(1, Math.min(365, Math.trunc(Number(input.interval) || 1)));
  const count = input.count == null ? null : Math.max(1, Math.min(10000, Math.trunc(Number(input.count))));
  const until = input.until ? formatDateKey(parseDateKey(input.until) || new Date('invalid')) : null;
  if (input.until && !parseDateKey(input.until)) throw new Error('重复结束日期无效');
  const weekdays = [...new Set((input.weekdays || []).map(Number).filter(day => day >= 1 && day <= 7))].sort();
  return { frequency, interval, count, until, weekdays, exclusions: [...new Set((input.exclusions || []).filter(parseDateKey))].sort() };
}

function differenceInDays(left, right) {
  return Math.round((left.getTime() - right.getTime()) / 86400000);
}

function matchesRecurrence(date, start, recurrence) {
  const days = differenceInDays(date, start);
  if (days < 0) return false;
  if (recurrence.frequency === 'daily') return days % recurrence.interval === 0;
  if (recurrence.frequency === 'weekly') {
    const weekday = date.getDay() || 7;
    const allowedDays = recurrence.weekdays.length ? recurrence.weekdays : [start.getDay() || 7];
    return Math.floor(days / 7) % recurrence.interval === 0 && allowedDays.includes(weekday);
  }
  if (recurrence.frequency === 'monthly') {
    const months = (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
    return months >= 0 && months % recurrence.interval === 0 && date.getDate() === start.getDate();
  }
  const years = date.getFullYear() - start.getFullYear();
  return years >= 0 && years % recurrence.interval === 0 && date.getMonth() === start.getMonth() && date.getDate() === start.getDate();
}

// 只在请求的日期窗口内展开，避免无限重复日程占用内存。
export function expandRecurringSchedule(schedule, rangeStart, rangeEnd) {
  const recurrence = normalizeRecurrence(schedule.recurrence);
  if (!recurrence) return [schedule];
  const seriesStart = parseDateKey(schedule.startDate);
  const requestedStart = parseDateKey(rangeStart);
  const requestedEnd = parseDateKey(rangeEnd);
  if (!seriesStart || !requestedStart || !requestedEnd) return [];
  const durationDays = Math.max(0, differenceInDays(parseDateKey(schedule.endDate), seriesStart));
  const occurrences = [];
  let matchedCount = 0;
  let cursor = new Date(seriesStart);
  const hardEnd = recurrence.until ? parseDateKey(recurrence.until) : requestedEnd;
  const searchEnd = hardEnd < requestedEnd ? hardEnd : requestedEnd;
  const searchStart = addCalendarDays(requestedStart, -durationDays);
  while (cursor <= searchEnd) {
    if (matchesRecurrence(cursor, seriesStart, recurrence)) {
      matchedCount += 1;
      const key = formatDateKey(cursor);
      if ((!recurrence.count || matchedCount <= recurrence.count) && !recurrence.exclusions.includes(key) && cursor >= searchStart) {
        const occurrenceEnd = addCalendarDays(cursor, durationDays);
        occurrences.push({ ...schedule, seriesId: schedule.id, occurrenceDate: key, startDate: key, endDate: formatDateKey(occurrenceEnd), dates: [key, formatDateKey(occurrenceEnd)] });
      }
      if (recurrence.count && matchedCount >= recurrence.count) break;
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return occurrences;
}
