export const CATEGORY_LABELS: Record<string, string> = {
  SHOES: 'Обувь',
  CLOTHES: 'Легпром',
  MEDICINE: 'Лекарства / БАДы',
  WATER: 'Вода / Напитки',
  TOBACCO: 'Табак',
  OTHER: 'Другое',
};

export function formatCategory(category?: string | null): string {
  if (!category) return 'Маркировка';
  return CATEGORY_LABELS[category] || category;
}

export const CLIENT_STATUS_CONFIG: Record<
  string,
  { label: string; badgeClass: string; dotClass: string }
> = {
  LEAD: {
    label: 'Новый лид',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    dotClass: 'bg-slate-400',
  },
  IN_NEGOTIATION: {
    label: 'В переговорах',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  KP_SENT: {
    label: 'КП отправлено',
    badgeClass: 'bg-blue-50 text-[#0082FB] border-blue-200',
    dotClass: 'bg-[#0082FB]',
  },
  PAYMENT_PENDING: {
    label: 'Счёт на оплате',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
    dotClass: 'bg-teal-500',
  },
  IN_PROGRESS: {
    label: 'В работе',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  WON: {
    label: 'Оплачено / В работе',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-600',
  },
  LOST: {
    label: 'Отказ',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
    dotClass: 'bg-red-500',
  },
};

export function getStatusConfig(status?: string | null) {
  if (!status) {
    return {
      label: 'Не задан',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      dotClass: 'bg-slate-400',
    };
  }
  return (
    CLIENT_STATUS_CONFIG[status] || {
      label: status,
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
      dotClass: 'bg-slate-400',
    }
  );
}

const CONDITION_KEY_LABELS: Record<string, string> = {
  category: 'Категория',
  product: 'Товар',
  operation: 'Операция',
  role: 'Роль участника',
  effectiveFrom: 'Действует с',
  effectiveTo: 'Действует до',
  jurisdiction: 'Юрисдикция',
  exceptions: 'Исключения',
  exception: 'Исключение',
  threshold: 'Порог',
  note: 'Примечание',
  appliesTo: 'Применимо к',
  requirement: 'Требование',
};

export function formatConditions(conditions: unknown): { key: string; value: string }[] {
  if (conditions === null || conditions === undefined) return [];
  if (typeof conditions === 'string') {
    return conditions.trim() ? [{ key: 'Условие', value: conditions }] : [];
  }
  if (Array.isArray(conditions)) {
    return conditions
      .map((item, idx) => ({
        key: `Условие ${idx + 1}`,
        value: typeof item === 'string' ? item : JSON.stringify(item),
      }))
      .filter((x) => x.value);
  }
  if (typeof conditions === 'object') {
    return Object.entries(conditions as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && val !== '')
      .map(([k, val]) => ({
        key: CONDITION_KEY_LABELS[k] || k,
        value: Array.isArray(val)
          ? val.join(', ')
          : typeof val === 'object'
            ? JSON.stringify(val)
            : String(val),
      }));
  }
  return [{ key: 'Условие', value: String(conditions) }];
}

export function formatPhoneDigits(phone?: string | null): string {
  return phone ? phone.replace(/[\s\-\(\)\+]/g, '') : '';
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₸';
}

