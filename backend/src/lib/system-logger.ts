export interface LogEntry {
  id: string;
  timestamp: string;
  timeFormatted: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'WHATSAPP';
  category: 'SYSTEM' | 'BACKEND' | 'FRONTEND' | 'WHATSAPP' | 'AUTH' | 'CRM';
  message: string;
  details?: any;
}

class SystemLogger {
  private buffer: LogEntry[] = [];
  private maxEntries = 2000;
  private isHooked = false;

  constructor() {
    this.hookConsole();
  }

  log(
    category: LogEntry['category'],
    level: LogEntry['level'],
    message: string,
    details?: any
  ) {
    const now = new Date();
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: now.toISOString(),
      timeFormatted: now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      level,
      category,
      message,
      details,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }
  }

  getLogs(limit = 500, category?: string, level?: string, search?: string): LogEntry[] {
    let result = this.buffer;

    if (category && category !== 'ALL') {
      result = result.filter((e) => e.category === category);
    }

    if (level && level !== 'ALL') {
      result = result.filter((e) => e.level === level);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.level.toLowerCase().includes(q) ||
          (e.details && JSON.stringify(e.details).toLowerCase().includes(q))
      );
    }

    return result.slice(-limit);
  }

  clear() {
    this.buffer = [];
    this.log('SYSTEM', 'INFO', 'Логи очищены администратором');
  }

  private hookConsole() {
    if (this.isHooked) return;
    this.isHooked = true;

    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = (...args: any[]) => {
      origLog(...args);
      const text = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
      const isWA =
        text.toLowerCase().includes('whatsapp') ||
        text.toLowerCase().includes('baileys') ||
        text.startsWith('[WhatsApp]');
      const isCRM = text.startsWith('[CRM]');
      const cat = isWA ? 'WHATSAPP' : isCRM ? 'CRM' : 'BACKEND';
      this.log(cat, isWA ? 'WHATSAPP' : 'INFO', text);
    };

    console.warn = (...args: any[]) => {
      origWarn(...args);
      const text = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
      const isWA =
        text.toLowerCase().includes('whatsapp') ||
        text.toLowerCase().includes('baileys') ||
        text.startsWith('[WhatsApp]');
      this.log(isWA ? 'WHATSAPP' : 'BACKEND', 'WARN', text);
    };

    console.error = (...args: any[]) => {
      origError(...args);
      const text = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
      const isWA =
        text.toLowerCase().includes('whatsapp') ||
        text.toLowerCase().includes('baileys') ||
        text.startsWith('[WhatsApp]');
      this.log(isWA ? 'WHATSAPP' : 'BACKEND', 'ERROR', text);
    };

    this.log('SYSTEM', 'INFO', 'Единая система логирования TANBOX CRM запущена (Backend + Frontend + WhatsApp)');
  }
}

export const systemLogger = new SystemLogger();
