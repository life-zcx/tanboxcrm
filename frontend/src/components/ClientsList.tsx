import React, { useEffect, useRef, useState } from 'react';
import { Client, api } from '../api';
import {
  Search,
  Building2,
  ChevronDown,
  MessageCircle,
  ArrowRight,
  Plus,
  X,
} from 'lucide-react';
import { formatCategory, formatPhoneDigits, getStatusConfig } from '../utils/labels';

interface ClientsListProps {
  initialFilters: { search: string; status: string; category: string };
  clients: Client[];
  onSelectClient: (client: Client) => void;
  onRefresh: () => void;
  onFiltersChange: (filters: { search: string; status: string; category: string }) => void;
}

export const ClientsList: React.FC<ClientsListProps> = ({
  clients,
  onSelectClient,
  onRefresh,
  onFiltersChange,
  initialFilters,
}) => {
  const [search, setSearch] = useState(initialFilters.search);
  const [selectedCategory, setSelectedCategory] = useState(initialFilters.category);
  const [selectedStatus, setSelectedStatus] = useState(initialFilters.status);

  useEffect(() => {
    setSearch(initialFilters.search);
    setSelectedCategory(initialFilters.category);
    setSelectedStatus(initialFilters.status);
  }, [initialFilters]);

  const filterCallback = useRef(onFiltersChange);
  filterCallback.current = onFiltersChange;
  useEffect(() => {
    const timer = setTimeout(
      () =>
        filterCallback.current({
          search,
          status: selectedStatus,
          category: selectedCategory,
        }),
      300
    );
    return () => clearTimeout(timer);
  }, [search, selectedStatus, selectedCategory]);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      search === '' ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone && c.phone.includes(search)) ||
      (c.company && c.company.toLowerCase().includes(search.toLowerCase())) ||
      (c.binIin && c.binIin.includes(search));

    const matchesCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
    const matchesStatus = selectedStatus === 'ALL' || c.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.createClient({ name, phone: phone || null });
      setName('');
      setPhone('');
      setAdding(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить клиента');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search, Filters & Add Action */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2.5 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени, телефону, БИН или компании..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0082FB] focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative">
              <select
                aria-label="Фильтр по категории"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-[#0082FB] appearance-none cursor-pointer"
              >
                <option value="ALL">Все категории товаров</option>
                <option value="SHOES">Обувь</option>
                <option value="CLOTHES">Легпром / Одежда</option>
                <option value="MEDICINE">Лекарства / БАДы</option>
                <option value="WATER">Вода / Напитки</option>
                <option value="TOBACCO">Табак</option>
                <option value="OTHER">Другое</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="relative">
              <select
                aria-label="Фильтр по статусу"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-[#0082FB] appearance-none cursor-pointer"
              >
                <option value="ALL">Все статусы ({clients.length})</option>
                <option value="LEAD">Новые лиды</option>
                <option value="IN_NEGOTIATION">В переговорах</option>
                <option value="KP_SENT">КП отправлено</option>
                <option value="PAYMENT_PENDING">Счёт на оплате</option>
                <option value="IN_PROGRESS">В работе</option>
                <option value="WON">Оплачено / В работе</option>
                <option value="LOST">Отказ</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setError('');
            setAdding((v) => !v);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold transition-colors shrink-0"
        >
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          <span>Добавить клиента</span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-xs font-medium"
        >
          {error}
        </p>
      )}

      {adding && (
        <form
          className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3"
          onSubmit={handleCreate}
        >
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              Имя или название компании
            </label>
            <input
              aria-label="Имя нового клиента"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя клиента"
              className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
            />
          </div>
          <div className="w-full sm:w-56 space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              Телефон WhatsApp
            </label>
            <input
              aria-label="Телефон нового клиента"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 777 000 00 00"
              className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-[#0082FB] focus:bg-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              {saving ? 'Сохранение…' : 'Сохранить клиента'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {/* Full-width Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Клиент / Организация</th>
                <th className="py-3 px-4">Товар и объём</th>
                <th className="py-3 px-4">WhatsApp контакт</th>
                <th className="py-3 px-4">Контекст и следующий шаг</th>
                <th className="py-3 px-4">Статус сделки</th>
                <th className="py-3 px-4 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredClients.map((client) => {
                const st = getStatusConfig(client.status);
                const rawPhone = formatPhoneDigits(client.phone);

                return (
                  <tr
                    key={client.id}
                    onClick={() => onSelectClient(client)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900 text-[13px]">
                        {client.name}
                      </div>
                      <div className="text-slate-500 text-[11px] flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>
                          {client.company || 'Физлицо'}
                          {client.binIin ? ` · БИН ${client.binIin}` : ''}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 inline-block mb-1">
                        {formatCategory(client.category)}
                      </span>
                      <div className="text-slate-600 font-medium text-[11px] tabular-nums">
                        {client.estimatedVolume
                          ? `${client.estimatedVolume.toLocaleString('ru-RU')} пар/шт`
                          : 'Объем не указан'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                      {rawPhone ? (
                        <a
                          href={`https://wa.me/${rawPhone}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold transition-colors tabular-nums"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>{client.phone}</span>
                        </a>
                      ) : (
                        <span className="text-slate-400 text-xs">Без номера</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 max-w-md">
                      {client.aiSummary && (
                        <p className="text-slate-600 line-clamp-1 mb-1 text-[11px]">
                          {client.aiSummary}
                        </p>
                      )}
                      {client.aiNextStep && (
                        <div className="text-[11px] text-[#0082FB] font-semibold flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 shrink-0" />
                          <span className="line-clamp-1">{client.aiNextStep}</span>
                        </div>
                      )}
                      {!client.aiSummary && !client.aiNextStep && (
                        <span className="text-slate-400 text-[11px]">Нет сводки</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border ${st.badgeClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dotClass}`} />
                        <span>{st.label}</span>
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectClient(client);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0082FB] hover:bg-[#0070D8] text-white text-xs font-semibold transition-colors"
                      >
                        <span>Переговоры</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredClients.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                    Клиенты не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
